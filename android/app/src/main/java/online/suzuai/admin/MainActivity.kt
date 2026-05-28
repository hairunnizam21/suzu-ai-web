package online.suzuai.admin

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import online.suzuai.admin.ui.SuzuAdminApp

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { SuzuAdminTheme { SuzuAdminApp() } }
    }
}

private val SuzuColors = darkColorScheme(
    primary = Color(0xFF7C6EF0),
    onPrimary = Color.White,
    primaryContainer = Color(0xFF1E1E1E),
    onPrimaryContainer = Color(0xFFECECEC),
    secondary = Color(0xFF9B8AFB),
    background = Color(0xFF0D0D0D),
    onBackground = Color(0xFFECECEC),
    surface = Color(0xFF171717),
    onSurface = Color(0xFFECECEC),
    surfaceVariant = Color(0xFF1E1E1E),
    onSurfaceVariant = Color(0xFFB0B0B0),
    outline = Color(0xFF2A2A2A),
    error = Color(0xFFEF4444),
)

@Composable
fun SuzuAdminTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = SuzuColors) {
        Surface(
            modifier = Modifier.fillMaxSize().background(Color(0xFF0D0D0D)),
            color = SuzuColors.background,
        ) {
            content()
        }
    }
}
