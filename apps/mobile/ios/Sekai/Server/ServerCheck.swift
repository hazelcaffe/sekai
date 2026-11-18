import Foundation

/// Asks an address whether it's a Sekai server: `GET /api/auth/status` answers JSON with `setupRequired`.
enum ServerCheck {
	enum Failure: Error {
		/// No answer at all (offline, wrong address, server down, not on the tailnet).
		case unreachable
		/// The certificate isn't one this device trusts.
		case untrusted
		/// Something answered with an error, like a proxy whose Sekai is down.
		case serverError(Int)
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
			return isCertificateProblem(error) ? .untrusted : .unreachable
		}
		let status = (response as? HTTPURLResponse)?.statusCode ?? 0
		let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
		if json?["setupRequired"] is Bool { return nil }
		return status >= 500 ? .serverError(status) : .notSekai
	}

	private static func isCertificateProblem(_ error: Error) -> Bool {
		let codes: Set<Int> = [
			NSURLErrorServerCertificateUntrusted, NSURLErrorServerCertificateHasBadDate,
			NSURLErrorServerCertificateHasUnknownRoot, NSURLErrorServerCertificateNotYetValid,
			NSURLErrorClientCertificateRejected,
		]
		let nsError = error as NSError
		return nsError.domain == NSURLErrorDomain && codes.contains(nsError.code)
	}
}

extension ServerCheck.Failure {
	/// What to tell the person, in full sentences.
	func message(for origin: Origin) -> String {
		switch self {
		case .unreachable:
			return "Couldn't reach \(origin.string). Check you're online (and on Tailscale, if that's how you reach Sekai)."
		case .untrusted:
			return "\(origin.string) has a certificate this device doesn't trust."
		case let .serverError(status):
			return "\(origin.string) answered with an error (\(status)). Check Sekai is running there."
		case .notSekai:
			return "That isn't a Sekai server."
		}
	}
}
