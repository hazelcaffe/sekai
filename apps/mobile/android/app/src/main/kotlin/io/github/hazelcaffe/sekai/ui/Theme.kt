package io.github.hazelcaffe.sekai.ui

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext

// Sekai's teal (#33CCBB) as Material 3's seed, for phones without Material You colors (before Android 12) and when
// dynamic color is off. Generated with Google's material-color-utilities (themeFromSourceColor, the 2023 surface
// tones), so every pair keeps Material's contrast.
private val LightColors = lightColorScheme(
    primary = Color(0xFF006A61),
    onPrimary = Color(0xFFFFFFFF),
    primaryContainer = Color(0xFF6CF8E6),
    onPrimaryContainer = Color(0xFF00201C),
    secondary = Color(0xFF4A635F),
    onSecondary = Color(0xFFFFFFFF),
    secondaryContainer = Color(0xFFCCE8E2),
    onSecondaryContainer = Color(0xFF05201C),
    tertiary = Color(0xFF466179),
    onTertiary = Color(0xFFFFFFFF),
    tertiaryContainer = Color(0xFFCCE5FF),
    onTertiaryContainer = Color(0xFF001D31),
    error = Color(0xFFBA1A1A),
    onError = Color(0xFFFFFFFF),
    errorContainer = Color(0xFFFFDAD6),
    onErrorContainer = Color(0xFF410002),
    background = Color(0xFFF7FAF8),
    onBackground = Color(0xFF191C1B),
    surface = Color(0xFFF7FAF8),
    onSurface = Color(0xFF191C1B),
    surfaceVariant = Color(0xFFDAE5E2),
    onSurfaceVariant = Color(0xFF3F4947),
    outline = Color(0xFF6F7977),
    outlineVariant = Color(0xFFBEC9C6),
    inverseSurface = Color(0xFF2D3130),
    inverseOnSurface = Color(0xFFEFF1EF),
    inversePrimary = Color(0xFF4ADCCA),
    surfaceTint = Color(0xFF006A61),
    surfaceDim = Color(0xFFD8DBD9),
    surfaceBright = Color(0xFFF7FAF8),
    surfaceContainerLowest = Color(0xFFFFFFFF),
    surfaceContainerLow = Color(0xFFF2F4F2),
    surfaceContainer = Color(0xFFECEEEC),
    surfaceContainerHigh = Color(0xFFE6E9E7),
    surfaceContainerHighest = Color(0xFFE0E3E1),
)

private val DarkColors = darkColorScheme(
    primary = Color(0xFF4ADCCA),
    onPrimary = Color(0xFF003732),
    primaryContainer = Color(0xFF005048),
    onPrimaryContainer = Color(0xFF6CF8E6),
    secondary = Color(0xFFB1CCC6),
    onSecondary = Color(0xFF1C3531),
    secondaryContainer = Color(0xFF334B47),
    onSecondaryContainer = Color(0xFFCCE8E2),
    tertiary = Color(0xFFADCAE6),
    onTertiary = Color(0xFF153349),
    tertiaryContainer = Color(0xFF2D4961),
    onTertiaryContainer = Color(0xFFCCE5FF),
    error = Color(0xFFFFB4AB),
    onError = Color(0xFF690005),
    errorContainer = Color(0xFF93000A),
    onErrorContainer = Color(0xFFFFB4AB),
    background = Color(0xFF101413),
    onBackground = Color(0xFFE0E3E1),
    surface = Color(0xFF101413),
    onSurface = Color(0xFFE0E3E1),
    surfaceVariant = Color(0xFF3F4947),
    onSurfaceVariant = Color(0xFFBEC9C6),
    outline = Color(0xFF899390),
    outlineVariant = Color(0xFF3F4947),
    inverseSurface = Color(0xFFE0E3E1),
    inverseOnSurface = Color(0xFF2D3130),
    inversePrimary = Color(0xFF006A61),
    surfaceTint = Color(0xFF4ADCCA),
    surfaceDim = Color(0xFF101413),
    surfaceBright = Color(0xFF363A39),
    surfaceContainerLowest = Color(0xFF0B0F0E),
    surfaceContainerLow = Color(0xFF191C1B),
    surfaceContainer = Color(0xFF1D201F),
    surfaceContainerHigh = Color(0xFF272B2A),
    surfaceContainerHighest = Color(0xFF323534),
)

/** The color scheme for [dark], with Material You colors on Android 12 and later when [dynamic]. */
@Composable
internal fun sekaiColors(dark: Boolean, dynamic: Boolean = true): ColorScheme {
    val context = LocalContext.current
    return when {
        dynamic && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ->
            if (dark) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        dark -> DarkColors
        else -> LightColors
    }
}

/**
 * Material 3 for the native screens: the phone's own colors on Android 12 and later, Sekai's teal before that. The
 * type scale and shapes are Material's (12 for cards and fields, 28 for dialogs), which is what DESIGN.md asks for.
 */
@Composable
internal fun SekaiTheme(
    dark: Boolean = isSystemInDarkTheme(),
    dynamic: Boolean = true,
    content: @Composable () -> Unit,
) {
    MaterialTheme(colorScheme = sekaiColors(dark, dynamic), content = content)
}
