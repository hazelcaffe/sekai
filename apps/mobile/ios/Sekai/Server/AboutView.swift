import SwiftUI

struct AboutLink: View {
	let current: Origin?

	var body: some View {
		NavigationLink { AboutView(current: current) } label: { Label("About", systemImage: "info.circle") }
	}
}

struct AboutView: View {
	let current: Origin?
	private let credit = "© SEGA / © Colorful Palette / © Crypton Future Media, INC. www.piapro.net"

	var body: some View {
		List {
			Section {
				HStack(spacing: 16) {
					Image("LaunchIcon").renderingMode(.original).resizable().scaledToFit()
						.frame(width: 64, height: 64).accessibilityHidden(true)
					VStack(alignment: .leading, spacing: 4) {
						Text("Sekai").font(.title2.bold())
						Text("Version \(AppInfo.version) (\(AppInfo.build))").foregroundStyle(.secondary)
					}
				}.padding(.vertical, 8).accessibilityElement(children: .combine)
			}
			Section("Server") { Text(current?.string ?? "Not connected").textSelection(.enabled) }
			Section("Credits") {
				NavigationLink("Software licence") {
					ScrollView {
						Text(verbatim: Self.licence).textSelection(.enabled).padding()
					}.navigationTitle("Software licence").navigationBarTitleDisplayMode(.inline)
				}
				VStack(alignment: .leading, spacing: 6) {
					Text("HATSUNE MIKU: COLORFUL STAGE!").font(.headline)
					Text("Logo and character art").foregroundStyle(.secondary)
					Text(credit).font(.footnote).foregroundStyle(.secondary)
				}.padding(.vertical, 6)
			}
			Section {
				if let url = URL(string: UIApplication.openNotificationSettingsURLString) {
					Link(destination: url) { Label("Notification settings", systemImage: "bell") }
				}
				ShareLink(item: "Sekai \(AppInfo.version) (\(AppInfo.build)) · iOS \(UIDevice.current.systemVersion)\n\(current?.string ?? "Not connected")") {
					Label("Share app details", systemImage: "square.and.arrow.up")
				}
			}
		}.listStyle(.insetGrouped).textCase(nil).navigationTitle("About")
	}

	private static let licence = Bundle.main.url(forResource: "LICENSE", withExtension: nil)
		.flatMap { try? String(contentsOf: $0, encoding: .utf8) } ?? "GNU Affero General Public License, version 3."
}
