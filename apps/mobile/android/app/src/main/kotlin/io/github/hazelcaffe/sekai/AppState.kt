package io.github.hazelcaffe.sekai

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob

/** What the activity, the push service and the notification buttons share in this process. */
internal object AppState {
    /** Whether Sekai is on screen: local notifications, and pushes other than tests, are skipped then. */
    @Volatile
    var inFront = false

    /** The open page's bridge, for events that start elsewhere (a new push token). Main thread only. */
    var page: PageBridge? = null

    /** Work that outlives a screen (answering from a notification, saving a download). */
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
}
