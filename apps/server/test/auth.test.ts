import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import postgres from "postgres";
import {
	isLocalRequest,
	markProxy,
	passkeysAvailableFor,
	readBearer,
	readCookie,
	sameOrigin,
	sessionCookie,
} from "../src/auth/request.ts";

const loopback = { requestIP: () => ({ address: "127.0.0.1" }) };
const lanPeer = { requestIP: () => ({ address: "192.168.0.20" }) };

describe("request helpers", () => {
	test("cookies and bearer tokens", () => {
		const req = new Request("http://x/api?token=q", { headers: { cookie: "a=1; sekai_session=abc%3D; b=2" } });
		expect(readCookie(req, "sekai_session")).toBe("abc=");
		expect(readCookie(req, "missing")).toBeNull();
		// ?token= only where a browser can't send a header (the event stream, downloads, WebSockets…).
		expect(readBearer(req)).toBeNull();
		expect(readBearer(new Request("http://x/api/events?token=q"))).toBe("q");
		expect(readBearer(new Request("http://x/api/agents/a1/export?token=q"))).toBe("q");
		expect(readBearer(new Request("http://x/api/events?token=q", { method: "POST" }))).toBeNull();
		expect(readBearer(new Request("http://x", { headers: { authorization: "Bearer t1" } }))).toBe("t1");
	});

	test("session cookies are HttpOnly, Lax, and Secure on https", () => {
		const plain = sessionCookie(new Request("http://x"), "s", 60);
		expect(plain).toContain("HttpOnly");
		expect(plain).toContain("SameSite=Lax");
		expect(plain).not.toContain("Secure");
		const proxied = new Request("http://x", { headers: { "x-forwarded-proto": "https" } });
		markProxy(proxied, loopback, []);
		expect(sessionCookie(proxied, "s", 60)).toContain("Secure");
		expect(sessionCookie(proxied, "s", 60)).toStartWith("__Host-sekai_session=");
		// Straight from the internet, the header is anyone's: it doesn't count.
		const spoofed = new Request("http://x", { headers: { "x-forwarded-proto": "https" } });
		markProxy(spoofed, { requestIP: () => ({ address: "203.0.113.5" }) }, []);
		expect(sessionCookie(spoofed, "s", 60)).not.toContain("Secure");
	});

	test("same origin means the page's Origin matches the Host", () => {
		const ok = new Request("http://sekai.lan/api", { headers: { origin: "http://sekai.lan", host: "sekai.lan" } });
		const evil = new Request("http://sekai.lan/api", {
			headers: { origin: "https://evil.example", host: "sekai.lan" },
		});
		expect(sameOrigin(ok)).toBe("http://sekai.lan");
		expect(sameOrigin(evil)).toBeNull();
		expect(sameOrigin(new Request("http://sekai.lan/api"))).toBeNull();
	});

	test("local means a loopback connection to a loopback page", () => {
		const local = new Request("http://localhost:7420/", {
			headers: { origin: "http://localhost:7420", host: "localhost:7420" },
		});
		const proxiedPhone = new Request("http://127.0.0.1:7420/", {
			headers: { origin: "http://192.168.0.5:5173", host: "192.168.0.5:5173" },
		});
		expect(isLocalRequest(local, loopback)).toBe(true);
		expect(isLocalRequest(local, lanPeer)).toBe(false);
		expect(isLocalRequest(proxiedPhone, loopback)).toBe(false);
	});

	test("passkeys need https on a hostname, or localhost", () => {
		expect(passkeysAvailableFor("http://localhost:5173")).toBe(true);
		expect(passkeysAvailableFor("https://sekai.tail1234.ts.net")).toBe(true);
		expect(passkeysAvailableFor("http://sekai.lan")).toBe(false);
		expect(passkeysAvailableFor("https://192.168.0.5")).toBe(false);
		expect(passkeysAvailableFor("http://127.0.0.1:7420")).toBe(false);
		expect(passkeysAvailableFor(null)).toBe(false);
	});
});

const MAIN_DB = process.env.DATABASE_URL ?? "postgres://sekai:sekai@127.0.0.1:5433/sekai";
const TEST_DB = MAIN_DB.replace(/\/[^/?]+(\?.*)?$/, "/sekai_auth_test$1");
const PASSKEY_DB = MAIN_DB.replace(/\/[^/?]+(\?.*)?$/, "/sekai_passkey_test$1");

async function prepareDb(): Promise<boolean> {
	const sql = postgres(MAIN_DB, { max: 1, connect_timeout: 3, onnotice: () => {} });
	try {
		for (const name of ["sekai_auth_test", "sekai_passkey_test"]) {
			const [row] = await sql`select 1 from pg_database where datname = ${name}`;
			if (!row) await sql.unsafe(`create database ${name}`);
		}
		return true;
	} catch {
		return false;
	} finally {
		await sql.end({ timeout: 2 });
	}
}

const dbReady = await prepareDb();

/** Runs a fixture as its own process (so its environment applies before the server's modules load). */
async function runFixture(file: string, env: Record<string, string>): Promise<unknown> {
	const p = Bun.spawn(["bun", join(import.meta.dir, "fixtures", file)], {
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env, SEKAI_LOG_LEVEL: "error", ...env },
	});
	const out = await new Response(p.stdout).text();
	const line = out.split("\n").find((l) => l.startsWith("REPORT "));
	if (!line) throw new Error(`no report: ${out}\n${await new Response(p.stderr).text()}`);
	return JSON.parse(line.slice(7));
}

describe("sign-in", () => {
	test.skipIf(!dbReady)(
		"setup, sessions, CSRF, tokens, password change, logout and rate limits (needs Postgres)",
		async () => {
			const p = Bun.spawn(["bun", join(import.meta.dir, "fixtures", "auth-check.ts")], {
				stdout: "pipe",
				stderr: "pipe",
				env: {
					...process.env,
					DATABASE_URL: TEST_DB,
					SEKAI_AUTH_TOKEN: "root-check-token",
					SEKAI_LOG_LEVEL: "error",
				},
			});
			const out = await new Response(p.stdout).text();
			const line = out.split("\n").find((l) => l.startsWith("REPORT "));
			if (!line) throw new Error(`no report: ${out}\n${await new Response(p.stderr).text()}`);
			expect(JSON.parse(line.slice(7))).toEqual({
				beforeSetup: "setup_required",
				status: { setupRequired: true, setupCodeRequired: true },
				remoteNeedsCode: true,
				remoteWrongCode: 403,
				crossSiteSetup: 403,
				localWithoutCode: 403,
				setup: { status: 200, httpOnly: true },
				again: 409,
				withCookie: 200,
				signedIn: true,
				csrf: 403,
				wrongPassword: 401,
				secondSession: 200,
				sessions: 2,
				fullToken: 200,
				bridgeTokenOnApi: 403,
				rootToken: 200,
				badToken: 401,
				staleTokenWithCookie: 200,
				revokedToken: 401,
				changePassword: 200,
				otherSessionAfterChange: 401,
				thisSessionAfterChange: 200,
				afterLogout: 401,
				rateLimited: 429,
				passkeysOnIp: 400,
			});
		},
		60_000,
	);

	test.skipIf(!dbReady)(
		"require a passkey to sign in: the second step, codes refused, recovery, last passkey, admin reset (needs Postgres)",
		async () => {
			const report = await runFixture("passkey-check.ts", {
				DATABASE_URL: PASSKEY_DB,
				// Its own data folder (and so its own secret key), not the checkout's.
				SEKAI_DATA_DIR: join(import.meta.dir, ".passkey-data"),
				SEKAI_AUTH_TOKEN: "",
			});
			const step = (passkey: boolean, passkeyRequired: boolean, methods: string[]) => ({
				status: "mfa",
				passkey,
				passkeyRequired,
				methods,
			});
			expect(report).toEqual({
				// Turning it on: a passkey first, from a signed-in page (not a token), after confirming it's you.
				onWithoutPasskey: 400,
				addedPasskey: { status: 200, rpId: "localhost" },
				onWithToken: 403,
				onNotRecent: { status: 403, code: "reauth_required" },
				on: { status: 200, required: true, newCodes: null },
				mfaStatus: true,
				listedRpId: "localhost",
				// A password alone, or with an authenticator or email code, doesn't sign in.
				passwordOnly: { ...step(true, true, ["recovery"]), session: 401 },
				passwordAndTotp: 400,
				emailCode: 400,
				stillNoSession: 401,
				// Only their own passkey answers.
				allowCredentials: ["ada's"],
				othersPasskey: { status: 401, session: 401 },
				crossSignIn: 400,
				ownPasskey: { status: "signed_in", session: 200 },
				// Signing in with the passkey itself stays one step.
				passkeyDirect: { status: "signed_in", session: 200 },
				passkeyUnverified: { ...step(false, false, ["totp", "recovery"]), thenTotp: "signed_in" },
				// On an address their passkeys aren't for: which ones they are for, and a recovery code works once.
				otherAddress: { ...step(false, true, ["recovery"]), hosts: ["localhost"] },
				otherAddressOptions: {
					status: 400,
					error: "Your passkeys are for localhost. Sign in there, or use a recovery code.",
				},
				recoveryCode: { status: "signed_in", session: 200 },
				recoveryCodeReused: 400,
				wrongPasskeys: { tries: [401, 401, 401, 401, 401], last: "Too many tries. Sign in again." },
				afterTooMany: 401,
				// The last passkey stays while it's required.
				removeLast: 400,
				removeOneOfTwo: 200,
				removeNewLast: 400,
				offNotRecent: 403,
				off: { required: false },
				afterOff: step(true, false, ["totp", "recovery"]),
				boOn: { status: 200, recoveryCodes: 10 },
				resetLink: step(true, true, ["recovery"]),
				memberUsesAdminRoute: 403,
				adminNotRecent: 403,
				adminReset: { status: 200, required: false },
				adminOwn: 400,
				boAfterReset: "signed_in",
				boCodesDropped: 0,
			});
		},
		60_000,
	);
});
