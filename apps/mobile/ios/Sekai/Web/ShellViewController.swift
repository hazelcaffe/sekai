import SafariServices
import SwiftUI
import Network
import UIKit
import WebKit

/// The web view belongs to one server. Setup and connection states cover it; Settings is a separate sheet.
final class ShellViewController: UIViewController {
	static let defaultBackground = UIColor(named: "Background") ?? .systemBackground
	private(set) var origin: Origin?
	private(set) var webView: WKWebView?
	private var cover: UIViewController?
	/// The server the offline screen is showing, so it can try again when the network comes back.
	private var offlineOrigin: Origin?
	private var check: Task<Void, Never>?
	private let network = NWPathMonitor()
	private var interruptedPage = false
	private var retryURL: URL?
	private var keyboardLimit: NSLayoutConstraint?
	/// The server's page has loaded the bridge and can take events.
	private var pageReady = false
	private var readyBeforeLoad = false
	private var queuedEvents: [[String: Any]] = []
	/// What the open page last reported through `backState`; nil until it does (older web apps never do).
	private var pageBack: PageBack?
	private var pageTheme = ServerStore.theme
	private lazy var pageBridge = PageBridge(shell: self)
	private let signIn = BrowserSignIn()
	let files = FileSharing()

	override var preferredStatusBarStyle: UIStatusBarStyle {
		guard let pageTheme, !pageTheme.system else { return .default }
		return pageTheme.dark ? .lightContent : .darkContent
	}

	override func viewDidLoad() {
		super.viewDidLoad()
		view.tintColor = SekaiStyle.tint
		applyTheme()
		files.shell = self
		FileSharing.removeOldFiles()
		start()
		if #unavailable(iOS 17) {
			NotificationCenter.default.addObserver(self, selector: #selector(keyboardFrame(_:)),
				name: UIResponder.keyboardWillChangeFrameNotification, object: nil)
		}
		network.pathUpdateHandler = { [weak self] path in
			let status = path.status
			Task { @MainActor in
				guard let self else { return }
				// Back online on the offline screen: try again by itself, as Android does.
				if status == .satisfied, let origin = self.offlineOrigin { self.retry(origin); return }
				guard status == .unsatisfied, self.cover == nil, self.pageReady, let origin = self.origin else { return }
				self.interruptedPage = true
				self.showStatus(origin, failure: .offline)
			}
		}
		network.start(queue: DispatchQueue(label: "sekai.reachability"))
	}

	deinit { network.cancel(); check?.cancel() }

	override func viewWillAppear(_ animated: Bool) {
		super.viewWillAppear(animated)
		applyTheme()
	}

	private func start() {
		if let code = Router.shared.takePendingSignInCode(), finishBrowserSignIn(code: code) { return }
		if let origin = ServerStore.current { retry(origin) } else { showSetup() }
	}

	// MARK: Screens

	private func showSetup() {
		removeWebView()
		pageTheme = nil
		applyTheme()
		showCover(NavigationStack { ConnectView(current: nil) { [weak self] origin in self?.connect(origin) } })
	}

	private func connect(_ next: Origin) {
		if next != ServerStore.current { retryURL = nil; signIn.cancel() }
		ServerStore.save(next)
		pageTheme = ServerStore.theme
		applyTheme()
		showServer(next)
	}

	@objc func openSettings() { presentServerSettings(editingAddress: false) }

	private func presentServerSettings(editingAddress: Bool) {
		guard let current = ServerStore.current, presentedViewController == nil else { return }
		let root = ServerSettingsView(current: current, connect: { [weak self] next in
			guard let self, self.presentedViewController?.isBeingDismissed == false else { return }
			self.dismiss(animated: true) { self.connect(next) }
		}, forget: { [weak self] in
			guard let self else { return }
			self.check?.cancel()
			self.signIn.cancel()
			ServerStore.forget(current)
			self.retryURL = nil
			// Signed out on this device too, as on Android (the web view only ever holds Sekai servers' data).
			let store = WKWebsiteDataStore.default()
			store.removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast) {}
			self.dismiss(animated: true) { self.showSetup() }
		}, close: { [weak self] in self?.dismiss(animated: true) }, path: editingAddress ? [.address] : [])
		let host = UIHostingController(rootView: root.tint(Color(uiColor: SekaiStyle.tint)))
		host.modalPresentationStyle = .pageSheet
		host.sheetPresentationController?.prefersGrabberVisible = true
		present(host, animated: true)
	}

	private func retry(_ origin: Origin) {
		check?.cancel()
		showStatus(origin)
		check = Task { [weak self] in
			let failure = await ServerCheck.run(origin)
			guard !Task.isCancelled, let self else { return }
			if let failure { self.showStatus(origin, failure: failure) }
			else if self.interruptedPage, self.pageReady {
				self.reveal()
				if let path = Router.shared.takePendingPath() { _ = self.open(path: path) }
			} else { self.showServer(origin) }
		}
	}

	func loadFailed(_ failure: ServerCheck.Failure, at url: URL?) {
		guard let origin else { return }
		if origin.contains(url), url?.path.hasPrefix("/api/") == false { retryURL = url }
		interruptedPage = false
		showStatus(origin, failure: failure)
	}

	private func showStatus(_ origin: Origin, failure: ServerCheck.Failure? = nil) {
		showCover(ConnectionStatusView(origin: origin, failure: failure, retry: { [weak self] in self?.retry(origin) },
			settings: { [weak self] in self?.presentServerSettings(editingAddress: true) }))
		offlineOrigin = failure == .offline ? origin : nil
		if let failure { UIAccessibility.post(notification: .announcement, argument: failure.title + ". " + failure.message) }
	}

	private func showCover<V: View>(_ root: V) {
		removeCover()
		let host = UIHostingController(rootView: root.tint(Color(uiColor: SekaiStyle.tint)))
		addChild(host)
		host.view.frame = view.bounds
		host.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
		view.addSubview(host.view)
		host.didMove(toParent: self)
		cover = host
		webView?.isHidden = true
	}

	private func removeCover() {
		offlineOrigin = nil
		cover?.willMove(toParent: nil)
		cover?.view.removeFromSuperview()
		cover?.removeFromParent()
		cover = nil
	}

	/// Opens the server: at a page a notification or link asked for, or with `request` (the browser sign-in).
	func showServer(_ origin: Origin, request: URLRequest? = nil) {
		removeWebView()
		self.origin = origin
		let webView = makeWebView(for: origin)
		self.webView = webView
		view.insertSubview(webView, at: 0)
		// Keep env(safe-area-inset-*) live at the screen edges, shrinking only for a docked keyboard.
		let bottom = webView.bottomAnchor.constraint(equalTo: view.bottomAnchor)
		bottom.priority = .defaultHigh
		let guide = view.keyboardLayoutGuide
		let limit = webView.bottomAnchor.constraint(lessThanOrEqualTo: guide.topAnchor)
		keyboardLimit = limit
		if #available(iOS 17, *) { guide.usesBottomSafeArea = false; limit.isActive = true }
		NSLayoutConstraint.activate([
			webView.topAnchor.constraint(equalTo: view.topAnchor), webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
			webView.trailingAnchor.constraint(equalTo: view.trailingAnchor), bottom,
		])
		showStatus(origin)
		applyTheme()
		if let request {
			webView.load(request)
		} else if let url = Router.shared.takePendingPath().flatMap({ origin.url(path: $0) }) ?? retryURL ?? origin.url {
			webView.load(URLRequest(url: url))
		}
		retryURL = nil
	}

	// iOS 16's keyboard guide falls back to the safe area when hidden. Don't inset the web content twice.
	@objc private func keyboardFrame(_ note: Notification) {
		guard let frame = (note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? NSValue)?.cgRectValue,
		      let window = view.window else { return }
		let rect = view.convert(frame, from: window.screen.coordinateSpace)
		keyboardLimit?.isActive = rect.maxY >= view.bounds.maxY && rect.minY < view.bounds.maxY
	}

	private func removeWebView() {
		check?.cancel()
		if let old = webView {
			old.navigationDelegate = nil
			old.uiDelegate = nil
			old.stopLoading()
			old.configuration.userContentController.removeAllScriptMessageHandlers()
			old.removeFromSuperview()
		}
		webView = nil
		origin = nil
		interruptedPage = false
		pageReady = false
		readyBeforeLoad = false
		pageBack = nil
		queuedEvents.removeAll()
	}

	private func makeWebView(for origin: Origin) -> WKWebView {
		let config = WKWebViewConfiguration()
		config.websiteDataStore = .default()
		config.allowsInlineMediaPlayback = true
		config.mediaTypesRequiringUserActionForPlayback = []
		config.applicationNameForUserAgent = AppInfo.userAgentName
		config.preferences.isElementFullscreenEnabled = true
		let content = config.userContentController
		if let source = BridgeScript.source(for: origin) {
			content.addUserScript(WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true))
		}
		content.addScriptMessageHandler(pageBridge, contentWorld: .page, name: PageBridge.name)
		let webView = WKWebView(frame: view.bounds, configuration: config)
		webView.translatesAutoresizingMaskIntoConstraints = false
		webView.navigationDelegate = self
		webView.uiDelegate = self
		let back = UIScreenEdgePanGestureRecognizer(target: self, action: #selector(edgeBack(_:)))
		back.edges = view.effectiveUserInterfaceLayoutDirection == .rightToLeft ? .right : .left
		back.delegate = self
		webView.addGestureRecognizer(back)
		webView.scrollView.panGestureRecognizer.require(toFail: back)
		// The pages draw under the status bar and home indicator themselves (viewport-fit=cover + safe-area insets).
		webView.scrollView.contentInsetAdjustmentBehavior = .never
		webView.scrollView.keyboardDismissMode = .interactive
		webView.isOpaque = false
		if #available(iOS 16.4, *) {
			webView.isInspectable = AppInfo.isDebug
		}
		return webView
	}

	@objc private func edgeBack(_ gesture: UIScreenEdgePanGestureRecognizer) {
		guard gesture.state == .ended, let webView, origin?.contains(webView.url) == true,
		      abs(gesture.translation(in: webView).x) >= 44 else { return }
		// Only an explicit true means the page handled it (as on Android); anything else falls back to history.
		let ask = "(()=>{try{return typeof window.__sekaiBack==='function'&&window.__sekaiBack()===true}catch(e){return false}})()"
		webView.evaluateJavaScript(ask) { [weak self, weak webView] handled, _ in
			guard handled as? Bool != true, let webView, webView === self?.webView, webView.canGoBack else { return }
			webView.goBack()
		}
	}

	/// The page's `backState`: whether it has an overlay to close or a screen to go back to.
	func setBackState(_ state: PageBack) {
		pageBack = state
	}

	/// Back has something to do: what the page reported, or for pages that never report, the web view's history.
	/// Otherwise the edge swipe stays with the page and nothing app-level happens.
	fileprivate var backHasSomethingToDo: Bool {
		guard let webView, cover == nil, origin?.contains(webView.url) == true else { return false }
		if let pageBack { return pageBack.overlay || pageBack.canGoBack }
		return webView.canGoBack
	}

	/// A new document is on screen: it reports its own back state (or never does).
	func pageCommitted() {
		pageBack = nil
		reveal()
	}

	func reveal() {
		interruptedPage = false
		removeCover()
		webView?.isHidden = false
		UIAccessibility.post(notification: .screenChanged, argument: nil)
		if let path = Router.shared.takePendingPath(), let url = origin?.url(path: path) {
			webView?.load(URLRequest(url: url))
		}
	}

	// MARK: Theme

	/// The page's theme colour (its theme-color) and whether it's dark, for the background and status bar.
	func setTheme(_ theme: ServerStore.Theme) {
		guard pageTheme != theme else { return }
		pageTheme = theme
		ServerStore.theme = theme
		applyTheme()
	}

	private func applyTheme() {
		let style: UIUserInterfaceStyle = pageTheme.map { $0.system ? .unspecified : $0.dark ? .dark : .light } ?? .unspecified
		overrideUserInterfaceStyle = style
		view.window?.overrideUserInterfaceStyle = style
		let color = pageTheme.flatMap { $0.system ? nil : UIColor(hex: $0.hex) } ?? Self.defaultBackground
		view.backgroundColor = color
		webView?.backgroundColor = color
		webView?.scrollView.backgroundColor = color
		webView?.underPageBackgroundColor = color
		setNeedsStatusBarAppearanceUpdate()
	}

	// MARK: The page

	/// Opens a path of the web app (from a notification or link). False when the server isn't showing yet.
	func open(path: String) -> Bool {
		guard let origin, let webView, cover == nil, let url = origin.url(path: path) else { return false }
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
		guard origin != nil else { return }
		let message: [String: Any] = ["event": event, "data": data]
		if pageReady {
			deliver(message)
		} else {
			queuedEvents.append(message)
		}
	}

	private func deliver(_ message: [String: Any]) {
		guard let origin, let webView, origin.contains(webView.url) else { return }
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
		updateTextSize()
		let events = queuedEvents
		queuedEvents.removeAll()
		events.forEach(deliver)
	}

	override func traitCollectionDidChange(_ previousTraitCollection: UITraitCollection?) {
		super.traitCollectionDidChange(previousTraitCollection)
		if traitCollection.preferredContentSizeCategory != previousTraitCollection?.preferredContentSizeCategory {
			updateTextSize()
		}
	}

	private func updateTextSize() {
		guard let webView, origin?.contains(webView.url) == true else { return }
		let scale = UIFont.preferredFont(forTextStyle: .body, compatibleWith: traitCollection).pointSize / 17
		webView.callAsyncJavaScript("document.documentElement?.style.setProperty('--native-font-scale', String(scale))",
			arguments: ["scale": scale], in: nil, in: .page, completionHandler: nil)
	}

	override var keyCommands: [UIKeyCommand]? {
		guard presentedViewController == nil, ServerStore.current != nil else { return nil }
		let settings = UIKeyCommand(input: ",", modifierFlags: .command, action: #selector(openSettings))
		settings.discoverabilityTitle = "Server settings"
		let reload = UIKeyCommand(input: "r", modifierFlags: .command, action: #selector(reloadServer))
		reload.discoverabilityTitle = "Reload"
		return [settings, reload]
	}

	@objc private func reloadServer() {
		if cover == nil { webView?.reload() }
		else if let current = ServerStore.current { retry(current) }
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
		guard let origin else { throw BridgeError("Connect to a server first.") }
		try signIn.start(server: origin, provider: provider, anchor: view.window) { [weak self] in
			guard let self, self.origin == origin else { return }
			let alert = UIAlertController(title: "Couldn't sign in", message: "The browser didn't finish signing you in. Try again from the sign-in page.", preferredStyle: .alert)
			alert.addAction(UIAlertAction(title: "OK", style: .default))
			self.presentOnTop(alert)
		}
	}

	/// The code from sekai://signed-in: the web view trades it (with the verifier) for its session.
	func finishBrowserSignIn(code: String) -> Bool {
		// No verifier (not started here, or used already): nothing to do, as the code is useless without it.
		guard let exchange = signIn.exchange(code: code) else { return true }
		ServerStore.save(exchange.origin)
		if origin == exchange.origin, let webView {
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
		safari.preferredControlTintColor = SekaiStyle.tint
		safari.preferredBarTintColor = view.backgroundColor
		safari.modalPresentationStyle = .pageSheet
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
			popover.sourceRect = CGRect(x: top.view.bounds.midX, y: top.view.bounds.midY, width: 1, height: 1)
			popover.permittedArrowDirections = []
		}
		top.present(controller, animated: true)
		return true
	}
}

/// What the page reports about going back (the bridge's `backState`).
struct PageBack: Equatable {
	var overlay = false
	var canGoBack = false
}

extension ShellViewController: UIGestureRecognizerDelegate {
	/// The edge swipe only starts while back has something to do; otherwise the page keeps the touch.
	func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
		guard gestureRecognizer is UIScreenEdgePanGestureRecognizer else { return true }
		return backHasSomethingToDo
	}
}
