package io.github.hazelcaffe.sekai

import android.net.Uri
import android.util.Base64
import androidx.core.net.toUri
import java.security.MessageDigest
import java.security.SecureRandom

/**
 * Signing in through the system browser, where passkeys and Google sign-in work (PKCE-style, see
 * apps/mobile/AGENTS.md): the browser ends at sekai://signed-in?code=…, and only this app's verifier turns that
 * code into a session, so another app that catches the link can't use it.
 */
internal object BrowserSignIn {
    private val PROVIDER = Regex("^[A-Za-z0-9_-]{1,64}$")
    private val CODE = Regex("^[A-Za-z0-9_-]{8,512}$")

    // The server's sign-in waits 15 minutes for the browser.
    private const val MAX_AGE_MS = 15 * 60_000L

    fun validProvider(provider: String?) = provider == null || PROVIDER.matches(provider)

    fun start(activity: MainActivity, server: String, provider: String?) {
        val verifier = base64Url(ByteArray(32).also { SecureRandom().nextBytes(it) })
        val challenge = base64Url(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.US_ASCII)))
        activity.store.signIn = PendingSignIn(server, verifier, System.currentTimeMillis())
        val url = "$server/api/auth/app/start".toUri().buildUpon()
            .appendQueryParameter("challenge", challenge)
            .appendQueryParameter("provider", provider.orEmpty())
            .build()
        Links.openInBrowser(activity, url, activity.pageTheme)
    }

    /**
     * sekai://signed-in?code=… (or ?error=cancelled): the form body to post to /api/auth/app/exchange, or null
     * when there's nothing to do (cancelled, expired, or a link this app didn't ask for).
     */
    fun finish(store: Store, link: Uri): Pair<String, String>? {
        val pending = store.signIn ?: return null
        store.signIn = null
        val code = link.getQueryParameter("code")?.takeIf { CODE.matches(it) } ?: return null
        if (System.currentTimeMillis() - pending.startedAt > MAX_AGE_MS) return null
        if (pending.server != store.serverUrl) return null
        return pending.server to "code=${Uri.encode(code)}&verifier=${Uri.encode(pending.verifier)}"
    }

    private fun base64Url(bytes: ByteArray) =
        Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
}
