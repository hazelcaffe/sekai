import type { MfaMethod, MfaStatus, TotpSetup } from "@sekai/shared";
import { and, eq, isNotNull, isNull, lt, or } from "drizzle-orm";
import QRCode from "qrcode";
import { db, schema } from "../db/index.ts";
import { badRequest, HttpError } from "../lib/errors.ts";
import { newId } from "../lib/ids.ts";
import { seal, unseal } from "../lib/secrets.ts";
import { emailReady, maskEmail, maskPhone, sendEmail, sendSms, smsReady } from "../services/messaging.ts";
import { safeEqual, sha256 } from "./request.ts";
import {
	checkTicketCode,
	consumeTicket,
	createTicket,
	deleteUserTickets,
	findTicket,
	setTicketCode,
} from "./tickets.ts";
import { newTotpSecret, totpUri, verifyTotp } from "./totp.ts";

type FactorRow = typeof schema.mfaFactors.$inferSelect;

async function factors(userId: string, confirmedOnly = true): Promise<FactorRow[]> {
	return db
		.select()
		.from(schema.mfaFactors)
		.where(
			confirmedOnly
				? and(eq(schema.mfaFactors.userId, userId), isNotNull(schema.mfaFactors.confirmedAt))
				: eq(schema.mfaFactors.userId, userId),
		);
}

async function user(userId: string) {
	const [u] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
	if (!u) throw new HttpError(404, "Account not found");
	return u;
}

async function roleRequiresMfa(roleId: string): Promise<boolean> {
	const [r] = await db.select({ x: schema.roles.requireMfa }).from(schema.roles).where(eq(schema.roles.id, roleId));
	return Boolean(r?.x);
}

/** Whether someone signs in with a second step (they set up a method). */
export async function hasMfa(userId: string): Promise<boolean> {
	return (await factors(userId)).length > 0;
}

/** Whether their role requires two-factor sign-in and they haven't set it up (passkeys count). */
export async function owesMfa(userId: string): Promise<boolean> {
	const u = await user(userId);
	if (!(await roleRequiresMfa(u.roleId))) return false;
	if (await hasMfa(userId)) return false;
	const [p] = await db
		.select({ id: schema.passkeys.id })
		.from(schema.passkeys)
		.where(eq(schema.passkeys.userId, userId))
		.limit(1);
	return !p;
}

export async function mfaStatus(userId: string): Promise<MfaStatus> {
	const u = await user(userId);
	const list = await factors(userId);
	const codes = await db
		.select({ id: schema.recoveryCodes.id })
		.from(schema.recoveryCodes)
		.where(and(eq(schema.recoveryCodes.userId, userId), isNull(schema.recoveryCodes.usedAt)));
	const email = list.find((f) => f.kind === "email");
	const sms = list.find((f) => f.kind === "sms");
	return {
		totp: list.some((f) => f.kind === "totp"),
		email: email?.target ? maskEmail(email.target) : null,
		sms: sms?.target ? maskPhone(sms.target) : null,
		recoveryCodesLeft: codes.length,
		required: await roleRequiresMfa(u.roleId),
		emailAvailable: await emailReady(),
		smsAvailable: await smsReady(),
	};
}

// ---------------------------------------------------------------- recovery codes

const CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

/** Ten new one-time codes (the old ones stop working). Shown once. */
export async function newRecoveryCodes(userId: string): Promise<string[]> {
	await db.delete(schema.recoveryCodes).where(eq(schema.recoveryCodes.userId, userId));
	const codes = Array.from({ length: 10 }, () => {
		const b = crypto.getRandomValues(new Uint8Array(10));
		const c = Array.from(b, (x) => CODE_ALPHABET[x % CODE_ALPHABET.length]).join("");
		return `${c.slice(0, 5)}-${c.slice(5)}`;
	});
	const now = Date.now();
	await db.insert(schema.recoveryCodes).values(
		codes.map((c) => ({
			id: newId("rc", 16),
			userId,
			codeHash: sha256(c.replace("-", "")),
			usedAt: null,
			createdAt: now,
		})),
	);
	return codes;
}

async function useRecoveryCode(userId: string, code: string): Promise<boolean> {
	const hash = sha256(code.toLowerCase().replace(/[\s-]/g, ""));
	const rows = await db
		.select()
		.from(schema.recoveryCodes)
		.where(and(eq(schema.recoveryCodes.userId, userId), isNull(schema.recoveryCodes.usedAt)));
	const hit = rows.find((r) => safeEqual(r.codeHash, hash));
	if (!hit) return false;
	const used = await db
		.update(schema.recoveryCodes)
		.set({ usedAt: Date.now() })
		.where(and(eq(schema.recoveryCodes.id, hit.id), isNull(schema.recoveryCodes.usedAt)))
		.returning();
	return used.length > 0;
}

/** After the first method is set up: recovery codes, so losing it doesn't lock you out. */
async function firstFactorCodes(userId: string): Promise<string[] | undefined> {
	const [existing] = await db
		.select({ id: schema.recoveryCodes.id })
		.from(schema.recoveryCodes)
		.where(eq(schema.recoveryCodes.userId, userId))
		.limit(1);
	return existing ? undefined : newRecoveryCodes(userId);
}

// ---------------------------------------------------------------- setting up an authenticator app

export async function startTotp(userId: string): Promise<TotpSetup> {
	const u = await user(userId);
	await db
		.delete(schema.mfaFactors)
		.where(
			and(
				eq(schema.mfaFactors.userId, userId),
				eq(schema.mfaFactors.kind, "totp"),
				isNull(schema.mfaFactors.confirmedAt),
			),
		);
	const secret = newTotpSecret();
	await db.insert(schema.mfaFactors).values({
		id: newId("mfa", 16),
		userId,
		kind: "totp",
		secret: seal(secret),
		target: null,
		confirmedAt: null,
		lastStep: null,
		createdAt: Date.now(),
		lastUsedAt: null,
	});
	const uri = totpUri(secret, u.email ?? u.username);
	const qrSvg = await QRCode.toString(uri, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
	return { secret: secret.replace(/(.{4})/g, "$1 ").trim(), uri, qrSvg };
}

export async function confirmTotp(userId: string, code: string): Promise<{ recoveryCodes?: string[] }> {
	const all = await factors(userId, false);
	const pending = all.filter((f) => f.kind === "totp" && !f.confirmedAt).at(-1);
	if (!pending?.secret) throw badRequest("Start setting up the authenticator app first");
	const step = await verifyTotp(unseal(pending.secret), code, null);
	if (step === null) throw badRequest("That code isn't right. Check your device's time, and try the newest code.");
	// One authenticator app at a time.
	await db
		.delete(schema.mfaFactors)
		.where(
			and(
				eq(schema.mfaFactors.userId, userId),
				eq(schema.mfaFactors.kind, "totp"),
				isNotNull(schema.mfaFactors.confirmedAt),
			),
		);
	await db
		.update(schema.mfaFactors)
		.set({ confirmedAt: Date.now(), lastStep: step })
		.where(eq(schema.mfaFactors.id, pending.id));
	return { recoveryCodes: await firstFactorCodes(userId) };
}

// ---------------------------------------------------------------- codes by email or text

/** At most this many codes an hour per account, and one every 30 seconds. */
const SEND_LIMIT = 6;
const SEND_GAP_MS = 30_000;
const sends = new Map<string, number[]>();

function checkSendRate(userId: string): void {
	const now = Date.now();
	const list = (sends.get(userId) ?? []).filter((t) => now - t < 3_600_000);
	sends.set(userId, list);
	const last = list.at(-1);
	if (last && now - last < SEND_GAP_MS) {
		throw new HttpError(
			429,
			`Wait ${Math.ceil((SEND_GAP_MS - (now - last)) / 1000)} seconds before asking for another code.`,
		);
	}
	if (list.length >= SEND_LIMIT)
		throw new HttpError(429, "That's a lot of codes. Wait an hour, or use another method.");
	list.push(now);
}

async function deliver(kind: "email" | "sms", target: string, code: string, purpose: string): Promise<void> {
	if (kind === "email") {
		await sendEmail(
			target,
			`${code} is your Sekai code`,
			`Your Sekai code is ${code}. It's for ${purpose} and works for 10 minutes.\n\nIf you didn't ask for it, someone may know your password: change it.`,
		);
	} else {
		await sendSms(target, `${code} is your Sekai code (${purpose}). It works for 10 minutes. Don't share it.`);
	}
}

/** Starts adding email or text codes: sends a code to your account's email or phone. */
export async function startCodeFactor(userId: string, kind: "email" | "sms"): Promise<{ hint: string }> {
	const u = await user(userId);
	const target = kind === "email" ? u.email : u.phone;
	if (!target) {
		throw badRequest(
			kind === "email" ? "Add an email to your account first." : "Add a phone number to your account first.",
		);
	}
	if (kind === "email" ? !(await emailReady()) : !(await smsReady())) {
		throw badRequest(
			kind === "email" ? "Email isn't set up on this server." : "Text messages aren't set up on this server.",
		);
	}
	checkSendRate(userId);
	await deleteUserTickets(userId, "code");
	const t = await createTicket("code", { userId, data: { kind, target, purpose: "setup" } });
	const code = await setTicketCode(t.id, { kind, target, purpose: "setup" });
	await deliver(kind, target, code, "setting up two-factor sign-in");
	return { hint: kind === "email" ? maskEmail(target) : maskPhone(target) };
}

export async function confirmCodeFactor(
	userId: string,
	kind: "email" | "sms",
	code: string,
): Promise<{ recoveryCodes?: string[] }> {
	const [row] = await db
		.select()
		.from(schema.authTickets)
		.where(and(eq(schema.authTickets.userId, userId), eq(schema.authTickets.kind, "code")));
	if (!row || row.expiresAt < Date.now() || (row.data as { kind?: string }).kind !== kind) {
		throw badRequest("That code expired. Send a new one.");
	}
	const result = await checkTicketCode(row, code);
	if (result === "used_up") throw badRequest("Too many wrong codes. Send a new one.");
	if (result === "wrong") throw badRequest("That code isn't right.");
	await db.delete(schema.authTickets).where(eq(schema.authTickets.id, row.id));
	await db
		.delete(schema.mfaFactors)
		.where(and(eq(schema.mfaFactors.userId, userId), eq(schema.mfaFactors.kind, kind)));
	const now = Date.now();
	await db.insert(schema.mfaFactors).values({
		id: newId("mfa", 16),
		userId,
		kind,
		secret: null,
		target: (row.data as { target?: string }).target ?? null,
		confirmedAt: now,
		lastStep: null,
		createdAt: now,
		lastUsedAt: null,
	});
	return { recoveryCodes: await firstFactorCodes(userId) };
}

export async function removeFactor(userId: string, kind: "totp" | "email" | "sms"): Promise<void> {
	await db
		.delete(schema.mfaFactors)
		.where(and(eq(schema.mfaFactors.userId, userId), eq(schema.mfaFactors.kind, kind)));
	// No methods left: the recovery codes go too.
	if (!(await hasMfa(userId))) await db.delete(schema.recoveryCodes).where(eq(schema.recoveryCodes.userId, userId));
}

// ---------------------------------------------------------------- the second step of signing in

/** What someone can use for their second step, and where codes would go (partly hidden). */
export async function challengeFor(
	userId: string,
): Promise<{ methods: MfaMethod[]; hints: { email?: string; sms?: string } }> {
	const list = await factors(userId);
	const methods: MfaMethod[] = [];
	const hints: { email?: string; sms?: string } = {};
	if (list.some((f) => f.kind === "totp")) methods.push("totp");
	const email = list.find((f) => f.kind === "email" && f.target);
	const sms = list.find((f) => f.kind === "sms" && f.target);
	if (email?.target && (await emailReady())) {
		methods.push("email");
		hints.email = maskEmail(email.target);
	}
	if (sms?.target && (await smsReady())) {
		methods.push("sms");
		hints.sms = maskPhone(sms.target);
	}
	methods.push("recovery");
	return { methods, hints };
}

/** The pending sign-in (held in a cookie while you enter your code). */
export async function startChallenge(userId: string, data: Record<string, unknown>): Promise<string> {
	await deleteUserTickets(userId, "mfa");
	const t = await createTicket("mfa", { userId, data });
	return t.token;
}

export const findChallenge = (token: string | null) => findTicket("mfa", token);
export const takeChallenge = (token: string | null) => consumeTicket("mfa", token);

/** Sends a sign-in code by email or text, kept on the pending sign-in. */
export async function sendChallengeCode(ticketToken: string | null, method: "email" | "sms"): Promise<void> {
	const t = await findChallenge(ticketToken);
	if (!t?.userId) throw new HttpError(401, "That sign-in expired. Start again.");
	const f = (await factors(t.userId)).find((x) => x.kind === method && x.target);
	if (!f?.target) throw badRequest("That method isn't set up for this account");
	checkSendRate(t.userId);
	const code = await setTicketCode(t.id, { ...t.data, sent: method });
	await deliver(method, f.target, code, "signing in");
}

/** Proving it's you again by email or text: a code to the method you set up. */
export async function sendReauthCode(userId: string, method: "email" | "sms"): Promise<void> {
	const f = (await factors(userId)).find((x) => x.kind === method && x.target);
	if (!f?.target) throw badRequest("That method isn't set up for your account");
	checkSendRate(userId);
	await deleteUserTickets(userId, "code");
	const t = await createTicket("code", { userId, data: { kind: method, purpose: "reauth" } });
	const code = await setTicketCode(t.id, { kind: method, purpose: "reauth", sent: method });
	await deliver(method, f.target, code, "confirming it's you");
}

/** The code from sendReauthCode (one use, five tries). */
async function checkReauthCode(userId: string, method: "email" | "sms", code: string): Promise<boolean> {
	const [row] = await db
		.select()
		.from(schema.authTickets)
		.where(and(eq(schema.authTickets.userId, userId), eq(schema.authTickets.kind, "code")));
	const data = (row?.data ?? {}) as { purpose?: string; sent?: string };
	if (!row || row.expiresAt < Date.now() || data.purpose !== "reauth" || data.sent !== method) return false;
	if ((await checkTicketCode(row, code)) !== "ok") return false;
	await db.delete(schema.authTickets).where(eq(schema.authTickets.id, row.id));
	return true;
}

/**
 * Checks a second-step code (or a recovery code). The pending sign-in allows five wrong tries in total; then it
 * ends and the person signs in again from the start.
 */
export async function verifyFactor(
	userId: string,
	method: MfaMethod,
	code: string,
	ticket: typeof schema.authTickets.$inferSelect | null,
): Promise<boolean> {
	const list = await factors(userId);
	if (method === "recovery") return useRecoveryCode(userId, code);
	if (method === "totp") {
		const f = list.find((x) => x.kind === "totp");
		if (!f?.secret) return false;
		const step = await verifyTotp(unseal(f.secret), code, f.lastStep);
		if (step === null) return false;
		// Only advance: two requests at once can't both use the same code.
		const updated = await db
			.update(schema.mfaFactors)
			.set({ lastStep: step, lastUsedAt: Date.now() })
			.where(
				and(
					eq(schema.mfaFactors.id, f.id),
					or(isNull(schema.mfaFactors.lastStep), lt(schema.mfaFactors.lastStep, step)),
				),
			)
			.returning({ id: schema.mfaFactors.id });
		return updated.length > 0;
	}
	// No sign-in waiting: proving it's you again while signed in.
	if (!ticket) return checkReauthCode(userId, method, code);
	if ((ticket.data as { sent?: string }).sent !== method) return false;
	return (await checkTicketCode(ticket, code)) === "ok";
}
