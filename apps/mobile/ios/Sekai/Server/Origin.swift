import Foundation
import WebKit

/// A web origin (scheme, host and port), compared the way browsers do, so https://sekai.example.com never
/// matches https://sekai.example.com.evil.net.
struct Origin: Equatable {
	let scheme: String
	let host: String
	let port: Int

	init?(url: URL) {
		guard let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" else { return nil }
		self.init(scheme: scheme, host: url.host ?? "", port: url.port)
	}

	init?(_ string: String) {
		guard let url = URL(string: string) else { return nil }
		self.init(url: url)
	}

	/// The origin of a page or frame in the web view (WebKit gives port 0 for the scheme's default).
	@MainActor
	init?(_ origin: WKSecurityOrigin) {
		let scheme = origin.protocol.lowercased()
		guard scheme == "http" || scheme == "https" else { return nil }
		self.init(scheme: scheme, host: origin.host, port: origin.port == 0 ? nil : origin.port)
	}

	private init?(scheme: String, host rawHost: String, port: Int?) {
		let host = rawHost.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "[]"))
		// Plain host names, IPv4 and IPv6 addresses only: no spaces, percent signs or other surprises.
		guard !host.isEmpty, host.range(of: "^[a-z0-9.:_-]+$", options: .regularExpression) != nil else { return nil }
		self.scheme = scheme
		self.host = host
		self.port = port ?? (scheme == "https" ? 443 : 80)
	}

	/// The address someone typed: https:// when they left out the scheme, and any path dropped.
	static func typed(_ input: String) -> Origin? {
		let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
		guard !text.isEmpty, text.count <= 2048 else { return nil }
		let hasScheme = text.range(of: "^[a-zA-Z][a-zA-Z0-9+.-]*://", options: .regularExpression) != nil
		return Origin(hasScheme ? text : "https://\(text)")
	}

	/// Like JavaScript's `location.origin`: no port when it's the scheme's default.
	var string: String {
		let host = self.host.contains(":") ? "[\(self.host)]" : self.host
		let defaultPort = scheme == "https" ? 443 : 80
		return port == defaultPort ? "\(scheme)://\(host)" : "\(scheme)://\(host):\(port)"
	}

	var url: URL? { URL(string: string) }

	/// A path on this server (like "/c/abc"), or nil when it would lead somewhere else ("//evil.net").
	func url(path: String) -> URL? {
		guard path.hasPrefix("/"), !path.hasPrefix("//"), !path.contains("\\"), path.count <= 4096,
		      let base = url, let resolved = URL(string: path, relativeTo: base)?.absoluteURL,
		      Origin(url: resolved) == self
		else { return nil }
		return resolved
	}

	func contains(_ url: URL?) -> Bool {
		guard let url, let origin = Origin(url: url) else { return false }
		return origin == self
	}
}
