import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import postgres from "postgres";
import { clientIp, inRange } from "../src/auth/request.ts";
import { base32Decode, base32Encode, totpAt, verifyTotp } from "../src/auth/totp.ts";

describe("authenticator codes (RFC 6238)", () => {
	// The RFC's SHA-1 key, "12345678901234567890", in base32; its 8-digit codes end in these 6 digits.
	const secret = base32Encode(new TextEncoder().encode("12345678901234567890"));
	test("matches the RFC's test vectors", async () => {
		expect(await totpAt(secret, Math.floor(59 / 30))).toBe("287082");
		expect(await totpAt(secret, Math.floor(1111111109 / 30))).toBe("081804");
		expect(await totpAt(secret, Math.floor(1234567890 / 30))).toBe("005924");
		expect(await totpAt(secret, Math.floor(2000000000 / 30))).toBe("279037");
	});
	test("base32 round-trips", () => {
		const bytes = crypto.getRandomValues(new Uint8Array(20));
		expect([...base32Decode(base32Encode(bytes))]).toEqual([...bytes]);
		expect([...base32Decode("gezd gnbv-gy3t qojq")]).toEqual([...new TextEncoder().encode("1234567890")]);
	});
	test("accepts a step either side, never a used one", async () => {
		const now = 1_700_000_000_000;
		const step = Math.floor(now / 30_000);
		const code = await totpAt(secret, step - 1);
		expect(await verifyTotp(secret, code, null, now)).toBe(step - 1);
		expect(await verifyTotp(secret, code, step - 1, now)).toBeNull();
		expect(await verifyTotp(secret, await totpAt(secret, step - 3), null, now)).toBeNull();
		expect(await verifyTotp(secret, "12345", null, now)).toBeNull();
	});
});

describe("who's calling", () => {
	test("address ranges", () => {
		expect(inRange("10.1.2.3", "10.0.0.0/8")).toBe(true);
		expect(inRange("11.1.2.3", "10.0.0.0/8")).toBe(false);
		expect(inRange("192.168.0.225", "192.168.0.225")).toBe(true);
		expect(inRange("::ffff:127.0.0.1", "127.0.0.0/8")).toBe(true);
		expect(inRange("fd7a:115c:a1e0::1", "fd7a:115c::/32")).toBe(true);
		expect(inRange("fd7a:115d::1", "fd7a:115c::/32")).toBe(false);
		expect(inRange("10.0.0.1", "fd7a::/16")).toBe(false);
		expect(inRange("10.0.0.1", "10.0.0.0/33")).toBe(false);
	});
	const via = (address: string) => ({ requestIP: () => ({ address }) });
	const req = (xff?: string) => new Request("http://x/", { headers: xff ? { "x-forwarded-for": xff } : {} });
	test("X-Forwarded-For only counts from a proxy you trust", () => {
		expect(clientIp(req("6.6.6.6"), via("203.0.113.9"))).toBe("203.0.113.9");
		expect(clientIp(req("198.51.100.7"), via("127.0.0.1"))).toBe("198.51.100.7");
		// Someone put a fake address first: the last one the proxy added wins.
		expect(clientIp(req("1.2.3.4, 198.51.100.7"), via("127.0.0.1"))).toBe("198.51.100.7");
		expect(clientIp(req("198.51.100.7, 10.0.0.5"), via("10.0.0.6"), ["10.0.0.0/8"])).toBe("198.51.100.7");
		expect(clientIp(req("198.51.100.7"), via("10.0.0.6"))).toBe("10.0.0.6");
		expect(clientIp(req(), via("127.0.0.1"))).toBe("127.0.0.1");
	});
});

const MAIN_DB = process.env.DATABASE_URL ?? "postgres://sekai:sekai@127.0.0.1:5433/sekai";
const TEST_DB = MAIN_DB.replace(/\/[^/?]+(\?.*)?$/, "/sekai_access_test$1");

async function prepareDb(): Promise<boolean> {
	const sql = postgres(MAIN_DB, { max: 1, connect_timeout: 3, onnotice: () => {} });
	try {
		const [row] = await sql`select 1 from pg_database where datname = 'sekai_access_test'`;
		if (!row) await sql.unsafe("create database sekai_access_test");
		return true;
	} catch {
		return false;
	} finally {
		await sql.end({ timeout: 2 });
	}
}

const dbReady = await prepareDb();

describe("several people", () => {
	test.skipIf(!dbReady)(
		"accounts, roles, two-factor sign-in, and everyone's things kept apart (needs Postgres)",
		async () => {
			const p = Bun.spawn(["bun", join(import.meta.dir, "fixtures", "access-check.ts")], {
				stdout: "pipe",
				stderr: "pipe",
				env: {
					...process.env,
					DATABASE_URL: TEST_DB,
					SEKAI_DATA_DIR: join(import.meta.dir, ".access-data"),
					SEKAI_LOG_LEVEL: "error",
					// Replies to the test's messages fail at once instead of calling a real model.
					GATEWAY_URL: "http://127.0.0.1:9/v1",
				},
			});
			const out = await new Response(p.stdout).text();
			const line = out.split("\n").find((l) => l.startsWith("REPORT "));
			if (!line) throw new Error(`no report: ${out}\n${await new Response(p.stderr).text()}`);
			expect(JSON.parse(line.slice(7))).toEqual({
				adminCreatesMember: { status: 201, temporary: true },
				memberMustChange: { status: 200, restriction: "password" },
				restrictedBlocked: 403,
				passwordChanged: 200,
				memberAfterChange: 200,
				memberSeesOwnBotsOnly: ["mine"],
				othersBot: 404,
				othersBotPatch: 404,
				sharedAppears: { name: "admin's", sharedBy: "Ada", instructions: "" },
				sharedPatch: 403,
				sharedChat: 201,
				adminSeesMemberChat: 404,
				adminChatList: 0,
				memberSearch: 0,
				memberBackups: 403,
				memberAdminUsers: 403,
				memberServerSetting: 403,
				memberTimezone: { status: 200, mine: "Asia/Tokyo", admins: "auto" },
				uploadOwner: 200,
				uploadOthers: 404,
				memoryKeptApart: { member: 1, admin: 0 },
				botLimit: 403,
				events: { memberGetsOwnChat: true, adminGetsMemberChat: false, memberGetsAdminChat: false },
				totp: { setUp: true, recoveryCodes: 10, signIn: "mfa", wrong: 400, right: "signed_in", reuse: 400 },
				recovery: "signed_in",
				disabled: 401,
				lastAdmin: 400,
			});
		},
		60_000,
	);
});
