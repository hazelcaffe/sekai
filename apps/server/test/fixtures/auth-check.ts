// Runs sign-in end to end against a scratch database and prints a JSON report. auth.test.ts runs this as its
// own process so DATABASE_URL and SEKAI_AUTH_TOKEN apply before the server's modules load.
import { createApp } from "../../src/app.ts";
import { resetRateLimits } from "../../src/auth/routes.ts";
import { ensureSetupCode, resetAuthCaches, setupCodeForTests } from "../../src/auth/service.ts";
import { closeDb, db, initDb, schema } from "../../src/db/index.ts";

await initDb();
await db.delete(schema.users);
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
	opts: { body?: unknown; cookie?: string; token?: string; origin?: string | null; host?: string } = {},
) {
	const headers: Record<string, string> = {};
	if (opts.body !== undefined) headers["content-type"] = "application/json";
	if (opts.cookie) headers.cookie = opts.cookie;
	if (opts.token) headers.authorization = `Bearer ${opts.token}`;
	if (opts.origin !== null) headers.origin = opts.origin ?? base;
	if (opts.host) headers.host = opts.host;
	const res = await fetch(`${base}${path}`, {
		method,
		headers,
		body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
	});
	const setCookie = res.headers.get("set-cookie");
	const text = await res.text();
	let data: unknown = null;
	try {
		data = text ? JSON.parse(text) : null;
	} catch {
		data = text;
	}
	return { status: res.status, data: data as Record<string, unknown>, setCookie };
}

const cookieOf = (setCookie: string | null) => setCookie?.split(";")[0] ?? "";
const owner = { username: "sam", name: "Sam", password: "correct horse battery", email: "" };

try {
	report.beforeSetup = (await call("GET", "/api/agents", { origin: null })).data.code;
	const status = (await call("GET", "/api/auth/status")).data;
	report.status = { setupRequired: status.setupRequired, setupCodeRequired: status.setupCodeRequired };

	// A page opened on a LAN address needs the setup code, even through a local proxy.
	const lan = "http://192.168.0.5:7420";
	report.remoteNeedsCode = (
		await call("GET", "/api/auth/status", { origin: lan, host: "192.168.0.5:7420" })
	).data.setupCodeRequired;
	report.remoteWrongCode = (
		await call("POST", "/api/auth/setup", {
			body: { ...owner, code: "AAAAAA" },
			origin: lan,
			host: "192.168.0.5:7420",
		})
	).status;
	report.crossSiteSetup = (
		await call("POST", "/api/auth/setup", { body: owner, origin: "https://evil.example" })
	).status;

	// Even from the server itself, setup needs the code from the log (a local proxy looks just like local).
	report.localWithoutCode = (await call("POST", "/api/auth/setup", { body: owner })).status;
	const setup = await call("POST", "/api/auth/setup", { body: { ...owner, code: setupCodeForTests() } });
	report.setup = { status: setup.status, httpOnly: /HttpOnly/.test(setup.setCookie ?? "") };
	const a = cookieOf(setup.setCookie);
	report.again = (await call("POST", "/api/auth/setup", { body: owner })).status;
	report.withCookie = (await call("GET", "/api/agents", { cookie: a, origin: null })).status;
	report.signedIn = (await call("GET", "/api/auth/status", { cookie: a })).data.signedIn;
	report.csrf = (
		await call("POST", "/api/notes", { cookie: a, origin: "https://evil.example", body: { title: "x" } })
	).status;

	const wrong = await call("POST", "/api/auth/login", { body: { username: "sam", password: "nope" } });
	report.wrongPassword = wrong.status;
	const b = cookieOf(
		(await call("POST", "/api/auth/login", { body: { username: "SAM", password: owner.password } })).setCookie,
	);
	report.secondSession = (await call("GET", "/api/agents", { cookie: b, origin: null })).status;
	report.sessions = ((await call("GET", "/api/auth/sessions", { cookie: a })).data as unknown as unknown[]).length;

	const full = (await call("POST", "/api/auth/tokens", { cookie: a, body: { name: "script", scope: "full" } })).data;
	report.fullToken = (await call("GET", "/api/agents", { token: String(full.token), origin: null })).status;
	const bridge = (await call("POST", "/api/auth/tokens/desktop", { cookie: a, body: { computerName: "studio" } }))
		.data;
	report.bridgeTokenOnApi = (await call("GET", "/api/agents", { token: String(bridge.token), origin: null })).status;
	report.rootToken = (await call("GET", "/api/agents", { token: "root-check-token", origin: null })).status;
	report.badToken = (await call("GET", "/api/agents", { token: "fsh_nope", origin: null })).status;
	// A stale token in an old web app falls through to the cookie.
	report.staleTokenWithCookie = (await call("GET", "/api/agents", { token: "old", cookie: a, origin: null })).status;
	await call("DELETE", `/api/auth/tokens/${full.id}`, { cookie: a });
	report.revokedToken = (await call("GET", "/api/agents", { token: String(full.token), origin: null })).status;

	report.changePassword = (
		await call("POST", "/api/auth/password", {
			cookie: a,
			body: { current: owner.password, next: "a brand new passphrase" },
		})
	).status;
	report.otherSessionAfterChange = (await call("GET", "/api/agents", { cookie: b, origin: null })).status;
	report.thisSessionAfterChange = (await call("GET", "/api/agents", { cookie: a, origin: null })).status;

	await call("POST", "/api/auth/logout", { cookie: a });
	report.afterLogout = (await call("GET", "/api/agents", { cookie: a, origin: null })).status;

	resetRateLimits();
	const codes: number[] = [];
	for (let i = 0; i < 11; i++) {
		codes.push((await call("POST", "/api/auth/login", { body: { username: "sam", password: `x${i}` } })).status);
	}
	report.rateLimited = codes.at(-1);
	report.passkeysOnIp = (await call("POST", "/api/auth/passkeys/login/options")).status;
} catch (err) {
	report.error = String(err);
} finally {
	console.info(`REPORT ${JSON.stringify(report)}`);
	await db.delete(schema.users);
	server.stop(true);
	await closeDb();
}
