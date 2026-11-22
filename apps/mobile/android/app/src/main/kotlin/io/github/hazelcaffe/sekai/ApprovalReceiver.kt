package io.github.hazelcaffe.sekai

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import android.webkit.CookieManager
import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

/**
 * Approve / Deny on a notification: answers the request the way the page would (the web view's cookies, the
 * server's Origin), then says how it went by replacing the notification. Android doesn't let a notification button's
 * receiver open the app, so when answering fails the notification says so and opens the chat when tapped. The buttons
 * ask for the phone to be unlocked first (see Notifications.show).
 */
class ApprovalReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val toolCallId = intent.getStringExtra(EXTRA_TOOL_CALL)?.takeIf(::isToolCallId) ?: return
        val tag = intent.getStringExtra(EXTRA_TAG) ?: return
        val server = intent.getStringExtra(EXTRA_SERVER) ?: return
        val title = intent.getStringExtra(EXTRA_TITLE).orEmpty()
        val path = safePath(intent.getStringExtra(EXTRA_PATH)) ?: "/"
        val approve = intent.getBooleanExtra(EXTRA_APPROVE, false)

        // What's done needs nothing more from you, so it clears itself; a failure stays to tap.
        fun done(text: Int, clears: Boolean = true) = Notifications.update(
            context,
            tag,
            title,
            context.getString(text),
            path,
            dismissAfterMs = if (clears) CLEAR_MS else 0,
        )
        // Notifications from a server you've since left can't be answered from here.
        if (server != Store(context).serverUrl) return done(R.string.answer_other_server, clears = false)

        Notifications.update(
            context,
            tag,
            title,
            context.getString(if (approve) R.string.approving else R.string.denying),
            path,
            progress = true,
        )
        val cookies = CookieManager.getInstance().getCookie(server)
        val pending = goAsync()
        AppState.scope.launch {
            try {
                val code = withContext(Dispatchers.IO) { answer(server, toolCallId, approve, cookies) }
                when (code) {
                    in 200..299 -> done(if (approve) R.string.approved else R.string.denied)
                    404 -> done(R.string.already_answered)
                    else -> done(R.string.answer_failed, clears = false)
                }
            } finally {
                pending.finish()
            }
        }
    }

    /** The HTTP status, or -1 when the server couldn't be reached. */
    private fun answer(server: String, toolCallId: String, approve: Boolean, cookies: String?): Int {
        val body = JSONObject().put("approve", approve).put("scope", "once").toString().toByteArray()
        val headers = buildMap {
            put("Content-Type", "application/json")
            put("Accept", "application/json")
            put("Origin", server)
            if (cookies != null) put("Cookie", cookies)
        }
        return try {
            httpRequest(
                "$server/api/approvals/${Uri.encode(toolCallId)}",
                "POST",
                headers,
                body,
                timeoutMs = 7_000,
            ).code
        } catch (e: IOException) {
            Log.w(TAG, "Couldn't answer the approval", e)
            -1
        }
    }

    companion object {
        private const val TAG = "SekaiApproval"
        private const val CLEAR_MS = 6_000L
        private const val EXTRA_TOOL_CALL = "toolCallId"
        private const val EXTRA_APPROVE = "approve"
        private const val EXTRA_TAG = "tag"
        private const val EXTRA_SERVER = "server"
        private const val EXTRA_TITLE = "title"
        private const val EXTRA_PATH = "path"

        internal fun intent(context: Context, server: String, alert: Alert, approve: Boolean): PendingIntent {
            val intent = Intent(context, ApprovalReceiver::class.java)
                .putExtra(EXTRA_TOOL_CALL, alert.toolCallId)
                .putExtra(EXTRA_APPROVE, approve)
                .putExtra(EXTRA_TAG, alert.tag)
                .putExtra(EXTRA_SERVER, server)
                .putExtra(EXTRA_TITLE, alert.title)
                .putExtra(EXTRA_PATH, alert.path)
            return PendingIntent.getBroadcast(
                context,
                "${alert.tag}:$approve".hashCode(),
                intent,
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
        }
    }
}
