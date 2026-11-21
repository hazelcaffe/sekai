import { expect, test } from "bun:test";
import { allowedWhileRestricted } from "../src/auth/paths.ts";

test("a session that owes two-step sign-in can set it up where it is", () => {
	// The methods, a passkey, and adding the email or phone number codes go to (after confirming it's you).
	for (const path of [
		"/api/auth/mfa",
		"/api/auth/mfa/sms/setup",
		"/api/auth/passkeys/register/options",
		"/api/auth/account",
		"/api/auth/reauth",
	]) {
		expect(allowedWhileRestricted(path, "mfa")).toBe(true);
	}
	// Nothing else.
	expect(allowedWhileRestricted("/api/agents", "mfa")).toBe(false);
	expect(allowedWhileRestricted("/api/auth/sessions", "mfa")).toBe(false);
});

test("a temporary password only lets you choose your own", () => {
	expect(allowedWhileRestricted("/api/auth/password", "password")).toBe(true);
	expect(allowedWhileRestricted("/api/auth/reauth", "password")).toBe(false);
	expect(allowedWhileRestricted("/api/auth/mfa/sms/setup", "password")).toBe(false);
});
