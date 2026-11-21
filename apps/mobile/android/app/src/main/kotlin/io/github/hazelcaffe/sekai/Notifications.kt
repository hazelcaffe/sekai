package io.github.hazelcaffe.sekai

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationChannelCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import androidx.core.content.ContextCompat

/** A notification to show: from the page (`notify`) or a push. */
internal data class Alert(
    val title: String,
    val body: String,
    /** Where tapping it goes, e.g. "/c/abc". */
    val path: String,
    /** Alerts with the same tag replace each other. */
    val tag: String,
    val channel: String,
    /** Set when it gets Approve / Deny buttons. */
    val toolCallId: String? = null,
    val ring: Boolean = false,
)

internal object Notifications {
    const val MESSAGES = "messages"
    const val APPROVALS = "approvals"
    const val CALLS = "calls"
    const val FILES = "files"

    // Every notification has its own tag, so they share one id.
    const val ID = 1
    private const val RING_MS = 45_000L

    fun createChannels(context: Context) {
        val ringtone = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
        val ringing = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()

        fun channel(id: String, importance: Int, name: Int, about: Int) =
            NotificationChannelCompat.Builder(id, importance)
                .setName(context.getString(name))
                .setDescription(context.getString(about))
        val high = NotificationManagerCompat.IMPORTANCE_HIGH
        val normal = NotificationManagerCompat.IMPORTANCE_DEFAULT
        val low = NotificationManagerCompat.IMPORTANCE_LOW
        val channels = listOf(
            channel(MESSAGES, normal, R.string.channel_messages, R.string.channel_messages_about),
            channel(APPROVALS, high, R.string.channel_approvals, R.string.channel_approvals_about),
            channel(CALLS, high, R.string.channel_calls, R.string.channel_calls_about)
                .setSound(ringtone, ringing)
                .setVibrationEnabled(true),
            channel(FILES, low, R.string.channel_files, R.string.channel_files_about),
        )
        NotificationManagerCompat.from(context).createNotificationChannelsCompat(channels.map { it.build() })
    }

    fun allowed(context: Context) = NotificationManagerCompat.from(context).areNotificationsEnabled()

    fun show(context: Context, alert: Alert) {
        val server = Store(context).serverUrl ?: return
        val open = open(context, alert.path, alert.tag)
        // On the lock screen the words stay private: it says only that something's there.
        val hidden = when {
            alert.ring -> R.string.hidden_call
            alert.toolCallId != null || alert.channel == APPROVALS -> R.string.hidden_approval
            else -> R.string.hidden_message
        }
        val builder = base(context, alert.channel, open)
            .setContentTitle(alert.title)
            .setContentText(alert.body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(alert.body))
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(
                base(context, alert.channel, open)
                    .setContentTitle(context.getString(R.string.app_name))
                    .setContentText(context.getString(hidden))
                    .build(),
            )
        if (alert.toolCallId != null) {
            builder.setCategory(NotificationCompat.CATEGORY_REMINDER)
            for (approve in listOf(true, false)) {
                val answer = ApprovalReceiver.intent(context, server, alert, approve)
                val label = context.getString(if (approve) R.string.approve else R.string.deny)
                // Answering for a bot needs the phone unlocked first (Android 12 and later; before that it's inert).
                val action = NotificationCompat.Action.Builder(0, label, answer)
                    .setAuthenticationRequired(true)
                    .build()
                builder.addAction(action)
            }
        } else {
            builder.setCategory(NotificationCompat.CATEGORY_MESSAGE)
        }
        if (alert.ring) {
            builder.setCategory(NotificationCompat.CATEGORY_CALL).setTimeoutAfter(RING_MS)
            callButtons(context, builder, alert, open)
        }
        val notification = builder.build()
        // Calls ring until they're answered, dismissed or time out.
        if (alert.ring) notification.flags = notification.flags or Notification.FLAG_INSISTENT
        post(context, alert.tag, notification)
    }

    /**
     * Answer and Decline on an incoming call. Where Android shows calls its own way (12 and later, and allowed to use
     * a full-screen alert) it's a call notification with two big buttons; elsewhere the same two buttons are plain
     * actions. Answering opens the chat, where the call is; Declining just clears it.
     */
    private fun callButtons(context: Context, builder: NotificationCompat.Builder, alert: Alert, open: PendingIntent) {
        val decline = CallReceiver.decline(context, alert.tag)
        if (callStyleAllowed(context)) {
            val caller = Person.Builder().setName(alert.title).setImportant(true).build()
            builder
                .setStyle(NotificationCompat.CallStyle.forIncomingCall(caller, decline, open))
                // Not `open`: the system starts this itself on a locked phone, which mustn't stop the ringing.
                .setFullScreenIntent(open(context, alert.path, alert.tag, clears = false), true)
                .setOngoing(true)
        } else {
            builder.addAction(0, context.getString(R.string.answer), open)
            builder.addAction(0, context.getString(R.string.decline), decline)
        }
    }

    private fun callStyleAllowed(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return false
        // Android 14 lets people turn full-screen alerts off per app.
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE ||
            context.getSystemService(NotificationManager::class.java).canUseFullScreenIntent()
    }

    /**
     * Replaces an approval notification (same tag, so no second one) while it's answered, and once it is (or couldn't
     * be): without its buttons, quietly. [dismissAfterMs] clears an outcome that needs nothing more from you.
     */
    fun update(
        context: Context,
        tag: String,
        title: String,
        text: String,
        path: String,
        progress: Boolean = false,
        dismissAfterMs: Long = 0,
    ) {
        val builder = base(context, APPROVALS, open(context, path, tag))
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setOnlyAlertOnce(true)
            .setSilent(true)
        if (progress) builder.setProgress(0, 0, true).setOngoing(true).setAutoCancel(false)
        if (dismissAfterMs > 0) builder.setTimeoutAfter(dismissAfterMs)
        post(context, tag, builder.build())
    }

    /** Opens a saved file in whatever app can show it. */
    private fun fileIntent(name: String, file: Uri, mime: String): Intent {
        val view = Intent(Intent.ACTION_VIEW)
            .setDataAndType(file, mime)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        return Intent.createChooser(view, name).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }

    fun openFile(context: Context, name: String, file: Uri, mime: String) {
        try {
            context.startActivity(fileIntent(name, file, mime))
        } catch (_: ActivityNotFoundException) {
            Snacks.show(context, R.string.no_app_for_link)
        }
    }

    /** "Saved to Downloads", tap to open the file. */
    fun saved(context: Context, name: String, file: Uri, mime: String) {
        val tag = "file:$file"
        val tap = PendingIntent.getActivity(
            context,
            tag.hashCode(),
            fileIntent(name, file, mime),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val builder = base(context, FILES, tap)
            .setContentTitle(context.getString(R.string.saved_to_downloads))
            .setContentText(context.getString(R.string.saved_tap_to_open, name))
        post(context, tag, builder.build())
    }

    private fun base(context: Context, channel: String, tap: PendingIntent) =
        NotificationCompat.Builder(context, channel)
            .setSmallIcon(R.drawable.ic_notification)
            .setColor(ContextCompat.getColor(context, R.color.accent))
            .setContentIntent(tap)
            .setAutoCancel(true)
            .setPriority(
                if (channel == MESSAGES || channel == FILES) {
                    NotificationCompat.PRIORITY_DEFAULT
                } else {
                    NotificationCompat.PRIORITY_HIGH
                },
            )

    /**
     * Opens the app at [path], and when [clears], clears the notification [tag] too (its buttons don't by themselves,
     * as tapping the notification does).
     */
    fun open(context: Context, path: String, tag: String, clears: Boolean = true): PendingIntent =
        PendingIntent.getActivity(
            context,
            // Extras don't tell PendingIntents apart, the request code does.
            (if (clears) tag else "$tag:open").hashCode(),
            MainActivity.openIntent(context, path, tag.takeIf { clears }),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

    @SuppressLint("MissingPermission") // allowed() checks the permission (areNotificationsEnabled covers it)
    private fun post(context: Context, tag: String, notification: Notification) {
        if (!allowed(context)) return
        NotificationManagerCompat.from(context).notify(tag, ID, notification)
    }
}
