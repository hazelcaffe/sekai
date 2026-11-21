import { userInfo } from "node:os";
import { TailscaleApiInput, type TailscaleOverview } from "@sekai/shared";
import { config } from "../config.ts";
import { bus } from "../events/bus.ts";
import { badRequest, errorMessage, parse } from "../lib/errors.ts";
import { log } from "../lib/log.ts";
import { seal, unseal } from "../lib/secrets.ts";
import { deleteKey, readKey, writeKey } from "../services/kv.ts";
import { getSettings, updateSettings } from "../services/settings.ts";

/**
 * Tailscale: this server's own place on your tailnet (its CLI), the HTTPS address Sekai is served at, and the
 * Tailscale API for the whole tailnet (devices, owners, tags, auth keys). Without an API key, Sekai still sees
 * devices through its own Tailscale.
 */

const API = "https://api.tailscale.com/api/v2";
const KEY = "tailscale.api";
const USER_KEY = "tailscale.defaultUser";

interface StoredApi {
	token?: string;
	clientId?: string;
	clientSecret?: string;
	setAt: number;
}

let oauthToken: { token: string; until: number } | null = null;
let lastApi: { ok: boolean; error: string | null; devices: number | null } | null = null;

// ---------------------------------------------------------------- the CLI on this server

async function cli(args: string[], timeoutMs = 15_000): Promise<{ code: number; out: string; err: string }> {
	try {
		const proc = Bun.spawn(["tailscale", ...args], { stdout: "pipe", stderr: "pipe" });
		const timer = setTimeout(() => proc.kill(), timeoutMs);
		const [out, err, code] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);
		clearTimeout(timer);
		return { code, out, err };
	} catch {
		return { code: 127, out: "", err: "Tailscale isn't installed on the Sekai server" };
	}
}

export interface CliPeer {
	ID?: string;
	HostName: string;
	DNSName?: string;
	TailscaleIPs?: string[];
	OS?: string;
	Online?: boolean;
	LastSeen?: string;
	Tags?: string[];
	UserID?: number;
}

export interface CliStatus {
	BackendState?: string;
	Version?: string;
	MagicDNSSuffix?: string;
	CurrentTailnet?: { Name?: string; MagicDNSSuffix?: string };
	Self?: CliPeer;
	Peer?: Record<string, CliPeer>;
	User?: Record<string, { LoginName?: string; DisplayName?: string }>;
}

export async function cliStatus(): Promise<{ status: CliStatus | null; error: string | null }> {
	const r = await cli(["status", "--json"]);
	if (r.code !== 0 && !r.out.trim().startsWith("{")) {
		return { status: null, error: r.err.trim() || "Tailscale isn't running on the Sekai server" };
	}
	try {
		return { status: JSON.parse(r.out) as CliStatus, error: null };
	} catch {
		return { status: null, error: "Couldn't read Tailscale's status" };
	}
}

const trimDot = (s: string | undefined) => (s ?? "").replace(/\.$/, "");

/** Whether Sekai is served over HTTPS on the tailnet (tailscale serve to this server's port). */
async function serveState(dnsName: string | null): Promise<TailscaleOverview["https"]> {
	const r = await cli(["serve", "status", "--json"]);
	if (r.code !== 0) return { on: false, url: null, canServe: false, error: r.err.trim() || null };
	let on = false;
	try {
		const s = JSON.parse(r.out || "{}") as {
			Web?: Record<string, { Handlers?: Record<string, { Proxy?: string }> }>;
		};
		for (const [host, web] of Object.entries(s.Web ?? {})) {
			const proxy = web.Handlers?.["/"]?.Proxy ?? "";
			if (host.endsWith(":443") && new RegExp(`:${config.port}/?$`).test(proxy)) on = true;
		}
	} catch {}
	return { on, url: dnsName ? `https://${dnsName}` : null, canServe: Boolean(dnsName), error: null };
}

/** Whether Sekai is also forwarded on this server's tailnet IP (plain TCP, so any address you type works). */
async function byIpState(address: string | null): Promise<TailscaleOverview["byIp"]> {
	const r = await cli(["serve", "status", "--json"]);
	let on = false;
	try {
		const s = JSON.parse(r.out || "{}") as { TCP?: Record<string, { TCPForward?: string }> };
		on = new RegExp(`:${config.port}$`).test(s.TCP?.[String(config.port)]?.TCPForward ?? "");
	} catch {}
	return { on, url: address ? `http://${address}:${config.port}` : null };
}

/** Forwards this server's tailnet IP and Sekai's port to Sekai (tailnet only), or stops. */
export async function setByIp(on: boolean): Promise<TailscaleOverview["byIp"]> {
	const r = on
		? await cli(["serve", "--bg", `--tcp=${config.port}`, `tcp://127.0.0.1:${config.port}`], 60_000)
		: await cli(["serve", `--tcp=${config.port}`, "off"], 30_000);
	if (r.code !== 0) {
		const err = r.err.trim() || r.out.trim();
		if (/access denied|denied|operator/i.test(err)) {
			throw badRequest(
				"Tailscale wants permission first: run `sudo tailscale set --operator=$USER` once on the Sekai server.",
			);
		}
		throw badRequest(`Tailscale: ${err.split("\n")[0]}`);
	}
	const { status } = await cliStatus();
	bus.emit({ type: "settings.changed" });
	return byIpState(status?.Self?.TailscaleIPs?.find((ip) => ip.includes(".")) ?? null);
}

/** Serves Sekai at https://<this machine>.<tailnet>.ts.net (tailnet only), or stops. */
export async function setHttps(on: boolean): Promise<TailscaleOverview["https"]> {
	const r = on
		? await cli(["serve", "--bg", "--https=443", `http://127.0.0.1:${config.port}`], 60_000)
		: await cli(["serve", "--https=443", "off"], 30_000);
	if (r.code !== 0) {
		const err = r.err.trim() || r.out.trim();
		if (/access denied|denied|operator/i.test(err)) {
			throw badRequest(
				"Tailscale wants permission first: run `sudo tailscale set --operator=$USER` once on the Sekai server, then try again.",
			);
		}
		if (/HTTPS|cert/i.test(err)) {
			throw badRequest(
				"Turn on HTTPS certificates for your tailnet first (Tailscale admin → DNS → HTTPS Certificates).",
			);
		}
		throw badRequest(`Tailscale: ${err.split("\n")[0]}`);
	}
	const { status } = await cliStatus();
	bus.emit({ type: "settings.changed" });
	return serveState(trimDot(status?.Self?.DNSName) || null);
}

// ---------------------------------------------------------------- the API

async function stored(): Promise<StoredApi | null> {
	return ((await readKey(KEY)) as StoredApi | undefined) ?? null;
}

/** A bearer token for the API: the access token, or one from the OAuth client (cached for its hour). */
async function bearer(s: StoredApi): Promise<string> {
	if (s.token) return unseal(s.token);
	if (!s.clientId || !s.clientSecret) throw new Error("No Tailscale API key");
	if (oauthToken && oauthToken.until > Date.now()) return oauthToken.token;
	const res = await fetch(`${API}/oauth/token`, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			client_id: s.clientId,
			client_secret: unseal(s.clientSecret),
			grant_type: "client_credentials",
		}),
		signal: AbortSignal.timeout(20_000),
	});
	if (!res.ok) throw new Error(`Tailscale didn't accept the OAuth client (${res.status})`);
	const body = (await res.json()) as { access_token: string; expires_in?: number };
	oauthToken = { token: body.access_token, until: Date.now() + ((body.expires_in ?? 3600) - 120) * 1000 };
	return body.access_token;
}

/** Calls the Tailscale API; throws a readable error. Null when no API key is set. */
export async function tailscaleApi<T>(path: string, init: RequestInit = {}): Promise<T | null> {
	const s = await stored();
	if (!s) return null;
	const token = await bearer(s);
	const res = await fetch(`${API}${path}`, {
		...init,
		headers: {
			authorization: `Bearer ${token}`,
			...(init.body ? { "content-type": "application/json" } : {}),
			...init.headers,
		},
		signal: init.signal ?? AbortSignal.timeout(20_000),
	});
	if (!res.ok) {
		const text = await res.text().catch(() => "");
		let message = text.slice(0, 200);
		try {
			message = (JSON.parse(text) as { message?: string }).message ?? message;
		} catch {}
		if (res.status === 401) throw new Error("Tailscale didn't accept the API key (expired or revoked?)");
		if (res.status === 403) throw new Error(`The API key can't do that: ${message}`);
		throw new Error(`Tailscale API (${res.status}): ${message}`);
	}
	return (res.status === 204 ? null : await res.json()) as T;
}

export interface ApiDevice {
	id: string;
	nodeId?: string;
	name: string;
	hostname: string;
	addresses: string[];
	os: string;
	user: string;
	tags?: string[];
	lastSeen?: string;
	connectedToControl?: boolean;
	keyExpiryDisabled?: boolean;
	expires?: string;
	clientVersion?: string;
	updateAvailable?: boolean;
	isExternal?: boolean;
}

export async function apiDevices(): Promise<ApiDevice[] | null> {
	try {
		const r = await tailscaleApi<{ devices: ApiDevice[] }>("/tailnet/-/devices?fields=all");
		if (r) lastApi = { ok: true, error: null, devices: r.devices.length };
		return r?.devices ?? null;
	} catch (err) {
		lastApi = { ok: false, error: errorMessage(err), devices: null };
		throw err;
	}
}

export async function setTailscaleApi(input: unknown): Promise<TailscaleOverview> {
	const data = parse(TailscaleApiInput, input);
	if ("token" in data && /^tskey-auth-/.test(data.token)) {
		throw badRequest(
			"That's an auth key (tskey-auth-…), which lets machines join your tailnet. The API needs an access token (tskey-api-…) or an OAuth client: Tailscale admin → Settings → Keys.",
		);
	}
	const next: StoredApi =
		"token" in data
			? { token: seal(data.token), setAt: Date.now() }
			: { clientId: data.clientId, clientSecret: seal(data.clientSecret), setAt: Date.now() };
	const previous = await stored();
	await writeKey(KEY, next);
	oauthToken = null;
	tokenExpiry = null;
	try {
		await apiDevices();
	} catch (err) {
		// Keep what worked before rather than a key that doesn't.
		if (previous) await writeKey(KEY, previous);
		else await deleteKey(KEY);
		throw badRequest(errorMessage(err));
	}
	log.info("tailscale: API key saved");
	bus.emit({ type: "settings.changed" });
	return tailscaleOverview();
}

export async function clearTailscaleApi(): Promise<void> {
	await deleteKey(KEY);
	oauthToken = null;
	lastApi = null;
	bus.emit({ type: "settings.changed" });
}

/** The key id inside a key: tskey-auth-<id>-<secret> (API access tokens look the same). */
const keyIdOf = (key: string) => key.match(/^tskey-(?:auth|api)-([A-Za-z0-9]+)-/)?.[1] ?? null;

let tokenExpiry: { id: string; expires: string | null } | null = null;

/** When the API access token expires (asked once per token). */
async function tokenExpires(s: StoredApi): Promise<string | null> {
	if (!s.token) return null;
	const id = keyIdOf(unseal(s.token));
	if (!id) return null;
	if (tokenExpiry?.id === id) return tokenExpiry.expires;
	const k = await tailscaleApi<{ expires?: string }>(`/tailnet/-/keys/${id}`).catch(() => null);
	tokenExpiry = { id, expires: k?.expires ?? null };
	return tokenExpiry.expires;
}

async function authKeyState(key: string): Promise<TailscaleOverview["authKey"]> {
	const base = { set: Boolean(key), expires: null, expired: false, revoked: false, reusable: null };
	const id = key ? keyIdOf(key) : null;
	if (!id || !(await stored())) return base;
	try {
		const k = await tailscaleApi<{
			expires?: string;
			revoked?: string;
			invalid?: boolean;
			capabilities?: { devices?: { create?: { reusable?: boolean } } };
		}>(`/tailnet/-/keys/${id}`);
		if (!k) return base;
		return {
			set: true,
			expires: k.expires ?? null,
			expired: Boolean(k.expires && Date.parse(k.expires) < Date.now()) || Boolean(k.invalid),
			revoked: Boolean(k.revoked),
			reusable: k.capabilities?.devices?.create?.reusable ?? null,
		};
	} catch (err) {
		// A deleted key reads as not found.
		if (/\(404\)/.test(errorMessage(err))) return { ...base, revoked: true };
		return base;
	}
}

/**
 * The key one new machine joins the tailnet with: with the Tailscale API, a single-use key made just for it (valid for
 * an hour, so a bot that reads its machine's setup files finds nothing reusable); otherwise the saved key.
 */
export async function machineAuthKey(saved: string, hostname: string): Promise<string> {
	if (!saved) return saved;
	try {
		const r = await tailscaleApi<{ key: string }>("/tailnet/-/keys", {
			method: "POST",
			body: JSON.stringify({
				capabilities: { devices: { create: { reusable: false, ephemeral: false, preauthorized: true } } },
				expirySeconds: 3600,
				description: `Sekai ${hostname}`.slice(0, 50),
			}),
		});
		return r?.key ?? saved;
	} catch (err) {
		log.warn(`tailscale: couldn't make a one-time key for ${hostname} (${errorMessage(err)}); using the saved one`);
		return saved;
	}
}

/** A fresh reusable auth key for bots' new machines (90 days), saved as the one they join with. */
export async function renewAuthKey(): Promise<TailscaleOverview> {
	const r = await tailscaleApi<{ key: string }>("/tailnet/-/keys", {
		method: "POST",
		body: JSON.stringify({
			capabilities: { devices: { create: { reusable: true, ephemeral: false, preauthorized: true } } },
			expirySeconds: 90 * 24 * 3600,
			description: "Sekai bots' computers",
		}),
	});
	if (!r?.key) throw badRequest("Add a Tailscale API key first");
	const s = await getSettings();
	await updateSettings({ machines: { ...s.machines, tailscaleAuthKey: r.key } });
	log.info("tailscale: made a new auth key for bots' machines");
	return tailscaleOverview();
}

export async function defaultUser(): Promise<string> {
	const v = (await readKey(USER_KEY)) as string | undefined;
	if (v) return v;
	try {
		return userInfo().username;
	} catch {
		return "";
	}
}

export async function setDefaultUser(user: string): Promise<void> {
	const u = user.trim();
	// Same account names as a device (root, sam, …): the shared rule.
	if (!/^[a-z_][\w.$-]*$/i.test(u)) throw badRequest("A Linux, macOS or Windows account name (e.g. sam or root)");
	await writeKey(USER_KEY, u);
}

export async function tailscaleOverview(): Promise<TailscaleOverview> {
	const [{ status, error }, s, settings] = await Promise.all([cliStatus(), stored(), getSettings()]);
	const self = status?.Self;
	const dnsName = trimDot(self?.DNSName) || null;
	const login = self?.UserID !== undefined ? (status?.User?.[String(self.UserID)]?.LoginName ?? null) : null;
	if (s && !lastApi) await apiDevices().catch(() => {});
	return {
		self: {
			running: status?.BackendState === "Running",
			error:
				status && status.BackendState !== "Running"
					? `Tailscale is ${status.BackendState ?? "stopped"}`
					: error,
			name: self?.HostName ?? null,
			dnsName,
			address: self?.TailscaleIPs?.find((ip) => ip.includes(".")) ?? null,
			login,
			version: status?.Version?.split("-")[0] ?? null,
			tailnet: status?.CurrentTailnet?.Name ?? (trimDot(status?.MagicDNSSuffix) || null),
		},
		https: await serveState(dnsName),
		byIp: await byIpState(self?.TailscaleIPs?.find((ip) => ip.includes(".")) ?? null),
		api: {
			configured: Boolean(s),
			kind: s ? (s.token ? "token" : "oauth") : null,
			ok: s ? (lastApi?.ok ?? null) : null,
			error: s ? (lastApi?.error ?? null) : null,
			devices: s ? (lastApi?.devices ?? null) : null,
			expires: s && lastApi?.ok ? await tokenExpires(s) : null,
			hint:
				!s && /^tskey-auth-/.test(settings.machines.tailscaleAuthKey)
					? "The key under Computers is an auth key: machines join your tailnet with it, but it can't read the tailnet. Add an access token (tskey-api-…) here."
					: null,
		},
		authKey: await authKeyState(settings.machines.tailscaleAuthKey),
		defaultUser: await defaultUser(),
	};
}
