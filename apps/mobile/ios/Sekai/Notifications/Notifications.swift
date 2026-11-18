import UIKit
import UserNotifications

/// The app's notifications: the page's own (while the app is in the background), taps, and the Approve / Deny
/// buttons on approval requests.
@MainActor
enum Notifications {
	/// Apple pushes name it in `aps.category` when they carry a `toolCallId`.
	static let approvalCategory = "SEKAI_APPROVAL"
	private static let approveAction = "SEKAI_APPROVE"
	private static let denyAction = "SEKAI_DENY"
	private static let delegate = NotificationDelegate()

	static func setUp() {
		let center = UNUserNotificationCenter.current()
		center.delegate = delegate
		// Answering needs the phone unlocked: a locked phone shouldn't approve what a bot does.
		let approve = UNNotificationAction(
			identifier: approveAction,
			title: "Approve",
			options: [.authenticationRequired],
			icon: UNNotificationActionIcon(systemImageName: "checkmark")
		)
		let deny = UNNotificationAction(
			identifier: denyAction,
			title: "Deny",
			options: [.authenticationRequired, .destructive],
			icon: UNNotificationActionIcon(systemImageName: "xmark")
		)
		let approval = UNNotificationCategory(
			identifier: approvalCategory,
			actions: [approve, deny],
			intentIdentifiers: [],
			options: []
		)
		center.setNotificationCategories([approval])
	}

	/// A notification from the app itself. With a `toolCallId` it gets Approve / Deny.
	static func show(
		title: String,
		body: String,
		path: String,
		toolCallId: String? = nil,
		thread: String? = nil,
		sound: Bool = true
	) {
		let content = UNMutableNotificationContent()
		content.title = title
		content.body = body
		if sound { content.sound = .default }
		var info: [String: String] = ["url": path]
		if let toolCallId {
			info["toolCallId"] = toolCallId
			content.categoryIdentifier = approvalCategory
		}
		content.userInfo = info
		if let thread { content.threadIdentifier = thread }
		let id = toolCallId.map { "approval-\($0)" } ?? UUID().uuidString
		UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: id, content: content, trigger: nil))
	}

	/// A tap opens the page the notification is about; Approve and Deny answer from the notification itself.
	static func respond(to action: String, payload: NotificationPayload) async {
		switch action {
		case approveAction:
			await answer(approve: true, payload: payload)
		case denyAction:
			await answer(approve: false, payload: payload)
		case UNNotificationDefaultActionIdentifier:
			Router.shared.open(path: payload.path)
		default:
			break
		}
	}

	private static func answer(approve: Bool, payload: NotificationPayload) async {
		guard let toolCallId = payload.toolCallId, let server = ServerStore.current else {
			couldNotAnswer(payload)
			return
		}
		switch await ApprovalReply.send(approve: approve, toolCallId: toolCallId, server: server) {
		case .answered:
			show(
				title: approve ? "Approved" : "Denied",
				body: payload.title,
				path: payload.path,
				thread: payload.thread,
				sound: false
			)
		case .alreadyAnswered:
			show(
				title: "Already answered",
				body: "That request was already answered (or timed out).",
				path: payload.path,
				thread: payload.thread,
				sound: false
			)
		case .failed:
			couldNotAnswer(payload)
		}
	}

	/// The answer didn't go through: the chat, so it can be answered there. iOS doesn't let an app come to the
	/// front by itself, so from the background that's one tap away.
	private static func couldNotAnswer(_ payload: NotificationPayload) {
		if UIApplication.shared.applicationState == .active {
			Router.shared.open(path: payload.path)
			return
		}
		show(
			title: "Couldn't send your answer",
			body: "Tap to open the chat and answer there.",
			path: payload.path,
			thread: payload.thread
		)
	}
}
