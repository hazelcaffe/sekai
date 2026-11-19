// The phone apps against a scratch database: signing in through the browser (start → finish → exchange), and
// push setup (Admin → Phone apps, a phone's token). mobile.test.ts runs this as its own process, like auth-check.
import { createHash, randomBytes } from "node:crypto";
import { rmSync } from "node:fs";
import { createApp } from "../../src/app.ts";
import { resetRateLimits } from "../../src/auth/routes.ts";
import { ensureSetupCode, resetAuthCaches, setupCodeForTests } from "../../src/auth/service.ts";
import { config } from "../../src/config.ts";
import { closeDb, db, initDb, schema } from "../../src/db/index.ts";
import { deleteKey } from "../../src/services/kv.ts";

await initDb();
await db.delete(schema.users);
// Push setup from an earlier run (sealed with that run's secret key, which is gone).
await deleteKey("push.mobile");
resetAuthCaches();
resetRateLimits();

await ensureSetupCode("http://127.0.0.1");
const app = createApp();
const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: (req, srv) => app.fetch(req, srv) });
const base = `http://127.0.0.1:${server.port}`;
const report: Record<string, unknown> = {};

async function call(
	method: string,
	path: string,
	opts: { body?: unknown; form?: Record<string, string>; cookie?: string; origin?: string | null } = {},
) {
	const headers: Record<string, string> = {};
	let body: string | undefined;
	if (opts.form) {
		headers["content-type"] = "application/x-www-form-urlencoded";
		body = new URLSearchParams(opts.form).toString();
	} else if (opts.body !== undefined) {
		headers["content-type"] = "application/json";
		body = JSON.stringify(opts.body);
	}
	if (opts.cookie) headers.cookie = opts.cookie;
	if (opts.origin !== null) headers.origin = opts.origin ?? base;
	const res = await fetch(`${base}${path}`, { method, headers, body, redirect: "manual" });
	const text = await res.text();
	let data: unknown = text;
	try {
		data = JSON.parse(text);
	} catch {}
	return {
		status: res.status,
		data: data as Record<string, unknown>,
		text,
		location: res.headers.get("location"),
		cookies: res.headers.getSetCookie().map((c) => c.split(";")[0] ?? ""),
	};
}

const pkce = () => {
	const verifier = randomBytes(32).toString("base64url");
	return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
};
const cookieNamed = (cookies: string[], name: string) => cookies.find((c) => c.startsWith(`${name}=`)) ?? "";
const codeIn = (html: string) => /sekai:\/\/signed-in\?code=([A-Za-z0-9]+)/.exec(html)?.[1] ?? "";

try {
	const setup = await call("POST", "/api/auth/setup", {
		body: { username: "sam", name: "Sam", password: "correct horse battery", email: "", code: setupCodeForTests() },
	});
	const browser = cookieNamed(setup.cookies, "sekai_session");

	// Not from the app: no challenge.
	report.badChallenge = (await call("GET", "/api/auth/app/start?challenge=short", { origin: null })).status;

	// Signed out in the browser: off to the sign-in page, which comes back to finish.
	const fresh = pkce();
	const out = await call("GET", `/api/auth/app/start?challenge=${fresh.challenge}`, { origin: null });
	report.signedOutGoesTo = out.location;
	const freshTicket = cookieNamed(out.cookies, "sekai_app_signin");
	// Having signed in there (during this sign-in), finish hands over straight away.
	const straight = await call("GET", "/api/auth/app/finish", { cookie: `${freshTicket}; ${browser}`, origin: null });
	report.straightHandOff = Boolean(codeIn(straight.text));

	// Already signed in in the browser: it asks first.
	const p = pkce();
	const start = await call("GET", `/api/auth/app/start?challenge=${p.challenge}`, { cookie: browser, origin: null });
	report.signedInGoesTo = start.location;
	const ticket = cookieNamed(start.cookies, "sekai_app_signin");
	const both = `${ticket}; ${browser}`;
	const confirm = await call("GET", "/api/auth/app/finish", { cookie: both, origin: null });
	report.asksFirst = confirm.text.includes("Sign in to the app?") && !codeIn(confirm.text);
	report.crossSiteConfirm = (
		await call("POST", "/api/auth/app/finish", { cookie: both, origin: "https://evil.example" })
	).status;
	const handed = await call("POST", "/api/auth/app/finish", { cookie: both });
	const code = codeIn(handed.text);
	report.handedOver = Boolean(code);

	// Someone else with the code but not the verifier gets nothing, and the code is gone.
	const stolen = await call("POST", "/api/auth/app/exchange", {
		form: { code, verifier: pkce().verifier },
		origin: null,
	});
	report.wrongVerifier = stolen.location?.startsWith("/?sso_error=") ?? false;
	const late = await call("POST", "/api/auth/app/exchange", { form: { code, verifier: p.verifier }, origin: null });
	report.codeUsedUp = late.location?.startsWith("/?sso_error=") ?? false;

	// The app with its verifier gets a session of its own.
	const fromStraight = codeIn(straight.text);
	const ok = await call("POST", "/api/auth/app/exchange", {
		form: { code: fromStraight, verifier: fresh.verifier },
		origin: null,
	});
	report.exchange = { status: ok.status, location: ok.location };
	const phone = cookieNamed(ok.cookies, "sekai_session");
	report.phoneSession = (await call("GET", "/api/agents", { cookie: phone, origin: null })).status;
	report.phoneIsNewSession = phone !== browser && phone.length > 20;

	// Push setup: nothing until an admin adds Firebase; then phones get its client settings.
	report.pushBefore = (await call("GET", "/api/push/mobile", { cookie: phone, origin: null })).data;
	const firebaseConfig = JSON.stringify({
		project_info: { project_number: "123456", project_id: "sekai-test" },
		client: [
			{
				client_info: {
					mobilesdk_app_id: "1:123456:android:abc",
					android_client_info: { package_name: "io.github.hazelcaffe.sekai" },
				},
				api_key: [{ current_key: "AIzaTest" }],
			},
		],
	});
	const serviceAccount = JSON.stringify({
		type: "service_account",
		project_id: "sekai-test",
		client_email: "push@sekai-test.iam.gserviceaccount.com",
		private_key: "-----BEGIN PRIVATE KEY-----\nnot a real key\n-----END PRIVATE KEY-----\n",
	});
	report.badFirebaseFile = (
		await call("PUT", "/api/admin/mobile", { cookie: browser, body: { firebaseConfig: "{}" } })
	).status;
	const saved = await call("PUT", "/api/admin/mobile", {
		cookie: browser,
		body: { firebaseConfig, firebaseServiceAccount: serviceAccount },
	});
	const settings = saved.data.settings as Record<string, string>;
	report.adminSaved = {
		status: saved.status,
		android: saved.data.android,
		secretMasked: settings.firebaseServiceAccount === "••••••••",
	};
	report.pushAfter = (await call("GET", "/api/push/mobile", { cookie: phone, origin: null })).data;
	report.addDevice = (
		await call("POST", "/api/push/devices", {
			cookie: phone,
			body: {
				provider: "fcm",
				token: "fcm-token-abc:123",
				appId: "io.github.hazelcaffe.sekai",
				device: "Pixel 8",
			},
		})
	).data;
	report.badToken = (
		await call("POST", "/api/push/devices", {
			cookie: phone,
			body: { provider: "fcm", token: "<script>", appId: "x" },
		})
	).status;
	report.devices = ((await call("GET", "/api/admin/mobile", { cookie: browser, origin: null })).data.devices ??
		null) as unknown;
	await call("POST", "/api/push/devices/remove", { cookie: phone, body: { token: "fcm-token-abc:123" } });
	report.devicesAfterRemove = (
		await call("GET", "/api/admin/mobile", { cookie: browser, origin: null })
	).data.devices;
} catch (err) {
	report.error = String(err);
} finally {
	console.info(`REPORT ${JSON.stringify(report)}`);
	await db.delete(schema.users);
	await deleteKey("push.mobile");
	server.stop(true);
	await closeDb();
	rmSync(config.dataDir, { recursive: true, force: true });
}
