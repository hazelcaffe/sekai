import { timingSafeEqual } from "node:crypto";
import type { Server } from "bun";

export const SESSION_COOKIE = "sekai_session";
/**
 * The name on https: the browser only accepts a __Host- cookie that's Secure, for this exact host and every path,
 * so nothing on a neighbouring subdomain can set or overwrite it.
 */
export const HOST_SESSION_COOKIE = "__Host-sekai_session";
/** The cookie from before the rename (Feesh → Sekai): still signs you in until it expires. */
export const LEGACY_SESSION_COOKIE = "feesh_session";

export function sha256(value: string): string {
	return new Bun.CryptoHasher("sha256").update(value).digest("hex");
}

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** A random base62 string; 43 characters ≈ 256 bits. */
export function randomSecret(length = 43): string {
	const bytes = crypto.getRandomValues(new Uint8Array(length));
	let out = "";
	for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
	return out;
}

export function safeEqual(a: string, b: string): boolean {
	const x = Buffer.from(a);
	const y = Buffer.from(b);
	return x.length === y.length && timingSafeEqual(x, y);
}

export function readCookie(req: Request, name: string): string | null {
	const header = req.headers.get("cookie");
	if (!header) return null;
	for (const part of header.split(";")) {
		const i = part.indexOf("=");
		if (i < 0) continue;
		if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
	}
	return null;
}

/**
 * Where a token may come in the address (?token=) instead of a header: only what a browser opens by itself and
 * can't add headers to (the live event stream, WebSockets, downloads, pictures and files). Elsewhere it would end
 * up in logs and history for nothing.
 */
const QUERY_TOKEN_PATHS = [
	/^\/api\/events$/,
	/^\/api\/machines\/[^/]+\/vnc$/,
	/^\/api\/machines\/bridge$/,
	/^\/api\/voice\/(dictate|call\/[^/]+)$/,
	/^\/api\/uploads\/[^/]+$/,
	/^\/api\/agents\/[^/]+\/export$/,
	/^\/api\/activity\/export$/,
	/^\/api\/usage\/export$/,
	/^\/api\/backups\/[^/]+\/download$/,
	/^\/api\/voice\/messages\/[^/]+\/speech$/,
	/^\/api\/machines\/[^/]+\/screen$/,
	/^\/api\/avatars\/gallery\/[^/]+$/,
];

/** A token from `Authorization: Bearer …`, or `?token=` where a browser can't send headers (see above). */
export function readBearer(req: Request): string | null {
	const header = req.headers.get("authorization") ?? "";
	if (header.startsWith("Bearer ")) return header.slice(7).trim() || null;
	const url = new URL(req.url);
	const token = url.searchParams.get("token");
	if (!token) return null;
	return req.method === "GET" && QUERY_TOKEN_PATHS.some((p) => p.test(url.pathname)) ? token : null;
}

/**
 * Requests that came through a proxy you trust (see markProxy): only then do X-Forwarded-Host and
 * X-Forwarded-Proto count. Anyone can send those headers straight to Sekai.
 */
const viaProxy = new WeakMap<Request, boolean>();

/** Notes whether a request came from a trusted proxy (the app does this first thing for every request). */
export function markProxy(req: Request, server: unknown, trustProxy: readonly string[]): void {
	const ip = socketIp(req, server);
	viaProxy.set(req, Boolean(ip && trusted(ip, trustProxy)));
}

/** Requests the app didn't mark (WebSocket upgrades are checked by origin; tests) keep the old behaviour. */
function forwarded(req: Request, name: string): string | null {
	if (viaProxy.get(req) === false) return null;
	return req.headers.get(name)?.split(",")[0]?.trim() || null;
}

export function isHttps(req: Request): boolean {
	const proto = forwarded(req, "x-forwarded-proto");
	return proto ? proto === "https" : new URL(req.url).protocol === "https:";
}

export function sessionCookie(req: Request, secret: string, maxAgeSeconds: number): string {
	const https = isHttps(req);
	const parts = [
		`${https ? HOST_SESSION_COOKIE : SESSION_COOKIE}=${encodeURIComponent(secret)}`,
		"Path=/",
		"HttpOnly",
		"SameSite=Lax",
		`Max-Age=${maxAgeSeconds}`,
	];
	if (https) parts.push("Secure");
	return parts.join("; ");
}

export function clearSessionCookie(req: Request): string {
	return sessionCookie(req, "", 0);
}

/** The sign-in cookie: the __Host- one, else the plain one (http, or from before), else the one from before the rename. */
export function readSessionCookie(req: Request): string | null {
	return (
		readCookie(req, HOST_SESSION_COOKIE) ??
		readCookie(req, SESSION_COOKIE) ??
		readCookie(req, LEGACY_SESSION_COOKIE)
	);
}

/** Signing out clears the other names too (the plain and pre-rename cookies). */
export function clearLegacySessionCookie(_req: Request): string[] {
	const plain = `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
	return [plain, plain.replace(`${SESSION_COOKIE}=`, `${LEGACY_SESSION_COOKIE}=`)];
}

/** The socket's address (never a forwarded header, which anyone can set). */
export function socketIp(req: Request, server: unknown): string | null {
	const srv = server as Server<unknown> | undefined;
	try {
		return srv?.requestIP?.(req)?.address ?? null;
	} catch {
		return null;
	}
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function isLoopbackIp(ip: string | null): boolean {
	if (!ip) return false;
	return ip === "::1" || ip.startsWith("127.") || ip === "::ffff:127.0.0.1" || ip.startsWith("::ffff:127.");
}

/**
 * Whether the person is sitting at the server itself: the connection comes from loopback and the page was opened
 * on a loopback address. Both checks matter, since a dev proxy forwards remote browsers from 127.0.0.1.
 */
export function isLocalRequest(req: Request, server: unknown): boolean {
	if (!isLoopbackIp(socketIp(req, server))) return false;
	const origin = req.headers.get("origin");
	const host = origin ? safeHostname(origin) : (req.headers.get("host") ?? "").replace(/:\d+$/, "");
	return host !== null && LOOPBACK_HOSTS.has(host);
}

function safeHostname(url: string): string | null {
	try {
		return new URL(url).hostname;
	} catch {
		return null;
	}
}

/** The page's origin, if it matches the host the request was sent to (so it isn't another site). */
export function sameOrigin(req: Request): string | null {
	const origin = req.headers.get("origin");
	if (!origin || origin === "null") return null;
	let url: URL;
	try {
		url = new URL(origin);
	} catch {
		return null;
	}
	const host = forwarded(req, "x-forwarded-host") || req.headers.get("host");
	return host && url.host === host ? url.origin : null;
}

/** The address the page is on: its Origin when sent (and not another site), else the Host it asked for. */
export function requestOrigin(req: Request): string | null {
	if (req.headers.get("origin")) return sameOrigin(req);
	const host = forwarded(req, "x-forwarded-host") || req.headers.get("host");
	return host ? `${isHttps(req) ? "https" : "http"}://${host}` : null;
}

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/** WebAuthn needs a secure context and a domain name: https on a hostname, or plain localhost. */
export function passkeysAvailableFor(origin: string | null): boolean {
	if (!origin) return false;
	const url = new URL(origin);
	if (url.hostname === "localhost") return true;
	return url.protocol === "https:" && !IPV4.test(url.hostname) && !url.hostname.includes(":");
}

// ---------------------------------------------------------------- who's really calling (behind proxies)

function ipv4ToInt(ip: string): number | null {
	const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
	if (!m) return null;
	const parts = m.slice(1).map(Number);
	if (parts.some((p) => p > 255)) return null;
	return (((parts[0] ?? 0) << 24) | ((parts[1] ?? 0) << 16) | ((parts[2] ?? 0) << 8) | (parts[3] ?? 0)) >>> 0;
}

/** Whether an address is in a range ("10.0.0.0/8", "fd7a:115c::/32", or one address). */
export function inRange(ip: string, range: string): boolean {
	const addr = ip.replace(/^::ffff:/, "");
	const [base = "", bitsText] = range.split("/");
	const v4 = ipv4ToInt(addr);
	const b4 = ipv4ToInt(base);
	if (v4 !== null && b4 !== null) {
		const bits = bitsText === undefined ? 32 : Number(bitsText);
		if (!(bits >= 0 && bits <= 32)) return false;
		const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
		return (v4 & mask) === (b4 & mask);
	}
	if (v4 !== null || b4 !== null) return false;
	const expand = (x: string) => {
		const [head = "", tail = ""] = x.split("::");
		const h = head ? head.split(":") : [];
		const t = tail ? tail.split(":") : [];
		const full = x.includes("::") ? [...h, ...Array(8 - h.length - t.length).fill("0"), ...t] : h;
		return full.map((g) => Number.parseInt(g || "0", 16));
	};
	const a = expand(addr.toLowerCase());
	const b = expand(base.toLowerCase());
	if (a.length !== 8 || b.length !== 8 || a.some(Number.isNaN) || b.some(Number.isNaN)) return false;
	let bits = bitsText === undefined ? 128 : Number(bitsText);
	for (let i = 0; i < 8 && bits > 0; i++, bits -= 16) {
		const take = Math.min(16, bits);
		const mask = take === 16 ? 0xffff : (0xffff << (16 - take)) & 0xffff;
		if (((a[i] ?? 0) & mask) !== ((b[i] ?? 0) & mask)) return false;
	}
	return true;
}

function trusted(ip: string, extra: readonly string[]): boolean {
	return isLoopbackIp(ip) || extra.some((r) => inRange(ip, r));
}

/**
 * The address a request really came from: the socket's, or, when that's a proxy you trust, the last address in
 * X-Forwarded-For that isn't one of your proxies (anyone can put anything at the start of that header).
 */
export function clientIp(req: Request, server: unknown, trustProxy: readonly string[] = []): string | null {
	const socket = socketIp(req, server);
	if (!socket || !trusted(socket, trustProxy)) return socket;
	const chain = (req.headers.get("x-forwarded-for") ?? "")
		.split(",")
		.map((x) => x.trim())
		.filter(Boolean);
	for (let i = chain.length - 1; i >= 0; i--) {
		const hop = chain[i] as string;
		if (!trusted(hop, trustProxy)) return hop;
	}
	return chain[0] ?? socket;
}
