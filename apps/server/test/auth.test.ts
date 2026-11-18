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

async function prepareDb(): Promise<boolean> {
	const sql = postgres(MAIN_DB, { max: 1, connect_timeout: 3, onnotice: () => {} });
	try {
		const [row] = await sql`select 1 from pg_database where datname = 'sekai_auth_test'`;
		if (!row) await sql.unsafe("create database sekai_auth_test");
		return true;
	} catch {
		return false;
	} finally {
		await sql.end({ timeout: 2 });
	}
}

const dbReady = await prepareDb();

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
});
