package io.github.hazelcaffe.sekai

import android.net.Uri
import android.webkit.WebView
import androidx.lifecycle.lifecycleScope
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

/** `sekaiConnectNative`: the bundled connect screen's bridge (only its origin gets it, see MainActivity). */
internal class ConnectBridge(private val activity: MainActivity) : WebViewCompat.WebMessageListener {
    override fun onPostMessage(
        view: WebView,
        message: WebMessageCompat,
        sourceOrigin: Uri,
        isMainFrame: Boolean,
        replyProxy: JavaScriptReplyProxy,
    ) {
        if (!isMainFrame || sourceOrigin.toString() != MainActivity.ASSETS_ORIGIN) return
        val call = PageCall.parse(message, replyProxy) ?: return
        when (call.method) {
            "state" -> call.reply(
                JSONObject()
                    .put("serverUrl", activity.store.serverUrl ?: JSONObject.NULL)
                    .put("recent", JSONArray(activity.store.recent))
                    .put("problem", activity.connectProblem ?: JSONObject.NULL)
                    .put("version", BuildConfig.VERSION_NAME),
            )
            "connect" -> connect(call)
            else -> call.fail("Unknown method")
        }
    }

    private fun connect(call: PageCall) {
        val origin = call.args.string("url")?.take(2000)?.let(::normalizeServerUrl)
            ?: return call.reply(result("Enter an address like https://sekai.example.com."))
        activity.lifecycleScope.launch {
            when (val check = checkServer(origin)) {
                is ServerCheck.Ok -> {
                    call.reply(JSONObject().put("ok", true))
                    activity.connectTo(check.origin)
                }
                is ServerCheck.Problem -> call.reply(result(check.message))
            }
        }
    }

    private fun result(error: String) = JSONObject().put("ok", false).put("error", error)
}
