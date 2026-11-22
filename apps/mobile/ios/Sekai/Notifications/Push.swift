import UIKit
import UserNotifications

/// Apple push: the device token the page registers with the server (the app itself never tells the server).
@MainActor
final class Push {
	static let shared = Push()

	private let defaults = UserDefaults.standard
	private let enabledKey = "pushEnabled"
	private let tokenKey = "pushToken"
	private var waiting: [UUID: CheckedContinuation<String, Error>] = [:]

	/// The page turned push on here (and hasn't turned it off).
	private var enabled: Bool {
		get { defaults.bool(forKey: enabledKey) }
		set { defaults.set(newValue, forKey: enabledKey) }
	}

	private var savedToken: String? {
		get { defaults.string(forKey: tokenKey) }
		set { defaults.set(newValue, forKey: tokenKey) }
	}

	func permission() async -> String {
		switch await UNUserNotificationCenter.current().notificationSettings().authorizationStatus {
		case .authorized, .provisional, .ephemeral:
			return "granted"
		case .denied:
			return "denied"
		default:
			return "prompt"
		}
	}

	/// Asks to show notifications (when iOS hasn't asked yet): "granted" or "denied".
	func requestPermission() async -> String {
		let center = UNUserNotificationCenter.current()
		if await center.notificationSettings().authorizationStatus == .notDetermined {
			_ = try? await center.requestAuthorization(options: [.alert, .sound, .badge])
		}
		return await permission() == "granted" ? "granted" : "denied"
	}

	/// Asks for permission if needed, then returns this device's push address (a MobilePushToken).
	func register() async throws -> [String: Any] {
		guard await requestPermission() == "granted" else {
			throw BridgeError("Notifications are off for Sekai. Turn them on in Settings → Notifications → Sekai.")
		}
		let token = try await deviceToken()
		enabled = true
		return describe(token)
	}

	/// The push address if push was turned on before and is still allowed; never asks.
	func current() async -> [String: Any]? {
		guard enabled, await permission() == "granted" else { return nil }
		if let savedToken {
			// iOS hands out the same token again (or a new one, which then goes to the page as pushToken).
			UIApplication.shared.registerForRemoteNotifications()
			return describe(savedToken)
		}
		guard let token = try? await deviceToken() else { return nil }
		return describe(token)
	}

	func unregister() {
		enabled = false
	}

	/// Apple asks apps to register at every launch; a changed token reaches the page as a pushToken event.
	func refreshAtLaunch() {
		guard enabled else { return }
		Task {
			if await permission() == "granted" { UIApplication.shared.registerForRemoteNotifications() }
		}
	}

	func didRegister(_ deviceToken: Data) {
		let token = deviceToken.map { String(format: "%02x", $0) }.joined()
		let changed = token != savedToken
		savedToken = token
		finish(.success(token))
		if changed, enabled {
			Router.shared.shell?.send(event: "pushToken", data: describe(token))
		}
	}

	func didFail(_ error: Error) {
		// 3000: the app was signed without Apple's push entitlement (unsigned builds, free developer accounts).
		let unsigned = (error as NSError).code == 3000
		finish(.failure(BridgeError(
			unsigned
				? "This copy of Sekai wasn't signed for push notifications, so they can't be turned on."
				: "Couldn't turn on notifications. Check you're online, then try again."
		)))
	}

	private func deviceToken() async throws -> String {
		let id = UUID()
		return try await withCheckedThrowingContinuation { continuation in
			waiting[id] = continuation
			UIApplication.shared.registerForRemoteNotifications()
			Task { [weak self] in
				try? await Task.sleep(nanoseconds: 30_000_000_000)
				self?.waiting.removeValue(forKey: id)?.resume(throwing: BridgeError(
					"Apple's push service didn't answer. Check you're online, then try again."
				))
			}
		}
	}

	private func finish(_ result: Result<String, Error>) {
		let continuations = waiting.values
		waiting.removeAll()
		for continuation in continuations {
			continuation.resume(with: result)
		}
	}

	/// A MobilePushToken (packages/shared/src/mobile.ts).
	private func describe(_ token: String) -> [String: Any] {
		[
			"provider": "apns",
			"token": token,
			"environment": PushEnvironment.current,
			"appId": AppInfo.bundleId,
			"device": UIDevice.current.name,
		]
	}
}
