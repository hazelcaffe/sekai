import { resolveMx, resolveSrv } from "node:dns/promises";
import type { EmailSecurity, EmailServer, EmailServerGuess } from "@sekai/shared";
import { guardedFetch } from "../lib/net.ts";
import { baseDomain, domainOf } from "./verify.ts";

/**
 * Filling in an email account's servers from its address, the way mail apps do: the domain's own autoconfig file,
 * Mozilla's ISPDB (for the domain, then for its mail host's provider), SRV records (RFC 6186 and 8314), and last a
 * guess (imap. and smtp. at the domain) that the Test button checks.
 */

type ServerPick = EmailServer & { username: string };

function fill(template: string, address: string): string {
	const [local = "", domain = ""] = address.split("@");
	return template
		.replace(/%EMAILADDRESS%/gi, address)
		.replace(/%EMAILLOCALPART%/gi, local)
		.replace(/%EMAILDOMAIN%/gi, domain);
}

const tag = (block: string, name: string) =>
	block.match(new RegExp(`<${name}>\\s*([^<]*?)\\s*</${name}>`, "i"))?.[1] ?? "";

function pick(blocks: string[], address: string, defaultPort: Record<EmailSecurity, number>): ServerPick | null {
	const servers = blocks
		.map((b) => {
			const socket = tag(b, "socketType").toUpperCase();
			const security: EmailSecurity | null =
				socket === "SSL" || socket === "TLS" ? "tls" : socket === "STARTTLS" ? "starttls" : null;
			const host = fill(tag(b, "hostname"), address).toLowerCase();
			const port = Number(tag(b, "port")) || (security ? defaultPort[security] : 0);
			const auth = [...b.matchAll(/<authentication>\s*([^<]*?)\s*<\/authentication>/gi)].map((m) =>
				(m[1] ?? "").toLowerCase(),
			);
			// Plain-text connections and OAuth-only servers are no use: Sekai signs in with a password over TLS.
			const password = !auth.length || auth.some((a) => a.startsWith("password"));
			if (!security || !host || !port || !password) return null;
			return { host, port, security, username: fill(tag(b, "username") || "%EMAILADDRESS%", address) };
		})
		.filter((s): s is ServerPick => Boolean(s));
	return servers.find((s) => s.security === "tls") ?? servers[0] ?? null;
}

/** A Mozilla autoconfig (config-v1.1.xml) file: its IMAP and SMTP servers, encrypted ones first. */
export function parseAutoconfig(
	xml: string,
	address: string,
): { imap: ServerPick; smtp: ServerPick; provider: string | null } | null {
	const incoming = [...xml.matchAll(/<incomingServer\s+type="imap"\s*>([\s\S]*?)<\/incomingServer>/gi)].map(
		(m) => m[1] ?? "",
	);
	const outgoing = [...xml.matchAll(/<outgoingServer\s+type="smtp"\s*>([\s\S]*?)<\/outgoingServer>/gi)].map(
		(m) => m[1] ?? "",
	);
	const imap = pick(incoming, address, { tls: 993, starttls: 143 });
	const smtp = pick(outgoing, address, { tls: 465, starttls: 587 });
	if (!imap || !smtp) return null;
	const provider = tag(xml, "displayName").trim() || null;
	return { imap, smtp, provider };
}

export interface DiscoverDeps {
	fetchText(url: string): Promise<string | null>;
	mx(domain: string): Promise<string[]>;
	srv(name: string): Promise<{ name: string; port: number; priority: number }[]>;
}

const liveDeps: DiscoverDeps = {
	async fetchText(url) {
		try {
			const res = await guardedFetch(new URL(url), {
				headers: { accept: "application/xml,text/xml;q=0.9,*/*;q=0.5" },
				signal: AbortSignal.timeout(6000),
				maxRedirects: 0,
			});
			if (!res.ok) return null;
			const reader = res.body?.getReader();
			if (!reader) return null;
			const chunks: Uint8Array[] = [];
			let size = 0;
			try {
				for (;;) {
					const { value, done } = await reader.read();
					if (done) break;
					size += value.byteLength;
					if (size > 200_000) {
						await reader.cancel();
						return null;
					}
					chunks.push(value);
				}
				return Buffer.concat(chunks).toString("utf8");
			} finally {
				reader.releaseLock();
			}
		} catch {
			return null;
		}
	},
	mx: (domain) =>
		resolveMx(domain).then(
			(r) => r.sort((a, b) => a.priority - b.priority).map((m) => m.exchange.toLowerCase()),
			() => [],
		),
	srv: (name) => resolveSrv(name).catch(() => []),
};

function guess(
	found: { imap: ServerPick; smtp: ServerPick; provider: string | null },
	source: EmailServerGuess["source"],
): EmailServerGuess {
	const { username, ...imap } = found.imap;
	const { username: _u, ...smtp } = found.smtp;
	return { imap, smtp, username, source, provider: found.provider };
}

/** The servers for an address, from the best source that knows them. */
export async function discoverServers(address: string, deps: DiscoverDeps = liveDeps): Promise<EmailServerGuess> {
	const email = address.trim().toLowerCase();
	const domain = domainOf(email);
	const q = `emailaddress=${encodeURIComponent(email)}`;
	const tryConfig = async (urls: string[]) => {
		for (const url of urls) {
			const xml = await deps.fetchText(url);
			const found = xml ? parseAutoconfig(xml, email) : null;
			if (found) return found;
		}
		return null;
	};

	// The domain's own file (mailcow and many hosts serve one; some only over plain http).
	const own = await tryConfig([
		`https://autoconfig.${domain}/mail/config-v1.1.xml?${q}`,
		`https://${domain}/.well-known/autoconfig/mail/config-v1.1.xml?${q}`,
	]);
	if (own) return guess(own, "autoconfig");

	const ispdb = await tryConfig([`https://autoconfig.thunderbird.net/v1.1/${encodeURIComponent(domain)}`]);
	if (ispdb) return guess(ispdb, "ispdb");

	// A domain hosted by a provider (Google Workspace, Fastmail…): its mail host's provider is in the ISPDB.
	const [mx] = await deps.mx(domain);
	if (mx) {
		const provider = baseDomain(mx);
		if (provider && provider !== domain) {
			const viaMx = await tryConfig([`https://autoconfig.thunderbird.net/v1.1/${encodeURIComponent(provider)}`]);
			if (viaMx) return guess(viaMx, "ispdb");
		}
	}

	const srv = async (names: [string, EmailSecurity][]) => {
		for (const [name, security] of names) {
			const records = (await deps.srv(`${name}.${domain}`)).filter((r) => r.name && r.name !== ".");
			const best = records.sort((a, b) => a.priority - b.priority)[0];
			if (best) return { host: best.name.toLowerCase().replace(/\.$/, ""), port: best.port, security };
		}
		return null;
	};
	const imapSrv = await srv([
		["_imaps._tcp", "tls"],
		["_imap._tcp", "starttls"],
	]);
	const smtpSrv = await srv([
		["_submissions._tcp", "tls"],
		["_submission._tcp", "starttls"],
	]);
	if (imapSrv && smtpSrv) return { imap: imapSrv, smtp: smtpSrv, username: email, source: "dns", provider: null };

	return {
		imap: imapSrv ?? { host: `imap.${domain}`, port: 993, security: "tls" },
		smtp: smtpSrv ?? { host: `smtp.${domain}`, port: 465, security: "tls" },
		username: email,
		source: "guess",
		provider: null,
	};
}
