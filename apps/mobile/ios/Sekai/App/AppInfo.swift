import Foundation

/// Facts about this build that the bridge and the server need.
enum AppInfo {
	static let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.0.0"
	/// Set in project.yml (SEKAI_APP_ID), the one place the app id lives.
	static let bundleId = Bundle.main.bundleIdentifier ?? ""
	/// sekai:// links (registered in Info.plist) and the browser sign-in's way back.
	static let linkScheme = "sekai"
	/// What the web view adds to its user agent, so the server knows it's talking to the app. Safari's own
	/// "Mobile/…" token stays, as pages look for it.
	static let userAgentName = "Mobile/15E148 SekaiApp/\(version) (iOS)"

	static var isDebug: Bool {
		#if DEBUG
			return true
		#else
			return false
		#endif
	}
}
