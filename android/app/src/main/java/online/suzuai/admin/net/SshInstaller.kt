package online.suzuai.admin.net

import com.jcraft.jsch.ChannelExec
import com.jcraft.jsch.JSch
import com.jcraft.jsch.Session
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOn
import java.io.BufferedReader
import java.io.InputStreamReader

/**
 * SSH helper that connects to a fresh VPS using password auth, runs Suzu AI's
 * installer one-liner from GitHub, and streams each output line back via a Flow.
 *
 * The installer script lives at https://github.com/hairunnizam21/script_ai_panel
 * (branch `setup`) and prepares the VPS to host suzu-ai-web.
 */
object SshInstaller {

    private const val INSTALLER_URL =
        "https://raw.githubusercontent.com/hairunnizam21/script_ai_panel/setup/install.sh"

    sealed interface Event {
        data class Line(val text: String) : Event
        data class Done(val exitCode: Int) : Event
        data class Error(val message: String) : Event
    }

    fun runInstall(
        host: String,
        port: Int,
        user: String,
        password: String,
        domain: String,
        apiBaseUrl: String,
        apiKey: String,
        defaultModel: String,
    ): Flow<Event> = flow {
        var session: Session? = null
        var channel: ChannelExec? = null
        try {
            val jsch = JSch()
            session = jsch.getSession(user, host, port)
            session.setPassword(password)
            val config = java.util.Properties().apply {
                put("StrictHostKeyChecking", "no")
                put("PreferredAuthentications", "password,keyboard-interactive")
            }
            session.setConfig(config)
            session.connect(15000)

            // Compose installer command. We run it non-interactively by feeding env
            // vars the install.sh respects so it skips the prompts.
            val cmd = buildString {
                append("set -e; export DEBIAN_FRONTEND=noninteractive; ")
                append("export SUZU_DOMAIN=${shellEscape(domain)}; ")
                append("export AI_API_BASE_URL=${shellEscape(apiBaseUrl)}; ")
                append("export AI_API_KEY=${shellEscape(apiKey)}; ")
                append("export AI_DEFAULT_MODEL=${shellEscape(defaultModel)}; ")
                append("curl -fsSL '")
                append(INSTALLER_URL)
                append("' | bash -s -- --noninteractive 2>&1")
            }

            channel = session.openChannel("exec") as ChannelExec
            channel.setCommand(cmd)
            channel.setErrStream(System.err)
            val input = channel.inputStream
            channel.connect()

            val reader = BufferedReader(InputStreamReader(input))
            while (true) {
                val line = reader.readLine() ?: break
                emit(Event.Line(line))
            }
            // Drain remaining output then collect exit status
            while (!channel.isClosed) {
                Thread.sleep(120)
            }
            val code = channel.exitStatus
            emit(Event.Done(code))
        } catch (t: Throwable) {
            emit(Event.Error(t.message ?: t::class.java.simpleName))
        } finally {
            channel?.disconnect()
            session?.disconnect()
        }
    }.flowOn(Dispatchers.IO)

    /** Run a one-off SSH command and return all stdout as a string. */
    suspend fun runOnce(
        host: String,
        port: Int,
        user: String,
        password: String,
        command: String,
    ): Result<String> = kotlinx.coroutines.withContext(Dispatchers.IO) {
        var session: Session? = null
        var channel: ChannelExec? = null
        try {
            val jsch = JSch()
            session = jsch.getSession(user, host, port)
            session.setPassword(password)
            session.setConfig(java.util.Properties().apply {
                put("StrictHostKeyChecking", "no")
                put("PreferredAuthentications", "password,keyboard-interactive")
            })
            session.connect(15000)
            channel = session.openChannel("exec") as ChannelExec
            channel.setCommand(command)
            channel.setErrStream(System.err)
            val out = channel.inputStream.bufferedReader().use { it.readText() }
            channel.connect()
            while (!channel.isClosed) Thread.sleep(100)
            Result.success(out)
        } catch (t: Throwable) {
            Result.failure(t)
        } finally {
            channel?.disconnect()
            session?.disconnect()
        }
    }

    private fun shellEscape(s: String): String {
        if (s.isEmpty()) return "''"
        return "'" + s.replace("'", "'\\''") + "'"
    }
}
