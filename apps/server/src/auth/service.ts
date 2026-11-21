import type {
	AccountPatch,
	ApiTokenInfo,
	ApiTokenScope,
	AuthUser,
	CreatedApiToken,
	SessionInfo,
	SessionMethod,
	SessionRestriction,
	SetupInput,
} from "@sekai/shared";
import { and, asc, desc, eq, isNull, ne, or } from "drizzle-orm";
import { config } from "../config.ts";
import { db, schema } from "../db/index.ts";
import { HttpError } from "../lib/errors.ts";
import { newId, randomChars } from "../lib/ids.ts";
import { log } from "../lib/log.ts";
import { forgetPrefs } from "../services/prefs.ts";
import { forgetActors } from "./actor.ts";
import { randomSecret, safeEqual, sha256 } from "./request.ts";

export const SESSION_DAYS = 30;
const SESSION_MS = SESSION_DAYS * 86_400_000;
/** How often a session's "last seen" is written, at most. */
const TOUCH_MS = 5 * 60_000;
const TOKEN_PREFIX = "sek_";
export const ADMIN_ROLE = "role_admin";
export const MEMBER_ROLE = "role_member";

export type Principal =
	| {
			kind: "session";
			userId: string;
			sessionId: string;
			restriction: SessionRestriction | null;
			verifiedAt: number | null;
	  }
	| { kind: "token"; userId: string; tokenId: string; scope: ApiTokenScope }
	| { kind: "root" };

export type UserRow = typeof schema.users.$inferSelect;

export function toUser(u: UserRow): AuthUser {
	return { id: u.id, username: u.username, name: u.name, email: u.email, phone: u.phone, createdAt: u.createdAt };
}

export async function getUserRow(id: string): Promise<UserRow | null> {
	const [u] = await db.select().from(schema.users).where(eq(schema.users.id, id));
	return u ?? null;
}

export async function getUser(id: string): Promise<AuthUser | null> {
	const u = await getUserRow(id);
	return u ? toUser(u) : null;
}

// ---------------------------------------------------------------- first-time setup

let setUp: boolean | undefined;

/** Someone has an account (setup is done). */
export async function isSetUp(): Promise<boolean> {
	if (setUp) return true;
	const [u] = await db.select({ id: schema.users.id }).from(schema.users).limit(1);
	setUp = Boolean(u);
	return setUp;
}

/** The first admin (who the SEKAI_AUTH_TOKEN acts as, and who owns Sekai's own things). */
export async function firstAdmin(): Promise<UserRow | null> {
	const [u] = await db
		.select({ user: schema.users })
		.from(schema.users)
		.innerJoin(schema.roles, eq(schema.roles.id, schema.users.roleId))
		.where(and(eq(schema.roles.builtin, "admin"), isNull(schema.users.disabledAt)))
		.orderBy(asc(schema.users.createdAt))
		.limit(1);
	return u?.user ?? null;
}

// A code for setting up from another device, printed in the server log. Regenerated each start.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
let setupCode: string | null = null;

/** For tests: the current setup code (it's only ever shown in the server's log). */
export function setupCodeForTests(): string | null {
	return setupCode;
}

let setupOrigin = "";
let wrongCodes = 0;

export async function ensureSetupCode(origin: string): Promise<void> {
	if (await isSetUp()) return;
	setupOrigin = origin;
	setupCode = randomChars(CODE_ALPHABET, 6);
	wrongCodes = 0;
	log.info(`first-time setup: open ${origin} and create your account`);
	log.info(`enter this setup code there: ${setupCode}`);
}

export async function hashPassword(password: string): Promise<string> {
	return Bun.password.hash(password, { algorithm: "argon2id" });
}

/** Passwords anyone would try first. */
const COMMON = new Set(
	"password password1 password123 12345678 123456789 1234567890 qwertyuiop qwerty123 iloveyou sunshine princess football baseball welcome welcome1 letmein admin123 administrator abc12345 11111111 00000000 trustno1 dragon123 monkey123 starwars passw0rd superman".split(
		" ",
	),
);

/** Throws when a new password is too easy to guess. */
export function checkNewPassword(password: string, user: { username: string; email?: string | null }): void {
	const p = password.toLowerCase();
	if (COMMON.has(p) || p === user.username.toLowerCase() || (user.email && p === user.email.toLowerCase())) {
		throw new HttpError(400, "That password is too easy to guess. Pick another one.");
	}
	if (/^(.)\1+$/.test(password)) throw new HttpError(400, "That password is too easy to guess. Pick another one.");
}

/** Creates the first account (an admin). From another device, the setup code from the server's log is needed. */
export async function setup(input: SetupInput & { code?: string }): Promise<AuthUser> {
	if (await isSetUp()) throw new HttpError(409, "This server is already set up. Sign in instead.");
	if (!setupCode) throw new HttpError(403, "Restart the server to get a setup code");
	if (!input.code || !safeEqual(input.code.replace(/[\s-]/g, "").toUpperCase(), setupCode)) {
		// Guessing from many addresses at once: after a few wrong codes, there's a new one (in the log).
		if (++wrongCodes >= 20) await ensureSetupCode(setupOrigin);
		throw new HttpError(403, "That setup code isn't right. It's in the server's log.");
	}
	checkNewPassword(input.password, input);
	const now = Date.now();
	const row: UserRow = {
		id: newId("usr"),
		username: input.username,
		name: input.name,
		email: input.email ?? null,
		phone: null,
		roleId: ADMIN_ROLE,
		passwordHash: await hashPassword(input.password),
		passwordChangedAt: now,
		mustChangePassword: false,
		requirePasskey: false,
		disabledAt: null,
		lastLoginAt: now,
		createdAt: now,
		updatedAt: now,
	};
	await db.insert(schema.users).values(row);
	setUp = true;
	setupCode = null;
	log.info(`first account created: ${row.username} (admin)`);
	return toUser(row);
}

// ---------------------------------------------------------------- passwords and accounts

// Dummy hash so a wrong username takes as long as a wrong password.
const DUMMY_HASH = hashPassword(randomSecret());

/**
 * Checks a username (or email) and password. Returns the account, or null when they don't match (the same answer,
 * and the same time taken, whether or not the account exists).
 */
export async function checkPassword(login: string, password: string): Promise<UserRow | null> {
	const name = login.trim().toLowerCase();
	const [u] = await db
		.select()
		.from(schema.users)
		.where(or(eq(schema.users.username, name), eq(schema.users.email, name)))
		.limit(1);
	if (!u?.passwordHash) {
		await Bun.password.verify(password, await DUMMY_HASH).catch(() => false);
		return null;
	}
	return (await Bun.password.verify(password, u.passwordHash).catch(() => false)) ? u : null;
}

export async function updateAccount(userId: string, patch: AccountPatch): Promise<AuthUser> {
	const set: Partial<UserRow> = { updatedAt: Date.now() };
	if (patch.username !== undefined) set.username = patch.username;
	if (patch.name !== undefined) set.name = patch.name;
	if (patch.email !== undefined) set.email = patch.email ?? null;
	if (patch.phone !== undefined) set.phone = patch.phone ?? null;
	try {
		const [row] = await db.update(schema.users).set(set).where(eq(schema.users.id, userId)).returning();
		if (!row) throw new HttpError(404, "Account not found");
		forgetPrefs(userId);
		return toUser(row);
	} catch (err) {
		if (/users_username_idx/.test(String(err))) throw new HttpError(409, "That username is taken");
		if (/users_email_idx/.test(String(err))) throw new HttpError(409, "Another account uses that email");
		throw err;
	}
}

/**
 * Changes the password and signs out every other session. The current one is needed, except when choosing your own
 * after a temporary password (the session that's asked to do it proves who you are).
 */
export async function changePassword(
	userId: string,
	current: string,
	next: string,
	keepSessionId: string | null,
): Promise<void> {
	const u = await getUserRow(userId);
	if (!u) throw new HttpError(404, "Account not found");
	const skipCurrent = u.mustChangePassword || !u.passwordHash;
	if (!skipCurrent && !(u.passwordHash && (await Bun.password.verify(current, u.passwordHash).catch(() => false)))) {
		throw new HttpError(400, "Your current password isn't right");
	}
	checkNewPassword(next, u);
	await setPassword(userId, next);
	await revokeOtherSessions(userId, keepSessionId);
	if (keepSessionId) await setSessionRestriction(keepSessionId, null);
}

/** Sets a password (and clears "must change it"). */
export async function setPassword(userId: string, password: string, mustChange = false): Promise<void> {
	const now = Date.now();
	await db
		.update(schema.users)
		.set({
			passwordHash: await hashPassword(password),
			passwordChangedAt: now,
			mustChangePassword: mustChange,
			updatedAt: now,
		})
		.where(eq(schema.users.id, userId));
}

export async function touchLogin(userId: string): Promise<void> {
	await db.update(schema.users).set({ lastLoginAt: Date.now() }).where(eq(schema.users.id, userId));
}

// ---------------------------------------------------------------- sessions

/** Resolved principals, so each request doesn't hit the database. Cleared whenever access is revoked. */
const principalCache = new Map<string, { principal: Principal; until: number }>();
const CACHE_MS = 30_000;

function cached(key: string): Principal | null {
	const hit = principalCache.get(key);
	if (!hit) return null;
	if (hit.until < Date.now()) {
		principalCache.delete(key);
		return null;
	}
	return hit.principal;
}

function remember(key: string, principal: Principal): Principal {
	if (principalCache.size > 2000) principalCache.clear();
	principalCache.set(key, { principal, until: Date.now() + CACHE_MS });
	return principal;
}

export function forgetCachedPrincipals(): void {
	principalCache.clear();
	forgetActors();
}

export async function createSession(
	userId: string,
	method: SessionMethod,
	meta: { userAgent: string | null; ip: string | null },
	restriction: SessionRestriction | null = null,
): Promise<{ secret: string; id: string; maxAgeSeconds: number }> {
	const secret = randomSecret();
	const now = Date.now();
	const id = newId("ses");
	await db.insert(schema.sessions).values({
		id,
		tokenHash: sha256(secret),
		userId,
		method,
		restriction,
		verifiedAt: now,
		userAgent: meta.userAgent?.slice(0, 400) ?? null,
		ip: meta.ip,
		createdAt: now,
		lastSeenAt: now,
		expiresAt: now + SESSION_MS,
	});
	return { secret, id, maxAgeSeconds: SESSION_MS / 1000 };
}

export async function sessionFromSecret(secret: string): Promise<Principal | null> {
	if (secret.length > 200) return null;
	const hash = sha256(secret);
	const hit = cached(`s:${hash}`);
	if (hit) return hit;
	const [row] = await db
		.select({ s: schema.sessions, disabledAt: schema.users.disabledAt })
		.from(schema.sessions)
		.innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
		.where(eq(schema.sessions.tokenHash, hash));
	const now = Date.now();
	if (!row) return null;
	const s = row.s;
	if (s.expiresAt < now || row.disabledAt) {
		await db.delete(schema.sessions).where(eq(schema.sessions.id, s.id));
		return null;
	}
	if (now - s.lastSeenAt > TOUCH_MS) {
		await db
			.update(schema.sessions)
			.set({ lastSeenAt: now, expiresAt: now + SESSION_MS })
			.where(eq(schema.sessions.id, s.id));
	}
	return remember(`s:${hash}`, {
		kind: "session",
		userId: s.userId,
		sessionId: s.id,
		restriction: s.restriction,
		verifiedAt: s.verifiedAt,
	});
}

export async function setSessionRestriction(sessionId: string, restriction: SessionRestriction | null): Promise<void> {
	await db.update(schema.sessions).set({ restriction }).where(eq(schema.sessions.id, sessionId));
	forgetCachedPrincipals();
}

/** You proved it's you again (sensitive changes are allowed for a while). */
export async function markVerified(sessionId: string): Promise<void> {
	await db.update(schema.sessions).set({ verifiedAt: Date.now() }).where(eq(schema.sessions.id, sessionId));
	forgetCachedPrincipals();
}

export async function deleteSessionBySecret(secret: string): Promise<void> {
	await db.delete(schema.sessions).where(eq(schema.sessions.tokenHash, sha256(secret)));
	forgetCachedPrincipals();
}

export async function listSessions(userId: string, currentId: string | null): Promise<SessionInfo[]> {
	const rows = await db
		.select()
		.from(schema.sessions)
		.where(eq(schema.sessions.userId, userId))
		.orderBy(desc(schema.sessions.lastSeenAt));
	const now = Date.now();
	return rows
		.filter((s) => s.expiresAt > now)
		.map((s) => ({
			id: s.id,
			method: s.method,
			userAgent: s.userAgent,
			ip: s.ip,
			createdAt: s.createdAt,
			lastSeenAt: s.lastSeenAt,
			expiresAt: s.expiresAt,
			current: s.id === currentId,
		}));
}

export async function revokeSession(userId: string, id: string): Promise<void> {
	await db.delete(schema.sessions).where(and(eq(schema.sessions.userId, userId), eq(schema.sessions.id, id)));
	forgetCachedPrincipals();
}

export async function revokeOtherSessions(userId: string, keepId: string | null): Promise<void> {
	await db
		.delete(schema.sessions)
		.where(
			keepId
				? and(eq(schema.sessions.userId, userId), ne(schema.sessions.id, keepId))
				: eq(schema.sessions.userId, userId),
		);
	forgetCachedPrincipals();
}

/** Signs someone out everywhere: sessions and API tokens (an admin turned the account off, or reset it). */
export async function revokeEverything(userId: string, opts: { tokens: boolean }): Promise<void> {
	await db.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
	if (opts.tokens) await db.delete(schema.apiTokens).where(eq(schema.apiTokens.userId, userId));
	forgetCachedPrincipals();
}

// ---------------------------------------------------------------- API tokens

function toToken(t: typeof schema.apiTokens.$inferSelect): ApiTokenInfo {
	return {
		id: t.id,
		name: t.name,
		scope: t.scope,
		prefix: t.prefix,
		createdAt: t.createdAt,
		lastUsedAt: t.lastUsedAt,
	};
}

export async function listTokens(userId: string): Promise<ApiTokenInfo[]> {
	const rows = await db
		.select()
		.from(schema.apiTokens)
		.where(eq(schema.apiTokens.userId, userId))
		.orderBy(desc(schema.apiTokens.createdAt));
	return rows.map(toToken);
}

export async function createToken(userId: string, name: string, scope: ApiTokenScope): Promise<CreatedApiToken> {
	const token = `${TOKEN_PREFIX}${randomSecret()}`;
	const row = {
		id: newId("tok"),
		userId,
		name,
		scope,
		tokenHash: sha256(token),
		prefix: token.slice(0, TOKEN_PREFIX.length + 6),
		createdAt: Date.now(),
		lastUsedAt: null,
	};
	await db.insert(schema.apiTokens).values(row);
	return { ...toToken(row), token };
}

/** A desktop app's token: one per computer, replaced whenever the app asks again. */
export async function rotateBridgeToken(userId: string, computerName: string): Promise<CreatedApiToken> {
	const name = `Desktop app on ${computerName}`.slice(0, 80);
	await db
		.delete(schema.apiTokens)
		.where(
			and(
				eq(schema.apiTokens.userId, userId),
				eq(schema.apiTokens.scope, "bridge"),
				eq(schema.apiTokens.name, name),
			),
		);
	forgetCachedPrincipals();
	return createToken(userId, name, "bridge");
}

export async function revokeToken(userId: string, id: string): Promise<void> {
	await db.delete(schema.apiTokens).where(and(eq(schema.apiTokens.userId, userId), eq(schema.apiTokens.id, id)));
	forgetCachedPrincipals();
}

const touchedTokens = new Map<string, number>();

export async function principalFromToken(token: string): Promise<Principal | null> {
	if (config.authToken && safeEqual(token, config.authToken)) return { kind: "root" };
	// fsh_: tokens made before the rename (Feesh → Sekai) keep working.
	if ((!token.startsWith(TOKEN_PREFIX) && !token.startsWith("fsh_")) || token.length > 200) return null;
	const hash = sha256(token);
	const hit = cached(`t:${hash}`);
	if (hit) return hit;
	const [row] = await db
		.select({ t: schema.apiTokens, disabledAt: schema.users.disabledAt })
		.from(schema.apiTokens)
		.innerJoin(schema.users, eq(schema.users.id, schema.apiTokens.userId))
		.where(eq(schema.apiTokens.tokenHash, hash));
	if (!row || row.disabledAt) return null;
	const t = row.t;
	const now = Date.now();
	if (now - (touchedTokens.get(t.id) ?? 0) > TOUCH_MS) {
		touchedTokens.set(t.id, now);
		await db.update(schema.apiTokens).set({ lastUsedAt: now }).where(eq(schema.apiTokens.id, t.id));
	}
	return remember(`t:${hash}`, { kind: "token", userId: t.userId, tokenId: t.id, scope: t.scope });
}

/** The account a principal acts for. The root token acts for the first admin. */
export async function principalUserId(p: Principal): Promise<string | null> {
	if (p.kind !== "root") return p.userId;
	return (await firstAdmin())?.id ?? null;
}

/** For tests. */
export function resetAuthCaches(): void {
	setUp = undefined;
	principalCache.clear();
	touchedTokens.clear();
	forgetActors();
}
