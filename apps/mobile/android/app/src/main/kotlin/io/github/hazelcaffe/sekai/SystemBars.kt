package io.github.hazelcaffe.sekai

import android.content.Context
import android.content.res.Configuration
import android.graphics.Color
import android.view.View
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.core.graphics.drawable.toDrawable
import androidx.core.graphics.toColorInt
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

/** The page's background color and whether it's dark (the bridge's `theme` message). */
internal data class PageTheme(val color: Int, val dark: Boolean) {
    companion object {
        private val HEX = Regex("^#[0-9a-fA-F]{6}$")

        fun parse(color: String?, dark: Boolean?): PageTheme? {
            if (color == null || dark == null || !HEX.matches(color)) return null
            return PageTheme(color.toColorInt(), dark)
        }

        /** The web app's own default for the phone's light or dark mode (also the connect screen's). */
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
 * Edge to edge, done so nothing hides under the bars: the system bars, display cutouts and keyboard become padding
 * on [root] (so the web view, and the page's composer, always sit between them), and the bars are transparent
 * over [root]'s background, which is the page's color.
 */
internal class SystemBars(private val activity: ComponentActivity, private val root: View) {
    init {
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val types = WindowInsetsCompat.Type.systemBars() or
                WindowInsetsCompat.Type.displayCutout() or
                WindowInsetsCompat.Type.ime()
            val bars = insets.getInsets(types)
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            // Consumed: the page mustn't add safe-area padding of its own on top.
            WindowInsetsCompat.CONSUMED
        }
    }

    fun apply(theme: PageTheme) {
        val style = if (theme.dark) {
            SystemBarStyle.dark(Color.TRANSPARENT)
        } else {
            SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT)
        }
        // Light or dark icons to match; no scrim behind three-button navigation (the page color shows instead).
        activity.enableEdgeToEdge(statusBarStyle = style, navigationBarStyle = style)
        root.setBackgroundColor(theme.color)
        activity.window.setBackgroundDrawable(theme.color.toDrawable())
    }
}
