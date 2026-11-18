import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { currentActor } from "../auth/actor.ts";

/**
 * Where an address points: the internet ("public"), your own network or tailnet ("private": LAN, CGNAT/Tailscale,
 * IPv6 ULA), or this server itself and cloud metadata ("local": loopback, link-local, unspecified).
 */
export type Reach = "public" | "private" | "local";

function reachOfIp(ip: string): Reach {
	const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
	if (isIP(v4) === 4) {
		const [a = 0, b = 0] = v4.split(".").map(Number);
		if (a === 127 || a === 0 || (a === 169 && b === 254)) return "local";
		if (
			a === 10 ||
			(a === 172 && b >= 16 && b <= 31) ||
			(a === 192 && b === 168) ||
			(a === 100 && b >= 64 && b <= 127)
		)
			return "private";
		return "public";
	}
	const v6 = ip.toLowerCase();
	if (
		v6 === "::1" ||
		v6 === "::" ||
		v6.startsWith("fe8") ||
		v6.startsWith("fe9") ||
		v6.startsWith("fea") ||
		v6.startsWith("feb")
	)
		return "local";
	if (v6.startsWith("fc") || v6.startsWith("fd")) return "private";
	return "public";
}

/** Where a host resolves to, and how far that reaches (the narrowest of its addresses). */
async function resolve(url: URL): Promise<{ reach: Reach; ips: string[] }> {
	const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
	if (host === "localhost" || host.endsWith(".localhost") || host === "metadata.google.internal") {
		return { reach: "local", ips: [] };
	}
	const ips = isIP(host)
		? [host]
		: await lookup(host, { all: true }).then(
				(r) => r.map((x) => x.address),
				() => [],
			);
	let worst: Reach = "public";
	for (const ip of ips) {
		const r = reachOfIp(ip);
		if (r === "local") return { reach: "local", ips };
		if (r === "private") worst = "private";
	}
	return { reach: worst, ips };
}

/** The narrowest reach of every address a URL's host resolves to (an unresolvable host counts as public). */
export async function reachOf(url: URL): Promise<Reach> {
	return (await resolve(url)).reach;
}

const reachCache = new Map<string, { reach: Reach; until: number }>();

/** reachOf, remembered for a minute per host (for checking every request a browser page makes). */
export async function cachedReach(url: URL): Promise<Reach> {
	const key = url.hostname.toLowerCase();
	const hit = reachCache.get(key);
	if (hit && hit.until > Date.now()) return hit.reach;
	const reach = await reachOf(url);
	if (reachCache.size > 5000) reachCache.clear();
	reachCache.set(key, { reach, until: Date.now() + 60_000 });
	return reach;
}

/**
 * fetch() that checks every hop of a redirect chain: http(s) only, never this server itself or cloud metadata, and
 * (unless allowPrivate) never your own network either. Only admins' bots reach your own network: for anyone else
 * allowPrivate is ignored, unless an admin set the address up (configured: a text-message webhook, say).
 *
 * Plain http connects to the address that was checked (so a name can't resolve to the internet for the check and to
 * your network for the request); https is held to the name by its certificate.
 */
export async function guardedFetch(
	input: URL,
	init: RequestInit & { allowPrivate?: boolean; maxRedirects?: number; configured?: boolean },
): Promise<Response> {
	const actor = currentActor();
	const allowPrivate = Boolean(init.allowPrivate && (init.configured || !actor || actor.admin));
	const { allowPrivate: _a, maxRedirects: _m, configured: _c, ...rest } = init;
	let url = input;
	for (let hop = 0; hop <= (init.maxRedirects ?? 5); hop++) {
		if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only http(s) addresses");
		const { reach, ips } = await resolve(url);
		if (reach === "local")
			throw new Error(`${url.hostname} is this server itself (or cloud metadata), so it's off limits`);
		if (reach === "private" && !allowPrivate) throw new Error(`${url.hostname} is on your own network`);
		const pinned = url.protocol === "http:" && ips[0] && !isIP(url.hostname.replace(/^\[|\]$/g, ""));
		let target = url;
		const headers = new Headers(rest.headers);
		if (pinned && ips[0]) {
			target = new URL(url);
			target.hostname = isIP(ips[0]) === 6 ? `[${ips[0]}]` : ips[0];
			headers.set("host", url.host);
		}
		const res = await fetch(target, { ...rest, headers, redirect: "manual" });
		const next = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
		if (!next) return res;
		url = new URL(next, url);
	}
	throw new Error("Too many redirects");
}
