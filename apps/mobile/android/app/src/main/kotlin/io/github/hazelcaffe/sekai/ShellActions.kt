package io.github.hazelcaffe.sekai

/** What went wrong when connecting to an address the person typed. */
internal sealed interface ConnectError {
    /** Nothing typed. */
    data object Empty : ConnectError

    /** Not an address at all. */
    data object Invalid : ConnectError

    data class Server(val problem: ServerProblem) : ConnectError
}

/** What the native screens can ask the app to do (the activity does it; screenshots and tests use fakes). */
internal interface ShellActions {
    /** Checks [address] is a Sekai server and switches to it. Null when it worked, else what to tell the person. */
    suspend fun connect(address: String): ConnectError?

    /** Loads the server's page again. */
    fun retry()

    fun open(screen: Screen)

    /** Closes the screen on top. */
    fun back()

    /** Forgets the current server: its address, and the sign-in on this phone. */
    fun forget()

    fun forgetRecent(origin: String)

    fun updateWebView()

    fun openNotificationSettings()

    fun shareDetails()

    /** The system bars and keyboard changed (for the page's `--sekai-inset-*`). */
    fun onInsets(insets: CssInsets)

    /**
     * Which system bar icons suit what's on screen: a native screen follows the phone ([dark], over [surface]), the
     * page its own colors.
     */
    fun onBarsFor(native: Boolean, dark: Boolean, surface: Int)
}
