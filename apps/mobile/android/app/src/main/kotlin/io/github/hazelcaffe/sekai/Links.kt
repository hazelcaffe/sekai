package io.github.hazelcaffe.sekai

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.Toast
import androidx.browser.customtabs.CustomTabColorSchemeParams
import androidx.browser.customtabs.CustomTabsIntent

/** Opening things outside the app's web view. */
internal object Links {
    /** Other sites open in a Custom Tab (the system browser), never in the app's web view. */
    fun openInBrowser(context: Context, url: Uri, theme: PageTheme?) {
        val builder = CustomTabsIntent.Builder().setShowTitle(true)
        if (theme != null) {
            val colors = CustomTabColorSchemeParams.Builder()
                .setToolbarColor(theme.color)
                .setNavigationBarColor(theme.color)
                .build()
            builder.setDefaultColorSchemeParams(colors)
            builder.setColorScheme(
                if (theme.dark) CustomTabsIntent.COLOR_SCHEME_DARK else CustomTabsIntent.COLOR_SCHEME_LIGHT,
            )
        }
        try {
            builder.build().launchUrl(context, url)
        } catch (_: ActivityNotFoundException) {
            Toast.makeText(context, R.string.no_browser, Toast.LENGTH_LONG).show()
        }
    }

    /** mailto:, tel: and sms: links go to the phone's own apps. */
    fun openWithApp(context: Context, url: Uri) {
        val intent = Intent(if (url.scheme == "mailto") Intent.ACTION_SENDTO else Intent.ACTION_VIEW, url)
        try {
            context.startActivity(intent)
        } catch (_: ActivityNotFoundException) {
            Toast.makeText(context, R.string.no_app_for_link, Toast.LENGTH_LONG).show()
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
