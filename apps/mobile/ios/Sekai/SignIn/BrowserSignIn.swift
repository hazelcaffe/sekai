import AuthenticationServices
import CryptoKit
import UIKit

/// Signing in through the system browser, where passkeys and Google sign-in work (they don't in a web view).
/// PKCE-style: the server hands back sekai://signed-in?code=…, and only this app knows the verifier that makes the
/// code worth anything, so another app that grabs the link can't use it.
@MainActor
final class BrowserSignIn: NSObject, ASWebAuthenticationPresentationContextProviding {
	// Kept on disk too: iOS may end the app while the browser is open.
	private static let verifierKey = "signInVerifier"
	private static let serverKey = "signInServer"

	private var session: ASWebAuthenticationSession?
	private var anchor: UIWindow?

	/// Opens `<server>/api/auth/app/start` in the browser sheet (with Safari's sign-ins, not a private one).
	func start(server: Origin, provider: String?, anchor: UIWindow?) throws {
		guard let anchor else { throw BridgeError("Sekai isn't on screen, so it can't open the browser.") }
		let verifier = try Self.randomVerifier()
		let challenge = Self.base64url(Data(SHA256.hash(data: Data(verifier.utf8))))
		guard let start = server.url(path: "/api/auth/app/start"),
		      var components = URLComponents(url: start, resolvingAgainstBaseURL: false)
		else { throw BridgeError("Couldn't open the browser to sign in.") }
		components.queryItems = [
			URLQueryItem(name: "challenge", value: challenge),
			URLQueryItem(name: "provider", value: provider ?? ""),
		]
		guard let url = components.url else { throw BridgeError("Couldn't open the browser to sign in.") }

		UserDefaults.standard.set(verifier, forKey: Self.verifierKey)
		UserDefaults.standard.set(server.string, forKey: Self.serverKey)
		session?.cancel()
		let session = ASWebAuthenticationSession(url: url, callbackURLScheme: AppInfo.linkScheme) { callback, _ in
			// Closing the sheet (or the page's Cancel, sekai://signed-in?error=cancelled) changes nothing.
			Task { @MainActor [weak self] in
				self?.session = nil
				if let callback { Router.shared.handle(link: callback) }
			}
		}
		session.prefersEphemeralWebBrowserSession = false
		session.presentationContextProvider = self
		self.anchor = anchor
		guard session.start() else { throw BridgeError("Couldn't open the browser to sign in.") }
		self.session = session
	}

	/// The request that trades a code for a session in the web view: a form POST to the server that started it,
	/// with the verifier (used once).
	func exchange(code: String) -> (origin: Origin, request: URLRequest)? {
		let defaults = UserDefaults.standard
		guard let verifier = defaults.string(forKey: Self.verifierKey),
		      let origin = defaults.string(forKey: Self.serverKey).flatMap({ Origin($0) }),
		      let url = origin.url(path: "/api/auth/app/exchange")
		else { return nil }
		defaults.removeObject(forKey: Self.verifierKey)
		defaults.removeObject(forKey: Self.serverKey)
		var request = URLRequest(url: url)
		request.httpMethod = "POST"
		request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
		request.httpBody = Data("code=\(Self.formEncoded(code))&verifier=\(Self.formEncoded(verifier))".utf8)
		return (origin, request)
	}

	func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
		anchor ?? ASPresentationAnchor()
	}

	/// 32 random bytes, base64url: the secret half of the code.
	private static func randomVerifier() throws -> String {
		var bytes = [UInt8](repeating: 0, count: 32)
		guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
			throw BridgeError("Couldn't start signing in. Try again.")
		}
		return base64url(Data(bytes))
	}

	private static func base64url(_ data: Data) -> String {
		data.base64EncodedString()
			.replacingOccurrences(of: "+", with: "-")
			.replacingOccurrences(of: "/", with: "_")
			.replacingOccurrences(of: "=", with: "")
	}

	private static func formEncoded(_ value: String) -> String {
		let allowed = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")
		return value.addingPercentEncoding(withAllowedCharacters: allowed) ?? ""
	}
}
