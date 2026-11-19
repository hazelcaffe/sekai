package io.github.hazelcaffe.sekai

import android.content.Context
import androidx.core.content.edit
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

/** A browser sign-in in progress: the verifier only this app knows (kept on disk: the app may be closed meanwhile). */
internal data class PendingSignIn(val server: String, val verifier: String, val startedAt: Long)

/** What the app remembers between launches. */
internal class Store(context: Context) {
    // The server list may move to a new phone (data_extraction_rules.xml); the rest belongs to this install.
    private val servers = context.getSharedPreferences("servers", Context.MODE_PRIVATE)
    private val device = context.getSharedPreferences("device", Context.MODE_PRIVATE)

    val serverUrl: String? get() = servers.getString(SERVER, null)

    val recent: List<String>
        get() = try {
            val list = JSONArray(servers.getString(RECENT, "[]"))
            (0 until list.length()).mapNotNull { list.optString(it).ifEmpty { null } }
        } catch (_: JSONException) {
            emptyList()
        }

    /** Makes [origin] the server the app opens, and the first of the recent ones. */
    fun useServer(origin: String) {
        val list = (listOf(origin) + recent.filter { it != origin }).take(MAX_RECENT)
        servers.edit {
            putString(SERVER, origin)
            putString(RECENT, JSONArray(list).toString())
        }
    }

    /** The page's last colors, for the window before the page has loaded. */
    var theme: PageTheme?
        get() = if (device.contains(THEME_COLOR)) {
            PageTheme(device.getInt(THEME_COLOR, 0), device.getBoolean(THEME_DARK, false))
        } else {
            null
        }
        set(value) = device.edit {
            if (value == null) {
                remove(THEME_COLOR)
                remove(THEME_DARK)
            } else {
                putInt(THEME_COLOR, value.color)
                putBoolean(THEME_DARK, value.dark)
            }
        }

    /** The Firebase project the server gave when push was turned on. */
    var fcmConfig: FcmConfig?
        get() = device.getString(FCM, null)?.let { runCatching { FcmConfig.from(JSONObject(it)) }.getOrNull() }
        set(value) = device.edit { putString(FCM, value?.toJson()?.toString()) }

    var pushToken: String?
        get() = device.getString(PUSH_TOKEN, null)
        set(value) = device.edit { putString(PUSH_TOKEN, value) }

    /** The server push was turned on for (another server doesn't get it without asking). */
    var pushServer: String?
        get() = device.getString(PUSH_SERVER, null)
        set(value) = device.edit { putString(PUSH_SERVER, value) }

    /** Whether Android's notification prompt was shown once (after that, "prompt" means it can't be shown again). */
    var askedNotifications: Boolean
        get() = device.getBoolean(ASKED_NOTIFICATIONS, false)
        set(value) = device.edit { putBoolean(ASKED_NOTIFICATIONS, value) }

    var signIn: PendingSignIn?
        get() = device.getString(SIGN_IN, null)?.let {
            runCatching {
                val json = JSONObject(it)
                PendingSignIn(json.getString("server"), json.getString("verifier"), json.getLong("startedAt"))
            }.getOrNull()
        }
        set(value) = device.edit {
            putString(
                SIGN_IN,
                value?.let {
                    JSONObject()
                        .put("server", it.server)
                        .put("verifier", it.verifier)
                        .put("startedAt", it.startedAt)
                        .toString()
                },
            )
        }

    private companion object {
        const val MAX_RECENT = 5
        const val SERVER = "server"
        const val RECENT = "recent"
        const val THEME_COLOR = "theme.color"
        const val THEME_DARK = "theme.dark"
        const val FCM = "push.fcm"
        const val PUSH_TOKEN = "push.token"
        const val PUSH_SERVER = "push.server"
        const val ASKED_NOTIFICATIONS = "notifications.asked"
        const val SIGN_IN = "signIn"
    }
}
