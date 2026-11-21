package io.github.hazelcaffe.sekai

import android.app.NotificationManager
import android.os.Build
import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.annotation.RequiresApi
import io.github.hazelcaffe.sekai.ui.AddressScreen
import io.github.hazelcaffe.sekai.ui.SekaiTheme
import io.github.hazelcaffe.sekai.ui.ShellRoot
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.flowOf

/**
 * Debug builds only: the native screens with made-up state, so each can be looked at (and screenshotted) without a
 * server: `adb shell am start -n io.github.hazelcaffe.sekai/.GalleryActivity --es screen offline`. `--ez dynamic
 * false` shows the teal palette that phones before Android 12 get. `--es screen notify-approval` (or `notify-call`,
 * `notify-message`) posts a notification the way a push would.
 */
class GalleryActivity : ComponentActivity() {
    private val server = "https://sekai.example.com"
    private val recent = listOf(server, "http://192.168.1.20:7420", "https://sekai.home.example")

    private val actions = object : ShellActions {
        override suspend fun connect(address: String): ConnectError? = awaitCancellation()
        override fun retry() = Unit
        override fun open(screen: Screen) = Unit
        override fun back() = Unit
        override fun forget() = Unit
        override fun forgetRecent(origin: String) = Unit
        override fun updateWebView() = Unit
        override fun openNotificationSettings() = Unit
        override fun shareDetails() = Unit
        override fun onInsets(insets: CssInsets) = Unit
        override fun onBarsFor(native: Boolean, dark: Boolean, surface: Int) = Unit
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val screen = intent.getStringExtra("screen").orEmpty()
        if (screen.startsWith("notify-")) {
            post(screen)
            finish()
            return
        }
        render(screen, intent.getBooleanExtra("dynamic", true))
    }

    private fun post(screen: String) {
        val alert = when (screen) {
            "notify-approval" -> Alert(
                "Nori wants to run a command",
                "git push origin main, on Nori's computer",
                "/c/cnv_demo",
                "approval-tc_demo",
                Notifications.APPROVALS,
                toolCallId = "tc_demo",
            )
            "notify-call" -> Alert(
                "Nori is calling",
                "Tap to answer",
                "/c/cnv_demo",
                "call-demo",
                Notifications.CALLS,
                ring = true,
            )
            else -> Alert("Nori", "The proof is ready for you.", "/c/cnv_demo", "cnv_demo", Notifications.MESSAGES)
        }
        Notifications.show(this, alert)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) logPosted()
    }

    /** What the system holds for each posted notification (the lock-screen text, and the unlock requirement). */
    @RequiresApi(Build.VERSION_CODES.S)
    private fun logPosted() {
        for (n in getSystemService(NotificationManager::class.java).activeNotifications) {
            val buttons = n.notification.actions.orEmpty()
                .joinToString { "${it.title}: authRequired=${it.isAuthenticationRequired}" }
            val lockScreen = n.notification.publicVersion?.extras?.getCharSequence("android.text")
            Log.i(TAG, "posted tag=${n.tag} visibility=${n.notification.visibility} actions=[$buttons] public=$lockScreen")
        }
    }

    private fun render(screen: String, dynamic: Boolean) {
        val shell = ShellState().also {
            it.server = server
            it.recent = recent
        }
        fun problem(kind: ProblemKind, code: Int? = null, retrying: Boolean = false) {
            shell.load = Load.Failed(ServerProblem(kind, server, code), retrying)
        }
        var snack: Snack? = null
        when (screen) {
            "first" -> {
                shell.server = null
                shell.recent = emptyList()
                shell.load = Load.NoServer
            }
            "first-recent" -> shell.load = Load.NoServer
            "change" -> shell.stack = listOf(Screen.Server, Screen.Address)
            "server" -> shell.stack = listOf(Screen.Server)
            "about" -> shell.stack = listOf(Screen.Server, Screen.About)
            "licence" -> shell.stack = listOf(Screen.Server, Screen.About, Screen.Licence)
            "offline" -> problem(ProblemKind.Offline)
            "unreachable" -> problem(ProblemKind.Unreachable)
            "untrusted" -> problem(ProblemKind.Untrusted)
            "error" -> problem(ProblemKind.ServerError, 502)
            "retrying" -> problem(ProblemKind.Unreachable, retrying = true)
            "connecting" -> shell.load = Load.Loading(server, slow = true)
            "webview" -> shell.webViewTooOld = true
            "snack" -> {
                shell.load = Load.Ready(server)
                snack = Snack("Saved report.pdf", SnackAction("Open") {})
            }
        }
        when (screen) {
            "address-error", "address-checking", "address-invalid" -> setContent {
                SekaiTheme(dynamic = dynamic) {
                    AddressScreen(
                        root = true,
                        current = null,
                        recent = emptyList(),
                        actions = actions,
                        initialError = when (screen) {
                            "address-error" -> ConnectError.Server(ServerProblem(ProblemKind.Unreachable, server))
                            "address-invalid" -> ConnectError.Invalid
                            else -> null
                        },
                        initialChecking = screen == "address-checking",
                    )
                }
            }
            else -> setContent { ShellRoot(shell, actions, snack?.let { flowOf(it) } ?: emptyFlow(), dynamic) }
        }
    }

    private companion object {
        const val TAG = "SekaiGallery"
    }
}
