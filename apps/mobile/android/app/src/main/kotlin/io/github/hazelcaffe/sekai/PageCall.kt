package io.github.hazelcaffe.sekai

import android.annotation.SuppressLint
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import org.json.JSONException
import org.json.JSONObject

/**
 * A call from a page over a WebMessageListener: `{id?, method, args}`. Replies are `{id, result}` or `{id, error}`
 * (see apps/mobile/AGENTS.md). Use it on the main thread, like the reply proxy.
 */
internal class PageCall private constructor(
    private val id: Int?,
    val method: String,
    val args: JSONObject,
    val proxy: JavaScriptReplyProxy,
) {
    fun reply(result: Any? = null) = send(JSONObject().put("id", id).put("result", result ?: JSONObject.NULL))

    fun fail(error: String) = send(JSONObject().put("id", id).put("error", error))

    @SuppressLint("RequiresFeature") // calls only arrive through a WebMessageListener
    private fun send(json: JSONObject) {
        if (id != null) proxy.postMessage(json.toString())
    }

    companion object {
        fun parse(message: WebMessageCompat, proxy: JavaScriptReplyProxy): PageCall? {
            if (message.type != WebMessageCompat.TYPE_STRING) return null
            val json = try {
                JSONObject(message.data ?: return null)
            } catch (_: JSONException) {
                return null
            }
            val method = json.opt("method") as? String ?: return null
            val id = (json.opt("id") as? Number)?.toInt()
            return PageCall(id, method, json.opt("args") as? JSONObject ?: JSONObject(), proxy)
        }
    }
}

/** Native → page events: `{event, data}`. */
@SuppressLint("RequiresFeature")
internal fun JavaScriptReplyProxy.event(name: String, data: Any?) =
    postMessage(JSONObject().put("event", name).put("data", data ?: JSONObject.NULL).toString())

// Arguments come from a web page: only take values of the right type.

internal fun JSONObject.string(name: String): String? = opt(name) as? String

internal fun JSONObject.bool(name: String): Boolean? = opt(name) as? Boolean

internal fun JSONObject.obj(name: String): JSONObject? = opt(name) as? JSONObject
