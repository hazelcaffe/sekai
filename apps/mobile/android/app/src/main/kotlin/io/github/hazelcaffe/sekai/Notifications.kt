package io.github.hazelcaffe.sekai

import android.annotation.SuppressLint
import android.app.Notification
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.net.Uri
import androidx.core.app.NotificationChannelCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
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
    private const val ID = 1
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
        val builder = base(context, alert.channel, open(context, alert.path, alert.tag))
            .setContentTitle(alert.title)
            .setContentText(alert.body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(alert.body))
        if (alert.toolCallId != null) {
            builder.setCategory(NotificationCompat.CATEGORY_REMINDER)
            for (approve in listOf(true, false)) {
                val answer = ApprovalReceiver.intent(context, server, alert, approve)
                builder.addAction(0, context.getString(if (approve) R.string.approve else R.string.deny), answer)
            }
        } else {
            builder.setCategory(NotificationCompat.CATEGORY_MESSAGE)
        }
        if (alert.ring) {
            builder.setCategory(NotificationCompat.CATEGORY_CALL).setTimeoutAfter(RING_MS)
        }
        val notification = builder.build()
        // Calls ring until they're answered, dismissed or time out.
        if (alert.ring) notification.flags = notification.flags or Notification.FLAG_INSISTENT
        post(context, alert.tag, notification)
    }

    /** Replaces an approval notification while it's answered, and once it is (or couldn't be). */
    fun update(context: Context, tag: String, title: String, text: String, path: String, progress: Boolean = false) {
        val builder = base(context, APPROVALS, open(context, path, tag))
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setOnlyAlertOnce(true)
            .setSilent(true)
        if (progress) builder.setProgress(0, 0, true).setOngoing(true).setAutoCancel(false)
        post(context, tag, builder.build())
    }

    /** "Saved to Downloads", tap to open the file. */
    fun saved(context: Context, name: String, file: Uri, mime: String) {
        val view = Intent(Intent.ACTION_VIEW)
            .setDataAndType(file, mime)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        val tag = "file:$file"
        val tap = PendingIntent.getActivity(
            context,
            tag.hashCode(),
            Intent.createChooser(view, name).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
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

    /** Opens the app at [path]. */
    fun open(context: Context, path: String, tag: String): PendingIntent = PendingIntent.getActivity(
        context,
        tag.hashCode(),
        MainActivity.openIntent(context, path),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    @SuppressLint("MissingPermission") // allowed() checks the permission (areNotificationsEnabled covers it)
    private fun post(context: Context, tag: String, notification: Notification) {
        if (!allowed(context)) return
        NotificationManagerCompat.from(context).notify(tag, ID, notification)
    }
}
