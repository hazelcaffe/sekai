// "Require a passkey to sign in" end to end against a scratch database, with a software authenticator making real
// WebAuthn answers (ES256), and prints a JSON report. auth.test.ts runs this as its own process, like auth-check.
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { rmSync } from "node:fs";
import { isoCBOR } from "@simplewebauthn/server/helpers";
import { createApp } from "../../src/app.ts";
import { resetRateLimits } from "../../src/auth/routes.ts";
import { ensureSetupCode, resetAuthCaches, setupCodeForTests } from "../../src/auth/service.ts";
import { base32Decode, base32Encode, currentStep, totpAt } from "../../src/auth/totp.ts";
import { config } from "../../src/config.ts";
import { closeDb, db, initDb, schema } from "../../src/db/index.ts";

await initDb();
await db.delete(schema.users);
resetAuthCaches();
resetRateLimits();

await ensureSetupCode("http://127.0.0.1");
const app = createApp();
const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: (req, srv) => app.fetch(req, srv) });
// Passkeys need https or localhost: the pages are "on" localhost, or on a made-up tailnet name over https.
const LOCAL = `localhost:${server.port}`;
const TAILNET = "sekai.tail1234.ts.net";
const report: Record<string, unknown> = {};

/** Cookies a browser would keep (the session, and the pending second step). */
class Jar {
	private cookies = new Map<string, string>();
	constructor(readonly host = LOCAL) {}
	get origin() {
		return this.host === TAILNET ? `https://${TAILNET}` : `http://${this.host}`;
	}
	take(res: Response) {
		for (const c of res.headers.getSetCookie()) {
			const [pair = ""] = c.split(";");
			const i = pair.indexOf("=");
			const value = pair.slice(i + 1);
			if (!value || /Max-Age=0/.test(c)) this.cookies.delete(pair.slice(0, i));
			else this.cookies.set(pair.slice(0, i), value);
		}
	}
	header() {
		return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
	}
}

async function call(method: string, path: string, jar: Jar, opts: { body?: unknown; token?: string } = {}) {
	const headers: Record<string, string> = { origin: jar.origin, host: jar.host };
	if (opts.body !== undefined) headers["content-type"] = "application/json";
	const cookie = jar.header();
	if (cookie) headers.cookie = cookie;
	if (opts.token) headers.authorization = `Bearer ${opts.token}`;
	const res = await fetch(`http://127.0.0.1:${server.port}${path}`, {
		method,
		headers,
		body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
		redirect: "manual",
	});
	jar.take(res);
	const text = await res.text();
	let data: unknown = null;
	try {
		data = text ? JSON.parse(text) : null;
	} catch {
		data = text;
	}
	// biome-ignore lint/suspicious/noExplicitAny: test fixture
	return { status: res.status, data: data as any };
}

const b64 = (bytes: Uint8Array | Buffer) => Buffer.from(bytes).toString("base64url");
const sha = (data: string | Uint8Array) => createHash("sha256").update(data).digest();

/** A passkey on a made-up device: makes credentials and signs challenges like a platform authenticator. */
class SoftPasskey {
	readonly id = b64(randomBytes(16));
	private readonly keys = generateKeyPairSync("ec", { namedCurve: "P-256" });
	private counter = 0;
	constructor(readonly rpId: string) {}

	private authData(flags: number, attested?: Uint8Array): Buffer {
		const count = Buffer.alloc(4);
		count.writeUInt32BE(this.counter);
		return Buffer.concat([sha(this.rpId), Buffer.from([flags]), count, ...(attested ? [attested] : [])]);
	}

	private clientData(type: string, challenge: string, origin: string): Buffer {
		return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
	}

	register(options: { challenge: string }, origin: string) {
		const jwk = this.keys.publicKey.export({ format: "jwk" });
		const cose = isoCBOR.encode(
			new Map<number, number | Uint8Array>([
				[1, 2],
				[3, -7],
				[-1, 1],
				[-2, Buffer.from(String(jwk.x), "base64url")],
				[-3, Buffer.from(String(jwk.y), "base64url")],
			]),
		);
		const credId = Buffer.from(this.id, "base64url");
		const len = Buffer.alloc(2);
		len.writeUInt16BE(credId.length);
		const attested = Buffer.concat([Buffer.alloc(16), len, credId, cose]);
		const attestation = isoCBOR.encode(
			new Map<string, string | Map<string, string> | Uint8Array>([
				["fmt", "none"],
				["attStmt", new Map<string, string>()],
				["authData", this.authData(0x45, attested)],
			]),
		);
		return {
			id: this.id,
			rawId: this.id,
			type: "public-key",
			response: {
				clientDataJSON: b64(this.clientData("webauthn.create", options.challenge, origin)),
				attestationObject: b64(attestation),
				transports: ["internal"],
			},
			clientExtensionResults: {},
			authenticatorAttachment: "platform",
		};
	}

	/** Answers a sign-in challenge; `verified`: the device checked a face, fingerprint or PIN. */
	assert(options: { challenge: string }, origin: string, verified = true) {
		this.counter++;
		const auth = this.authData(verified ? 0x05 : 0x01);
		const client = this.clientData("webauthn.get", options.challenge, origin);
		const signature = sign("sha256", Buffer.concat([auth, sha(client)]), this.keys.privateKey);
		return {
			id: this.id,
			rawId: this.id,
			type: "public-key",
			response: {
				clientDataJSON: b64(client),
				authenticatorData: b64(auth),
				signature: b64(signature),
			},
			clientExtensionResults: {},
			authenticatorAttachment: "platform",
		};
	}
}

async function addPasskey(jar: Jar, key: SoftPasskey) {
	const start = await call("POST", "/api/auth/passkeys/register/options", jar);
	return call("POST", "/api/auth/passkeys/register/verify", jar, {
		body: { challengeId: start.data.challengeId, response: key.register(start.data.options, jar.origin) },
	});
}

async function passwordSignIn(jar: Jar, username: string, password: string) {
	return call("POST", "/api/auth/login", jar, { body: { username, password } });
}

/** The second step with a passkey: options for the waiting sign-in, answered by `key`. */
async function passkeyStep(jar: Jar, key: SoftPasskey) {
	const start = await call("POST", "/api/auth/mfa/passkey/options", jar);
	if (start.status !== 200) return start;
	return call("POST", "/api/auth/mfa/passkey/verify", jar, {
		body: { challengeId: start.data.challengeId, response: key.assert(start.data.options, jar.origin) },
	});
}

/** Pretends the session last proved it's you long ago (so sensitive changes ask again). */
async function forgetRecentAuth() {
	await db.update(schema.sessions).set({ verifiedAt: 0 });
	resetAuthCaches();
}

const pick = (r: { status: number; data: Record<string, unknown> }) => ({
	status: r.data?.status ?? r.status,
	passkey: r.data?.passkey,
	passkeyRequired: r.data?.passkeyRequired,
	methods: r.data?.methods,
});

try {
	const ada = new Jar();
	const adaPassword = "correct horse battery";
	const setup = await call("POST", "/api/auth/setup", ada, {
		body: { username: "ada", name: "Ada", password: adaPassword, code: setupCodeForTests() },
	});
	if (setup.status !== 200) throw new Error(`setup: ${JSON.stringify(setup.data)}`);
	const adaId = String(setup.data.user.id);

	// An authenticator app first (its codes must stop counting once a passkey is required).
	const totp = (await call("POST", "/api/auth/mfa/totp/setup", ada)).data;
	const secret = base32Encode(base32Decode(String(totp.secret)));
	const confirmed = await call("POST", "/api/auth/mfa/totp/confirm", ada, {
		body: { code: await totpAt(secret, currentStep() - 1) },
	});
	const recovery = (confirmed.data.recoveryCodes as string[] | undefined) ?? [];

	// Turning it on needs a passkey, a recent sign-in, and Sekai's own page (not an API token).
	report.onWithoutPasskey = (
		await call("PUT", "/api/auth/passkeys/required", ada, { body: { required: true } })
	).status;
	const k1 = new SoftPasskey("localhost");
	const added = await addPasskey(ada, k1);
	report.addedPasskey = { status: added.status, rpId: added.data.rpId };
	const token = (await call("POST", "/api/auth/tokens", ada, { body: { name: "script" } })).data.token as string;
	report.onWithToken = (
		await call("PUT", "/api/auth/passkeys/required", new Jar(), { body: { required: true }, token })
	).status;
	await forgetRecentAuth();
	const stale = await call("PUT", "/api/auth/passkeys/required", ada, { body: { required: true } });
	report.onNotRecent = { status: stale.status, code: stale.data.code };
	await call("POST", "/api/auth/reauth", ada, { body: { password: adaPassword } });
	const on = await call("PUT", "/api/auth/passkeys/required", ada, { body: { required: true } });
	// Ada has recovery codes from her authenticator app: they stay (Bo, without any, gets new ones below).
	report.on = { status: on.status, required: on.data.required, newCodes: on.data.recoveryCodes ?? null };
	report.mfaStatus = (await call("GET", "/api/auth/mfa", ada)).data.passkeyRequired;
	// The passkey list says which address each is for.
	report.listedRpId = (await call("GET", "/api/auth/passkeys", ada)).data[0]?.rpId;

	// A password alone: a second step that only takes the passkey (or a recovery code), and no session yet.
	const pw = new Jar();
	const pwStep = await passwordSignIn(pw, "ada", adaPassword);
	report.passwordOnly = { ...pick(pwStep), session: (await call("GET", "/api/agents", pw)).status };
	// Authenticator codes don't count, and email or text codes aren't sent.
	const code = await totpAt(secret, currentStep());
	report.passwordAndTotp = (
		await call("POST", "/api/auth/mfa/verify", pw, { body: { method: "totp", code } })
	).status;
	report.emailCode = (await call("POST", "/api/auth/mfa/send", pw, { body: { method: "email" } })).status;
	report.stillNoSession = (await call("GET", "/api/agents", pw)).status;

	// Someone else's passkey can't be the second step: Bo's account, with a passkey of its own.
	const created = await call("POST", "/api/admin/users", ada, {
		body: { username: "bo", name: "Bo", email: "bo@example.com", roleId: "role_member", password: "temporary" },
	});
	const boId = String(created.data.user.id);
	const bo = new Jar();
	await passwordSignIn(bo, "bo", String(created.data.temporaryPassword));
	await call("POST", "/api/auth/password", bo, { body: { next: "bo's own long password" } });
	const kb = new SoftPasskey("localhost");
	await addPasskey(bo, kb);
	const options = await call("POST", "/api/auth/mfa/passkey/options", pw);
	report.allowCredentials = (options.data.options.allowCredentials as { id: string }[]).map((c) =>
		c.id === k1.id ? "ada's" : c.id === kb.id ? "bo's" : "other",
	);
	const othersKey = await call("POST", "/api/auth/mfa/passkey/verify", pw, {
		body: { challengeId: options.data.challengeId, response: kb.assert(options.data.options, pw.origin) },
	});
	report.othersPasskey = { status: othersKey.status, session: (await call("GET", "/api/agents", pw)).status };
	// A challenge made for one waiting sign-in doesn't finish another (a newer sign-in replaced this one).
	const old = await call("POST", "/api/auth/mfa/passkey/options", pw);
	const other = new Jar();
	await passwordSignIn(other, "ada", adaPassword);
	report.crossSignIn = (
		await call("POST", "/api/auth/mfa/passkey/verify", other, {
			body: { challengeId: old.data.challengeId, response: k1.assert(old.data.options, other.origin) },
		})
	).status;
	const right = await passkeyStep(other, k1);
	report.ownPasskey = { status: right.data.status, session: (await call("GET", "/api/agents", other)).status };

	// Signing in with the passkey itself stays one step (face, fingerprint or PIN checked).
	const direct = new Jar();
	const dOpts = await call("POST", "/api/auth/passkeys/login/options", direct);
	const dRes = await call("POST", "/api/auth/passkeys/login/verify", direct, {
		body: { challengeId: dOpts.data.challengeId, response: k1.assert(dOpts.data.options, direct.origin) },
	});
	report.passkeyDirect = { status: dRes.data.status, session: (await call("GET", "/api/agents", direct)).status };
	// Without that check it's a passkey sign-in already: the usual second step (the app code), no passkey again.
	const unverified = new Jar();
	const uOpts = await call("POST", "/api/auth/passkeys/login/options", unverified);
	const uRes = await call("POST", "/api/auth/passkeys/login/verify", unverified, {
		body: {
			challengeId: uOpts.data.challengeId,
			response: k1.assert(uOpts.data.options, unverified.origin, false),
		},
	});
	const uTotp = await call("POST", "/api/auth/mfa/verify", unverified, {
		body: { method: "totp", code: await totpAt(secret, currentStep() + 1) },
	});
	report.passkeyUnverified = { ...pick(uRes), thenTotp: uTotp.data.status };

	// Another address: the passkey is for localhost, so this one says where, and takes a recovery code.
	resetRateLimits();
	const away = new Jar(TAILNET);
	const awayStep = await passwordSignIn(away, "ada", adaPassword);
	report.otherAddress = { ...pick(awayStep), hosts: awayStep.data.passkeyHosts };
	const awayOpts = await call("POST", "/api/auth/mfa/passkey/options", away);
	report.otherAddressOptions = { status: awayOpts.status, error: awayOpts.data.error };
	const recovered = await call("POST", "/api/auth/mfa/verify", away, {
		body: { method: "recovery", code: recovery[0] },
	});
	report.recoveryCode = { status: recovered.data.status, session: (await call("GET", "/api/agents", away)).status };
	const again = new Jar(TAILNET);
	await passwordSignIn(again, "ada", adaPassword);
	report.recoveryCodeReused = (
		await call("POST", "/api/auth/mfa/verify", again, { body: { method: "recovery", code: recovery[0] } })
	).status;

	// Five wrong answers end the waiting sign-in, like wrong codes.
	resetRateLimits();
	const guess = new Jar();
	await passwordSignIn(guess, "ada", adaPassword);
	const tries: number[] = [];
	let last = "";
	for (let i = 0; i < 5; i++) {
		const r = await passkeyStep(guess, kb);
		tries.push(r.status);
		last = String(r.data.error);
	}
	report.wrongPasskeys = { tries, last };
	report.afterTooMany = (await passkeyStep(guess, k1)).status;
	resetRateLimits();

	// The last passkey can't go while it's required.
	report.removeLast = (await call("DELETE", `/api/auth/passkeys/${k1.id}`, ada)).status;
	const k2 = new SoftPasskey("localhost");
	await addPasskey(ada, k2);
	report.removeOneOfTwo = (await call("DELETE", `/api/auth/passkeys/${k1.id}`, ada)).status;
	report.removeNewLast = (await call("DELETE", `/api/auth/passkeys/${k2.id}`, ada)).status;

	// Turning it off needs a recent sign-in too; then the app code works again.
	await forgetRecentAuth();
	report.offNotRecent = (await call("PUT", "/api/auth/passkeys/required", ada, { body: { required: false } })).status;
	await call("POST", "/api/auth/reauth", ada, { body: { password: adaPassword } });
	report.off = (await call("PUT", "/api/auth/passkeys/required", ada, { body: { required: false } })).data;
	const offStep = await passwordSignIn(new Jar(), "ada", adaPassword);
	report.afterOff = pick(offStep);

	// Bo turns it on; an invite or reset link doesn't get around it.
	await call("POST", "/api/auth/reauth", bo, { body: { password: "bo's own long password" } });
	const boOn = await call("PUT", "/api/auth/passkeys/required", bo, { body: { required: true } });
	report.boOn = { status: boOn.status, recoveryCodes: (boOn.data.recoveryCodes as string[] | undefined)?.length };
	const link = await call("POST", `/api/admin/users/${boId}/reset-password`, ada, { body: { how: "link" } });
	const linkToken = String(link.data.inviteUrl).split("/").at(-1);
	const viaLink = await call("POST", `/api/auth/ticket/reset/${linkToken}`, new Jar(), {
		body: { password: "bo's brand new password" },
	});
	report.resetLink = pick(viaLink);

	// An admin can turn it off for someone (after confirming it's them); Bo can't do it for himself there.
	const boAgain = new Jar();
	await passwordSignIn(boAgain, "bo", "bo's brand new password");
	await passkeyStep(boAgain, kb);
	report.memberUsesAdminRoute = (
		await call("POST", `/api/admin/users/${adaId}/passkey-requirement-off`, boAgain)
	).status;
	await forgetRecentAuth();
	report.adminNotRecent = (await call("POST", `/api/admin/users/${boId}/passkey-requirement-off`, ada)).status;
	await call("POST", "/api/auth/reauth", ada, { body: { password: adaPassword } });
	const reset = await call("POST", `/api/admin/users/${boId}/passkey-requirement-off`, ada);
	report.adminReset = { status: reset.status, required: reset.data.mfa?.passkeyRequired };
	// Their own goes through Account (from a signed-in page), not the admin route.
	report.adminOwn = (await call("POST", `/api/admin/users/${adaId}/passkey-requirement-off`, ada)).status;
	const boAfter = await passwordSignIn(new Jar(), "bo", "bo's brand new password");
	report.boAfterReset = boAfter.data.status;
	report.boCodesDropped = (await call("GET", "/api/auth/mfa", boAgain)).data.recoveryCodesLeft;
} catch (err) {
	report.error = String(err instanceof Error ? err.stack : err);
} finally {
	console.info(`REPORT ${JSON.stringify(report)}`);
	await db.delete(schema.users);
	server.stop(true);
	await closeDb();
	rmSync(config.dataDir, { recursive: true, force: true });
	process.exit(0);
}
