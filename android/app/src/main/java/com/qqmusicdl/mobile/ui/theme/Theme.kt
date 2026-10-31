package com.qqmusicdl.mobile.ui.theme

import android.app.Activity
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat

val Ink = Color(0xFF20242E)
val MutedInk = Color(0xFF6C7280)
val SoftBlue = Color(0xFF6E93D8)
val SoftPink = Color(0xFFE49AAF)
val PaleBlue = Color(0xFFEAF2FF)
val PalePink = Color(0xFFFFEDF2)
val Page = Color(0xFFF7F8FC)
val Hairline = Color(0xFFE7E9F0)

private val colorScheme = lightColorScheme(
    primary = SoftBlue,
    onPrimary = Color.White,
    primaryContainer = PaleBlue,
    onPrimaryContainer = Ink,
    secondary = SoftPink,
    onSecondary = Color.White,
    secondaryContainer = PalePink,
    onSecondaryContainer = Ink,
    background = Page,
    onBackground = Ink,
    surface = Color.White,
    onSurface = Ink,
    surfaceVariant = Color(0xFFF0F2F8),
    onSurfaceVariant = MutedInk,
    outline = Hairline,
    error = Color(0xFFB5485D),
)

@Composable
fun QqMusicDlTheme(content: @Composable () -> Unit) {
    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as Activity).window
            WindowCompat.getInsetsController(window, view).isAppearanceLightStatusBars = true
        }
    }
    MaterialTheme(
        colorScheme = colorScheme,
        typography = MaterialTheme.typography,
        content = content,
    )
}
