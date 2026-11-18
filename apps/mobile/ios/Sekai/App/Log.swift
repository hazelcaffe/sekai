import os

/// The app's log, for Console.app or `log stream --predicate 'subsystem == "<app id>"'`. It says what happened,
/// never what a page sent.
enum Log {
	static let app = Logger(subsystem: AppInfo.bundleId, category: "app")
	static let bridge = Logger(subsystem: AppInfo.bundleId, category: "bridge")
}
