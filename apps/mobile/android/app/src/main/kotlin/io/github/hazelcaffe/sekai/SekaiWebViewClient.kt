package io.github.hazelcaffe.sekai

import android.graphics.Bitmap
import android.net.http.SslError
import android.webkit.RenderProcessGoneDetail
import android.webkit.SslErrorHandler
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import androidx.webkit.WebResourceErrorCompat
import androidx.webkit.WebViewClientCompat

/**
 * Where the web view may go: the server's own pages stay; other sites open in the browser; mailto:/tel:/sms: in
 * the phone's apps; sekai:// links in the app. A server that can't be reached shows the offline screen.
 */
internal class SekaiWebViewClient(private val activity: MainActivity) : WebViewClientCompat() {
    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        // Frames load what the page's own rules allow.
        if (!request.isForMainFrame) return false
        val url = request.url
        return when (val scheme = url.scheme?.lowercase()) {
            "http", "https" -> when {
                isSameOrigin(url.toString(), activity.bridgeOrigin) -> false
                else -> {
                    Links.openInBrowser(activity, url, activity.pageTheme)
                    true
                }
            }
            Links.SCHEME -> {
                activity.openLink(url)
                true
            }
            in Links.APP_SCHEMES -> {
                Links.openWithApp(activity, url)
                true
            }
            else -> scheme != "about"
        }
    }

    override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
        activity.onPageStarted()
    }

    override fun onPageCommitVisible(view: WebView, url: String) {
        activity.onPageVisible(url)
    }

    override fun onPageFinished(view: WebView, url: String) {
        activity.onPageFinished(url)
    }

    override fun doUpdateVisitedHistory(view: WebView, url: String, isReload: Boolean) {
        activity.onHistoryChanged()
    }

    override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceErrorCompat) {
        val server = activity.bridgeOrigin ?: return
        if (request.isForMainFrame && isSameOrigin(request.url.toString(), server)) {
            val kind = if (Connectivity.isOnline(activity)) ProblemKind.Unreachable else ProblemKind.Offline
            activity.onLoadFailed(ServerProblem(kind, server))
        }
    }

    override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, errorResponse: WebResourceResponse) {
        val server = activity.bridgeOrigin ?: return
        // A proxy in front of Sekai answering for it while Sekai is down or restarting.
        if (request.isForMainFrame && isSameOrigin(request.url.toString(), server) &&
            errorResponse.statusCode in 502..504
        ) {
            activity.onLoadFailed(ServerProblem(ProblemKind.ServerError, server, errorResponse.statusCode))
        }
    }

    override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
        handler.cancel()
        val server = activity.bridgeOrigin ?: return
        if (isSameOrigin(error.url, server)) activity.onLoadFailed(ServerProblem(ProblemKind.Untrusted, server))
    }

    override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
        activity.onWebViewGone()
        return true
    }
}
