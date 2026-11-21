/** Auth endpoints anyone can call. Everything else under /api/auth needs you signed in. */
export function isPublicAuthPath(path: string): boolean {
	return (
		[
			"/api/auth/status",
			"/api/auth/setup",
			"/api/auth/login",
			"/api/auth/logout",
			"/api/auth/passkeys/login/options",
			"/api/auth/passkeys/login/verify",
			"/api/auth/mfa/challenge",
			"/api/auth/mfa/send",
			"/api/auth/mfa/verify",
			"/api/auth/mfa/passkey/options",
			"/api/auth/mfa/passkey/verify",
			"/api/auth/forgot",
			// Signing in to the phone apps through the browser (finish checks the session itself).
			"/api/auth/app/start",
			"/api/auth/app/finish",
			"/api/auth/app/exchange",
		].includes(path) ||
		/^\/api\/auth\/sso\/[A-Za-z0-9_]+\/(start|callback)$/.test(path) ||
		/^\/api\/auth\/ticket\/(invite|reset)\/[A-Za-z0-9]+$/.test(path)
	);
}

/**
 * What a session that owes a step may still use. Setting up two-step sign-in may need an email or a phone number
 * added to the account first, which asks "Confirm it's you" once the sign-in is a while old: so that's allowed too.
 */
export function allowedWhileRestricted(path: string, restriction: "password" | "mfa"): boolean {
	if (["/api/auth/status", "/api/auth/logout", "/api/auth/account"].includes(path)) return true;
	if (restriction === "password") return path === "/api/auth/password";
	return (
		path.startsWith("/api/auth/mfa") ||
		path.startsWith("/api/auth/passkeys/register") ||
		path === "/api/auth/password" ||
		path === "/api/auth/reauth"
	);
}
