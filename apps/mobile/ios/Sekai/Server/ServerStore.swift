import Foundation

/// The Sekai server the app opens, and the last few used (in UserDefaults: none of it is secret).
enum ServerStore {
	private static let defaults = UserDefaults.standard
	private static let serverKey = "serverUrl"
	private static let recentKey = "recentServers"

	static var current: Origin? {
		defaults.string(forKey: serverKey).flatMap { Origin($0) }
	}

	static var recent: [String] {
		defaults.stringArray(forKey: recentKey) ?? []
	}

	static func save(_ origin: Origin) {
		defaults.set(origin.string, forKey: serverKey)
		let recent = [origin.string] + recent.filter { $0 != origin.string }
		defaults.set(Array(recent.prefix(5)), forKey: recentKey)
	}
}
