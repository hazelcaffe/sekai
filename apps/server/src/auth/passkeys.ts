import type { PasskeyInfo } from "@sekai/shared";
import {
	type AuthenticationResponseJSON,
	generateAuthenticationOptions,
	generateRegistrationOptions,
	type RegistrationResponseJSON,
	verifyAuthenticationResponse,
	verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import { and, desc, eq } from "drizzle-orm";
import { APP_NAME } from "../config.ts";
import { db, schema } from "../db/index.ts";
import { HttpError } from "../lib/errors.ts";
import { randomSecret } from "./request.ts";
import { getUserRow } from "./service.ts";

/** Pending ceremonies, keyed by an id the browser sends back. They expire after five minutes. */
const challenges = new Map<
	string,
	{ challenge: string; origin: string; rpId: string; kind: "register" | "login"; userId?: string; until: number }
>();
const CHALLENGE_MS = 5 * 60_000;

function keepChallenge(entry: Omit<Parameters<typeof challenges.set>[1], "until">): string {
	const now = Date.now();
	for (const [k, v] of challenges) if (v.until < now) challenges.delete(k);
	const id = randomSecret(24);
	challenges.set(id, { ...entry, until: now + CHALLENGE_MS });
	return id;
}

function takeChallenge(id: string, kind: "register" | "login") {
	const c = challenges.get(id);
	challenges.delete(id);
	if (!c || c.kind !== kind || c.until < Date.now()) {
		throw new HttpError(400, "That took too long or was already used. Try again.");
	}
	return c;
}

/** Friendly names for common passkey providers, by authenticator AAGUID. */
const PROVIDERS: Record<string, string> = {
	"fbfc3007-154e-4ecc-8c0b-6e020557d7bd": "iCloud Keychain",
	"ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4": "Google Password Manager",
	"adce0002-35bc-c60a-648b-0b25f1f05503": "Chrome on Mac",
	"08987058-cadc-4b81-b6e1-30de50dcbe96": "Windows Hello",
	"9ddd1817-af5a-4672-a2b9-3e3dd95000a9": "Windows Hello",
	"6028b017-b1d4-4c02-b4b3-afcdafc96bb2": "Windows Hello",
	"bada5566-a7aa-401f-bd96-45619a55120d": "1Password",
	"d548826e-79b4-db40-a3d8-11116f7e8349": "Bitwarden",
	"53414d53-554e-4700-0000-000000000000": "Samsung Pass",
};

function defaultName(aaguid: string | null, userAgent: string | null): string {
	if (aaguid && PROVIDERS[aaguid]) return PROVIDERS[aaguid];
	const ua = userAgent ?? "";
	const os = /iPhone|iPad/.test(ua)
		? "iPhone or iPad"
		: /Android/.test(ua)
			? "Android"
			: /Mac OS X/.test(ua)
				? "Mac"
				: /Windows/.test(ua)
					? "Windows"
					: /Linux/.test(ua)
						? "Linux"
						: null;
	return os ? `Passkey on ${os}` : "Passkey";
}

function toInfo(p: typeof schema.passkeys.$inferSelect): PasskeyInfo {
	return {
		id: p.id,
		name: p.name,
		backedUp: p.backedUp,
		rpId: p.rpId,
		createdAt: p.createdAt,
		lastUsedAt: p.lastUsedAt,
	};
}

export async function listPasskeys(userId: string): Promise<PasskeyInfo[]> {
	const rows = await db
		.select()
		.from(schema.passkeys)
		.where(eq(schema.passkeys.userId, userId))
		.orderBy(desc(schema.passkeys.createdAt));
	return rows.map(toInfo);
}

/** Someone here has a passkey (so the sign-in page offers it). */
export async function hasPasskeys(): Promise<boolean> {
	const [row] = await db.select({ id: schema.passkeys.id }).from(schema.passkeys).limit(1);
	return Boolean(row);
}

export async function registrationOptions(userId: string, origin: string) {
	const owner = await getUserRow(userId);
	if (!owner) throw new HttpError(404, "Account not found");
	const rpId = new URL(origin).hostname;
	const existing = await db.select().from(schema.passkeys).where(eq(schema.passkeys.userId, userId));
	const options = await generateRegistrationOptions({
		rpName: APP_NAME,
		rpID: rpId,
		userName: owner.username,
		userDisplayName: owner.name,
		userID: new TextEncoder().encode(owner.id),
		attestationType: "none",
		excludeCredentials: existing
			.filter((p) => p.rpId === rpId)
			.map((p) => ({ id: p.id, transports: p.transports })),
		authenticatorSelection: { residentKey: "required", userVerification: "required" },
	});
	const challengeId = keepChallenge({ challenge: options.challenge, origin, rpId, kind: "register", userId });
	return { challengeId, options };
}

export async function finishRegistration(
	userId: string,
	challengeId: string,
	response: RegistrationResponseJSON,
	name: string | undefined,
	userAgent: string | null,
): Promise<PasskeyInfo> {
	const c = takeChallenge(challengeId, "register");
	if (c.userId !== userId) throw new HttpError(400, "That passkey request belongs to another session");
	const result = await verifyRegistrationResponse({
		response,
		expectedChallenge: c.challenge,
		expectedOrigin: c.origin,
		expectedRPID: c.rpId,
		requireUserVerification: false,
	}).catch((err: unknown) => {
		throw new HttpError(400, `Couldn't add the passkey: ${err instanceof Error ? err.message : String(err)}`);
	});
	if (!result.verified) throw new HttpError(400, "Couldn't verify the passkey");
	const info = result.registrationInfo;
	const row = {
		id: info.credential.id,
		userId,
		name: name?.trim().slice(0, 80) || defaultName(info.aaguid, userAgent),
		publicKey: isoBase64URL.fromBuffer(info.credential.publicKey),
		counter: info.credential.counter,
		transports: info.credential.transports ?? [],
		aaguid: info.aaguid,
		backedUp: info.credentialBackedUp,
		rpId: c.rpId,
		createdAt: Date.now(),
		lastUsedAt: null,
	};
	await db.insert(schema.passkeys).values(row).onConflictDoNothing();
	return toInfo(row);
}

export async function renamePasskey(userId: string, id: string, name: string): Promise<void> {
	await db
		.update(schema.passkeys)
		.set({ name: name.trim().slice(0, 80) || "Passkey" })
		.where(and(eq(schema.passkeys.userId, userId), eq(schema.passkeys.id, id)));
}

export async function deletePasskey(userId: string, id: string): Promise<void> {
	await db.delete(schema.passkeys).where(and(eq(schema.passkeys.userId, userId), eq(schema.passkeys.id, id)));
}

/** Options for signing in with any passkey saved for this site (no username needed). */
export async function loginOptions(origin: string) {
	const rpId = new URL(origin).hostname;
	// Asks the device to check it's you (face, fingerprint, PIN): then a passkey is both sign-in steps at once.
	const options = await generateAuthenticationOptions({ rpID: rpId, userVerification: "preferred" });
	const challengeId = keepChallenge({ challenge: options.challenge, origin, rpId, kind: "login" });
	return { challengeId, options };
}

/** Verifies a passkey sign-in. Returns the account, and whether the device checked it was them (face, PIN…). */
export async function finishLogin(
	challengeId: string,
	response: AuthenticationResponseJSON,
): Promise<{ userId: string; userVerified: boolean }> {
	const c = takeChallenge(challengeId, "login");
	const [p] = await db.select().from(schema.passkeys).where(eq(schema.passkeys.id, response.id));
	if (!p) throw new HttpError(401, "This passkey isn't registered here. Sign in with your password instead.");
	const result = await verifyAuthenticationResponse({
		response,
		expectedChallenge: c.challenge,
		expectedOrigin: c.origin,
		expectedRPID: c.rpId,
		credential: {
			id: p.id,
			publicKey: isoBase64URL.toBuffer(p.publicKey),
			counter: p.counter,
			transports: p.transports,
		},
		requireUserVerification: false,
	}).catch((err: unknown) => {
		throw new HttpError(
			401,
			`Couldn't sign in with the passkey: ${err instanceof Error ? err.message : String(err)}`,
		);
	});
	if (!result.verified) throw new HttpError(401, "Couldn't verify the passkey");
	await db
		.update(schema.passkeys)
		.set({
			counter: result.authenticationInfo.newCounter,
			backedUp: result.authenticationInfo.credentialBackedUp,
			lastUsedAt: Date.now(),
		})
		.where(eq(schema.passkeys.id, p.id));
	return { userId: p.userId, userVerified: result.authenticationInfo.userVerified };
}
