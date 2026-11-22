package io.github.hazelcaffe.sekai

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * Pushes from the server (data only, all strings: title, body, url, tag, ring, toolCallId, test), shown as
 * notifications. While the app is in front the page shows its own, so only tests show then.
 */
class PushService : FirebaseMessagingService() {
    @Deprecated("Firebase's token API, still what Sekai's server sends to (see Push.kt).")
    override fun onNewToken(token: String) = Push.onNewToken(applicationContext, token)

    override fun onMessageReceived(message: RemoteMessage) {
        val data = message.data
        if (AppState.inFront && data["test"] != "1") return
        val store = Store(this)
        // Pushes from a server you've since left.
        if (store.pushServer == null || store.pushServer != store.serverUrl) return
        val path = safePath(data["url"]) ?: "/"
        val toolCallId = data["toolCallId"]?.takeIf(::isToolCallId)
        val ring = data["ring"] == "1"
        Notifications.show(
            this,
            Alert(
                title = data["title"].orEmpty().take(200).ifBlank { getString(R.string.app_name) },
                body = data["body"].orEmpty().take(1000),
                path = path,
                tag = data["tag"]?.take(100)?.ifBlank { null } ?: toolCallId?.let { "approval-$it" } ?: path,
                channel = when {
                    ring -> Notifications.CALLS
                    toolCallId != null -> Notifications.APPROVALS
                    else -> Notifications.MESSAGES
                },
                toolCallId = toolCallId,
                ring = ring,
            ),
        )
    }
}
