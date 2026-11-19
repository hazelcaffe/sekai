package io.github.hazelcaffe.sekai

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.net.Uri
import android.os.Bundle
import android.util.Log
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.webkit.CookieManager
import android.webkit.WebSettings
import android.webkit.WebView
import android.widget.Button
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.activity.addCallback
import androidx.core.net.toUri
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.webkit.ScriptHandler
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import kotlinx.coroutines.launch
import org.json.JSONObject

/**
 * The app's one screen: the connect screen (a bundled page) or the server's own web app, in one web view. This
 * class decides what's loaded; the clients, bridges and helpers next to it do the rest.
 */
class MainActivity : ComponentActivity() {
    internal lateinit var store: Store
        private set
    internal val permissions = PermissionAsker(this)
    private val files = FileChooser(this)
    private val pageBridge = PageBridge(this)
    private lateinit var root: FrameLayout
    private lateinit var bars: SystemBars
    private var web: WebView? = null
    private var bridgeScript: ScriptHandler? = null

    /** The server the bridge is set up for (its pages get window.sekaiMobile). */
    internal var bridgeOrigin: String? = null
        private set

    /** Why the connect screen is showing, when something went wrong. */
    internal var connectProblem: String? = null
        private set

    /** The colors on screen now. */
    internal var pageTheme: PageTheme? = null
        private set

    private var showingConnect = false
    private var showingUpdate = false

    /** After the app itself loads a page, back shouldn't return to what was before (a failed page, the connect screen). */
    private var clearHistoryFor: String? = null
    private var keepSplash = true

    private val bridgeSource by lazy { assets.open("bridge.js").bufferedReader().use { it.readText() } }

    override fun onCreate(savedInstanceState: Bundle?) {
        val splash = installSplashScreen()
        super.onCreate(savedInstanceState)
        splash.setKeepOnScreenCondition { keepSplash }
        store = Store(this)
        root = FrameLayout(this)
        bars = SystemBars(this, root)
        setContentView(root)
        // The splash stays until the first page shows, but not forever.
        root.postDelayed({ keepSplash = false }, SPLASH_MAX_MS)
        paint(store.theme?.takeIf { store.serverUrl != null } ?: PageTheme.system(this))

        if (!setUpWebView()) return showWebViewUpdate()
        AppState.page = pageBridge
        onBackPressedDispatcher.addCallback(this) { back() }
        val restored = safePath(savedInstanceState?.getString(STATE_PATH))
        when {
            restored != null -> navigate(restored)
            savedInstanceState == null -> handleIntent(intent, launch = true)
            else -> start()
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (web != null) handleIntent(intent, launch = false)
    }

    override fun onStart() {
        super.onStart()
        AppState.inFront = true
    }

    override fun onStop() {
        AppState.inFront = false
        super.onStop()
    }

    override fun onPause() {
        // Sign-ins survive the app being closed.
        CookieManager.getInstance().flush()
        super.onPause()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        val url = web?.url ?: return
        if (!showingConnect && isSameOrigin(url, bridgeOrigin)) {
            val uri = url.toUri()
            outState.putString(STATE_PATH, uri.path + (uri.query?.let { "?$it" } ?: ""))
        }
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        // The connect screen follows the phone's light or dark mode (the server's pages report their own colors).
        // From newConfig: the activity's resources may not have caught up yet.
        if (showingConnect) paint(PageTheme.system(this, newConfig))
        // The native screen's colors come from resources, so it starts again in the new mode.
        if (showingUpdate) recreate()
    }

    override fun onDestroy() {
        if (AppState.page === pageBridge) AppState.page = null
        web?.destroy()
        web = null
        super.onDestroy()
    }

    // ---------------------------------------------------------------- what's loaded

    private fun handleIntent(intent: Intent?, launch: Boolean) {
        val link = intent?.data?.takeIf { intent.action == Intent.ACTION_VIEW && it.scheme == Links.SCHEME }
        val path = safePath(intent?.getStringExtra(EXTRA_PATH))
        when {
            link != null -> openLink(link)
            path != null -> navigate(path)
            launch -> start()
        }
    }

    private fun start() {
        val server = store.serverUrl
        if (server == null) showConnect(null) else loadServer(server, "/")
    }

    /** Goes to [path] on the server: in the open page when it's ready, else by loading it. */
    internal fun navigate(path: String) {
        val server = store.serverUrl ?: return showConnect(null)
        if (pageBridge.ready && !showingConnect && bridgeOrigin == server) {
            pageBridge.emit("navigate", path)
        } else {
            loadServer(server, path)
        }
    }

    /** sekai:// links: a chat (sekai://c/<id>), or the browser sign-in coming back (sekai://signed-in?code=…). */
    internal fun openLink(link: Uri) {
        if (link.host != "signed-in") return navigate(Links.pathFromDeepLink(link) ?: "/")
        val (server, form) = BrowserSignIn.finish(store, link) ?: run {
            // Cancelled (or not ours): just be back where you were.
            if (web?.url == null) start()
            return
        }
        val view = web ?: return
        attachBridge(server)
        pageBridge.reset()
        clearHistoryFor = server
        // The server sets the session cookie and redirects to the app.
        view.postUrl("$server/api/auth/app/exchange", form.toByteArray())
    }

    /** Where a target=_blank link or window.open would have gone. */
    internal fun openFromNewWindow(url: Uri) {
        val view = web ?: return
        val address = url.toString()
        when (url.scheme?.lowercase()) {
            "http", "https" -> when {
                !isSameOrigin(address, bridgeOrigin) -> Links.openInBrowser(this, url, pageTheme)
                url.path.orEmpty().startsWith("/api/") -> Downloads.fetch(this, address, view.settings.userAgentString)
                else -> view.loadUrl(address)
            }
            Links.SCHEME -> openLink(url)
            in Links.APP_SCHEMES -> Links.openWithApp(this, url)
        }
    }

    /** The connect screen picked a server (it checked it's Sekai). */
    internal fun connectTo(origin: String) {
        val before = store.serverUrl
        if (before != null && before != origin && store.pushServer != null) {
            // Pushes from the server you left would open the new one.
            store.pushServer = null
            AppState.scope.launch { Push.unregister(applicationContext) }
        }
        store.useServer(origin)
        connectProblem = null
        clearHistoryFor = origin
        loadServer(origin, "/")
    }

    internal fun showConnect(problem: String?, fromSettings: Boolean = false) {
        val view = web ?: return
        connectProblem = problem
        pageBridge.reset()
        // From the page's settings, back returns to it; after a failed load, back leaves the app.
        clearHistoryFor = if (fromSettings) null else CONNECT_URL
        showingConnect = true
        paint(PageTheme.system(this))
        view.loadUrl(CONNECT_URL)
    }

    private fun loadServer(server: String, path: String) {
        val view = web ?: return
        attachBridge(server)
        pageBridge.reset()
        showingConnect = false
        paint(store.theme ?: PageTheme.system(this))
        view.loadUrl(server + path)
    }

    /** window.sekaiMobile (bridge.js and its listener) for [origin]'s pages only. */
    @SuppressLint("RequiresFeature") // setUpWebView checks both features before there's a web view
    private fun attachBridge(origin: String) {
        val view = web ?: return
        if (bridgeOrigin == origin) return
        if (bridgeOrigin != null) {
            WebViewCompat.removeWebMessageListener(view, PAGE_BRIDGE)
            bridgeScript?.remove()
        }
        WebViewCompat.addWebMessageListener(view, PAGE_BRIDGE, setOf(origin), pageBridge)
        val app = JSONObject()
            .put("platform", "android")
            .put("version", BuildConfig.VERSION_NAME)
            .put("serverUrl", origin)
        val script = bridgeSource.replace("__SEKAI_APP__", app.toString())
        bridgeScript = WebViewCompat.addDocumentStartJavaScript(view, script, setOf(origin))
        bridgeOrigin = origin
    }

    /** Back goes back in the web view, and leaves the app (to the background) when there's nowhere left. */
    private fun back() {
        val view = web
        if (view == null) {
            moveTaskToBack(true)
            return
        }
        val history = view.copyBackForwardList()
        // The server's "/" only redirects to a chat: going back to it would land right where you are.
        var steps = -1
        while (history.currentIndex + steps >= 0 && isHome(history.getItemAtIndex(history.currentIndex + steps).url)) {
            steps--
        }
        if (history.currentIndex + steps >= 0) view.goBackOrForward(steps) else moveTaskToBack(true)
    }

    private fun isHome(url: String) = bridgeOrigin != null && url.trimEnd('/') == bridgeOrigin

    // ---------------------------------------------------------------- from the web view

    internal fun onPageStarted(url: String) {
        showingConnect = url.startsWith(CONNECT_URL)
    }

    internal fun onPageVisible() {
        keepSplash = false
    }

    internal fun onPageFinished(url: String) {
        keepSplash = false
        val expected = clearHistoryFor ?: return
        if (url.startsWith(expected)) {
            web?.clearHistory()
            clearHistoryFor = null
        }
    }

    /** The page's colors (the bridge's `theme`): the bars, and the window for next time. */
    internal fun applyPageTheme(theme: PageTheme) {
        store.theme = theme
        paint(theme)
    }

    /** The web view's renderer crashed or was killed for memory: start a new web view where the page was. */
    internal fun onWebViewGone() {
        val url = web?.url
        web?.let {
            root.removeView(it)
            it.destroy()
        }
        web = null
        bridgeOrigin = null
        bridgeScript = null
        pageBridge.reset()
        if (!setUpWebView()) return showWebViewUpdate()
        val path = url?.takeIf { isSameOrigin(it, store.serverUrl) }?.toUri()?.path
        if (path != null) navigate(path) else start()
    }

    private fun paint(theme: PageTheme) {
        pageTheme = theme
        bars.apply(theme)
        web?.setBackgroundColor(theme.color)
    }

    // ---------------------------------------------------------------- the web view

    @SuppressLint("SetJavaScriptEnabled", "RequiresFeature") // it's a web app; the features are checked first
    private fun setUpWebView(): Boolean {
        val view = try {
            WebView(this)
        } catch (e: RuntimeException) {
            // No web view installed, or it's being updated right now.
            Log.w(TAG, "No web view", e)
            return false
        }
        val supported = WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) &&
            WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)
        if (!supported) {
            view.destroy()
            return false
        }
        view.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            safeBrowsingEnabled = true
            setGeolocationEnabled(false)
            setSupportMultipleWindows(true)
            javaScriptCanOpenWindowsAutomatically = true
            userAgentString = "$userAgentString SekaiApp/${BuildConfig.VERSION_NAME} (Android)"
        }
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(view, false)
        }
        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
        view.webViewClient = SekaiWebViewClient(this, assetLoader)
        view.webChromeClient = SekaiChromeClient(this, files)
        view.setDownloadListener { url, userAgent, disposition, mime, _ ->
            val onTheWeb = url.startsWith("https://") || url.startsWith("http://")
            when {
                isSameOrigin(url, bridgeOrigin) -> Downloads.enqueue(this, url, userAgent, disposition, mime)
                onTheWeb -> Links.openInBrowser(this, url.toUri(), pageTheme)
            }
        }
        WebViewCompat.addWebMessageListener(view, CONNECT_BRIDGE, setOf(ASSETS_ORIGIN), ConnectBridge(this))
        pageTheme?.let { view.setBackgroundColor(it.color) }
        root.addView(view, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
        web = view
        return true
    }

    /** Without a recent web view the bridge can't work, so there's a native screen asking to update it. */
    private fun showWebViewUpdate() {
        keepSplash = false
        showingUpdate = true
        paint(PageTheme.system(this))
        val screen = layoutInflater.inflate(R.layout.webview_update, root, true)
        screen.findViewById<Button>(R.id.update).setOnClickListener {
            val market = "market://details?id=$WEBVIEW_PACKAGE".toUri()
            try {
                startActivity(Intent(Intent.ACTION_VIEW, market))
            } catch (_: ActivityNotFoundException) {
                Links.openInBrowser(
                    this,
                    "https://play.google.com/store/apps/details?id=$WEBVIEW_PACKAGE".toUri(),
                    pageTheme,
                )
            }
        }
    }

    companion object {
        private const val TAG = "Sekai"
        const val ASSETS_HOST = "appassets.androidplatform.net"
        const val ASSETS_ORIGIN = "https://$ASSETS_HOST"
        private const val CONNECT_URL = "$ASSETS_ORIGIN/assets/connect.html"
        private const val PAGE_BRIDGE = "sekaiNative"
        private const val CONNECT_BRIDGE = "sekaiConnectNative"
        private const val EXTRA_PATH = "path"
        private const val STATE_PATH = "path"
        private const val SPLASH_MAX_MS = 2_500L
        private const val WEBVIEW_PACKAGE = "com.google.android.webview"

        /** Opens the app at [path] on the server (notifications). */
        fun openIntent(context: Context, path: String): Intent = Intent(context, MainActivity::class.java)
            .setAction(Intent.ACTION_VIEW)
            .putExtra(EXTRA_PATH, path)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    }
}
