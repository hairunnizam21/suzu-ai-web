package online.suzuai.admin.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import online.suzuai.admin.data.Prefs

@Composable
fun SetupScreen(onContinue: () -> Unit) {
    val ctx = LocalContext.current

    var host by rememberSaveable { mutableStateOf("") }
    var port by rememberSaveable { mutableStateOf("22") }
    var sshUser by rememberSaveable { mutableStateOf("root") }
    var password by rememberSaveable { mutableStateOf("") }
    var serverUrl by rememberSaveable { mutableStateOf("") }
    var domain by rememberSaveable { mutableStateOf("") }
    var apiBaseUrl by rememberSaveable { mutableStateOf("https://core.fiqstr.com/v1") }
    var apiKey by rememberSaveable { mutableStateOf("") }
    var model by rememberSaveable { mutableStateOf("fiqstr/claude-sonnet-4.6-thinking-agentic") }

    LaunchedEffect(Unit) {
        host = Prefs.get(ctx, Prefs.K_VPS_HOST)
        port = Prefs.get(ctx, Prefs.K_VPS_PORT, "22").ifBlank { "22" }
        sshUser = Prefs.get(ctx, Prefs.K_VPS_USER, "root").ifBlank { "root" }
        password = Prefs.get(ctx, Prefs.K_VPS_PASSWORD)
        serverUrl = Prefs.get(ctx, Prefs.K_SERVER_URL)
        // domain/apiKey/etc are not stored as preferences; user re-enters per install
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .verticalScroll(rememberScrollState())
            .padding(vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
            Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("VPS untuk install", style = MaterialTheme.typography.titleSmall)
                Text(
                    "Wajib. IP / domain VPS kosong yang anda nak install Suzu AI di atasnya.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                OutlinedTextField(
                    value = host,
                    onValueChange = { host = it.trim() },
                    label = { Text("IP / host") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = port,
                    onValueChange = { port = it.filter { c -> c.isDigit() } },
                    label = { Text("Port") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = sshUser,
                    onValueChange = { sshUser = it.trim() },
                    label = { Text("User SSH (biasanya root)") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = password,
                    onValueChange = { password = it },
                    label = { Text("Password root") },
                    singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }

        Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
            Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Suzu AI", style = MaterialTheme.typography.titleSmall)
                Text(
                    "Domain awam selepas install + default config AI.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                OutlinedTextField(
                    value = domain,
                    onValueChange = { domain = it.trim() },
                    label = { Text("Domain (cth: suzu-ai.online)") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = serverUrl,
                    onValueChange = { serverUrl = it.trim() },
                    label = { Text("Server URL untuk Manage (https://${'$'}domain)") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = apiBaseUrl,
                    onValueChange = { apiBaseUrl = it.trim() },
                    label = { Text("AI Base URL") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = apiKey,
                    onValueChange = { apiKey = it.trim() },
                    label = { Text("AI API key") },
                    singleLine = true,
                    keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(
                        keyboardType = KeyboardType.Password,
                    ),
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = model,
                    onValueChange = { model = it.trim() },
                    label = { Text("Default model") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }

        val canContinue = host.isNotBlank() && password.isNotBlank() && port.toIntOrNull() != null
        Button(
            onClick = {
                Prefs.set(ctx, Prefs.K_VPS_HOST, host)
                Prefs.set(ctx, Prefs.K_VPS_PORT, port)
                Prefs.set(ctx, Prefs.K_VPS_USER, sshUser.ifBlank { "root" })
                Prefs.set(ctx, Prefs.K_VPS_PASSWORD, password)
                if (serverUrl.isNotBlank()) Prefs.set(ctx, Prefs.K_SERVER_URL, serverUrl)
                Prefs.set(ctx, "install_domain", domain)
                Prefs.set(ctx, "install_base_url", apiBaseUrl)
                Prefs.set(ctx, "install_api_key", apiKey)
                Prefs.set(ctx, "install_model", model)
                onContinue()
            },
            enabled = canContinue,
            modifier = Modifier.fillMaxWidth(),
        ) { Text("Teruskan ke Install") }

        Text(
            "Kredentian SSH disimpan dalam Android Keystore (encrypted). Mereka hanya dipakai untuk install pertama; selepas itu Manage menggunakan token admin via HTTPS.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 4.dp),
        )
    }
}
