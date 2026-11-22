package io.github.hazelcaffe.sekai

import android.content.Context
import android.os.Build
import android.provider.Settings
import android.util.Log
import com.google.android.gms.tasks.Task
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.messaging.FirebaseMessaging
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeout
import org.json.JSONObject

/** Firebase's client settings for the server's project (public values; the page passes them from the server). */
internal data class FcmConfig(val apiKey: String, val appId: String, val projectId: String, val senderId: String) {
    fun toJson(): JSONObject =
        JSONObject().put("apiKey", apiKey).put("appId", appId).put("projectId", projectId).put("senderId", senderId)

    fun options(): FirebaseOptions = FirebaseOptions.Builder()
        .setApiKey(apiKey)
        .setApplicationId(appId)
        .setProjectId(projectId)
        .setGcmSenderId(senderId)
        .build()

    fun matches(options: FirebaseOptions) = options.apiKey == apiKey &&
        options.applicationId == appId &&
        options.projectId == projectId &&
        options.gcmSenderId == senderId

    companion object {
        private val VALUE = Regex("^[A-Za-z0-9:_.-]{1,200}$")

        fun from(json: JSONObject?): FcmConfig? {
            json ?: return null
            val values = listOf("apiKey", "appId", "projectId", "senderId").map { json.string(it) }
            if (values.any { it == null || !VALUE.matches(it) }) return null
            val (apiKey, appId, projectId, senderId) = values.map { it.orEmpty() }
            return FcmConfig(apiKey, appId, projectId, senderId)
        }
    }
}

/** Thrown with a message the page shows as is. */
internal class PushError(message: String) : Exception(message)

/**
 * Push through Firebase Cloud Messaging, with no Firebase project built in: the server's project comes from the
 * page (push.register / push.current), is saved, and starts Firebase again whenever the app starts, so pushes
 * reach the app while it's closed. The page registers the token with the server; the app never does.
 *
 * This uses FCM registration tokens (getToken / onNewToken), which Firebase now marks deprecated in favour of
 * installation ids (register / onRegistered). Switching changes what the server sends to, so it's a change for
 * both sides at once.
 */
internal object Push {
    private const val TAG = "SekaiPush"
    const val NOT_SET_UP = "Push isn't set up on this server yet. An admin can add Firebase in Settings → Server → Network & devices → Phone notifications."
    const val NOTIFICATIONS_OFF = "Notifications are off for Sekai. Turn them on in Android settings, then try again."

    /** From Application.onCreate. */
    fun startSaved(context: Context) {
        val store = Store(context)
        val config = store.fcmConfig ?: return
        if (store.pushServer == null) return
        try {
            firebase(context, config)
        } catch (e: RuntimeException) {
            Log.w(TAG, "Firebase didn't start", e)
        }
    }

    /** Asks to show notifications if needed and returns this phone's push address for the server. */
    suspend fun register(activity: MainActivity, config: FcmConfig?): JSONObject {
        config ?: throw PushError(NOT_SET_UP)
        if (NotificationAccess.ask(activity) != "granted") throw PushError(NOTIFICATIONS_OFF)
        val server = activity.store.serverUrl ?: throw PushError(NOT_SET_UP)
        val token = token(activity, config)
        activity.store.pushServer = server
        return tokenJson(activity, token)
    }

    /** The push address if push was turned on for this server before (never asks), else null. */
    suspend fun current(context: Context, config: FcmConfig?): JSONObject? {
        val store = Store(context)
        if (config == null || store.pushServer == null || store.pushServer != store.serverUrl) return null
        if (!Notifications.allowed(context)) return null
        return try {
            tokenJson(context, token(context, config))
        } catch (e: PushError) {
            Log.w(TAG, "No push token: ${e.message}")
            null
        }
    }

    /** Forgets the push address (Firebase stops delivering to it). */
    suspend fun unregister(context: Context) {
        val store = Store(context)
        if (FirebaseApp.getApps(context).isNotEmpty()) {
            try {
                @Suppress("DEPRECATION")
                FirebaseMessaging.getInstance().deleteToken().await()
            } catch (e: Exception) {
                Log.w(TAG, "Couldn't delete the push token", e)
            }
        }
        store.pushToken = null
        store.pushServer = null
        store.fcmConfig = null
    }

    /** A new token from Firebase (FirebaseMessagingService.onNewToken; any thread). */
    fun onNewToken(context: Context, token: String) {
        val store = Store(context)
        if (store.pushServer == null) return
        store.pushToken = token
        val data = tokenJson(context, token)
        AppState.scope.launch {
            AppState.page?.takeIf { store.pushServer == store.serverUrl }?.emit("pushToken", data)
        }
    }

    private suspend fun token(context: Context, config: FcmConfig): String {
        val store = Store(context)
        val before = store.fcmConfig
        if (before != null && before != config && store.pushToken != null) {
            // The old project shouldn't reach this phone any more.
            try {
                @Suppress("DEPRECATION")
                FirebaseMessaging.getInstance().deleteToken().await()
            } catch (e: Exception) {
                Log.w(TAG, "Couldn't delete the old push token", e)
            }
        }
        try {
            firebase(context, config)
        } catch (e: RuntimeException) {
            throw PushError("Firebase didn't start (${e.message}). Check the Firebase settings in Settings → Server → Network & devices → Phone notifications.")
        }
        store.fcmConfig = config
        val token = try {
            @Suppress("DEPRECATION")
            withTimeout(30_000) { FirebaseMessaging.getInstance().token.await() }
        } catch (_: TimeoutCancellationException) {
            throw PushError("Firebase didn't answer. Check you're online and try again.")
        } catch (e: Exception) {
            throw PushError(explain(e))
        }
        store.pushToken = token
        return token
    }

    /** The default FirebaseApp for [config]: re-created when the server's Firebase project changed. */
    @Synchronized
    private fun firebase(context: Context, config: FcmConfig): FirebaseApp {
        val existing = FirebaseApp.getApps(context).firstOrNull { it.name == FirebaseApp.DEFAULT_APP_NAME }
        if (existing != null) {
            if (config.matches(existing.options)) return existing
            existing.delete()
        }
        return FirebaseApp.initializeApp(context, config.options())
    }

    private fun explain(e: Exception): String {
        // Firebase's messages run long; the first sentence says enough.
        val reason = e.message.orEmpty().substringBefore(". ").take(160)
        return when {
            "SERVICE_NOT_AVAILABLE" in reason -> "Couldn't reach Firebase. Check you're online and try again."
            "MISSING_INSTANCEID_SERVICE" in reason -> "Push needs Google Play services, which this phone doesn't have."
            else ->
                "Firebase didn't give this phone a push address ($reason). " +
                    "Check the Firebase settings in Settings → Server → Network & devices → Phone notifications."
        }
    }

    fun tokenJson(context: Context, token: String): JSONObject = JSONObject()
        .put("provider", "fcm")
        .put("token", token)
        .put("appId", context.packageName)
        .put("device", deviceName(context))

    /** The phone's own name ("Hazel's Pixel"), else its model ("Google Pixel 8"). */
    private fun deviceName(context: Context): String {
        val named = Settings.Global.getString(context.contentResolver, Settings.Global.DEVICE_NAME)
        if (!named.isNullOrBlank()) return named.take(120)
        val model = Build.MODEL.orEmpty()
        val maker = Build.MANUFACTURER.orEmpty().replaceFirstChar { it.titlecase() }
        return (if (model.startsWith(maker, ignoreCase = true)) model else "$maker $model").trim().take(120)
    }
}

private suspend fun <T> Task<T>.await(): T = suspendCancellableCoroutine { continuation ->
    addOnCompleteListener { task ->
        val error = task.exception
        when {
            error != null -> continuation.resumeWithException(error)
            task.isCanceled -> continuation.cancel()
            else -> continuation.resume(task.result)
        }
    }
}
