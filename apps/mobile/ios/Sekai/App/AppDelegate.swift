import UIKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
	func application(
		_ application: UIApplication,
		didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
	) -> Bool {
		// Before launching finishes, so a tap or an Approve that launched the app isn't missed.
		Notifications.setUp()
		Push.shared.refreshAtLaunch()
		return true
	}

	func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
		Push.shared.didRegister(deviceToken)
	}

	func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
		Push.shared.didFail(error)
	}
}
