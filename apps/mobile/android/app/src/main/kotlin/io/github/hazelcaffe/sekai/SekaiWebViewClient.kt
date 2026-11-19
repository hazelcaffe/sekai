package io.github.hazelcaffe.sekai

import android.graphics.Bitmap
import android.net.http.SslError
import android.webkit.RenderProcessGoneDetail
import android.webkit.SslErrorHandler
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import androidx.webkit.WebResourceErrorCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat

/**
 * Where the web view may go: the server's own pages stay; other sites open in the browser; mailto:/tel:/sms: in
 * the phone's apps; sekai:// links in the app. A server that can't be reached shows the connect screen.
 */
internal class SekaiWebViewClient(private val activity: MainActivity, private val assets: WebViewAssetLoader) :
    WebViewClientCompat() {
    override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
        assets.shouldInterceptRequest(request.url)

    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        // Frames load what the page's own rules allow.
        if (!request.isForMainFrame) return false
        val url = request.url
        return when (val scheme = url.scheme?.lowercase()) {
            "http", "https" -> when {
                isSameOrigin(url.toString(), activity.bridgeOrigin) -> false
                // Only the app itself opens its connect screen.
                url.host == MainActivity.ASSETS_HOST -> true
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
        activity.onPageStarted(url)
    }

    override fun onPageCommitVisible(view: WebView, url: String) {
        activity.onPageVisible()
    }

    override fun onPageFinished(view: WebView, url: String) {
        activity.onPageFinished(url)
    }

    override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceErrorCompat) {
        val server = activity.bridgeOrigin ?: return
        if (request.isForMainFrame && isSameOrigin(request.url.toString(), server)) {
            activity.showConnect(unreachable(server))
        }
    }

    override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, errorResponse: WebResourceResponse) {
        val server = activity.bridgeOrigin ?: return
        // A proxy in front of Sekai answering for it while Sekai is down or restarting.
        if (request.isForMainFrame && isSameOrigin(request.url.toString(), server) &&
            errorResponse.statusCode in 502..504
        ) {
            activity.showConnect(
                "$server isn't answering right now (error ${errorResponse.statusCode}). Try again in a moment.",
            )
        }
    }

    override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
        handler.cancel()
        val server = activity.bridgeOrigin ?: return
        if (isSameOrigin(error.url, server)) activity.showConnect(untrusted(server))
    }

    override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
        activity.onWebViewGone()
        return true
    }
}
