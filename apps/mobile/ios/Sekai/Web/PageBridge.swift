import UIKit
import UserNotifications
import WebKit

/// `window.sekaiMobile` on the server's pages (shared/bridge.js posts here). Answers only the main frame of the
/// connected server's origin, and checks every argument.
@MainActor
final class PageBridge: NSObject, WKScriptMessageHandlerWithReply {
	static let name = "sekai"
	private weak var shell: ShellViewController?

	init(shell: ShellViewController) {
		self.shell = shell
	}

	func userContentController(
		_ userContentController: WKUserContentController,
		didReceive message: WKScriptMessage
	) async -> (Any?, String?) {
		guard let shell, let origin = shell.origin, message.webView === shell.webView,
		      message.frameInfo.isMainFrame, Origin(message.frameInfo.securityOrigin) == origin,
		      let body = message.body as? [String: Any], let method = body["method"] as? String
		else {
			Log.bridge.error("Refused a message that didn't come from the server's own page")
			return (nil, "Not allowed")
		}
		let args = body["args"] as? [String: Any] ?? [:]
		do {
			let result = try await handle(method, args, shell: shell)
			return (result ?? NSNull(), nil)
		} catch let error as BridgeError {
			Log.bridge.error("\(method, privacy: .public) failed: \(error.message, privacy: .public)")
			return (nil, error.message)
		} catch {
			Log.bridge.error("\(method, privacy: .public) failed: \(error.localizedDescription, privacy: .public)")
			return (nil, "Something went wrong. Try again.")
		}
	}

	private func handle(_ method: String, _ args: [String: Any], shell: ShellViewController) async throws -> Any? {
		switch method {
		case "ready":
			Log.bridge.notice("The server's page is connected to the bridge")
			shell.bridgeReady()
		case "notify":
			notify(args)
		case "setBadge":
			guard let count = Validate.number(args["count"]) else { throw BridgeError("The count must be a number.") }
			try? await UNUserNotificationCenter.current().setBadgeCount(Int(min(max(count, 0), 99999)))
		case "openSettings":
			shell.openSettings()
		case "openNotificationSettings":
			if let url = URL(string: UIApplication.openNotificationSettingsURLString) { _ = await UIApplication.shared.open(url) }
		case "haptic":
			guard let kind = args["kind"] as? String, let haptic = Haptic(rawValue: kind) else {
				throw BridgeError("That kind of feedback isn't available.")
			}
			haptic.play()
		case "backState":
			guard let overlay = Validate.bool(args["overlay"]), let canGoBack = Validate.bool(args["canGoBack"]) else {
				throw BridgeError("The back state must say true or false for overlay and canGoBack.")
			}
			shell.setBackState(PageBack(overlay: overlay, canGoBack: canGoBack))
		case "openExternal":
			guard let text = args["url"] as? String, let url = URL(string: text),
			      ["http", "https"].contains(url.scheme?.lowercased() ?? "")
			else { throw BridgeError("Only web addresses (http or https) can be opened.") }
			shell.openInBrowser(url)
		case "theme":
			guard let hex = Validate.hexColor(args["color"]) else {
				throw BridgeError("The colour must look like #0d0a10.")
			}
			shell.setTheme(.init(hex: hex, dark: args["dark"] as? Bool ?? false, system: args["system"] as? Bool ?? false))
		case "saveFile":
			try saveFile(args, shell: shell)
		case "push.register":
			return try await Push.shared.register()
		case "push.current":
			return await Push.shared.current()
		case "push.unregister":
			Push.shared.unregister()
		case "push.permission":
			return await Push.shared.permission()
		case "push.requestPermission":
			return await Push.shared.requestPermission()
		case "signInWithBrowser":
			let provider = args["provider"]
			guard provider == nil || provider is NSNull || Validate.providerId(provider) != nil else {
				throw BridgeError("That sign-in provider isn't valid.")
			}
			try shell.startBrowserSignIn(provider: Validate.providerId(provider))
		default:
			throw BridgeError("The app doesn't know \(String(method.prefix(40))) yet. Update Sekai to use it.")
		}
		return nil
	}

	/// The page's notifications, shown only while the app is in the background (in front, the page shows its own).
	private func notify(_ args: [String: Any]) {
		guard UIApplication.shared.applicationState != .active else { return }
		let title = Validate.text(args["title"], max: 200) ?? ""
		let body = Validate.text(args["body"], max: 2000) ?? ""
		guard !title.isEmpty || !body.isEmpty else { return }
		let conversationId = Validate.id(args["conversationId"])
		let approval = args["approval"] as? [String: Any]
		Notifications.show(
			title: title,
			body: body,
			path: conversationId.map { "/c/\($0)" } ?? "/",
			toolCallId: Validate.id(approval?["toolCallId"]),
			allowsAnswer: Validate.explicitFalse(approval?["alwaysAsk"]),
			thread: conversationId
		)
	}

	private func saveFile(_ args: [String: Any], shell: ShellViewController) throws {
		guard let base64 = args["base64"] as? String else { throw BridgeError("There's no file to save.") }
		// About 100 MB: bigger files are better downloaded from a link.
		guard base64.utf8.count <= 140_000_000 else { throw BridgeError("That file is too big to save from here.") }
		guard let data = Data(base64Encoded: base64, options: .ignoreUnknownCharacters) else {
			throw BridgeError("That file couldn't be read.")
		}
		let name = Validate.text(args["name"], max: 255) ?? "download"
		do {
			try shell.files.share(data, named: name)
		} catch {
			throw BridgeError("Couldn't save that file. Check there's space on this device.")
		}
	}
}

private enum Haptic: String {
	case selection, light, medium, success, warning, error

	@MainActor func play() {
		switch self {
		case .selection: UISelectionFeedbackGenerator().selectionChanged()
		case .light, .medium: UIImpactFeedbackGenerator(style: self == .light ? .light : .medium).impactOccurred()
		case .success: UINotificationFeedbackGenerator().notificationOccurred(.success)
		case .warning: UINotificationFeedbackGenerator().notificationOccurred(.warning)
		case .error: UINotificationFeedbackGenerator().notificationOccurred(.error)
		}
	}
}

extension UIColor {
	/// "#rrggbb", as the page reports its theme colour.
	convenience init?(hex: String) {
		guard hex.count == 7, let value = UInt32(hex.dropFirst(), radix: 16) else { return nil }
		self.init(
			red: CGFloat((value >> 16) & 0xFF) / 255,
			green: CGFloat((value >> 8) & 0xFF) / 255,
			blue: CGFloat(value & 0xFF) / 255,
			alpha: 1
		)
	}
}
