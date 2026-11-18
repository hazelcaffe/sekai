import Foundation
import Testing
@testable import Sekai

struct ValidationTests {
	@Test func appPaths() {
		#expect(Router.isAppPath("/"))
		#expect(Router.isAppPath("/c/conv_123"))
		#expect(!Router.isAppPath("//evil.net"))
		#expect(!Router.isAppPath("https://evil.net"))
		#expect(!Router.isAppPath("/c/a b"))
		#expect(!Router.isAppPath("/c/a\nb"))
	}

	@Test func links() throws {
		func link(_ text: String) throws -> Router.Link {
			Router.parse(try #require(URL(string: text)))
		}
		#expect(try link("sekai://c/conv_123") == .page("/c/conv_123"))
		#expect(try link("sekai://inbox/") == .page("/inbox"))
		#expect(try link("sekai://") == .page("/"))
		#expect(try link("sekai://c/../../x") == .page("/"))
		#expect(try link("sekai://signed-in?code=abc123") == .signedIn(code: "abc123"))
		#expect(try link("sekai://signed-in?error=cancelled") == .ignored)
		#expect(try link("https://sekai.example.com/c/abc") == .ignored)
	}

	@Test func bridgeValues() {
		#expect(Validate.id("call_abc-123") == "call_abc-123")
		#expect(Validate.id("../etc") == nil)
		#expect(Validate.id(42) == nil)
		#expect(Validate.hexColor("#0d0a10") == "#0d0a10")
		#expect(Validate.hexColor("red") == nil)
		#expect(Validate.hexColor("#0d0a10; x") == nil)
		#expect(Validate.number(NSNumber(value: 3)) == 3)
		#expect(Validate.number(NSNumber(value: true)) == nil)
		#expect(Validate.text("long text", max: 4) == "long")
		#expect(Validate.providerId("google") == "google")
		#expect(Validate.providerId("google/../x") == nil)
	}

	@Test func fileNames() {
		#expect(FileSharing.safeName("report.pdf") == "report.pdf")
		#expect(FileSharing.safeName("../../secret") == "-..-secret")
		#expect(FileSharing.safeName(".hidden") == "hidden")
		#expect(FileSharing.safeName("") == "download")
		#expect(FileSharing.safeName(String(repeating: "a", count: 500)).count == 200)
	}
}
