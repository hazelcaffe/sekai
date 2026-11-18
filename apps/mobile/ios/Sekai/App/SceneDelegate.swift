import UIKit

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
	var window: UIWindow?

	func scene(
		_ scene: UIScene,
		willConnectTo session: UISceneSession,
		options connectionOptions: UIScene.ConnectionOptions
	) {
		guard let windowScene = scene as? UIWindowScene else { return }
		let shell = ShellViewController()
		Router.shared.shell = shell
		let window = UIWindow(windowScene: windowScene)
		window.rootViewController = shell
		self.window = window
		window.makeKeyAndVisible()
		// A sekai:// link that launched the app waits in the router until the server is showing.
		for context in connectionOptions.urlContexts {
			Router.shared.handle(link: context.url)
		}
	}

	func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
		for context in URLContexts {
			Router.shared.handle(link: context.url)
		}
	}
}
