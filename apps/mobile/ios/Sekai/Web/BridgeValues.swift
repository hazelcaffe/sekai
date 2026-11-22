import Foundation

/// An error the page sees (the bridge's promise rejects with this message), in words a person understands.
struct BridgeError: Error {
	let message: String

	init(_ message: String) {
		self.message = message
	}
}

/// Checks for values that come from pages and notifications: nothing is trusted as it arrives.
enum Validate {
	/// Notification shortcuts are opt-in: missing or malformed approval rules must ask in the chat.
	static func explicitFalse(_ value: Any?) -> Bool {
		bool(value) == false
	}

	/// A JavaScript boolean (not a number, which arrives as an NSNumber too).
	static func bool(_ value: Any?) -> Bool? {
		guard let number = value as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() else { return nil }
		return number.boolValue
	}

	/// Ids like conversation and tool call ids ("call_abc123", "toolu_01…").
	static func id(_ value: Any?) -> String? {
		matching(value, "^[A-Za-z0-9_.:-]{1,200}$")
	}

	/// A sign-in provider's id, as the server lists them.
	static func providerId(_ value: Any?) -> String? {
		matching(value, "^[A-Za-z0-9_.-]{1,64}$")
	}

	/// A colour like "#0d0a10".
	static func hexColor(_ value: Any?) -> String? {
		matching(value, "^#[0-9a-fA-F]{6}$")
	}

	/// Text, cut to a length that fits where it goes.
	static func text(_ value: Any?, max: Int) -> String? {
		guard let text = value as? String else { return nil }
		return String(text.prefix(max))
	}

	/// A JavaScript number (not a boolean, which arrives as a number too).
	static func number(_ value: Any?) -> Double? {
		guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }
		let double = number.doubleValue
		return double.isFinite ? double : nil
	}

	private static func matching(_ value: Any?, _ pattern: String) -> String? {
		guard let text = value as? String, text.range(of: pattern, options: .regularExpression) != nil else { return nil }
		return text
	}
}
