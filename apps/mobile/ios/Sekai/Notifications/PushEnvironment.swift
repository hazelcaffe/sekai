import Foundation

/// Which of Apple's push servers this build's tokens belong to: what the provisioning profile says when the app
/// has one (development or ad hoc builds), otherwise sandbox for debug builds and production for the rest
/// (App Store and TestFlight builds have no profile inside).
enum PushEnvironment {
	static let current: String = {
		if let fromProfile = profileEnvironment() { return fromProfile == "production" ? "production" : "sandbox" }
		return AppInfo.isDebug ? "sandbox" : "production"
	}()

	/// `aps-environment` from embedded.mobileprovision: a signed plist, read here without checking the signature
	/// (iOS already did).
	private static func profileEnvironment() -> String? {
		guard let url = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision"),
		      let data = try? Data(contentsOf: url),
		      let start = data.range(of: Data("<?xml".utf8)),
		      let end = data.range(of: Data("</plist>".utf8), in: start.lowerBound..<data.endIndex),
		      let plist = try? PropertyListSerialization.propertyList(
		      	from: data.subdata(in: start.lowerBound..<end.upperBound),
		      	format: nil
		      ) as? [String: Any],
		      let entitlements = plist["Entitlements"] as? [String: Any]
		else { return nil }
		return entitlements["aps-environment"] as? String
	}
}
