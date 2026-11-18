import AVFoundation
import UIKit
import WebKit

/// New windows, the microphone and camera, and the page's alert(), confirm() and prompt().
extension ShellViewController: WKUIDelegate {
	/// target=_blank and window.open never make a second web view: the server's files open in a preview, its
	/// other pages here, and other sites in the browser.
	func webView(
		_ webView: WKWebView,
		createWebViewWith configuration: WKWebViewConfiguration,
		for navigationAction: WKNavigationAction,
		windowFeatures: WKWindowFeatures
	) -> WKWebView? {
		guard let url = navigationAction.request.url else { return nil }
		if case let .server(origin) = screen, origin.contains(url) {
			if url.path.hasPrefix("/api/") {
				files.fetch(url, in: webView)
			} else {
				webView.load(URLRequest(url: url))
			}
		} else {
			leave(to: url)
		}
		return nil
	}

	/// Calls and voice messages: only the connected server, and only once iOS has said yes.
	func webView(
		_ webView: WKWebView,
		requestMediaCapturePermissionFor origin: WKSecurityOrigin,
		initiatedByFrame frame: WKFrameInfo,
		type: WKMediaCaptureType,
		decisionHandler: @escaping @MainActor (WKPermissionDecision) -> Void
	) {
		guard case let .server(server) = screen, Origin(origin) == server, Origin(frame.securityOrigin) == server else {
			decisionHandler(.deny)
			return
		}
		Task {
			let allowed = await Self.systemAllows(type)
			decisionHandler(allowed ? .grant : .deny)
		}
	}

	private static func systemAllows(_ type: WKMediaCaptureType) async -> Bool {
		switch type {
		case .microphone:
			return await AVCaptureDevice.requestAccess(for: .audio)
		case .camera:
			return await AVCaptureDevice.requestAccess(for: .video)
		case .cameraAndMicrophone:
			let microphone = await AVCaptureDevice.requestAccess(for: .audio)
			let camera = await AVCaptureDevice.requestAccess(for: .video)
			return microphone && camera
		@unknown default:
			return false
		}
	}

	func webView(
		_ webView: WKWebView,
		runJavaScriptAlertPanelWithMessage message: String,
		initiatedByFrame frame: WKFrameInfo,
		completionHandler: @escaping @MainActor () -> Void
	) {
		let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
		alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
		if !presentOnTop(alert) { completionHandler() }
	}

	func webView(
		_ webView: WKWebView,
		runJavaScriptConfirmPanelWithMessage message: String,
		initiatedByFrame frame: WKFrameInfo,
		completionHandler: @escaping @MainActor (Bool) -> Void
	) {
		let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
		alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
		alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
		if !presentOnTop(alert) { completionHandler(false) }
	}

	func webView(
		_ webView: WKWebView,
		runJavaScriptTextInputPanelWithPrompt prompt: String,
		defaultText: String?,
		initiatedByFrame frame: WKFrameInfo,
		completionHandler: @escaping @MainActor (String?) -> Void
	) {
		let alert = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
		alert.addTextField { $0.text = defaultText }
		alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(nil) })
		alert.addAction(UIAlertAction(title: "OK", style: .default) { [weak alert] _ in
			completionHandler(alert?.textFields?.first?.text ?? "")
		})
		if !presentOnTop(alert) { completionHandler(nil) }
	}
}
