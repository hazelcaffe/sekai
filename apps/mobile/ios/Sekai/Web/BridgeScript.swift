import Foundation

/// shared/bridge.js, ready to inject into the server's pages: `__SEKAI_APP__` becomes what the page should know
/// about the app.
enum BridgeScript {
	private static let template: String? = Bundle.main.url(forResource: "bridge", withExtension: "js")
		.flatMap { try? String(contentsOf: $0, encoding: .utf8) }

	static func source(for origin: Origin) -> String? {
		let app = ["platform": "ios", "version": AppInfo.version, "serverUrl": origin.string]
		guard let template,
		      let data = try? JSONSerialization.data(withJSONObject: app, options: [.sortedKeys, .withoutEscapingSlashes]),
		      let json = String(data: data, encoding: .utf8)
		else { return nil }
		return template.replacingOccurrences(of: "__SEKAI_APP__", with: json)
	}
}
