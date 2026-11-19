package io.github.hazelcaffe.sekai

import android.Manifest
import android.os.Build

/** Whether Sekai may show notifications, and asking for it (Android 13 and later ask; older ones allow by default). */
internal object NotificationAccess {
    /** "granted", "denied" or "prompt" (Android would still show its prompt). */
    fun state(activity: MainActivity): String {
        if (Notifications.allowed(activity)) return "granted"
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return "denied"
        val permission = Manifest.permission.POST_NOTIFICATIONS
        // Granted, yet off: turned off in Android settings.
        if (activity.permissions.has(permission)) return "denied"
        val canAsk = !activity.store.askedNotifications || activity.shouldShowRequestPermissionRationale(permission)
        return if (canAsk) "prompt" else "denied"
    }

    /** Shows Android's prompt if it can (it answers right away when people said no for good). */
    suspend fun ask(activity: MainActivity): String {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && !Notifications.allowed(activity)) {
            activity.permissions.request(Manifest.permission.POST_NOTIFICATIONS)
            activity.store.askedNotifications = true
        }
        return if (Notifications.allowed(activity)) "granted" else "denied"
    }
}
