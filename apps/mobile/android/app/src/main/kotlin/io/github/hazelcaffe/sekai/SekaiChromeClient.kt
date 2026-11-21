package io.github.hazelcaffe.sekai

import android.Manifest
import android.graphics.Bitmap
import android.net.Uri
import android.os.Message
import android.webkit.GeolocationPermissions
import android.webkit.JsPromptResult
import android.webkit.JsResult
import android.webkit.PermissionRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.core.graphics.createBitmap
import androidx.core.net.toUri
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch

/** The page asking for more than a page can do alone: new windows, files, the microphone and camera. */
internal class SekaiChromeClient(private val activity: MainActivity, private val files: FileChooser) :
    WebChromeClient() {
    /**
     * target=_blank and window.open: a throwaway web view catches where the window would go, then that address
     * goes to the browser (other sites), Downloads (the server's /api/ files) or this web view (other server pages).
     */
    override fun onCreateWindow(
        parent: WebView,
        isDialog: Boolean,
        isUserGesture: Boolean,
        resultMsg: Message,
    ): Boolean {
        val transport = resultMsg.obj as? WebView.WebViewTransport ?: return false
        val popup = WebView(parent.context)
        popup.webViewClient = object : WebViewClient() {
            private var done = false

            private fun take(url: Uri): Boolean {
                if (done || url.toString() == "about:blank") return done
                done = true
                activity.openFromNewWindow(url)
                // Not popup.post: the popup is never attached to a window, so its queue never runs.
                parent.post { popup.destroy() }
                return true
            }

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) = take(request.url)

            override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
                if (take(url.toUri())) view.stopLoading()
            }

            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                parent.post { popup.destroy() }
                return true
            }
        }
        transport.webView = popup
        resultMsg.sendToTarget()
        return true
    }

    override fun onShowFileChooser(
        webView: WebView,
        filePathCallback: ValueCallback<Array<Uri>>,
        fileChooserParams: FileChooserParams,
    ) = files.show(filePathCallback, fileChooserParams)

    // The page's alert, confirm and prompt (and "leave this page?") are Material 3 dialogs, only for the server's pages.
    override fun onJsAlert(view: WebView, url: String, message: String, result: JsResult): Boolean =
        dialog(url, result) { JsDialog.Alert(message, result) }

    override fun onJsConfirm(view: WebView, url: String, message: String, result: JsResult): Boolean =
        dialog(url, result) { JsDialog.Confirm(message, result) }

    override fun onJsBeforeUnload(view: WebView, url: String, message: String, result: JsResult): Boolean =
        dialog(url, result) { JsDialog.Confirm(message.ifBlank { activity.getString(R.string.leave_page) }, result) }

    override fun onJsPrompt(
        view: WebView,
        url: String,
        message: String,
        defaultValue: String?,
        result: JsPromptResult,
    ): Boolean = dialog(url, result) { JsDialog.Prompt(message, defaultValue.orEmpty(), result) }

    private fun dialog(url: String, result: JsResult, make: () -> JsDialog): Boolean {
        if (!isSameOrigin(url, activity.bridgeOrigin)) {
            result.cancel()
            return true
        }
        activity.showJsDialog(make())
        return true
    }

    /** The microphone and camera, for the server's own pages only, once Android's permission is given. */
    override fun onPermissionRequest(request: PermissionRequest) {
        val ours = isSameOrigin(request.origin.toString(), activity.bridgeOrigin)
        val wanted = request.resources.filter { it in MEDIA }
        if (!ours || wanted.isEmpty()) return request.deny()
        activity.lifecycleScope.launch {
            val granted = activity.permissions.request(wanted.mapNotNull(MEDIA::get).distinct())
            val allowed = wanted.filter { granted[MEDIA[it]] == true }
            if (allowed.isEmpty()) request.deny() else request.grant(allowed.toTypedArray())
        }
    }

    override fun onGeolocationPermissionsShowPrompt(origin: String, callback: GeolocationPermissions.Callback) {
        callback.invoke(origin, false, false)
    }

    // Without this, videos without a poster show a grey play button while they load.
    override fun getDefaultVideoPoster(): Bitmap = createBitmap(1, 1)

    private companion object {
        val MEDIA = mapOf(
            PermissionRequest.RESOURCE_AUDIO_CAPTURE to Manifest.permission.RECORD_AUDIO,
            PermissionRequest.RESOURCE_VIDEO_CAPTURE to Manifest.permission.CAMERA,
        )
    }
}
