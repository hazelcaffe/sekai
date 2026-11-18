import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { join } from "node:path";
import postgres from "postgres";
import { resetFcmForTests, sendFcm } from "../src/mobile/fcm.ts";
import { firebaseClient, serviceAccount } from "../src/mobile/settings.ts";

const googleServices = (packageName: string) =>
	JSON.stringify({
		project_info: { project_number: "42", project_id: "proj" },
		client: [
			{
				client_info: { mobilesdk_app_id: "1:42:android:other", android_client_info: { package_name: "x.y" } },
				api_key: [{ current_key: "key-other" }],
			},
			{
				client_info: {
					mobilesdk_app_id: "1:42:android:sekai",
					android_client_info: { package_name: packageName },
				},
				api_key: [{ current_key: "key-sekai" }],
			},
		],
	});

describe("phone app push settings", () => {
	test("google-services.json gives the Sekai app's client settings", () => {
		expect(firebaseClient(googleServices("io.github.hazelcaffe.sekai"))).toEqual({
			apiKey: "key-sekai",
			appId: "1:42:android:sekai",
			projectId: "proj",
			senderId: "42",
		});
		// Another package name: the first app in the file.
		expect(firebaseClient(googleServices("com.example")).appId).toBe("1:42:android:other");
		expect(() => firebaseClient("not json")).toThrow("google-services.json");
		expect(() => firebaseClient(JSON.stringify({ project_info: {} }))).toThrow("no Android app");
	});

	test("a service account key needs its parts", () => {
		expect(
			serviceAccount(
				JSON.stringify({ type: "service_account", project_id: "p", client_email: "e@x", private_key: "k" }),
			),
		).toEqual({ projectId: "p", clientEmail: "e@x", privateKey: "k" });
		expect(() => serviceAccount(JSON.stringify({ type: "authorized_user" }))).toThrow("service account");
	});
});

describe("Firebase sending", () => {
	afterEach(() => resetFcmForTests());

	const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
	const sa = {
		projectId: "proj",
		clientEmail: "push@proj.iam.gserviceaccount.com",
		privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
	};

	test("gets a token once, sends data-only messages, and says when a phone is gone", async () => {
		const calls: { url: string; body: string }[] = [];
		const fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (
			input: string | URL | Request,
			init?: RequestInit,
		) => {
			const url = String(input);
			calls.push({ url, body: String(init?.body ?? "") });
			if (url.startsWith("https://oauth2.googleapis.com/")) {
				return Response.json({ access_token: "ya29.test", expires_in: 3600 });
			}
			if (JSON.parse(String(init?.body)).message.token === "gone") {
				return Response.json(
					{ error: { status: "NOT_FOUND", details: [{ errorCode: "UNREGISTERED" }] } },
					{ status: 404 },
				);
			}
			return Response.json({ name: "projects/proj/messages/1" });
		}) as typeof fetch);
		try {
			const data = { title: "Hi", body: "There", url: "/c/1", tag: "", ring: "", toolCallId: "", test: "" };
			expect(await sendFcm(sa, "phone-1", data, { ttlSeconds: 60, collapseKey: "c1" })).toBe("sent");
			expect(await sendFcm(sa, "gone", data, { ttlSeconds: 60 })).toBe("gone");
			const tokenCalls = calls.filter((c) => c.url.startsWith("https://oauth2.googleapis.com/"));
			expect(tokenCalls).toHaveLength(1);
			expect(tokenCalls[0]?.body).toContain("grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer");
			const send = calls.find((c) => c.url === "https://fcm.googleapis.com/v1/projects/proj/messages:send");
			const message = JSON.parse(send?.body ?? "{}").message;
			expect(message.token).toBe("phone-1");
			expect(message.data).toEqual(data);
			expect(message.notification).toBeUndefined();
			expect(message.android).toEqual({ priority: "high", ttl: "60s", collapse_key: "c1" });
		} finally {
			fetchSpy.mockRestore();
		}
	});
});

const MAIN_DB = process.env.DATABASE_URL ?? "postgres://sekai:sekai@127.0.0.1:5433/sekai";
const TEST_DB = MAIN_DB.replace(/\/[^/?]+(\?.*)?$/, "/sekai_mobile_test$1");

async function prepareDb(): Promise<boolean> {
	const sql = postgres(MAIN_DB, { max: 1, connect_timeout: 3, onnotice: () => {} });
	try {
		const [row] = await sql`select 1 from pg_database where datname = 'sekai_mobile_test'`;
		if (!row) await sql.unsafe("create database sekai_mobile_test");
		return true;
	} catch {
		return false;
	} finally {
		await sql.end({ timeout: 2 });
	}
}

const dbReady = await prepareDb();

describe("phone apps end to end", () => {
	test.skipIf(!dbReady)(
		"sign in through the browser, and push setup (needs Postgres)",
		async () => {
			const p = Bun.spawn(["bun", join(import.meta.dir, "fixtures", "app-signin-check.ts")], {
				stdout: "pipe",
				stderr: "pipe",
				env: { ...process.env, DATABASE_URL: TEST_DB, SEKAI_LOG_LEVEL: "error" },
			});
			const out = await new Response(p.stdout).text();
			const line = out.split("\n").find((l) => l.startsWith("REPORT "));
			if (!line) throw new Error(`no report: ${out}\n${await new Response(p.stderr).text()}`);
			expect(JSON.parse(line.slice(7))).toEqual({
				badChallenge: 400,
				signedOutGoesTo: "/?next=%2Fapi%2Fauth%2Fapp%2Ffinish",
				straightHandOff: true,
				signedInGoesTo: "/api/auth/app/finish",
				asksFirst: true,
				crossSiteConfirm: 403,
				handedOver: true,
				wrongVerifier: true,
				codeUsedUp: true,
				exchange: { status: 303, location: "/" },
				phoneSession: 200,
				phoneIsNewSession: true,
				pushBefore: { fcm: null, apns: false },
				badFirebaseFile: 400,
				adminSaved: {
					status: 200,
					android: { ready: true, projectId: "sekai-test", problem: null },
					secretMasked: true,
				},
				pushAfter: {
					fcm: {
						apiKey: "AIzaTest",
						appId: "1:123456:android:abc",
						projectId: "sekai-test",
						senderId: "123456",
					},
					apns: false,
				},
				addDevice: { devices: 1 },
				badToken: 400,
				devices: { android: 1, ios: 0 },
				devicesAfterRemove: { android: 0, ios: 0 },
			});
		},
		60_000,
	);
});
