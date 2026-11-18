import Foundation
import WebKit

/// `sekaiConnect` for the bundled connect page (shared/connect.html), and only that page: it can switch servers.
@MainActor
final class ConnectBridge: NSObject, WKScriptMessageHandlerWithReply {
	static let name = "sekaiConnect"
	private weak var shell: ShellViewController?

	init(shell: ShellViewController) {
		self.shell = shell
	}

	static var pageURL: URL? {
		Bundle.main.url(forResource: "connect", withExtension: "html")
	}

	/// Whether a URL is the bundled connect page (whatever its query or fragment).
	static func isConnectPage(_ url: URL?) -> Bool {
		guard let url, url.isFileURL, let page = pageURL else { return false }
		return url.standardizedFileURL.path == page.standardizedFileURL.path
	}

	func userContentController(
		_ userContentController: WKUserContentController,
		didReceive message: WKScriptMessage
	) async -> (Any?, String?) {
		guard let shell, shell.screen == .connect, message.webView === shell.webView, message.frameInfo.isMainFrame,
		      message.frameInfo.securityOrigin.protocol == "file", Self.isConnectPage(message.frameInfo.request.url),
		      let body = message.body as? [String: Any], let method = body["method"] as? String
		else {
			Log.bridge.error("Refused a connect message that didn't come from the bundled page")
			return (nil, "Not allowed")
		}
		switch method {
		case "state":
			let state: [String: Any] = [
				"serverUrl": ServerStore.current?.string ?? NSNull(),
				"recent": ServerStore.recent,
				"problem": shell.problem ?? NSNull(),
				"version": AppInfo.version,
			]
			return (state, nil)
		case "connect":
			let args = body["args"] as? [String: Any]
			return (await connect(args?["url"] as? String ?? ""), nil)
		default:
			return (nil, "Unknown method")
		}
	}

	/// Checks the address is a Sekai server, saves it and opens it.
	private func connect(_ input: String) async -> [String: Any] {
		guard let origin = Origin.typed(input) else {
			return ["ok": false, "error": "That doesn't look like an address. Try something like https://sekai.example.com."]
		}
		if let failure = await ServerCheck.run(origin) {
			var error = failure.message(for: origin)
			if case .unreachable = failure, !input.contains("://") {
				error += " If your server uses plain http, start the address with http://."
			}
			return ["ok": false, "error": error]
		}
		ServerStore.save(origin)
		Log.app.notice("Connected to a Sekai server")
		// After this reply reaches the page, so the old web view isn't torn down mid-answer.
		Task { @MainActor [weak shell] in
			shell?.showServer(origin)
		}
		return ["ok": true]
	}
}
