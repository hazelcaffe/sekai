import UIKit
import WebKit

/// What may load in the web view: the server's own pages stay, everything else leaves the app.
extension ShellViewController: WKNavigationDelegate {
	func webView(
		_ webView: WKWebView,
		decidePolicyFor navigationAction: WKNavigationAction,
		decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void
	) {
		decisionHandler(policy(for: navigationAction))
	}

	private func policy(for action: WKNavigationAction) -> WKNavigationActionPolicy {
		guard let url = action.request.url, let screen else { return .cancel }
		// target=_blank and window.open: createWebViewWith decides.
		guard let frame = action.targetFrame else { return .allow }
		switch screen {
		case .connect:
			return ConnectBridge.isConnectPage(url) ? .allow : .cancel
		case let .server(origin):
			if origin.contains(url) { return action.shouldPerformDownload ? .download : .allow }
			// Embeds (videos, previews) load what they like: frames never get the bridge.
			let scheme = url.scheme?.lowercased() ?? ""
			if !frame.isMainFrame, ["http", "https", "about", "blob", "data"].contains(scheme) { return .allow }
			if frame.isMainFrame, scheme == "about" { return .allow }
			leave(to: url)
			return .cancel
		}
	}

	/// A link out of the app: other sites in the browser, mail and phone links in their apps, sekai:// here.
	func leave(to url: URL) {
		switch url.scheme?.lowercased() ?? "" {
		case "http", "https":
			openInBrowser(url)
		case "mailto", "tel", "sms", "facetime":
			UIApplication.shared.open(url)
		case AppInfo.linkScheme:
			Router.shared.handle(link: url)
		default:
			break
		}
	}

	func webView(
		_ webView: WKWebView,
		decidePolicyFor navigationResponse: WKNavigationResponse,
		decisionHandler: @escaping @MainActor (WKNavigationResponsePolicy) -> Void
	) {
		let response = navigationResponse.response
		let disposition = (response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition") ?? ""
		let attachment = disposition.lowercased().hasPrefix("attachment")
		guard case let .server(origin) = screen, origin.contains(response.url),
		      attachment || !navigationResponse.canShowMIMEType
		else {
			decisionHandler(.allow)
			return
		}
		decisionHandler(.download)
	}

	func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
		files.track(download, preview: false)
	}

	func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
		files.track(download, preview: false)
	}

	func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
		guard webView === self.webView else { return }
		pageWillLoad()
	}

	func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
		guard webView === self.webView else { return }
		reveal()
	}

	func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
		guard webView === self.webView else { return }
		reveal()
	}

	func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
		guard webView === self.webView else { return }
		if case let .server(origin) = screen, let problem = Self.connectionProblem(error, origin: origin) {
			showConnect(problem: problem)
			return
		}
		pageDidNotLoad()
		reveal()
	}

	/// iOS ends the web view's process when memory runs low (often while the app is in the background).
	func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
		guard webView === self.webView else { return }
		webView.reload()
	}

	/// When a load failed because the server can't be reached, what to tell the person.
	private static func connectionProblem(_ error: Error, origin: Origin) -> String? {
		let error = error as NSError
		guard error.domain == NSURLErrorDomain else { return nil }
		switch error.code {
		case NSURLErrorServerCertificateUntrusted, NSURLErrorServerCertificateHasBadDate,
		     NSURLErrorServerCertificateHasUnknownRoot, NSURLErrorServerCertificateNotYetValid:
			return ServerCheck.Failure.untrusted.message(for: origin)
		case NSURLErrorNotConnectedToInternet, NSURLErrorCannotFindHost, NSURLErrorCannotConnectToHost,
		     NSURLErrorTimedOut, NSURLErrorNetworkConnectionLost, NSURLErrorDNSLookupFailed,
		     NSURLErrorSecureConnectionFailed, NSURLErrorInternationalRoamingOff, NSURLErrorDataNotAllowed:
			return ServerCheck.Failure.unreachable.message(for: origin)
		default:
			return nil
		}
	}
}
