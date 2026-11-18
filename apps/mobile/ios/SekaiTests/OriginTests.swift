import Foundation
import Testing
@testable import Sekai

struct OriginTests {
	@Test func typedAddressesBecomeOrigins() {
		#expect(Origin.typed("sekai.example.com")?.string == "https://sekai.example.com")
		#expect(Origin.typed("  https://Sekai.Example.com/chats/abc?x=1  ")?.string == "https://sekai.example.com")
		#expect(Origin.typed("http://192.168.1.20:7420")?.string == "http://192.168.1.20:7420")
		#expect(Origin.typed("localhost:7420")?.string == "https://localhost:7420")
		#expect(Origin.typed("https://sekai.example.com:443")?.string == "https://sekai.example.com")
		#expect(Origin.typed("http://[::1]:7420")?.string == "http://[::1]:7420")
	}

	@Test func otherAddressesAreRefused() {
		#expect(Origin.typed("") == nil)
		#expect(Origin.typed("ftp://sekai.example.com") == nil)
		#expect(Origin.typed("javascript://alert(1)") == nil)
		#expect(Origin.typed("sekai example.com") == nil)
		#expect(Origin.typed("file:///etc/passwd") == nil)
	}

	@Test func originsCompareLikeBrowsers() {
		let origin = Origin("https://sekai.example.com")
		#expect(origin != nil)
		#expect(origin == Origin("https://sekai.example.com:443/settings"))
		#expect(origin != Origin("https://sekai.example.com.evil.net"))
		#expect(origin != Origin("http://sekai.example.com"))
		#expect(origin != Origin("https://sekai.example.com:8443"))
	}

	@Test func pathsStayOnTheServer() throws {
		let origin = try #require(Origin("https://sekai.example.com"))
		#expect(origin.url(path: "/c/abc")?.absoluteString == "https://sekai.example.com/c/abc")
		#expect(origin.url(path: "/inbox?tab=approvals#top")?.absoluteString == "https://sekai.example.com/inbox?tab=approvals#top")
		#expect(origin.url(path: "//evil.net/x") == nil)
		#expect(origin.url(path: "/\\evil.net") == nil)
		#expect(origin.url(path: "https://evil.net") == nil)
		#expect(origin.url(path: "c/abc") == nil)
	}
}
