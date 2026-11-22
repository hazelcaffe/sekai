package io.github.hazelcaffe.sekai

import android.content.Context
import android.content.res.Configuration
import android.graphics.Color
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.core.graphics.drawable.toDrawable
import androidx.core.graphics.toColorInt

/** The page's background color and whether it's dark (the bridge's `theme` message). */
internal data class PageTheme(val color: Int, val dark: Boolean) {
    companion object {
        private val HEX = Regex("^#[0-9a-fA-F]{6}$")

        fun parse(color: String?, dark: Boolean?): PageTheme? {
            if (color == null || dark == null || !HEX.matches(color)) return null
            return PageTheme(color.toColorInt(), dark)
        }

        /** The web app's own default for the phone's light or dark mode (what shows before the page's own colors). */
        fun system(context: Context, config: Configuration = context.resources.configuration): PageTheme {
            val night = config.uiMode and Configuration.UI_MODE_NIGHT_MASK
            return if (night == Configuration.UI_MODE_NIGHT_YES) {
                PageTheme("#0d0a10".toColorInt(), true)
            } else {
                PageTheme(Color.WHITE, false)
            }
        }
    }
}

/**
 * Edge to edge: the app draws behind the status and navigation bars and nothing pads for them (the screens use the
 * window insets, and the page gets them as CSS variables, see [CssInsets]). This only picks the bars' icon colors and
 * the window color behind everything.
 */
internal class SystemBars(private val activity: ComponentActivity) {
    /** The page's colors: its background behind the bars, light or dark icons to match. */
    fun apply(theme: PageTheme) = style(theme.dark, theme.color)

    /** A native screen: the phone's light or dark mode, over the screen's own [surface] color. */
    fun applyNative(dark: Boolean, surface: Int) = style(dark, surface)

    private fun style(dark: Boolean, background: Int) {
        val style = if (dark) {
            SystemBarStyle.dark(Color.TRANSPARENT)
        } else {
            SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT)
        }
        // No scrim behind three-button navigation: the screen's color shows through instead.
        activity.enableEdgeToEdge(statusBarStyle = style, navigationBarStyle = style)
        activity.window.setBackgroundDrawable(background.toDrawable())
    }
}
