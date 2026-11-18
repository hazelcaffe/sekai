import SafariServices
import UIKit
import WebKit

/// The app's one screen: a web view with either the bundled connect page or the Sekai server's own web app.
/// Each switch gets a fresh web view (cookies stay in the default data store), so the history, the injected
/// bridge and the message handlers always belong to what's showing.
final class ShellViewController: UIViewController {
	enum Screen: Equatable {
		case connect
		case server(Origin)
	}

	static let defaultBackground = UIColor(named: "Background") ?? .systemBackground

	private(set) var screen: Screen?
	private(set) var webView: WKWebView?
	/// Why the saved server couldn't be opened, for the connect page to show.
	private(set) var problem: String?
	/// The server's page has loaded the bridge and can take events.
	private var pageReady = false
	private var readyBeforeLoad = false
	private var queuedEvents: [[String: Any]] = []
	private var pageTheme: (color: UIColor, dark: Bool)?

	/// The launch screen's icon, kept until the first page has loaded so there's no blank flash.
	private let splash = UIImageView(image: UIImage(named: "LaunchIcon"))
	private lazy var connectBridge = ConnectBridge(shell: self)
	private lazy var pageBridge = PageBridge(shell: self)
	private let signIn = BrowserSignIn()
	let files = FileSharing()

	override var preferredStatusBarStyle: UIStatusBarStyle {
		guard let pageTheme else { return .default }
		return pageTheme.dark ? .lightContent : .darkContent
	}

	override func viewDidLoad() {
		super.viewDidLoad()
		view.backgroundColor = Self.defaultBackground
		splash.translatesAutoresizingMaskIntoConstraints = false
		view.addSubview(splash)
		NSLayoutConstraint.activate([
			splash.centerXAnchor.constraint(equalTo: view.centerXAnchor),
			splash.centerYAnchor.constraint(equalTo: view.centerYAnchor),
		])
		files.shell = self
		FileSharing.removeOldFiles()
		Task { await start() }
	}

	/// The saved server if it answers, else the connect page (saying why).
	private func start() async {
		if let code = Router.shared.takePendingSignInCode(), finishBrowserSignIn(code: code) { return }
		guard screen == nil else { return }
		guard let origin = ServerStore.current else {
			showConnect()
			return
		}
		let failure = await ServerCheck.run(origin)
		// A sekai:// link may have opened something while the check ran.
		guard screen == nil else { return }
		if let failure {
			showConnect(problem: failure.message(for: origin))
		} else {
			showServer(origin)
		}
	}

	// MARK: Screens

	func showConnect(problem: String? = nil) {
		if let problem { Log.app.notice("Showing the connect page: \(problem, privacy: .public)") }
		self.problem = problem
		install(.connect)
		guard let page = ConnectBridge.pageURL else { return }
		webView?.loadFileURL(page, allowingReadAccessTo: page.deletingLastPathComponent())
	}

	/// Opens the server: at a page a notification or link asked for, or with `request` (the browser sign-in).
	func showServer(_ origin: Origin, request: URLRequest? = nil) {
		problem = nil
		install(.server(origin))
		if let request {
			webView?.load(request)
		} else if let url = Router.shared.takePendingPath().flatMap({ origin.url(path: $0) }) ?? origin.url {
			webView?.load(URLRequest(url: url))
		}
	}

	private func install(_ next: Screen) {
		if let old = webView {
			old.stopLoading()
			old.configuration.userContentController.removeAllScriptMessageHandlers()
			old.removeFromSuperview()
		}
		screen = next
		pageReady = false
		queuedEvents.removeAll()
		pageTheme = nil
		let webView = makeWebView(for: next)
		webView.alpha = 0
		splash.alpha = 1
		view.insertSubview(webView, belowSubview: splash)
		self.webView = webView
		applyTheme()
	}

	private func makeWebView(for screen: Screen) -> WKWebView {
		let config = WKWebViewConfiguration()
		config.websiteDataStore = .default()
		config.allowsInlineMediaPlayback = true
		config.mediaTypesRequiringUserActionForPlayback = []
		config.applicationNameForUserAgent = AppInfo.userAgentName
		config.preferences.isElementFullscreenEnabled = true
		let content = config.userContentController
		switch screen {
		case .connect:
			content.addScriptMessageHandler(connectBridge, contentWorld: .page, name: ConnectBridge.name)
		case let .server(origin):
			if let source = BridgeScript.source(for: origin) {
				content.addUserScript(WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true))
			}
			content.addScriptMessageHandler(pageBridge, contentWorld: .page, name: PageBridge.name)
		}
		let webView = WKWebView(frame: view.bounds, configuration: config)
		webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
		webView.navigationDelegate = self
		webView.uiDelegate = self
		webView.allowsBackForwardNavigationGestures = true
		// The pages draw under the status bar and home indicator themselves (viewport-fit=cover + safe-area insets).
		webView.scrollView.contentInsetAdjustmentBehavior = .never
		webView.isOpaque = false
		if #available(iOS 16.4, *) {
			webView.isInspectable = AppInfo.isDebug
		}
		return webView
	}

	/// Shows the web view once its first page has drawn, in place of the launch icon.
	func reveal() {
		guard let webView, webView.alpha == 0 else { return }
		UIView.animate(withDuration: 0.2) {
			webView.alpha = 1
			self.splash.alpha = 0
		}
	}

	// MARK: Theme

	/// The page's theme colour (its theme-color) and whether it's dark, for the background and status bar.
	func setTheme(color: UIColor, dark: Bool) {
		pageTheme = (color, dark)
		applyTheme()
	}

	private func applyTheme() {
		let color = pageTheme?.color ?? Self.defaultBackground
		view.backgroundColor = color
		webView?.backgroundColor = color
		webView?.scrollView.backgroundColor = color
		setNeedsStatusBarAppearanceUpdate()
	}

	// MARK: The page

	/// Opens a path of the web app (from a notification or link). False when the server isn't showing yet.
	func open(path: String) -> Bool {
		guard case let .server(origin) = screen, let webView, let url = origin.url(path: path) else { return false }
		Log.app.notice("Opening \(path)")
		if pageReady {
			send(event: "navigate", data: path)
		} else {
			webView.load(URLRequest(url: url))
		}
		return true
	}

	/// An event for the server's page (`{event, data}`), held until the page has loaded the bridge.
	func send(event: String, data: Any) {
		guard case .server = screen else { return }
		let message: [String: Any] = ["event": event, "data": data]
		if pageReady {
			deliver(message)
		} else {
			queuedEvents.append(message)
		}
	}

	private func deliver(_ message: [String: Any]) {
		guard case let .server(origin) = screen, let webView, origin.contains(webView.url) else { return }
		webView.callAsyncJavaScript(
			"window.__sekaiMobileReceive?.(message)",
			arguments: ["message": message],
			in: nil,
			in: .page,
			completionHandler: nil
		)
	}

	func bridgeReady() {
		pageReady = true
		let events = queuedEvents
		queuedEvents.removeAll()
		events.forEach(deliver)
	}

	/// A new page is loading: events wait for its bridge.
	func pageWillLoad() {
		readyBeforeLoad = pageReady
		pageReady = false
	}

	/// The load didn't happen (cancelled, or became a download): the old page is still there.
	func pageDidNotLoad() {
		if readyBeforeLoad { bridgeReady() }
	}

	// MARK: Signing in with the browser

	func startBrowserSignIn(provider: String?) throws {
		guard case let .server(origin) = screen else { throw BridgeError("Connect to a server first.") }
		try signIn.start(server: origin, provider: provider, anchor: view.window)
	}

	/// The code from sekai://signed-in: the web view trades it (with the verifier) for its session.
	func finishBrowserSignIn(code: String) -> Bool {
		// No verifier (not started here, or used already): nothing to do, as the code is useless without it.
		guard let exchange = signIn.exchange(code: code) else { return true }
		ServerStore.save(exchange.origin)
		if screen == .server(exchange.origin), let webView {
			webView.load(exchange.request)
		} else {
			showServer(exchange.origin, request: exchange.request)
		}
		return true
	}

	// MARK: Leaving the app

	/// Another site, in a browser over the app (never in the app's own web view).
	func openInBrowser(_ url: URL) {
		guard ["http", "https"].contains(url.scheme?.lowercased() ?? "") else { return }
		let safari = SFSafariViewController(url: url)
		safari.dismissButtonStyle = .close
		presentOnTop(safari)
	}

	/// Presents over whatever is showing (a share sheet over a browser, an alert over a preview).
	@discardableResult
	func presentOnTop(_ controller: UIViewController) -> Bool {
		guard view.window != nil else { return false }
		var top: UIViewController = self
		while let presented = top.presentedViewController, !presented.isBeingDismissed {
			top = presented
		}
		if let popover = controller.popoverPresentationController {
			popover.sourceView = top.view
			popover.sourceRect = CGRect(x: top.view.bounds.midX, y: top.view.bounds.maxY - 80, width: 1, height: 1)
			popover.permittedArrowDirections = []
		}
		top.present(controller, animated: true)
		return true
	}
}
