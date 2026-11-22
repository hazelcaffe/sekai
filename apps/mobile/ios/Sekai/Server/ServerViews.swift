import SwiftUI

/// Two shades of Sekai teal so links on grouped backgrounds and text on filled buttons stay legible.
enum SekaiStyle {
	static let tint = UIColor { traits in
		traits.userInterfaceStyle == .dark
			? UIColor(red: 0.34, green: 0.87, blue: 0.79, alpha: 1)
			: UIColor(red: 0.00, green: 0.40, blue: 0.36, alpha: 1)
	}
}

struct PrimaryAction: View {
	let title: String
	var busy = false
	let action: () -> Void
	@Environment(\.isEnabled) private var isEnabled

	var body: some View {
		Button(action: action) {
			HStack {
				if busy { ProgressView().accessibilityHidden(true) }
				Text(title).font(.headline)
			}
			.frame(maxWidth: .infinity, minHeight: 30)
		}
		.controlSize(.large)
		.buttonStyle(.borderedProminent)
		.foregroundStyle(Color(uiColor: isEnabled ? .systemBackground : .secondaryLabel))
	}
}

struct ConnectView: View {
	let current: Origin?
	let connect: (Origin) -> Void
	@State private var address: String
	@State private var recent: [String]
	@State private var checking: String?
	@State private var error: String?
	@FocusState private var editing: Bool
	private var canSubmit: Bool {
		!address.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && (current == nil || Origin.typed(address) != current)
	}

	init(current: Origin?, connect: @escaping (Origin) -> Void) {
		self.current = current
		self.connect = connect
		_address = State(initialValue: current?.string ?? "")
		_recent = State(initialValue: ServerStore.recent.filter { $0 != current?.string })
	}

	var body: some View {
		List {
			Section {
				HStack {
					TextField("Server address", text: $address, prompt: Text(verbatim: "https://sekai.example.com").foregroundColor(.secondary))
						.accessibilityLabel("Server address")
						.keyboardType(.URL).textContentType(.URL).textInputAutocapitalization(.never)
						.autocorrectionDisabled().submitLabel(.go).focused($editing)
						.onSubmit { begin(address) }
						.onChange(of: address) { _ in error = nil }
					if editing, !address.isEmpty {
						Button { address = "" } label: {
							Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary)
								.frame(width: 44, height: 44)
						}
						.buttonStyle(.borderless).accessibilityLabel("Clear address")
					}
				}
				.frame(minHeight: 44).disabled(checking != nil)
			} header: {
				Text("Server address")
			} footer: {
				if let error {
					Label(error, systemImage: "exclamationmark.circle").font(.subheadline).foregroundStyle(.primary)
				} else {
					Text("Use the address that opens Sekai in your browser.")
				}
			}
			Section {
				PrimaryAction(title: checking != nil ? "Checking…" : error == nil ? "Connect" : "Try again", busy: checking != nil) {
					begin(address)
				}
				.disabled(checking != nil || !canSubmit)
				.listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
				if checking != nil {
					Button("Cancel") { checking = nil }
						.frame(maxWidth: .infinity, minHeight: 44).listRowBackground(Color.clear)
				}
			}
			if !recent.isEmpty {
				Section("Recent servers") {
					ForEach(recent, id: \.self) { url in
						Button { address = url; begin(url) } label: { Label(url, systemImage: "clock") }
							.disabled(checking != nil)
							.swipeActions(allowsFullSwipe: false) {
								Button("Remove", role: .destructive) {
									if let origin = Origin(url) { ServerStore.forget(origin) }
									recent.removeAll { $0 == url }
								}
							}
					}
				}
			}
			if current == nil { AboutLink(current: nil) }
		}
		.listStyle(.insetGrouped).textCase(nil)
		.navigationTitle(current == nil ? "Connect to Sekai" : "Change server")
		.scrollDismissesKeyboard(.interactively)
		.task(id: checking) {
			guard let input = checking else { return }
			guard let origin = Origin.typed(input) else {
				failed("That address doesn't look right. Try https://sekai.example.com.")
				return
			}
			let failure = await ServerCheck.run(origin)
			guard !Task.isCancelled else { return }
			if let failure {
				let hint = failure == .unreachable && !input.contains("://") ? " If you use http://, include it." : ""
				failed("\(failure.title). \(failure.message)\(hint)")
			} else {
				UINotificationFeedbackGenerator().notificationOccurred(.success)
				connect(origin)
			}
		}
		.onDisappear { checking = nil }
	}

	private func begin(_ input: String) {
		guard checking == nil, !input.isEmpty, current == nil || Origin.typed(input) != current else { return }
		editing = false
		error = nil
		checking = input
	}

	private func failed(_ message: String) {
		error = message
		checking = nil
		UINotificationFeedbackGenerator().notificationOccurred(.error)
		UIAccessibility.post(notification: .announcement, argument: message)
	}
}

struct ServerSettingsView: View {
	enum Route: Hashable { case address }
	let current: Origin
	let connect: (Origin) -> Void
	let forget: () -> Void
	let close: () -> Void
	@State private var confirming = false
	@State var path: [Route]

	var body: some View {
		NavigationStack(path: $path) {
			List {
				Section("Current server") {
					Label(current.string, systemImage: "server.rack").textSelection(.enabled)
					NavigationLink("Change server", value: Route.address)
				}
				AboutLink(current: current)
				Section {
					Button("Forget this server", role: .destructive) { confirming = true }
						.confirmationDialog("Forget this server?", isPresented: $confirming, titleVisibility: .visible) {
							Button("Forget", role: .destructive, action: forget)
							Button("Cancel", role: .cancel) {}
						} message: { Text("This removes the saved address and signs you out on this device. Your chats stay on the server.") }
				}
			}
			.listStyle(.insetGrouped).textCase(nil)
			.navigationTitle("Server")
			.toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel", action: close) } }
			.navigationDestination(for: Route.self) { _ in ConnectView(current: current, connect: connect) }
		}
	}
}

/// Used immediately at launch and again on failure. The same server and escape hatch stay in view.
struct ConnectionStatusView: View {
	let origin: Origin
	let failure: ServerCheck.Failure?
	let retry: () -> Void
	let settings: () -> Void

	var body: some View {
		if failure != nil { state.refreshable { retry() } }
		else { state }
	}

	private var state: some View {
		ScrollView {
			VStack(spacing: 16) {
				if let failure {
					Image(systemName: failure == .offline ? "wifi.slash" : "server.rack")
						.font(.largeTitle).foregroundStyle(.secondary).accessibilityHidden(true)
				} else { ProgressView().controlSize(.large).accessibilityHidden(true) }
				Text(failure?.title ?? "Connecting…").font(.title.bold()).accessibilityAddTraits(.isHeader)
				Text(origin.string).font(.subheadline).foregroundStyle(.secondary).textSelection(.enabled)
				if let failure {
					Text(failure.message).foregroundStyle(.secondary)
					PrimaryAction(title: "Try again", action: retry).padding(.top, 8)
				}
				Button("Change server", action: settings).frame(minHeight: 44)
			}
			.multilineTextAlignment(.center).frame(maxWidth: 420).padding(24)
			.frame(maxWidth: .infinity)
		}
		// Centre short states; when type is large or the phone turns sideways, allow scrolling instead.
		.modifier(CenteredState())
		.background(Color(uiColor: .systemGroupedBackground))
	}
}

private struct CenteredState: ViewModifier {
	func body(content: Content) -> some View {
		if #available(iOS 18, *) { content.defaultScrollAnchor(.center, for: .alignment) }
		else { content.padding(.top, 44) }
	}
}
