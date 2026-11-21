import UserNotifications

/// What a notification carries, the same for Apple pushes (top-level keys) and the app's own notifications.
struct NotificationPayload: Sendable {
	let identifier: String
	let title: String
	/// The page it's about, like "/c/<id>".
	let path: String
	let toolCallId: String?
	let thread: String?
	/// A test push from settings: shown even while the app is in front.
	let test: Bool

	init(_ request: UNNotificationRequest) {
		identifier = request.identifier
		let content = request.content
		let info = content.userInfo
		title = content.title
		path = (info["url"] as? String).flatMap { Router.isAppPath($0) ? $0 : nil } ?? "/"
		toolCallId = content.categoryIdentifier == Notifications.approvalCategory ? Validate.id(info["toolCallId"]) : nil
		thread = content.threadIdentifier.isEmpty ? nil : content.threadIdentifier
		let test = info["test"]
		self.test = (test as? String) == "1" || (test as? NSNumber)?.intValue == 1
	}
}

/// UserNotifications' delegate. It hands the work to the main actor and says when it's done, so iOS keeps the
/// app running until an Approve or Deny has gone through.
final class NotificationDelegate: NSObject, UNUserNotificationCenterDelegate {
	func userNotificationCenter(
		_ center: UNUserNotificationCenter,
		willPresent notification: UNNotification,
		withCompletionHandler completionHandler: @escaping @Sendable (UNNotificationPresentationOptions) -> Void
	) {
		// In front, the page shows its own notices; only test pushes show here.
		let payload = NotificationPayload(notification.request)
		completionHandler(payload.test ? [.banner, .list, .sound] : [])
	}

	func userNotificationCenter(
		_ center: UNUserNotificationCenter,
		didReceive response: UNNotificationResponse,
		withCompletionHandler completionHandler: @escaping @Sendable () -> Void
	) {
		let payload = NotificationPayload(response.notification.request)
		let action = response.actionIdentifier
		Task { @MainActor in
			await Notifications.respond(to: action, payload: payload)
			completionHandler()
		}
	}
}
