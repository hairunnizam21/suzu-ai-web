package online.suzuai.admin.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import online.suzuai.admin.data.Prefs

enum class Screen { Setup, Install, Manage }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SuzuAdminApp() {
    val ctx = LocalContext.current
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()

    var screen by rememberSaveable {
        mutableStateOf(
            if (Prefs.getBool(ctx, Prefs.K_INSTALL_DONE)) Screen.Manage else Screen.Setup
        )
    }

    LaunchedEffect(Unit) {
        // If we already have credentials but install isn't marked done, jump straight to Install
        val hasHost = Prefs.get(ctx, Prefs.K_VPS_HOST).isNotBlank()
        if (hasHost && !Prefs.getBool(ctx, Prefs.K_INSTALL_DONE) && screen == Screen.Setup) {
            screen = Screen.Install
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(screen.title(), style = MaterialTheme.typography.titleMedium) },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface,
                    titleContentColor = MaterialTheme.colorScheme.onSurface,
                ),
            )
        },
        snackbarHost = { SnackbarHost(snackbar) },
        containerColor = MaterialTheme.colorScheme.background,
    ) { pad ->
        Box(modifier = Modifier.fillMaxSize().padding(pad).padding(horizontal = 16.dp)) {
            when (screen) {
                Screen.Setup -> SetupScreen(
                    onContinue = { screen = Screen.Install },
                )
                Screen.Install -> InstallScreen(
                    onBack = { screen = Screen.Setup },
                    onInstalled = {
                        Prefs.setBool(ctx, Prefs.K_INSTALL_DONE, true)
                        screen = Screen.Manage
                    },
                )
                Screen.Manage -> ManageScreen(
                    snackbar = snackbar,
                    onReinstall = {
                        Prefs.setBool(ctx, Prefs.K_INSTALL_DONE, false)
                        screen = Screen.Install
                    },
                    onForgetServer = {
                        Prefs.clear(ctx)
                        screen = Screen.Setup
                    },
                )
            }
        }
    }
}

private fun Screen.title(): String = when (this) {
    Screen.Setup -> "Suzu Admin · Setup"
    Screen.Install -> "Install Suzu AI"
    Screen.Manage -> "Manage"
}
