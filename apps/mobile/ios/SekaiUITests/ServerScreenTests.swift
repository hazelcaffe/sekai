import XCTest

/// Drive the actual connection UI. The little page in scripts/bridge-fixture.html makes openSettings and Back
/// testable without signing into an account or depending on a particular version of the web app.
final class ServerScreenTests: XCTestCase {
	@MainActor func testServerSheetInBothAppearances() throws {
		continueAfterFailure = false
		let app = XCUIApplication()
		for dark in [false, true] {
			let mode = dark ? "dark" : "light"
			XCUIDevice.shared.appearance = dark ? .dark : .light
			app.launchArguments = ["-serverUrl", "http://127.0.0.1:7491"]
			app.launch()
			let open = app.webViews.buttons["Server settings"]
			XCTAssertTrue(open.waitForExistence(timeout: 20), "Start scripts/serve-bridge-fixture.sh before running UI tests.")
			open.tap()
			let cancel = app.buttons["Cancel"]
			XCTAssertTrue(cancel.waitForExistence(timeout: 4))
			shot("server-sheet-\(mode)")
			app.buttons["About"].tap()
			XCTAssertTrue(app.buttons["Software licence"].waitForExistence(timeout: 3))
			shot("about-\(mode)")
			app.navigationBars.buttons.element(boundBy: 0).tap()
			app.buttons["Change server"].tap()
			let field = app.textFields["Server address"]
			XCTAssertEqual(field.value as? String, "http://127.0.0.1:7491")
			shot("change-server-\(mode)")
			field.tap()
			app.buttons["Clear address"].tap()
			field.typeText("ftp://example.com\n")
			XCTAssertTrue(app.buttons["Try again"].waitForExistence(timeout: 5))
			shot("address-error-\(mode)")
			app.navigationBars.buttons.element(boundBy: 0).tap()
			cancel.tap()
			// The exact page that requested the sheet survived it; reloading would lose this marker.
			XCTAssertTrue(app.webViews.staticTexts["Draft preserved"].waitForExistence(timeout: 4))
			let edge = app.coordinate(withNormalizedOffset: CGVector(dx: 0.003, dy: 0.6))
			let middle = app.coordinate(withNormalizedOffset: CGVector(dx: 0.65, dy: 0.6))
			edge.press(forDuration: 0.05, thenDragTo: middle)
			XCTAssertTrue(app.webViews.staticTexts["Overlay closed"].waitForExistence(timeout: 3))
			edge.press(forDuration: 0.05, thenDragTo: middle)
			XCTAssertTrue(app.webViews.staticTexts["Returned in history"].waitForExistence(timeout: 3))
			let fieldInPage = app.webViews.textFields["Message"]
			fieldInPage.tap()
			fieldInPage.typeText("Hello")
			XCTAssertEqual(fieldInPage.value as? String, "Hello")
			if app.keyboards.firstMatch.exists {
				XCTAssertLessThanOrEqual(fieldInPage.frame.maxY, app.keyboards.firstMatch.frame.minY + 1)
			}
			XCTAssertTrue(open.isHittable)
			shot("web-keyboard-\(mode)")
			app.terminate()
		}
		XCUIDevice.shared.appearance = .light
	}

	/// A page that reports its back state decides: Back closes its sheet, then leaves the edge swipe to the page even
	/// though the web view has history.
	@MainActor func testBackFollowsTheReportedState() {
		continueAfterFailure = false
		let app = XCUIApplication()
		app.launchArguments = ["-serverUrl", "http://127.0.0.1:7491"]
		app.launch()
		let sheet = app.webViews.buttons["Open a sheet"]
		XCTAssertTrue(sheet.waitForExistence(timeout: 20))
		sheet.tap()
		XCTAssertTrue(app.webViews.staticTexts["Sheet open"].waitForExistence(timeout: 3))
		let edge = app.coordinate(withNormalizedOffset: CGVector(dx: 0.003, dy: 0.6))
		let middle = app.coordinate(withNormalizedOffset: CGVector(dx: 0.65, dy: 0.6))
		edge.press(forDuration: 0.05, thenDragTo: middle)
		XCTAssertTrue(app.webViews.staticTexts["Sheet closed"].waitForExistence(timeout: 3))
		edge.press(forDuration: 0.05, thenDragTo: middle)
		XCTAssertFalse(app.webViews.staticTexts["Back reached the page"].waitForExistence(timeout: 2))
		XCTAssertFalse(app.webViews.staticTexts["Returned in history"].exists)
		XCTAssertTrue(app.webViews.staticTexts["Sheet closed"].exists)
		app.terminate()
	}

	@MainActor func testConnectAndForget() {
		continueAfterFailure = false
		let app = XCUIApplication()
		app.launch()
		let field = app.textFields["Server address"]
		XCTAssertTrue(field.waitForExistence(timeout: 4))
		field.tap()
		field.typeText("http://127.0.0.1:7491\n")
		let settings = app.webViews.buttons["Server settings"]
		XCTAssertTrue(settings.waitForExistence(timeout: 10))
		settings.tap()
		app.buttons["Forget this server"].tap()
		app.buttons["Forget"].tap()
		XCTAssertTrue(field.waitForExistence(timeout: 5))
		app.terminate()
		app.launch()
		XCTAssertTrue(field.waitForExistence(timeout: 5))
	}

	@MainActor private func shot(_ name: String) {
		let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
		image.name = name
		image.lifetime = .keepAlways
		add(image)
	}

	/// With a light phone and a fixed dark Sekai theme, the native sheet and a fresh launch must stay dark.
	@MainActor func testThemeOverrideSurvivesRelaunch() {
		continueAfterFailure = false
		XCUIDevice.shared.appearance = .light
		let app = XCUIApplication()
		app.launchArguments = ["-serverUrl", "http://localhost:7491"]
		app.launch()
		let toggle = app.webViews.buttons["Use dark appearance"]
		XCTAssertTrue(toggle.waitForExistence(timeout: 10))
		toggle.tap()
		XCTAssertTrue(app.webViews.staticTexts["Native dark"].waitForExistence(timeout: 4))
		app.terminate()
		app.launch()
		XCTAssertTrue(app.webViews.staticTexts["Native dark"].waitForExistence(timeout: 10))
		app.webViews.buttons["Server settings"].tap()
		XCTAssertTrue(app.buttons["Cancel"].waitForExistence(timeout: 3))
		shot("server-sheet-dark-on-light-phone")
	}
}
