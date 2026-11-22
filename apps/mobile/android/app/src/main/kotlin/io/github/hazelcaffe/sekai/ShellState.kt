package io.github.hazelcaffe.sekai

import android.webkit.JsPromptResult
import android.webkit.JsResult
import android.webkit.WebView
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

/** How the server's own page is doing. */
internal sealed interface Load {
    /** No server saved yet: the first-launch screen. */
    data object NoServer : Load

    /** The page is loading; [slow] once it's taking a while. */
    data class Loading(val origin: String, val slow: Boolean = false) : Load

    data class Ready(val origin: String) : Load

    /** The page couldn't be opened; [retrying] while Try again is working. */
    data class Failed(val problem: ServerProblem, val retrying: Boolean = false) : Load
}

/** Native screens pushed over the page (or over each other), newest last. */
internal enum class Screen { Server, Address, About, Licence }

/** What the page reports about going back (the bridge's `backState`). */
internal data class PageBack(val overlay: Boolean = false, val canGoBack: Boolean = false)

/** A JavaScript alert, confirm or prompt the page is waiting on. */
internal sealed class JsDialog(val message: String) {
    class Alert(message: String, val result: JsResult) : JsDialog(message)

    class Confirm(message: String, val result: JsResult) : JsDialog(message)

    class Prompt(message: String, val initial: String, val result: JsPromptResult) : JsDialog(message)

    fun cancel() {
        when (this) {
            is Alert -> result.cancel()
            is Confirm -> result.cancel()
            is Prompt -> result.cancel()
        }
    }
}

/**
 * Everything the native screens show. The activity changes it and the Compose UI reads it, so nothing here holds a
 * view except [web], which is only handed to the page's layer.
 */
internal class ShellState {
    var web by mutableStateOf<WebView?>(null)

    /** The saved server (null before the first one) and the recent ones, newest first. */
    var server by mutableStateOf<String?>(null)
    var recent by mutableStateOf<List<String>>(emptyList())

    var load by mutableStateOf<Load>(Load.NoServer)
    var stack by mutableStateOf<List<Screen>>(emptyList())

    /** The phone's web view is too old for the bridge. */
    var webViewTooOld by mutableStateOf(false)

    var dialog by mutableStateOf<JsDialog?>(null)
    /** What the open page last reported through `backState`; null until it does (older pages never do). */
    var pageBack by mutableStateOf<PageBack?>(null)

    /** The web view has an earlier page of the server's to go back to (what decides for pages that don't report). */
    var historyBack by mutableStateOf(false)

    /** 0..1 while a back gesture is swiping a native screen away. */
    var backProgress by mutableFloatStateOf(0f)

    fun push(screen: Screen) {
        if (stack.lastOrNull() != screen) stack = stack + screen
    }

    fun pop() {
        if (stack.isNotEmpty()) stack = stack.dropLast(1)
        backProgress = 0f
    }

    /**
     * Whether back has something to do (so the system's own back, and its predictive animation to the home screen,
     * run otherwise): a native screen to close, or something in the page to close or go back to. A page that reports
     * its own state is believed over the web view's history, so its root screen leaves the app.
     */
    val canHandleBack: Boolean
        get() = stack.isNotEmpty() ||
            (front == null && (pageBack?.let { it.overlay || it.canGoBack } ?: historyBack))

    /** What's in front of the page, or null when the page itself is. */
    val front: Front?
        get() {
            if (webViewTooOld) return Front.WebViewTooOld
            stack.lastOrNull()?.let { return Front.Native(it) }
            return when (val state = load) {
                Load.NoServer -> Front.FirstLaunch
                is Load.Failed -> Front.Problem(state.problem, state.retrying)
                is Load.Loading -> if (state.slow) Front.Connecting(state.origin) else null
                is Load.Ready -> null
            }
        }
}

/** The screen on top. */
internal sealed interface Front {
    data object WebViewTooOld : Front

    data object FirstLaunch : Front

    data class Native(val screen: Screen) : Front

    data class Problem(val problem: ServerProblem, val retrying: Boolean) : Front

    data class Connecting(val origin: String) : Front
}
