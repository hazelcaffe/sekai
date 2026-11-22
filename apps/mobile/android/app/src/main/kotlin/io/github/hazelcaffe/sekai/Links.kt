package io.github.hazelcaffe.sekai

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import androidx.browser.customtabs.CustomTabColorSchemeParams
import androidx.browser.customtabs.CustomTabsIntent
import androidx.core.graphics.ColorUtils

/** Opening things outside the app's web view. */
internal object Links {
    /** Other sites open in a Custom Tab (the system browser), never in the app's web view. */
    fun openInBrowser(context: Context, url: Uri, theme: PageTheme?) {
        // Share is in the tab's menu (a page you opened may be worth sending on); the bar hides as you scroll.
        val builder = CustomTabsIntent.Builder()
            .setShowTitle(true)
            .setShareState(CustomTabsIntent.SHARE_STATE_ON)
            .setUrlBarHidingEnabled(true)
        if (theme != null) {
            // The tab's bars take the page's color, with its divider a hair off it (as the web app's own borders).
            val divider = ColorUtils.blendARGB(theme.color, if (theme.dark) Color.WHITE else Color.BLACK, 0.12f)
            val colors = CustomTabColorSchemeParams.Builder()
                .setToolbarColor(theme.color)
                .setNavigationBarColor(theme.color)
                .setNavigationBarDividerColor(divider)
                .build()
            builder.setDefaultColorSchemeParams(colors)
            builder.setColorScheme(
                if (theme.dark) CustomTabsIntent.COLOR_SCHEME_DARK else CustomTabsIntent.COLOR_SCHEME_LIGHT,
            )
        }
        try {
            builder.build().launchUrl(context, url)
        } catch (_: ActivityNotFoundException) {
            Snacks.show(context, R.string.no_browser)
        }
    }

    /** mailto:, tel: and sms: links go to the phone's own apps. */
    fun openWithApp(context: Context, url: Uri) {
        val intent = Intent(if (url.scheme == "mailto") Intent.ACTION_SENDTO else Intent.ACTION_VIEW, url)
        try {
            context.startActivity(intent)
        } catch (_: ActivityNotFoundException) {
            Snacks.show(context, R.string.no_app_for_link)
        }
    }

    val APP_SCHEMES = setOf("mailto", "tel", "sms")

    /** sekai://c/<conversationId> → /c/<conversationId>. */
    fun pathFromDeepLink(link: Uri): String? {
        if (link.scheme != SCHEME) return null
        val path = "/${link.host.orEmpty()}${link.path.orEmpty()}".trimEnd('/')
        return safePath(path.ifEmpty { "/" }) ?: "/"
    }

    const val SCHEME = "sekai"
}
