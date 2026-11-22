import Foundation

/// Asks an address whether it's a Sekai server: `GET /api/auth/status` answers JSON with `setupRequired`.
enum ServerCheck {
	enum Failure: Error {
		/// No answer at all (offline, wrong address, server down, not on the tailnet).
		case offline, unreachable
		/// The certificate isn't one this device trusts.
		case untrusted
		/// Something answered with an error, like a proxy whose Sekai is down.
		case serverError
		/// Something answered, but it isn't Sekai.
		case notSekai
	}

	private static let session: URLSession = {
		let config = URLSessionConfiguration.ephemeral
		config.timeoutIntervalForRequest = 10
		config.httpShouldSetCookies = false
		config.requestCachePolicy = .reloadIgnoringLocalCacheData
		return URLSession(configuration: config)
	}()

	static func run(_ origin: Origin) async -> Failure? {
		guard let url = origin.url(path: "/api/auth/status") else { return .unreachable }
		var request = URLRequest(url: url)
		request.setValue("application/json", forHTTPHeaderField: "Accept")
		let data: Data
		let response: URLResponse
		do {
			(data, response) = try await session.data(for: request)
		} catch {
			return failure(for: error)
		}
		let status = (response as? HTTPURLResponse)?.statusCode ?? 0
		let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
		guard status < 500 else { return .serverError }
		if origin.contains(response.url), (200..<300).contains(status), json?["setupRequired"] is Bool { return nil }
		return .notSekai
	}

	static func failure(for error: Error) -> Failure {
		let codes: Set<Int> = [
			NSURLErrorServerCertificateUntrusted, NSURLErrorServerCertificateHasBadDate,
			NSURLErrorServerCertificateHasUnknownRoot, NSURLErrorServerCertificateNotYetValid,
			NSURLErrorClientCertificateRejected,
		]
		let nsError = error as NSError
		guard nsError.domain == NSURLErrorDomain else { return .unreachable }
		if nsError.code == NSURLErrorNotConnectedToInternet { return .offline }
		return codes.contains(nsError.code) ? .untrusted : .unreachable
	}
}

extension ServerCheck.Failure {
	/// What to tell the person, in full sentences.
	var title: String {
		switch self {
		case .offline: return "You're offline"
		case .unreachable: return "Can't reach your server"
		case .untrusted: return "Connection isn't secure"
		case .notSekai: return "Not a Sekai server"
		case .serverError: return "Server unavailable"
		}
	}

	var message: String {
		switch self {
		case .offline:
			return "Connect to Wi-Fi or cellular data, then try again."
		case .unreachable:
			return "Check the address and that the server is running. If you use Tailscale, check that it's on."
		case .untrusted:
			return "This device doesn't trust the server's security certificate. Check the address, or ask whoever runs the server to fix it."
		case .serverError:
			return "Your server didn't finish loading. Check that Sekai is running, then try again."
		case .notSekai:
			return "That address didn't open Sekai. Check the address you use in your browser."
		}
	}
}
