package io.github.hazelcaffe.sekai

import android.animation.ValueAnimator
import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.util.Log
import android.view.animation.AccelerateInterpolator
import android.webkit.CookieManager
import android.webkit.WebSettings
import android.webkit.WebStorage
import android.webkit.WebView
import androidx.activity.BackEventCompat
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.compose.setContent
import androidx.compose.runtime.snapshotFlow
import androidx.core.app.NotificationManagerCompat
import androidx.core.net.toUri
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.lifecycle.lifecycleScope
import androidx.webkit.ScriptHandler
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import io.github.hazelcaffe.sekai.ui.ShellRoot
import io.github.hazelcaffe.sekai.ui.appDetails
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject

/**
 * The app's one screen: the server's own web app in a web view, drawn edge to edge, with Compose (Material 3)
 * screens over it when something native is needed (connecting, the server, offline, about). This class decides
 * what's loaded; [ShellState] is what the screens show, and the clients, bridges and helpers next to it do the rest.
 */
class MainActivity : ComponentActivity() {
    internal lateinit var store: Store
        private set
    internal val permissions = PermissionAsker(this)
    private val files = FileChooser(this)
    private val pageBridge = PageBridge(this)
    private val shell = ShellState()
    private lateinit var bars: SystemBars
    private var web: WebView? = null
    private var bridgeScript: ScriptHandler? = null
    private var insetsScript: ScriptHandler? = null
    private var insets = CssInsets.NONE
    private var insetsJob: Job? = null
    private var slowJob: Job? = null
    private var backJob: Job? = null

    /** The server the bridge is set up for (its pages get window.sekaiMobile). */
    internal var bridgeOrigin: String? = null
        private set

    /** The colors on screen now. */
    internal var pageTheme: PageTheme? = null
        private set

    /** The path of the page being loaded, so Try again opens the same one. */
    private var loadPath = "/"

    /** A failure was already shown for this page load (an error page and an HTTP error can both report one). */
    private var failedThisLoad = false

    /** After the app itself loads a page, back shouldn't return to what was before (a failed page). */
    private var clearHistoryFor: String? = null
    private var keepSplash = true
    private var nativeFront = false
    private var nativeDark = false
    private var nativeSurface = 0

    private val bridgeSource by lazy { assets.open("bridge.js").bufferedReader().use { it.readText() } }

    /** Back is enabled only while there's something for it to do, so otherwise Android's own back animation runs. */
    private val backCallback = object : OnBackPressedCallback(false) {
        override fun handleOnBackStarted(backEvent: BackEventCompat) {
            shell.backProgress = 0f
        }

        override fun handleOnBackProgressed(backEvent: BackEventCompat) {
            if (shell.stack.isNotEmpty()) shell.backProgress = backEvent.progress
        }

        override fun handleOnBackCancelled() {
            shell.backProgress = 0f
        }

        override fun handleOnBackPressed() = goBack()
    }

    private val actions = object : ShellActions {
        override suspend fun connect(address: String) = this@MainActivity.connect(address)

        override fun retry() = this@MainActivity.retry()

        override fun open(screen: Screen) {
            shell.push(screen)
        }

        override fun back() {
            shell.pop()
        }

        override fun forget() = this@MainActivity.forget()

        override fun forgetRecent(origin: String) {
            store.forgetServer(origin)
            syncServers()
        }

        override fun updateWebView() = this@MainActivity.updateWebView()

        override fun openNotificationSettings() = this@MainActivity.openNotificationSettings()

        override fun shareDetails() = this@MainActivity.shareDetails()

        override fun onInsets(insets: CssInsets) = this@MainActivity.onInsets(insets)

        override fun onBarsFor(native: Boolean, dark: Boolean, surface: Int) {
            nativeFront = native
            nativeDark = dark
            nativeSurface = surface
            updateBars()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        val splash = installSplashScreen()
        super.onCreate(savedInstanceState)
        splash.setKeepOnScreenCondition { keepSplash }
        splash.setOnExitAnimationListener { provider ->
            if (ValueAnimator.areAnimatorsEnabled()) {
                provider.view.animate().alpha(0f).setDuration(SPLASH_FADE_MS).setInterpolator(AccelerateInterpolator())
                    .withEndAction(provider::remove).start()
            } else {
                provider.remove()
            }
        }
        store = Store(this)
        bars = SystemBars(this)
        syncServers()
        paint(store.theme?.takeIf { store.serverUrl != null } ?: PageTheme.system(this))
        // The splash stays until the first page shows, but not forever.
        window.decorView.postDelayed({ keepSplash = false }, SPLASH_MAX_MS)

        val ready = setUpWebView()
        setContent { ShellRoot(shell, actions, Snacks.flow) }
        if (!ready) {
            keepSplash = false
            shell.webViewTooOld = true
            return
        }
        AppState.page = pageBridge
        onBackPressedDispatcher.addCallback(this, backCallback)
        // Before Android 12 the system's back closes the activity (and the page with it), so back stays on and
        // sends the app to the background instead; there's no predictive animation to keep there.
        val keepsPage = Build.VERSION.SDK_INT < Build.VERSION_CODES.S
        lifecycleScope.launch {
            snapshotFlow { shell.canHandleBack }.collect { backCallback.isEnabled = it || keepsPage }
        }
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
        if (isSameOrigin(url, bridgeOrigin)) {
            val uri = url.toUri()
            outState.putString(STATE_PATH, uri.path + (uri.query?.let { "?$it" } ?: ""))
        }
    }

    override fun onDestroy() {
        if (AppState.page === pageBridge) AppState.page = null
        shell.dialog?.cancel()
        shell.dialog = null
        shell.web = null
        web?.destroy()
        web = null
        super.onDestroy()
    }

    // ---------------------------------------------------------------- what's loaded

    private fun handleIntent(intent: Intent?, launch: Boolean) {
        // A notification's button opened the app (Answer on a call): it has done its job, and a call stops ringing.
        intent?.getStringExtra(EXTRA_NOTIFICATION)?.let {
            NotificationManagerCompat.from(this).cancel(it, Notifications.ID)
        }
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
        if (server == null) {
            shell.load = Load.NoServer
            keepSplash = false
        } else {
            loadServer(server, "/")
        }
    }

    /** Goes to [path] on the server: in the open page when it's ready, else by loading it. */
    internal fun navigate(path: String) {
        val server = store.serverUrl ?: return start()
        // Whatever native screen was open gives way to the chat a notification or link points at.
        shell.stack = emptyList()
        if (pageBridge.ready && shell.load is Load.Ready && bridgeOrigin == server) {
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
        beginLoad(server, "/")
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

    /** Checks [address] is a Sekai server and switches to it. */
    private suspend fun connect(address: String): ConnectError? {
        val origin = address.take(MAX_ADDRESS).let(::normalizeServerUrl) ?: return ConnectError.Invalid
        return when (val check = checkServer(this, origin)) {
            is ServerCheck.Ok -> {
                connectTo(check.origin)
                null
            }
            is ServerCheck.Problem -> ConnectError.Server(check.problem)
        }
    }

    private fun connectTo(origin: String) {
        val before = store.serverUrl
        if (before != null && before != origin && store.pushServer != null) {
            // Pushes from the server you left would open the new one.
            store.pushServer = null
            AppState.scope.launch { Push.unregister(applicationContext) }
        }
        store.useServer(origin)
        syncServers()
        shell.stack = emptyList()
        // The same server that's working: nothing to load.
        if (before == origin && shell.load is Load.Ready) return
        clearHistoryFor = origin
        loadServer(origin, "/")
    }

    /** Try again on the offline screen: the same page, while the screen shows it's working. */
    private fun retry() {
        val server = store.serverUrl ?: return
        val failed = shell.load as? Load.Failed ?: return
        if (failed.retrying) return
        loadServer(server, loadPath)
    }

    /** Forgets the saved server and the sign-in on this phone, and goes back to the first screen. */
    private fun forget() {
        val origin = store.serverUrl ?: return
        store.forgetServer(origin)
        if (store.pushServer != null) {
            store.pushServer = null
            AppState.scope.launch { Push.unregister(applicationContext) }
        }
        CookieManager.getInstance().removeAllCookies(null)
        WebStorage.getInstance().deleteAllData()
        web?.let {
            it.loadUrl("about:blank")
            it.clearHistory()
        }
        slowJob?.cancel()
        detachBridge()
        pageBridge.reset()
        syncServers()
        shell.stack = emptyList()
        shell.pageBack = null
        shell.historyBack = false
        shell.load = Load.NoServer
        paint(PageTheme.system(this))
    }

    private fun syncServers() {
        shell.server = store.serverUrl
        shell.recent = store.recent
    }

    /** The bridge's `openSettings`: the server screen, over the page (which stays where it was). */
    internal fun showServer() {
        shell.push(Screen.Server)
    }

    private fun loadServer(server: String, path: String) {
        val view = web ?: return
        attachBridge(server)
        pageBridge.reset()
        shell.pageBack = null
        paint(store.theme ?: PageTheme.system(this))
        beginLoad(server, path)
        view.loadUrl(server + path)
    }

    /** Marks the state for a page load that's starting (the caller loads it). */
    private fun beginLoad(server: String, path: String) {
        loadPath = path
        failedThisLoad = false
        slowJob?.cancel()
        val failed = shell.load as? Load.Failed
        if (failed != null && failed.problem.origin == server) {
            // Try again: the offline screen stays, showing it's working.
            shell.load = failed.copy(retrying = true)
        } else {
            shell.load = Load.Loading(server)
            slowJob = lifecycleScope.launch {
                delay(SLOW_MS)
                (shell.load as? Load.Loading)?.let { shell.load = it.copy(slow = true) }
            }
        }
    }

    /** window.sekaiMobile (bridge.js and its listener) for [origin]'s pages only. */
    @SuppressLint("RequiresFeature") // setUpWebView checks both features before there's a web view
    private fun attachBridge(origin: String) {
        val view = web ?: return
        if (bridgeOrigin == origin) return
        detachBridge()
        WebViewCompat.addWebMessageListener(view, PAGE_BRIDGE, setOf(origin), pageBridge)
        val app = JSONObject()
            .put("platform", "android")
            .put("version", BuildConfig.VERSION_NAME)
            .put("serverUrl", origin)
        val script = bridgeSource.replace("__SEKAI_APP__", app.toString())
        bridgeScript = WebViewCompat.addDocumentStartJavaScript(view, script, setOf(origin))
        bridgeOrigin = origin
        registerInsetsScript()
    }

    @SuppressLint("RequiresFeature")
    private fun detachBridge() {
        val view = web ?: return
        if (bridgeOrigin == null) return
        WebViewCompat.removeWebMessageListener(view, PAGE_BRIDGE)
        bridgeScript?.remove()
        insetsScript?.remove()
        bridgeScript = null
        insetsScript = null
        bridgeOrigin = null
    }

    // ---------------------------------------------------------------- back

    /**
     * What a back gesture does. Native screens close first. Then the page gets to close its topmost sheet, dialog,
     * menu or side panel, or go back a screen (`window.__sekaiBack`, which says whether it did); only when it didn't
     * does the web view's own history go back, and with nothing left the app goes to the background.
     */
    private fun goBack() {
        if (shell.stack.isNotEmpty()) return shell.pop()
        if (!shell.canHandleBack) {
            moveTaskToBack(true)
            return
        }
        if (backJob?.isActive == true) return
        backJob = lifecycleScope.launch {
            if (askPageToGoBack()) return@launch
            val steps = historySteps()
            if (steps != null) web?.goBackOrForward(steps) else moveTaskToBack(true)
        }
    }

    private suspend fun askPageToGoBack(): Boolean {
        val view = web ?: return false
        if (!isSameOrigin(view.url, bridgeOrigin)) return false
        return withTimeoutOrNull(BACK_ASK_MS) {
            suspendCancellableCoroutine { continuation ->
                view.evaluateJavascript(BACK_SCRIPT) { continuation.resumeWith(Result.success(it == "true")) }
            }
        } ?: false
    }

    /** How many steps back the web view's history goes, or null when there's nothing before this page. */
    private fun historySteps(): Int? {
        val history = web?.copyBackForwardList() ?: return null
        // The server's "/" only redirects to a chat: going back to it would land right where you are.
        var steps = -1
        while (history.currentIndex + steps >= 0 && isHome(history.getItemAtIndex(history.currentIndex + steps).url)) {
            steps--
        }
        return if (history.currentIndex + steps >= 0) steps else null
    }

    private fun isHome(url: String) = bridgeOrigin != null && url.trimEnd('/') == bridgeOrigin

    internal fun onHistoryChanged() {
        shell.historyBack = historySteps() != null
    }

    /** The page's `backState`: whether it has something to close or a screen to go back to. */
    internal fun onPageBackState(state: PageBack) {
        shell.pageBack = state
    }

    // ---------------------------------------------------------------- from the web view

    internal fun onPageStarted() {
        failedThisLoad = false
        // A new page reports for itself (SPA navigation inside it doesn't come through here).
        shell.pageBack = null
    }

    internal fun onPageVisible(url: String) {
        pageShown(url)
        applyInsets()
    }

    internal fun onPageFinished(url: String) {
        pageShown(url)
        onHistoryChanged()
        val expected = clearHistoryFor ?: return
        if (url.startsWith(expected)) {
            web?.clearHistory()
            clearHistoryFor = null
            onHistoryChanged()
        }
    }

    private fun pageShown(url: String) {
        keepSplash = false
        val server = store.serverUrl ?: return
        if (!failedThisLoad && isSameOrigin(url, server) && shell.load !is Load.Ready) {
            slowJob?.cancel()
            shell.load = Load.Ready(server)
        }
    }

    /** The server's page couldn't be opened: the offline screen says why and offers Try again. */
    internal fun onLoadFailed(problem: ServerProblem) {
        if (failedThisLoad) return
        failedThisLoad = true
        slowJob?.cancel()
        keepSplash = false
        shell.load = Load.Failed(problem)
    }

    /** The page's colors (the bridge's `theme`): the bars, and the window for next time. */
    internal fun applyPageTheme(theme: PageTheme) {
        store.theme = theme
        paint(theme)
    }

    /** The bridge's `haptic`. */
    internal fun haptic(kind: String) {
        if (AppState.inFront) web?.let { Haptics.perform(it, kind) }
    }

    /** A JavaScript alert, confirm or prompt from the page, shown as a Material 3 dialog. */
    internal fun showJsDialog(dialog: JsDialog) {
        shell.dialog?.cancel()
        shell.dialog = dialog
    }

    /** The web view's renderer crashed or was killed for memory: start a new web view where the page was. */
    internal fun onWebViewGone() {
        val url = web?.url
        shell.web = null
        web?.destroy()
        web = null
        bridgeOrigin = null
        bridgeScript = null
        insetsScript = null
        pageBridge.reset()
        if (!setUpWebView()) {
            shell.webViewTooOld = true
            return
        }
        val path = url?.takeIf { isSameOrigin(it, store.serverUrl) }?.toUri()?.path
        if (path != null) navigate(path) else start()
    }

    // ---------------------------------------------------------------- system bars and insets

    private fun paint(theme: PageTheme) {
        pageTheme = theme
        web?.setBackgroundColor(theme.color)
        updateBars()
    }

    private fun updateBars() {
        val theme = pageTheme
        when {
            nativeFront -> bars.applyNative(nativeDark, nativeSurface)
            theme != null -> bars.apply(theme)
        }
    }

    private fun onInsets(insets: CssInsets) {
        this.insets = insets
        applyInsets()
        registerInsetsScript()
    }

    /** Tells the open page the sizes now (--sekai-inset-*). */
    private fun applyInsets() {
        val view = web ?: return
        if (isSameOrigin(view.url, bridgeOrigin)) view.evaluateJavascript(insets.applyScript(), null)
    }

    /** And the pages that load next, from their first moment (replaced when the sizes settle). */
    @SuppressLint("RequiresFeature")
    private fun registerInsetsScript() {
        val view = web ?: return
        val origin = bridgeOrigin ?: return
        insetsJob?.cancel()
        insetsJob = lifecycleScope.launch {
            delay(INSETS_SETTLE_MS)
            insetsScript?.remove()
            insetsScript = WebViewCompat.addDocumentStartJavaScript(view, insets.documentStartScript(), setOf(origin))
        }
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
        view.webViewClient = SekaiWebViewClient(this)
        view.webChromeClient = SekaiChromeClient(this, files)
        view.setDownloadListener { url, userAgent, disposition, mime, _ ->
            val onTheWeb = url.startsWith("https://") || url.startsWith("http://")
            when {
                isSameOrigin(url, bridgeOrigin) -> Downloads.enqueue(this, url, userAgent, disposition, mime)
                onTheWeb -> Links.openInBrowser(this, url.toUri(), pageTheme)
            }
        }
        pageTheme?.let { view.setBackgroundColor(it.color) }
        web = view
        shell.web = view
        return true
    }

    // ---------------------------------------------------------------- native screens' actions

    /** Without a recent web view the bridge can't work, so there's a native screen asking to update it. */
    private fun updateWebView() {
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

    /** Android's notification settings for Sekai (the bridge's `openNotificationSettings`, and About). */
    internal fun openNotificationSettings() {
        val intent = Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, packageName)
        try {
            startActivity(intent)
        } catch (_: ActivityNotFoundException) {
            Snacks.show(this, R.string.no_settings_app)
        }
    }

    private fun shareDetails() {
        val send = Intent(Intent.ACTION_SEND)
            .setType("text/plain")
            .putExtra(Intent.EXTRA_TEXT, appDetails(this, store.serverUrl))
        startActivity(Intent.createChooser(send, null))
    }

    companion object {
        private const val TAG = "Sekai"
        private const val PAGE_BRIDGE = "sekaiNative"
        private const val EXTRA_PATH = "path"
        private const val EXTRA_NOTIFICATION = "notification"
        private const val STATE_PATH = "path"
        private const val SPLASH_MAX_MS = 2_500L
        private const val SPLASH_FADE_MS = 200L
        private const val SLOW_MS = 6_000L
        private const val INSETS_SETTLE_MS = 150L
        private const val BACK_ASK_MS = 800L
        private const val MAX_ADDRESS = 2000
        private const val WEBVIEW_PACKAGE = "com.google.android.webview"
        private const val BACK_SCRIPT =
            "(function(){try{return typeof window.__sekaiBack==='function'&&window.__sekaiBack()===true}catch(e){return false}})()"

        /** Opens the app at [path] on the server (notifications), clearing the notification [tag] if there's one. */
        fun openIntent(context: Context, path: String, tag: String? = null): Intent =
            Intent(context, MainActivity::class.java)
                .setAction(Intent.ACTION_VIEW)
                .putExtra(EXTRA_PATH, path)
                .putExtra(EXTRA_NOTIFICATION, tag)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    }
}
