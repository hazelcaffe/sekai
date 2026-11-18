import {
	AccountPatch,
	ApiTokenCreate,
	type AuthStatus,
	ForgotPassword,
	LoginInput,
	MfaSend,
	MfaVerify,
	PasswordChange,
	Reauth,
	SetupInput,
	type SignInResult,
	TicketAccept,
	type TicketInfo,
} from "@sekai/shared";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import { eq } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { config } from "../config.ts";
import { db, schema } from "../db/index.ts";
import { HttpError } from "../lib/errors.ts";
import { log } from "../lib/log.ts";
import { body, ok } from "../routes/util.ts";
import { emailReady } from "../services/messaging.ts";
import { actorFor } from "./actor.ts";
import {
	APP_COOKIE,
	APP_FINISH,
	appPage,
	appSignIn,
	issueAppCode,
	redeemAppCode,
	startAppSignIn,
} from "./app-signin.ts";
import { authenticate, denyReason } from "./index.ts";
import {
	challengeFor,
	confirmCodeFactor,
	confirmTotp,
	findChallenge,
	hasMfa,
	mfaStatus,
	newRecoveryCodes,
	owesMfa,
	removeFactor,
	sendChallengeCode,
	sendReauthCode,
	startChallenge,
	startCodeFactor,
	startTotp,
	takeChallenge,
	verifyFactor,
} from "./mfa.ts";
import {
	deletePasskey,
	finishLogin,
	finishRegistration,
	hasPasskeys,
	listPasskeys,
	loginOptions,
	registrationOptions,
	renamePasskey,
} from "./passkeys.ts";
import {
	clearLegacySessionCookie,
	clearSessionCookie,
	clientIp,
	isHttps,
	passkeysAvailableFor,
	readCookie,
	readSessionCookie,
	requestOrigin,
	sameOrigin,
	sessionCookie,
} from "./request.ts";
import {
	changePassword,
	checkPassword,
	createSession,
	createToken,
	deleteSessionBySecret,
	getUser,
	getUserRow,
	isSetUp,
	listSessions,
	listTokens,
	markVerified,
	type Principal,
	principalUserId,
	revokeOtherSessions,
	revokeSession,
	revokeToken,
	rotateBridgeToken,
	setPassword,
	setSessionRestriction,
	setup,
	toUser,
	touchLogin,
	type UserRow,
	updateAccount,
} from "./service.ts";
import { accountFor, finishSso, listIdentities, safeRedirect, ssoButtons, startSso, unlinkIdentity } from "./sso.ts";
import { consumeTicket, failTicket, findTicket } from "./tickets.ts";

// ---------------------------------------------------------------- rate limiting

const WINDOW_MS = 15 * 60_000;
/** Wrong passwords or codes per address, and per account, before waiting. */
const PER_IP = 10;
const PER_ACCOUNT = 10;
const failures = new Map<string, number[]>();

function recent(key: string): number[] {
	const now = Date.now();
	const list = (failures.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
	if (list.length) failures.set(key, list);
	else failures.delete(key);
	return list;
}

function checkRate(ip: string, account?: string): void {
	const keys = [`ip:${ip}`, ...(account ? [`acct:${account.toLowerCase()}`] : [])];
	for (const key of keys) {
		const list = recent(key);
		const limit = key.startsWith("ip:") ? PER_IP : PER_ACCOUNT;
		if (list.length >= limit) {
			const wait = Math.max(1, Math.ceil((Math.min(...list) + WINDOW_MS - Date.now()) / 60_000));
			throw new HttpError(429, `Too many tries. Wait ${wait} minute${wait === 1 ? "" : "s"} and try again.`);
		}
	}
}

function recordFailure(ip: string, account?: string): void {
	const now = Date.now();
	for (const key of [`ip:${ip}`, ...(account ? [`acct:${account.toLowerCase()}`] : [])]) {
		const list = recent(key);
		list.push(now);
		failures.set(key, list);
	}
	if (failures.size > 50_000) failures.clear();
}

export function resetRateLimits(): void {
	failures.clear();
}

// ---------------------------------------------------------------- helpers

const MFA_COOKIE = "sekai_mfa";
/** Sensitive changes ask you to prove it's you again after this long. */
export const REAUTH_MS = 15 * 60_000;

function ipOf(c: Context): string {
	return clientIp(c.req.raw, c.env, config.trustProxy) ?? "unknown";
}

function meta(c: Context) {
	return { userAgent: c.req.header("user-agent") ?? null, ip: clientIp(c.req.raw, c.env, config.trustProxy) };
}

/** The address people use, for sign-in callbacks and links (SEKAI_PUBLIC_URL, else this request's). */
export function publicUrl(c: Context): string {
	const url = config.publicUrl ?? requestOrigin(c.req.raw);
	if (!url) throw new HttpError(400, "Set SEKAI_PUBLIC_URL so Sekai knows its own address");
	return url;
}

/** The phone app's sign-in in this browser (see app-signin.ts). */
function appCookie(c: Context, token: string, maxAge: number): string {
	const parts = [
		`${APP_COOKIE}=${encodeURIComponent(token)}`,
		"Path=/api/auth/app",
		"HttpOnly",
		"SameSite=Lax",
		`Max-Age=${maxAge}`,
	];
	if (isHttps(c.req.raw)) parts.push("Secure");
	return parts.join("; ");
}

/** Hands this browser's sign-in to the app: a one-time code in a sekai:// link. */
async function handToApp(c: Context, p: Extract<Principal, { kind: "session" }>) {
	const code = await issueAppCode(readCookie(c.req.raw, APP_COOKIE), p.userId, p.restriction);
	c.header("set-cookie", appCookie(c, "", 0), { append: true });
	c.header("cache-control", "no-store");
	return c.html(
		appPage({
			title: "You're signed in",
			text: "Going back to the Sekai app. If nothing happens, tap the button.",
			open: `sekai://signed-in?code=${encodeURIComponent(code)}`,
		}),
	);
}

function mfaCookie(c: Context, token: string, maxAge: number): string {
	const parts = [
		`${MFA_COOKIE}=${encodeURIComponent(token)}`,
		"Path=/api/auth",
		"HttpOnly",
		"SameSite=Lax",
		`Max-Age=${maxAge}`,
	];
	if (isHttps(c.req.raw)) parts.push("Secure");
	return parts.join("; ");
}

/**
 * The end of every way in: a turned-off account stops here; one with two-factor sign-in gets its second step;
 * everyone else gets a session (owing a step first when they have a temporary password or must set up 2FA).
 */
async function completeSignIn(
	c: Context,
	user: UserRow,
	method: "password" | "passkey" | "setup" | "sso" | "invite",
	opts: { secondFactorDone?: boolean } = {},
): Promise<SignInResult> {
	if (user.disabledAt) throw new HttpError(403, "This account is turned off. Ask an admin.");
	if (!opts.secondFactorDone && (await hasMfa(user.id))) {
		const token = await startChallenge(user.id, { method });
		c.header("set-cookie", mfaCookie(c, token, 600), { append: true });
		return { status: "mfa", ...(await challengeFor(user.id)) };
	}
	const restriction = user.mustChangePassword ? "password" : (await owesMfa(user.id)) ? "mfa" : null;
	const s = await createSession(user.id, method, meta(c), restriction);
	c.header("set-cookie", sessionCookie(c.req.raw, s.secret, s.maxAgeSeconds), { append: true });
	c.header("set-cookie", mfaCookie(c, "", 0), { append: true });
	await touchLogin(user.id);
	log.info(`signed in: ${user.username} (${method}${opts.secondFactorDone ? " + 2FA" : ""}) from ${ipOf(c)}`);
	return { status: "signed_in", user: toUser(user), restriction };
}

/** Passkey ceremonies are bound to the page's origin, which must be this server. */
function pageOrigin(c: Context): string {
	const origin = sameOrigin(c.req.raw);
	if (!origin) throw new HttpError(400, "Open Sekai in the browser to use passkeys");
	if (!passkeysAvailableFor(origin)) {
		throw new HttpError(400, "Passkeys need https (or localhost). Sign in with your password here.");
	}
	return origin;
}

async function userOf(c: Context): Promise<string> {
	const id = await principalUserId(c.get("principal"));
	if (!id) throw new HttpError(409, "Set up an account first");
	return id;
}

function currentSessionId(p: Principal): string | null {
	return p.kind === "session" ? p.sessionId : null;
}

/** Throws 403 "reauth_required" unless you proved it's you recently (API tokens and the root token are fine). */
export function requireRecentAuth(c: Context): void {
	const p = c.get("principal");
	if (p.kind !== "session") return;
	if (p.verifiedAt && Date.now() - p.verifiedAt < REAUTH_MS) return;
	throw new HttpError(403, "Confirm it's you to continue", { code: "reauth_required" });
}

const RegisterVerify = z.object({
	challengeId: z.string(),
	name: z.string().max(80).optional(),
	response: z.custom<RegistrationResponseJSON>((v) => typeof v === "object" && v !== null),
});
const LoginVerify = z.object({
	challengeId: z.string(),
	response: z.custom<AuthenticationResponseJSON>((v) => typeof v === "object" && v !== null),
	/** Proving it's you again (signed in already), not signing in. */
	reauth: z.boolean().optional(),
});

function requireSameOrigin(c: Context, what: string): void {
	if (!sameOrigin(c.req.raw)) throw new HttpError(403, `${what} from Sekai's own page`);
}

// ---------------------------------------------------------------- public: status, setup, signing in

const publicRoutes = new Hono()
	.get("/status", async (c) => {
		const setUp = await isSetUp();
		const p = await authenticate(c.req.raw);
		const allowed = p && !denyReason(p, c.req.raw) ? p : null;
		const userId = allowed ? await principalUserId(allowed) : null;
		const actor = userId ? await actorFor(userId).catch(() => null) : null;
		const status: AuthStatus = {
			setupRequired: !setUp,
			setupCodeRequired: !setUp,
			signedIn: Boolean(allowed && setUp && actor),
			user: userId ? await getUser(userId) : null,
			via: allowed ? (allowed.kind === "session" ? "session" : allowed.kind) : null,
			hasPasskeys: await hasPasskeys(),
			passkeysAvailable: passkeysAvailableFor(requestOrigin(c.req.raw)),
			access: actor
				? {
						userId: actor.userId,
						roleId: actor.roleId,
						roleName: actor.roleName,
						admin: actor.admin,
						permissions: actor.permissions,
						limits: actor.limits,
					}
				: null,
			restriction: allowed?.kind === "session" ? allowed.restriction : null,
			sso: setUp ? await ssoButtons() : [],
			// Reset links go by email to SEKAI_PUBLIC_URL (never to an address a request named).
			passwordReset: setUp && Boolean(config.publicUrl) && (await emailReady()),
		};
		return c.json(status);
	})
	.post("/setup", async (c) => {
		requireSameOrigin(c, "Set up Sekai");
		const ip = ipOf(c);
		checkRate(ip);
		const input = await body(c, SetupInput);
		try {
			const user = await setup(input);
			const row = await getUserRow(user.id);
			if (!row) throw new HttpError(500, "The account wasn't saved");
			return c.json(await completeSignIn(c, row, "setup"));
		} catch (err) {
			if (err instanceof HttpError && err.status === 403) recordFailure(ip);
			throw err;
		}
	})
	.post("/login", async (c) => {
		requireSameOrigin(c, "Sign in");
		const ip = ipOf(c);
		const input = await body(c, LoginInput);
		checkRate(ip, input.username);
		const user = await checkPassword(input.username, input.password);
		if (!user) {
			recordFailure(ip, input.username);
			log.warn(`failed sign-in for "${input.username.slice(0, 60)}" from ${ip}`);
			throw new HttpError(401, "That username and password don't match");
		}
		return c.json(await completeSignIn(c, user, "password"));
	})
	.post("/logout", async (c) => {
		const secret = readSessionCookie(c.req.raw);
		if (secret) await deleteSessionBySecret(secret);
		c.header("set-cookie", clearSessionCookie(c.req.raw));
		for (const old of clearLegacySessionCookie(c.req.raw)) c.header("set-cookie", old, { append: true });
		c.header("set-cookie", mfaCookie(c, "", 0), { append: true });
		return c.json(ok);
	})
	.post("/passkeys/login/options", async (c) => {
		const origin = pageOrigin(c);
		return c.json(await loginOptions(origin));
	})
	.post("/passkeys/login/verify", async (c) => {
		const ip = ipOf(c);
		checkRate(ip);
		const input = await body(c, LoginVerify);
		try {
			const { userId, userVerified } = await finishLogin(input.challengeId, input.response);
			if (input.reauth) {
				// Proving it's you again: the passkey must be the signed-in account's.
				const p = await authenticate(c.req.raw);
				if (p?.kind !== "session" || p.userId !== userId)
					throw new HttpError(403, "That passkey is for another account");
				await markVerified(p.sessionId);
				return c.json(ok);
			}
			const user = await getUserRow(userId);
			if (!user) throw new HttpError(401, "Account not found");
			// A passkey that checked your face, fingerprint or PIN is both steps at once.
			return c.json(await completeSignIn(c, user, "passkey", { secondFactorDone: userVerified }));
		} catch (err) {
			recordFailure(ip);
			throw err;
		}
	})

	// The second step: a code from an authenticator app, email or text, or a recovery code.
	.get("/mfa/challenge", async (c) => {
		// After single sign-on, the page learns what the waiting sign-in can use.
		const ticket = await findChallenge(readCookie(c.req.raw, MFA_COOKIE));
		if (!ticket?.userId) throw new HttpError(401, "That sign-in expired. Start again.");
		return c.json(await challengeFor(ticket.userId));
	})
	.post("/mfa/send", async (c) => {
		requireSameOrigin(c, "Sign in");
		const input = await body(c, MfaSend);
		await sendChallengeCode(readCookie(c.req.raw, MFA_COOKIE), input.method);
		return c.json(ok);
	})
	.post("/mfa/verify", async (c) => {
		requireSameOrigin(c, "Sign in");
		const ip = ipOf(c);
		const input = await body(c, MfaVerify);
		const token = readCookie(c.req.raw, MFA_COOKIE);
		const ticket = await findChallenge(token);
		if (!ticket?.userId) throw new HttpError(401, "That sign-in expired. Start again.");
		checkRate(ip, ticket.userId);
		if (!(await verifyFactor(ticket.userId, input.method, input.code, ticket))) {
			recordFailure(ip, ticket.userId);
			const left = await failTicket(ticket);
			if (left === "used_up") {
				c.header("set-cookie", mfaCookie(c, "", 0), { append: true });
				throw new HttpError(401, "Too many wrong codes. Sign in again.");
			}
			throw new HttpError(
				400,
				input.method === "recovery"
					? "That recovery code isn't right (or was used)."
					: "That code isn't right.",
			);
		}
		const done = await takeChallenge(token);
		const user = done?.userId ? await getUserRow(done.userId) : null;
		if (!user) throw new HttpError(401, "That sign-in expired. Start again.");
		const method = ((done?.data as { method?: string })?.method ?? "password") as "password" | "passkey" | "sso";
		return c.json(await completeSignIn(c, user, method, { secondFactorDone: true }));
	})

	// Single sign-on: off to the provider and back.
	.get("/sso/:id/start", async (c) => {
		const redirect = safeRedirect(c.req.query("redirect"));
		const link = c.req.query("link") === "1" || c.req.query("reauth") === "1";
		let linkUserId: string | null = null;
		if (link) {
			const p = await authenticate(c.req.raw);
			if (p?.kind !== "session") throw new HttpError(401, "Sign in first");
			linkUserId = p.userId;
		}
		const url = await startSso(c.req.param("id"), { publicUrl: publicUrl(c), redirect, linkUserId });
		return c.redirect(url, 302);
	})
	.get("/sso/:id/callback", async (c) => {
		const back = (path: string, error?: string) =>
			c.redirect(error ? `/?sso_error=${encodeURIComponent(error.slice(0, 300))}` : path, 302);
		try {
			const ip = ipOf(c);
			checkRate(ip);
			const result = await finishSso(c.req.param("id"), c.req.query());
			const userId = await accountFor(c.req.param("id"), result.identity, result.linkUserId);
			if (result.linkUserId) {
				// Linked (or proving it's you again) while signed in.
				const p = await authenticate(c.req.raw);
				if (p?.kind === "session" && p.userId === userId) await markVerified(p.sessionId);
				return back(`${result.redirect}${result.redirect.includes("?") ? "&" : "?"}sso_linked=1`);
			}
			const user = await getUserRow(userId);
			if (!user) throw new HttpError(401, "Account not found");
			const signedIn = await completeSignIn(c, user, "sso");
			return back(
				signedIn.status === "mfa" ? `/?mfa=1&next=${encodeURIComponent(result.redirect)}` : result.redirect,
			);
		} catch (err) {
			return back("/", err instanceof Error ? err.message : String(err));
		}
	})

	// The phone apps sign in through the system browser (see app-signin.ts).
	.get("/app/start", async (c) => {
		const p = await authenticate(c.req.raw);
		const signedIn = p?.kind === "session";
		let token: string;
		try {
			token = await startAppSignIn(c.req.query("challenge") ?? "", signedIn);
		} catch (err) {
			const text = err instanceof Error ? err.message : String(err);
			return c.html(appPage({ title: "Couldn't sign in", text }), 400);
		}
		c.header("set-cookie", appCookie(c, token, 15 * 60), { append: true });
		const provider = c.req.query("provider");
		if (signedIn) return c.redirect(APP_FINISH, 302);
		if (provider && /^[A-Za-z0-9_]+$/.test(provider)) {
			return c.redirect(`/api/auth/sso/${provider}/start?redirect=${encodeURIComponent(APP_FINISH)}`, 302);
		}
		return c.redirect(`/?next=${encodeURIComponent(APP_FINISH)}`, 302);
	})
	.get("/app/finish", async (c) => {
		const started = await appSignIn(readCookie(c.req.raw, APP_COOKIE));
		if (!started) {
			return c.html(
				appPage({ title: "That sign-in expired", text: "Go back to the Sekai app and try again." }),
				400,
			);
		}
		const p = await authenticate(c.req.raw);
		if (p?.kind !== "session") return c.redirect(`/?next=${encodeURIComponent(APP_FINISH)}`, 302);
		// Signed in before the app asked: make sure it's the person holding the phone who wants this.
		if (started.hadSession) {
			const user = await getUserRow(p.userId);
			c.header("cache-control", "no-store");
			return c.html(
				appPage({
					title: "Sign in to the app?",
					text: `The Sekai app on this phone wants to sign in as ${user?.name || user?.username || "you"} (@${user?.username ?? ""}).`,
					form: { action: APP_FINISH, button: "Continue", cancel: "Cancel" },
				}),
			);
		}
		return handToApp(c, p);
	})
	.post("/app/finish", async (c) => {
		requireSameOrigin(c, "Signing in to the app");
		const p = await authenticate(c.req.raw);
		if (p?.kind !== "session") return c.redirect(`/?next=${encodeURIComponent(APP_FINISH)}`, 303);
		return handToApp(c, p);
	})
	// In the app's web view: the code and the verifier only the app has, for a session of its own.
	.post("/app/exchange", async (c) => {
		const ip = ipOf(c);
		try {
			checkRate(ip);
			const form = await c.req.parseBody();
			const code = typeof form.code === "string" ? form.code : "";
			const verifier = typeof form.verifier === "string" ? form.verifier : "";
			const { userId, restriction } = await redeemAppCode(code, verifier).catch((err: unknown) => {
				recordFailure(ip);
				throw err;
			});
			const user = await getUserRow(userId);
			if (!user || user.disabledAt) throw new HttpError(403, "This account is turned off. Ask an admin.");
			const s = await createSession(user.id, "app", meta(c), restriction);
			c.header("set-cookie", sessionCookie(c.req.raw, s.secret, s.maxAgeSeconds), { append: true });
			await touchLogin(user.id);
			log.info(`signed in: ${user.username} (the app, through the browser) from ${ip}`);
			return c.redirect("/", 303);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return c.redirect(`/?sso_error=${encodeURIComponent(message.slice(0, 300))}`, 303);
		}
	})

	// Invite and password reset links.
	.get("/ticket/:kind/:token", async (c) => {
		const kind = c.req.param("kind") === "reset" ? "reset" : "invite";
		const t = await findTicket(kind, c.req.param("token"));
		const user = t?.userId ? await getUserRow(t.userId) : null;
		if (!t || !user || user.disabledAt) throw new HttpError(404, "That link expired or was already used.");
		const info: TicketInfo = { kind, name: user.name, username: user.username };
		return c.json(info);
	})
	.post("/ticket/:kind/:token", async (c) => {
		requireSameOrigin(c, "Set your password");
		const ip = ipOf(c);
		checkRate(ip);
		const kind = c.req.param("kind") === "reset" ? "reset" : "invite";
		const input = await body(c, TicketAccept);
		const peek = await findTicket(kind, c.req.param("token"));
		const before = peek?.userId ? await getUserRow(peek.userId) : null;
		if (!peek || !before) {
			recordFailure(ip);
			throw new HttpError(404, "That link expired or was already used.");
		}
		const { checkNewPassword } = await import("./service.ts");
		checkNewPassword(input.password, before);
		const t = await consumeTicket(kind, c.req.param("token"));
		if (!t?.userId) throw new HttpError(404, "That link expired or was already used.");
		await setPassword(t.userId, input.password);
		await revokeOtherSessions(t.userId, null);
		const user = await getUserRow(t.userId);
		if (!user) throw new HttpError(404, "Account not found");
		return c.json(await completeSignIn(c, user, "invite"));
	})
	.post("/forgot", async (c) => {
		requireSameOrigin(c, "Reset your password");
		const ip = ipOf(c);
		checkRate(ip);
		const input = await body(c, ForgotPassword);
		// Always the same answer, whether or not there's an account with that email.
		recordFailure(ip);
		// Links only ever point at SEKAI_PUBLIC_URL (a request's Host could name someone else's site).
		if (config.publicUrl && (await emailReady())) {
			const [u] = await db.select().from(schema.users).where(eq(schema.users.email, input.email));
			if (u && !u.disabledAt) {
				const { sendResetLink } = await import("./users.ts");
				void sendResetLink(u.id, config.publicUrl).catch((err: unknown) =>
					log.warn(`reset email: ${String(err)}`),
				);
			}
		}
		return c.json(ok);
	});

// ---------------------------------------------------------------- signed in: your account

const accountRoutes = new Hono()
	.patch("/account", async (c) => {
		const input = await body(c, AccountPatch);
		// Email and phone are where codes and reset links go: changing them needs you to prove it's you.
		if (input.email !== undefined || input.phone !== undefined) requireRecentAuth(c);
		return c.json(await updateAccount(await userOf(c), input));
	})
	.post("/password", async (c) => {
		const input = await body(c, PasswordChange);
		const p = c.get("principal");
		const userId = await userOf(c);
		await changePassword(userId, input.current, input.next, currentSessionId(p));
		// Done with the temporary password: next, two-factor sign-in if the role requires it.
		if (p.kind === "session" && (await owesMfa(userId))) await setSessionRestriction(p.sessionId, "mfa");
		return c.json(ok);
	})
	.get("/recent", (c) => {
		requireRecentAuth(c);
		return c.json(ok);
	})
	.post("/reauth/send", async (c) => {
		const { method } = await body(c, MfaSend);
		await sendReauthCode(await userOf(c), method);
		return c.json(ok);
	})
	.post("/reauth", async (c) => {
		const p = c.get("principal");
		if (p.kind !== "session") return c.json(ok);
		const ip = ipOf(c);
		checkRate(ip, p.userId);
		const input = await body(c, Reauth);
		const user = await getUserRow(p.userId);
		if (!user) throw new HttpError(401, "Account not found");
		let okay = false;
		if (input.password && user.passwordHash) {
			okay = await Bun.password.verify(input.password, user.passwordHash).catch(() => false);
		} else if (input.method && input.code) {
			okay = await verifyFactor(p.userId, input.method, input.code.replace(/[\s-]/g, ""), null);
		}
		if (!okay) {
			recordFailure(ip, p.userId);
			throw new HttpError(400, "That isn't right. Try again.");
		}
		await markVerified(p.sessionId);
		return c.json(ok);
	})
	.get("/sessions", async (c) => c.json(await listSessions(await userOf(c), currentSessionId(c.get("principal")))))
	.delete("/sessions/:id", async (c) => {
		await revokeSession(await userOf(c), c.req.param("id"));
		return c.json(ok);
	})
	.post("/sessions/revoke-others", async (c) => {
		await revokeOtherSessions(await userOf(c), currentSessionId(c.get("principal")));
		return c.json(ok);
	})

	// Passkeys
	.get("/passkeys", async (c) => c.json(await listPasskeys(await userOf(c))))
	.post("/passkeys/register/options", async (c) => c.json(await registrationOptions(await userOf(c), pageOrigin(c))))
	.post("/passkeys/register/verify", async (c) => {
		const input = await body(c, RegisterVerify);
		const userId = await userOf(c);
		const info = await finishRegistration(
			userId,
			input.challengeId,
			input.response,
			input.name,
			c.req.header("user-agent") ?? null,
		);
		// A passkey meets a role's two-factor requirement.
		const p = c.get("principal");
		if (p.kind === "session" && p.restriction === "mfa" && !(await owesMfa(userId)))
			await setSessionRestriction(p.sessionId, null);
		return c.json(info);
	})
	.patch("/passkeys/:id", async (c) => {
		const input = await body(c, z.object({ name: z.string().max(80) }));
		await renamePasskey(await userOf(c), c.req.param("id"), input.name);
		return c.json(ok);
	})
	.delete("/passkeys/:id", async (c) => {
		requireRecentAuth(c);
		await deletePasskey(await userOf(c), c.req.param("id"));
		return c.json(ok);
	})

	// Two-factor sign-in
	.get("/mfa", async (c) => c.json(await mfaStatus(await userOf(c))))
	.post("/mfa/totp/setup", async (c) => c.json(await startTotp(await userOf(c))))
	.post("/mfa/totp/confirm", async (c) => {
		const input = await body(c, z.object({ code: z.string().trim().min(6).max(10) }));
		const userId = await userOf(c);
		const out = await confirmTotp(userId, input.code.replace(/\s/g, ""));
		await mfaDone(c);
		return c.json(out);
	})
	.post("/mfa/:kind/setup", async (c) => {
		const kind = c.req.param("kind") === "sms" ? "sms" : "email";
		return c.json(await startCodeFactor(await userOf(c), kind));
	})
	.post("/mfa/:kind/confirm", async (c) => {
		const kind = c.req.param("kind") === "sms" ? "sms" : "email";
		const input = await body(c, z.object({ code: z.string().trim().min(6).max(10) }));
		const userId = await userOf(c);
		const out = await confirmCodeFactor(userId, kind, input.code.replace(/\s/g, ""));
		await mfaDone(c);
		return c.json(out);
	})
	.delete("/mfa/:kind", async (c) => {
		requireRecentAuth(c);
		const k = c.req.param("kind");
		if (k !== "totp" && k !== "email" && k !== "sms") throw new HttpError(404, "Not found");
		const userId = await userOf(c);
		const status = await mfaStatus(userId);
		const left = [status.totp, Boolean(status.email), Boolean(status.sms)].filter(Boolean).length;
		if (status.required && left <= 1 && (await listPasskeys(userId)).length === 0) {
			throw new HttpError(
				400,
				"Your role requires two-factor sign-in: set up another method before removing this one.",
			);
		}
		await removeFactor(userId, k);
		return c.json(ok);
	})
	.post("/mfa/recovery-codes", async (c) => {
		requireRecentAuth(c);
		const userId = await userOf(c);
		if (!(await hasMfa(userId))) throw new HttpError(400, "Set up two-factor sign-in first");
		return c.json({ codes: await newRecoveryCodes(userId) });
	})

	// Single sign-on accounts linked to you
	.get("/identities", async (c) => c.json(await listIdentities(await userOf(c))))
	.delete("/identities/:id", async (c) => {
		requireRecentAuth(c);
		const userId = await userOf(c);
		const user = await getUserRow(userId);
		const ids = await listIdentities(userId);
		if (!user?.passwordHash && ids.length <= 1 && (await listPasskeys(userId)).length === 0) {
			throw new HttpError(400, "That's your only way to sign in. Set a password or add a passkey first.");
		}
		await unlinkIdentity(userId, c.req.param("id"));
		return c.json(ok);
	})

	// API tokens
	.get("/tokens", async (c) => c.json(await listTokens(await userOf(c))))
	.post("/tokens", async (c) => {
		requireRecentAuth(c);
		const input = await body(c, ApiTokenCreate);
		return c.json(await createToken(await userOf(c), input.name, input.scope));
	})
	.post("/tokens/desktop", async (c) => {
		const input = await body(c, z.object({ computerName: z.string().trim().min(1).max(60) }));
		return c.json(await rotateBridgeToken(await userOf(c), input.computerName));
	})
	.delete("/tokens/:id", async (c) => {
		await revokeToken(await userOf(c), c.req.param("id"));
		return c.json(ok);
	});

/** A method was set up: a session that owed it is free to go. */
async function mfaDone(c: Context): Promise<void> {
	const p = c.get("principal");
	if (p.kind === "session") {
		await markVerified(p.sessionId);
		if (p.restriction === "mfa") await setSessionRestriction(p.sessionId, null);
	}
}

export const authRoutes = new Hono().route("/", publicRoutes).route("/", accountRoutes);
