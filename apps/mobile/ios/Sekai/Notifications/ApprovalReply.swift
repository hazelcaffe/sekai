import Foundation
import WebKit

/// Answers an approval request from its notification, as the person signed in to the web view: the web view's
/// cookies, and the server's own Origin (cookie requests that change things must come from Sekai's pages).
@MainActor
enum ApprovalReply {
	enum Outcome {
		case answered
		/// 404: answered somewhere else already, or it timed out.
		case alreadyAnswered
		case failed
	}

	private static let session: URLSession = {
		let config = URLSessionConfiguration.ephemeral
		config.timeoutIntervalForRequest = 20
		config.httpShouldSetCookies = false
		config.httpCookieAcceptPolicy = .never
		return URLSession(configuration: config)
	}()

	static func send(approve: Bool, toolCallId: String, server: Origin) async -> Outcome {
		var allowed = CharacterSet.urlPathAllowed
		allowed.remove("/")
		guard let id = toolCallId.addingPercentEncoding(withAllowedCharacters: allowed),
		      let url = server.url(path: "/api/approvals/\(id)"),
		      let body = try? JSONSerialization.data(withJSONObject: ["approve": approve, "scope": "once"])
		else { return .failed }
		var request = URLRequest(url: url)
		request.httpMethod = "POST"
		request.httpBody = body
		request.setValue("application/json", forHTTPHeaderField: "Content-Type")
		request.setValue(server.string, forHTTPHeaderField: "Origin")
		let jar = await cookies(for: url)
		for (name, value) in HTTPCookie.requestHeaderFields(with: jar) {
			request.setValue(value, forHTTPHeaderField: name)
		}
		do {
			let (_, response) = try await session.data(for: request)
			switch (response as? HTTPURLResponse)?.statusCode ?? 0 {
			case 200..<300: return .answered
			case 404: return .alreadyAnswered
			default: return .failed
			}
		} catch {
			return .failed
		}
	}

	/// The web view's cookies that a request to this address would carry.
	private static func cookies(for url: URL) async -> [HTTPCookie] {
		guard let host = url.host?.lowercased() else { return [] }
		let secure = url.scheme?.lowercased() == "https"
		let path = url.path.isEmpty ? "/" : url.path
		let now = Date()
		let all = await WKWebsiteDataStore.default().httpCookieStore.allCookies()
		return all.filter { cookie in
			let domain = cookie.domain.lowercased()
			let domainMatches = domain.hasPrefix(".")
				? host == domain.dropFirst() || host.hasSuffix(domain)
				: host == domain
			return domainMatches && path.hasPrefix(cookie.path) && (secure || !cookie.isSecure)
				&& (cookie.expiresDate.map { $0 > now } ?? true)
		}
	}
}
