package online.suzuai.admin.ui

import android.content.Intent
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import online.suzuai.admin.data.Prefs
import online.suzuai.admin.net.AdminApi
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@Composable
fun ManageScreen(
    snackbar: SnackbarHostState,
    onReinstall: () -> Unit,
    onForgetServer: () -> Unit,
) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()

    val serverUrl = remember { Prefs.get(ctx, Prefs.K_SERVER_URL).ifBlank { "https://${Prefs.get(ctx, "install_domain")}" } }
    var adminToken by rememberSaveable { mutableStateOf(Prefs.get(ctx, Prefs.K_ADMIN_TOKEN)) }
    val api = remember(serverUrl, adminToken) { AdminApi(serverUrl, adminToken) }

    var loading by rememberSaveable { mutableStateOf(false) }
    var config by remember { mutableStateOf<JSONObject?>(null) }
    val users = remember { mutableStateListOf<JSONObject>() }

    // Editable config fields
    var cfgBaseUrl by rememberSaveable { mutableStateOf("") }
    var cfgModel by rememberSaveable { mutableStateOf("") }
    var cfgApiKey by rememberSaveable { mutableStateOf("") }
    var cfgDomain by rememberSaveable { mutableStateOf("") }

    fun toast(msg: String) {
        scope.launch { snackbar.showSnackbar(msg) }
    }

    suspend fun loadAll() {
        loading = true
        val cfgRes = api.getConfig()
        cfgRes.onSuccess { c ->
            config = c
            cfgBaseUrl = c.optString("base_url")
            cfgModel = c.optString("model")
            cfgDomain = c.optString("domain")
            cfgApiKey = "" // server never returns the live key
        }
        cfgRes.onFailure { toast("Tidak dapat baca config: ${it.message?.take(120)}") }

        val uRes = api.listUsers()
        uRes.onSuccess { arr ->
            users.clear()
            for (i in 0 until arr.length()) users.add(arr.getJSONObject(i))
        }
        uRes.onFailure { toast("Tidak dapat baca senarai user: ${it.message?.take(120)}") }
        loading = false
    }

    LaunchedEffect(adminToken, serverUrl) {
        if (adminToken.isNotBlank() && serverUrl.isNotBlank()) loadAll()
    }

    // File pickers for Export / Import
    val exportLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.CreateDocument("application/zip")
    ) { uri: Uri? ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            val tmp = File(ctx.cacheDir, "suzu-backup.tmp.zip")
            val res = api.downloadBackup(tmp)
            res.onSuccess { size ->
                withContext(Dispatchers.IO) {
                    ctx.contentResolver.openOutputStream(uri)?.use { out ->
                        tmp.inputStream().use { it.copyTo(out) }
                    }
                    tmp.delete()
                }
                toast("Backup tersimpan (${size / 1024} KB)")
            }
            res.onFailure { toast("Export gagal: ${it.message?.take(120)}") }
        }
    }

    val importLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument()
    ) { uri: Uri? ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            val tmp = File(ctx.cacheDir, "suzu-restore.tmp.zip")
            withContext(Dispatchers.IO) {
                ctx.contentResolver.openInputStream(uri)?.use { input ->
                    tmp.outputStream().use { input.copyTo(it) }
                }
            }
            val res = api.uploadRestore(tmp)
            res.onSuccess { j ->
                toast("Restore selesai · ${j.optInt("users")} user dipulihkan")
                tmp.delete()
                loadAll()
            }
            res.onFailure { toast("Restore gagal: ${it.message?.take(120)}") }
        }
    }

    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        // Server connection
        Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
            Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Server", style = MaterialTheme.typography.titleSmall)
                Text(serverUrl, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                OutlinedTextField(
                    value = adminToken,
                    onValueChange = {
                        adminToken = it.trim()
                        Prefs.set(ctx, Prefs.K_ADMIN_TOKEN, adminToken)
                    },
                    label = { Text("Admin token (SUZU_ADMIN_TOKEN)") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(
                        onClick = { scope.launch { loadAll() } },
                        enabled = !loading && adminToken.isNotBlank(),
                    ) { Text(if (loading) "Memuatkan…" else "Refresh") }
                    OutlinedButton(onClick = onReinstall) { Text("Re-install") }
                    OutlinedButton(onClick = onForgetServer) { Text("Lupa server") }
                }
            }
        }

        // Config card
        Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
            Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("AI Config", style = MaterialTheme.typography.titleSmall)
                Text("Disimpan ke .env di server, panas-reload tanpa restart.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)

                OutlinedTextField(
                    value = cfgBaseUrl,
                    onValueChange = { cfgBaseUrl = it.trim() },
                    label = { Text("AI_API_BASE_URL") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = cfgModel,
                    onValueChange = { cfgModel = it.trim() },
                    label = { Text("AI_DEFAULT_MODEL") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = cfgApiKey,
                    onValueChange = { cfgApiKey = it },
                    label = { Text("AI_API_KEY (kosongkan = jangan ubah)") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = cfgDomain,
                    onValueChange = { cfgDomain = it.trim() },
                    label = { Text("Domain") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Button(
                    onClick = {
                        scope.launch {
                            val res = api.setConfig(
                                baseApiUrl = cfgBaseUrl.ifBlank { null },
                                model = cfgModel.ifBlank { null },
                                apiKey = cfgApiKey.ifBlank { null },
                                domain = cfgDomain.ifBlank { null },
                            )
                            res.onSuccess { toast("Config dikemas kini") ; cfgApiKey = "" ; loadAll() }
                            res.onFailure { toast("Gagal: ${it.message?.take(120)}") }
                        }
                    },
                    enabled = !loading,
                ) { Text("Simpan config") }
            }
        }

        // Backup / Restore
        Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
            Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Backup / Restore", style = MaterialTheme.typography.titleSmall)
                Text("Export semua data user sebagai ZIP. Restore dari ZIP yang anda backup sebelum ini.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                    Button(
                        onClick = {
                            val stamp = SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(Date())
                            exportLauncher.launch("suzu-backup-$stamp.zip")
                        },
                        enabled = !loading,
                        modifier = Modifier.weight(1f),
                    ) { Text("Export") }
                    OutlinedButton(
                        onClick = { importLauncher.launch(arrayOf("application/zip", "application/octet-stream", "*/*")) },
                        enabled = !loading,
                        modifier = Modifier.weight(1f),
                    ) { Text("Import") }
                }
            }
        }

        // Users
        Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
            Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("Users (${users.size})", style = MaterialTheme.typography.titleSmall)
                    if (loading) CircularProgressIndicator(strokeWidth = 2.dp, modifier = Modifier.padding(end = 4.dp))
                }
                if (users.isEmpty() && !loading) {
                    Text("Belum ada user, atau load gagal.", style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                for (u in users) {
                    UserRow(
                        u = u,
                        onGrant = { id, dur ->
                            scope.launch {
                                api.grantPremium(id, dur).onSuccess { toast("Premium diberi: $dur") ; loadAll() }
                                    .onFailure { toast("Gagal: ${it.message?.take(120)}") }
                            }
                        },
                        onRevoke = { id ->
                            scope.launch {
                                api.revokePremium(id).onSuccess { toast("Premium dicabut") ; loadAll() }
                                    .onFailure { toast("Gagal: ${it.message?.take(120)}") }
                            }
                        },
                        onResetTokens = { id ->
                            scope.launch {
                                api.resetTokens(id).onSuccess { toast("Token direset") ; loadAll() }
                                    .onFailure { toast("Gagal: ${it.message?.take(120)}") }
                            }
                        },
                        onCopyId = { id ->
                            val cb = ctx.getSystemService(android.content.ClipboardManager::class.java)
                            cb?.setPrimaryClip(android.content.ClipData.newPlainText("user_id", id))
                            toast("UID disalin")
                        },
                    )
                    HorizontalDivider(color = Color(0x22FFFFFF))
                }
            }
        }
    }
}

@Composable
private fun UserRow(
    u: JSONObject,
    onGrant: (id: String, duration: String) -> Unit,
    onRevoke: (id: String) -> Unit,
    onResetTokens: (id: String) -> Unit,
    onCopyId: (id: String) -> Unit,
) {
    val id = u.optString("id")
    val email = u.optString("email")
    val plan = u.optString("plan", "free")
    val used = u.optLong("tokens_used_today", 0L)
    val limit = u.optLong("tokens_limit_daily", 0L)
    val expires = u.optString("plan_expires_at").takeIf { it.isNotBlank() && it != "null" }

    var menuOpen by remember { mutableStateOf(false) }

    Column(verticalArrangement = Arrangement.spacedBy(4.dp), modifier = Modifier.padding(vertical = 6.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(
                        if (plan == "premium") "★ Premium" else "Free",
                        color = if (plan == "premium") Color(0xFFE6B83C) else MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.labelSmall,
                    )
                    Text(email, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                Text(
                    "Tokens $used / $limit" + (expires?.let { " · expires $it" } ?: ""),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            TextButton(onClick = { menuOpen = true }) { Text("⋯") }
            DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                DropdownMenuItem(text = { Text("Salin UID") }, onClick = { menuOpen = false; onCopyId(id) })
                DropdownMenuItem(text = { Text("Grant Premium · 1 hari") }, onClick = { menuOpen = false; onGrant(id, "1d") })
                DropdownMenuItem(text = { Text("Grant Premium · 7 hari") }, onClick = { menuOpen = false; onGrant(id, "7d") })
                DropdownMenuItem(text = { Text("Grant Premium · 30 hari") }, onClick = { menuOpen = false; onGrant(id, "30d") })
                DropdownMenuItem(text = { Text("Revoke Premium") }, onClick = { menuOpen = false; onRevoke(id) })
                DropdownMenuItem(text = { Text("Reset tokens hari ini") }, onClick = { menuOpen = false; onResetTokens(id) })
            }
        }
    }
}
