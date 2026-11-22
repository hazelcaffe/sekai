package io.github.hazelcaffe.sekai

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationManagerCompat

/** Decline on an incoming call's notification: stops the ringing and clears it. */
class CallReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val tag = intent.getStringExtra(EXTRA_TAG) ?: return
        NotificationManagerCompat.from(context).cancel(tag, Notifications.ID)
    }

    companion object {
        private const val EXTRA_TAG = "tag"

        internal fun decline(context: Context, tag: String): PendingIntent = PendingIntent.getBroadcast(
            context,
            "$tag:decline".hashCode(),
            Intent(context, CallReceiver::class.java).putExtra(EXTRA_TAG, tag),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
    }
}
