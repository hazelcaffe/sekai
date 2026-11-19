package io.github.hazelcaffe.sekai

import android.app.Application

/** What has to be ready even when no screen is open: notification channels, and push. */
class SekaiApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Notifications.createChannels(this)
        // Pushes reach a closed app, so Firebase starts from the project the server gave last time.
        Push.startSaved(this)
    }
}
