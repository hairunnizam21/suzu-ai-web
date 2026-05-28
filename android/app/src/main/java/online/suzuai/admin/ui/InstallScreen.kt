package online.suzuai.admin.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import online.suzuai.admin.data.Prefs
import online.suzuai.admin.net.SshInstaller

@Composable
fun InstallScreen(onBack: () -> Unit, onInstalled: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()

    val host = remember { Prefs.get(ctx, Prefs.K_VPS_HOST) }
    val port = remember { Prefs.get(ctx, Prefs.K_VPS_PORT, "22").toIntOrNull() ?: 22 }
    val user = remember { Prefs.get(ctx, Prefs.K_VPS_USER, "root").ifBlank { "root" } }
    val password = remember { Prefs.get(ctx, Prefs.K_VPS_PASSWORD) }
    val domain = remember { Prefs.get(ctx, "install_domain") }
    val apiBaseUrl = remember { Prefs.get(ctx, "install_base_url", "https://core.fiqstr.com/v1") }
    val apiKey = remember { Prefs.get(ctx, "install_api_key") }
    val model = remember { Prefs.get(ctx, "install_model", "fiqstr/claude-sonnet-4.6-thinking-agentic") }

    var running by rememberSaveable { mutableStateOf(false) }
    var exitCode by rememberSaveable { mutableStateOf<Int?>(null) }
    var error by rememberSaveable { mutableStateOf<String?>(null) }
    val log = remember { mutableStateListOf<String>() }
    val listState = rememberLazyListState()

    // Auto-scroll the log to the bottom as new lines come in.
    LaunchedEffect(Unit) {
        snapshotFlow { log.size }.collectLatest { size ->
            if (size > 0) listState.animateScrollToItem(size - 1)
        }
    }

    fun startInstall() {
        if (running) return
        log.clear()
        error = null
        exitCode = null
        running = true
        scope.launch {
            SshInstaller.runInstall(
                host = host,
                port = port,
                user = user,
                password = password,
                domain = domain,
                apiBaseUrl = apiBaseUrl,
                apiKey = apiKey,
                defaultModel = model,
            ).collect { ev ->
                when (ev) {
                    is SshInstaller.Event.Line -> log.add(ev.text)
                    is SshInstaller.Event.Done -> {
                        exitCode = ev.exitCode
                        running = false
                        if (ev.exitCode == 0) {
                            log.add("")
                            log.add("✓ Installasi telah selesai.")
                            // Auto-advance after a short pause so the user can see the toast/log
                            onInstalled()
                        } else {
                            log.add("")
                            log.add("✗ Installer keluar dengan exit code ${ev.exitCode}.")
                        }
                    }
                    is SshInstaller.Event.Error -> {
                        error = ev.message
                        running = false
                    }
                }
            }
        }
    }

    Column(
        modifier = Modifier.fillMaxSize().padding(vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
            Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                    IconButton(onClick = onBack, enabled = !running) {
                        Icon(Icons.Filled.ArrowBack, contentDescription = "Kembali")
                    }
                    Text("Target VPS", style = MaterialTheme.typography.titleSmall)
                }
                kvRow("Host", "$host:$port")
                kvRow("User", user)
                kvRow("Domain", domain.ifBlank { "—" })
                kvRow("AI base URL", apiBaseUrl.ifBlank { "—" })
                kvRow("Model", model.ifBlank { "—" })
                kvRow("API key", if (apiKey.isBlank()) "—" else mask(apiKey))
            }
        }

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
            Button(
                onClick = { startInstall() },
                enabled = !running && host.isNotBlank() && password.isNotBlank(),
                modifier = Modifier.weight(1f),
            ) {
                Text(if (exitCode == 0) "Install semula" else "Install Suzu AI")
            }
            OutlinedButton(
                onClick = onBack,
                enabled = !running,
            ) { Text("Edit") }
        }

        if (running) {
            LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
        }
        error?.let {
            Card(
                colors = CardDefaults.cardColors(containerColor = Color(0x44EF4444)),
            ) {
                Text(
                    "Error: $it",
                    color = Color(0xFFFFB4B4),
                    modifier = Modifier.padding(12.dp),
                )
            }
        }

        Text(
            "Log",
            style = MaterialTheme.typography.titleSmall,
            modifier = Modifier.padding(top = 4.dp),
        )

        Card(
            modifier = Modifier.fillMaxWidth().weight(1f),
            shape = RoundedCornerShape(10.dp),
            colors = CardDefaults.cardColors(containerColor = Color(0xFF0A0A0A)),
        ) {
            Box(modifier = Modifier.fillMaxSize().padding(8.dp)) {
                LazyColumn(state = listState, modifier = Modifier.fillMaxSize()) {
                    items(log) { line ->
                        Text(
                            line,
                            fontFamily = FontFamily.Monospace,
                            fontSize = 11.sp,
                            color = Color(0xFFD0D0D0),
                            maxLines = 4,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.padding(vertical = 1.dp),
                        )
                    }
                    if (log.isEmpty()) {
                        item {
                            Text(
                                "Belum mula. Tekan 'Install Suzu AI' di atas.",
                                color = Color(0xFF888888),
                                fontFamily = FontFamily.Monospace,
                                fontSize = 11.sp,
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun kvRow(label: String, value: String) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            label,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.width(96.dp),
        )
        Text(
            value,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurface,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

private fun mask(s: String): String =
    if (s.length <= 8) "•".repeat(s.length) else s.take(4) + "…" + s.takeLast(4)
