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
		if current != origin { defaults.removeObject(forKey: "pageTheme") }
		defaults.set(origin.string, forKey: serverKey)
		let recent = [origin.string] + recent.filter { $0 != origin.string }
		defaults.set(Array(recent.prefix(5)), forKey: recentKey)
	}

	static func forget(_ origin: Origin) {
		defaults.set(recent.filter { $0 != origin.string }, forKey: recentKey)
		if current == origin {
			defaults.removeObject(forKey: serverKey)
			defaults.removeObject(forKey: "pageTheme")
		}
	}

	struct Theme: Codable, Equatable {
		let hex: String
		let dark: Bool
		let system: Bool
	}

	static var theme: Theme? {
		get { defaults.data(forKey: "pageTheme").flatMap { try? JSONDecoder().decode(Theme.self, from: $0) } }
		set { defaults.set(newValue.flatMap { try? JSONEncoder().encode($0) }, forKey: "pageTheme") }
	}
}
