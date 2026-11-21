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
		guard let url = action.request.url, let origin else { return .cancel }
		// target=_blank and window.open: createWebViewWith decides.
		guard let frame = action.targetFrame else { return .allow }
		if origin.contains(url) { return action.shouldPerformDownload ? .download : .allow }
		// Embeds (videos, previews) may load other sites: frames never get the bridge.
		let scheme = url.scheme?.lowercased() ?? ""
		if !frame.isMainFrame, ["http", "https", "about", "blob", "data"].contains(scheme) { return .allow }
		if frame.isMainFrame, scheme == "about" { return .allow }
		leave(to: url)
		return .cancel
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
		if webView === self.webView, navigationResponse.isForMainFrame, origin?.contains(response.url) == true,
		   let status = (response as? HTTPURLResponse)?.statusCode, (500...599).contains(status) {
			decisionHandler(.cancel)
			loadFailed(.serverError, at: response.url)
			return
		}
		let disposition = (response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition") ?? ""
		let attachment = disposition.lowercased().hasPrefix("attachment")
		guard let origin, origin.contains(response.url),
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

	func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
		guard webView === self.webView else { return }
		pageCommitted()
	}

	func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
		handleFailure(error, in: webView)
	}

	func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
		handleFailure(error, in: webView)
	}

	/// iOS ends the web view's process when memory runs low (often while the app is in the background).
	func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
		guard webView === self.webView else { return }
		webView.reload()
	}

	private func handleFailure(_ error: Error, in webView: WKWebView) {
		guard webView === self.webView else { return }
		let ns = error as NSError
		// Policy cancellations (e.g. a download) aren't network failures.
		if (ns.domain == NSURLErrorDomain && ns.code == NSURLErrorCancelled) || (ns.domain == "WebKitErrorDomain" && ns.code == 102) {
			pageDidNotLoad()
			return
		}
		loadFailed(ServerCheck.failure(for: error), at: ns.userInfo[NSURLErrorFailingURLErrorKey] as? URL ?? webView.url)
	}
}
