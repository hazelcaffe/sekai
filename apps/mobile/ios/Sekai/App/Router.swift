import Foundation

/// Where notifications and sekai:// links go. They can arrive before the web view exists (a tap that launched
/// the app), so the router keeps them until the shell can take them.
@MainActor
final class Router {
	static let shared = Router()

	weak var shell: ShellViewController?
	private var pendingPath: String?
	private var pendingSignInCode: String?

	/// Opens a page of the server's web app, like "/c/<id>": now, or as soon as the server is showing.
	func open(path: String) {
		guard Router.isAppPath(path) else { return }
		if shell?.open(path: path) == true { return }
		pendingPath = path
	}

	func takePendingPath() -> String? {
		defer { pendingPath = nil }
		return pendingPath
	}

	func takePendingSignInCode() -> String? {
		defer { pendingSignInCode = nil }
		return pendingSignInCode
	}

	enum Link: Equatable {
		/// A page of the web app.
		case page(String)
		/// The browser sign-in's way back.
		case signedIn(code: String)
		/// Not ours, or nothing to do (like the sign-in page's Cancel).
		case ignored
	}

	/// sekai://c/<id> opens that chat (any sekai://<path> opens that page, as on desktop);
	/// sekai://signed-in?code=… finishes signing in with the browser.
	nonisolated static func parse(_ url: URL) -> Link {
		guard url.scheme?.lowercased() == AppInfo.linkScheme else { return .ignored }
		let host = url.host?.lowercased() ?? ""
		if host == "signed-in" {
			let code = URLComponents(url: url, resolvingAgainstBaseURL: false)?
				.queryItems?.first { $0.name == "code" }?.value
			guard let code, !code.isEmpty, code.count <= 512 else { return .ignored }
			return .signedIn(code: code)
		}
		var path = "/\(host)\(url.path)"
		while path.count > 1, path.hasSuffix("/") {
			path.removeLast()
		}
		return .page(path.range(of: "^/[A-Za-z0-9_/-]*$", options: .regularExpression) != nil ? path : "/")
	}

	func handle(link url: URL) {
		switch Router.parse(url) {
		case let .page(path):
			open(path: path)
		case let .signedIn(code):
			if shell?.finishBrowserSignIn(code: code) == true { return }
			pendingSignInCode = code
		case .ignored:
			break
		}
	}

	/// A path within the web app (not "//other.site", not a full URL).
	nonisolated static func isAppPath(_ path: String) -> Bool {
		path.hasPrefix("/") && !path.hasPrefix("//") && !path.contains("\\") && path.count <= 2048
			&& path.rangeOfCharacter(from: .whitespacesAndNewlines.union(.controlCharacters)) == nil
	}
}
