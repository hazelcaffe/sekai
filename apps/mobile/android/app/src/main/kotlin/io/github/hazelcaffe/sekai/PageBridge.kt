package io.github.hazelcaffe.sekai

import android.net.Uri
import android.util.Base64
import android.webkit.WebView
import androidx.core.net.toUri
import androidx.lifecycle.lifecycleScope
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import kotlinx.coroutines.launch
import org.json.JSONObject

/**
 * `sekaiNative`: window.sekaiMobile's way to the app (shared/bridge.js). Only the connected server's pages get it
 * (MainActivity sets the allowed origin), and every message is checked again here: main frame, that origin.
 */
internal class PageBridge(private val activity: MainActivity) : WebViewCompat.WebMessageListener {
    /** The open page's reply proxy, from its `ready` message: events go through it. */
    private var page: JavaScriptReplyProxy? = null

    val ready get() = page != null

    /** The page went away (another page is loading). */
    fun reset() {
        page = null
    }

    fun emit(event: String, data: Any?) {
        page?.event(event, data)
    }

    override fun onPostMessage(
        view: WebView,
        message: WebMessageCompat,
        sourceOrigin: Uri,
        isMainFrame: Boolean,
        replyProxy: JavaScriptReplyProxy,
    ) {
        val server = activity.bridgeOrigin ?: return
        if (!isMainFrame || sourceOrigin.toString() != server) return
        val call = PageCall.parse(message, replyProxy) ?: return
        handle(call)
    }

    private fun handle(call: PageCall) {
        val args = call.args
        when (call.method) {
            "ready" -> {
                page = call.proxy
                call.reply()
            }
            "notify" -> {
                notify(args)
                call.reply()
            }
            // The app icon's number is iOS's; Android launchers count notifications themselves.
            "setBadge" -> call.reply()
            "openSettings" -> {
                call.reply()
                activity.showConnect(problem = null, fromSettings = true)
            }
            "openExternal" -> {
                val url = args.string("url")?.toUri()?.takeIf { it.scheme == "http" || it.scheme == "https" }
                    ?: return call.fail("Only http and https links open outside.")
                Links.openInBrowser(activity, url, activity.pageTheme)
                call.reply()
            }
            "theme" -> {
                PageTheme.parse(args.string("color"), args.bool("dark"))?.let(activity::applyPageTheme)
                call.reply()
            }
            "saveFile" -> saveFile(call)
            "push.register" -> activity.lifecycleScope.launch {
                try {
                    call.reply(Push.register(activity, FcmConfig.from(args.obj("fcm"))))
                } catch (e: PushError) {
                    call.fail(e.message.orEmpty())
                } catch (e: RuntimeException) {
                    call.fail("Couldn't turn on push (${e.message}).")
                }
            }
            "push.current" -> activity.lifecycleScope.launch {
                call.reply(Push.current(activity, FcmConfig.from(args.obj("fcm"))))
            }
            "push.unregister" -> activity.lifecycleScope.launch {
                Push.unregister(activity)
                call.reply()
            }
            "push.permission" -> call.reply(NotificationAccess.state(activity))
            "push.requestPermission" -> activity.lifecycleScope.launch {
                call.reply(NotificationAccess.ask(activity))
            }
            "signInWithBrowser" -> {
                val provider = args.opt("provider").takeUnless { it == JSONObject.NULL }
                if (provider != null && (provider !is String || !BrowserSignIn.validProvider(provider))) {
                    return call.fail("That isn't a sign-in provider.")
                }
                BrowserSignIn.start(activity, activity.bridgeOrigin ?: return, provider?.ifEmpty { null })
                call.reply()
            }
            else -> call.fail("The app doesn't know ${call.method.take(60)} yet. Update the Sekai app.")
        }
    }

    private fun notify(args: JSONObject) {
        // The page shows its own while you're looking at it.
        if (AppState.inFront) return
        val conversationId = args.string("conversationId")?.takeIf { CONVERSATION.matches(it) }
        val approval = args.obj("approval")
        val toolCallId = approval?.string("toolCallId")?.takeIf(::isToolCallId)
        // Requests that always ask are answered in the app, where you can see everything.
        val buttons = toolCallId != null && approval.bool("alwaysAsk") != true
        val path = conversationId?.let { "/c/$it" } ?: "/"
        Notifications.show(
            activity,
            Alert(
                title = args.string("title").orEmpty().take(200).ifBlank { activity.getString(R.string.app_name) },
                body = args.string("body").orEmpty().take(1000),
                path = path,
                tag = when {
                    toolCallId != null -> "approval-$toolCallId"
                    conversationId != null -> conversationId
                    else -> "sekai"
                },
                channel = if (toolCallId != null) Notifications.APPROVALS else Notifications.MESSAGES,
                toolCallId = toolCallId.takeIf { buttons },
            ),
        )
    }

    private fun saveFile(call: PageCall) {
        val name = call.args.string("name")
        val mime = call.args.string("mime")
        val base64 = call.args.string("base64") ?: return call.fail("No file to save.")
        val bytes = try {
            Base64.decode(base64, Base64.DEFAULT)
        } catch (_: IllegalArgumentException) {
            return call.fail("That file couldn't be read.")
        }
        Downloads.save(activity, name.orEmpty(), mime.orEmpty(), bytes)
        call.reply()
    }

    private companion object {
        val CONVERSATION = Regex("^[\\w-]{1,64}$")
    }
}
