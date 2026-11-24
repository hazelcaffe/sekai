/*
 * Who really sent an email. A From line is easy to fake, so a sender counts only when something vouched for it:
 * the receiving server's own Authentication-Results (DMARC pass, or SPF or DKIM aligned with the From domain).
 * Local delivery within mailcow can instead prove its own domain signature over the full email.
 *
 * Senders can put Authentication-Results lines in their own mail. The receiving server adds its line on top of
 * everything that came in, so only the topmost one is read, and only when it names a server this mailbox trusts.
 */

export interface AuthResult {
	method: string;
	result: string;
	/** reason, header.from, smtp.mailfrom, header.d…, lower-case keys. */
	props: Record<string, string>;
}

export interface AuthResults {
	/** The server that wrote it ("" when it left its name out, as some do). */
	authservId: string;
	results: AuthResult[];
}

/** Drops (comments), nested ones too, outside quoted strings. */
function stripComments(s: string): string {
	let out = "";
	let depth = 0;
	let quoted = false;
	for (let i = 0; i < s.length; i++) {
		const c = s[i] as string;
		if (quoted) {
			if (depth === 0) out += c;
			if (c === "\\") {
				if (depth === 0) out += s[i + 1] ?? "";
				i++;
			} else if (c === '"') quoted = false;
			continue;
		}
		if (c === '"' && depth === 0) {
			quoted = true;
			out += c;
		} else if (c === "(") depth++;
		else if (c === ")" && depth > 0) {
			depth--;
			if (depth === 0) out += " ";
		} else if (depth === 0) out += c;
	}
	return out;
}

/** Splits on a separator outside quoted strings. */
function splitOutsideQuotes(s: string, sep: RegExp): string[] {
	const out: string[] = [];
	let cur = "";
	let quoted = false;
	for (let i = 0; i < s.length; i++) {
		const c = s[i] as string;
		if (c === '"') quoted = !quoted;
		if (!quoted && sep.test(c)) {
			out.push(cur);
			cur = "";
			continue;
		}
		cur += c;
	}
	out.push(cur);
	return out.map((x) => x.trim()).filter(Boolean);
}

const unquote = (v: string) => (v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1).replace(/\\(.)/g, "$1") : v);

/** One Authentication-Results value (RFC 8601). */
export function parseAuthResults(value: string): AuthResults {
	const parts = splitOutsideQuotes(stripComments(value.replace(/\r?\n/g, " ")), /;/);
	let authservId = "";
	if (parts.length && !(parts[0] as string).includes("=")) {
		authservId = ((parts.shift() as string).split(/\s+/)[0] ?? "").toLowerCase();
	}
	const results: AuthResult[] = [];
	for (const part of parts) {
		const tokens = splitOutsideQuotes(part, /\s/);
		const head = tokens.shift() ?? "";
		const eq = head.indexOf("=");
		if (eq === -1) continue;
		const method = head.slice(0, eq).split("/")[0]?.toLowerCase() ?? "";
		const result = head
			.slice(eq + 1)
			.toLowerCase()
			.trim();
		if (method === "none" || !method) continue;
		const props: Record<string, string> = {};
		for (const t of tokens) {
			const i = t.indexOf("=");
			if (i > 0) props[t.slice(0, i).toLowerCase()] = unquote(t.slice(i + 1));
		}
		results.push({ method, result, props });
	}
	return { authservId, results };
}

/** The domain of an address or a bare domain, lower case, without a trailing dot. */
export function domainOf(value: string): string {
	return value
		.slice(value.lastIndexOf("@") + 1)
		.trim()
		.toLowerCase()
		.replace(/\.$/, "")
		.replace(/^<|>$/g, "");
}

/**
 * Strict alignment for individual SPF/DKIM results. Only the receiver's DMARC verdict may use relaxed alignment.
 */
export function aligned(domain: string, fromDomain: string): boolean {
	const a = domainOf(domain);
	const b = domainOf(fromDomain);
	if (!a || !b || !a.includes(".") || !b.includes(".")) return false;
	return a === b;
}

/** The part of a mail server's name that's the provider's own: "mx3.messagingengine.com" → "messagingengine.com". */
export function baseDomain(host: string): string {
	const labels = host.toLowerCase().replace(/\.$/, "").split(".").filter(Boolean);
	if (labels.length <= 2) return labels.join(".");
	const second = labels[labels.length - 2] as string;
	const tld = labels[labels.length - 1] as string;
	// example.co.uk, example.com.au: the registry's own second level.
	const take = tld.length === 2 && second.length <= 3 ? 3 : 2;
	return labels.slice(-take).join(".");
}

/** Whether an authserv-id exactly names one of this mailbox's receiving servers. */
export function trustedServer(authservId: string, trusted: string[]): boolean {
	const id = authservId.toLowerCase();
	if (!id) return false;
	return trusted.some((t) => {
		const s = t.toLowerCase();
		return s.includes(".") && id === s;
	});
}

export type VerifiedBy = "dmarc" | "dkim" | "spf" | "signature";

export interface SenderVerdict {
	verified: boolean;
	by: VerifiedBy | null;
	/** In words, for logs and the bot. */
	reason: string;
}

export interface SenderCheck {
	/** The From address (one, lower case), or null when there's none or several. */
	from: string | null;
	/** Authentication-Results values, topmost first. */
	authResults: string[];
	/** Names of the mail servers that received it for this mailbox (theirs is the only verdict that counts). */
	trustedServers: string[];
	/** DKIM checked here, used when there's no trusted verdict. */
	localSignature: boolean;
}

/** Whether the message's own servers vouched for its From address. */
export function senderVerdict(input: SenderCheck): SenderVerdict {
	const no = (reason: string): SenderVerdict => ({ verified: false, by: null, reason });
	const yes = (by: VerifiedBy, reason: string): SenderVerdict => ({ verified: true, by, reason });
	if (!input.from) return no("it has no single From address");
	const from = input.from.toLowerCase();
	const fromDomain = domainOf(from);
	const top = input.authResults[0];
	const verdict = top ? parseAuthResults(top) : null;
	if (verdict && trustedServer(verdict.authservId, input.trustedServers)) {
		const r = verdict.results;
		const dmarc = r.filter((x) => x.method === "dmarc");
		if (dmarc.some((x) => x.result === "fail")) return no(`DMARC failed at ${verdict.authservId}`);
		if (dmarc.some((x) => x.result === "pass" && domainOf(x.props["header.from"] ?? "") === fromDomain))
			return yes("dmarc", `DMARC passed at ${verdict.authservId}`);
		const dkim = r.find((x) => {
			if (x.method !== "dkim" || x.result !== "pass") return false;
			const d = x.props["header.d"] ?? (x.props["header.i"] ? domainOf(x.props["header.i"]) : "");
			return Boolean(d) && aligned(d, fromDomain);
		});
		if (dkim) return yes("dkim", `DKIM passed for ${fromDomain} at ${verdict.authservId}`);
		const spf = r.find((x) => {
			if (x.method !== "spf" || x.result !== "pass") return false;
			const mailFrom = x.props["smtp.mailfrom"] ?? "";
			return Boolean(mailFrom) && aligned(domainOf(mailFrom), fromDomain);
		});
		if (spf) return yes("spf", `SPF passed for ${fromDomain} at ${verdict.authservId}`);
		return no(`${verdict.authservId} couldn't verify ${fromDomain}`);
	}
	return input.localSignature
		? yes("signature", `the local domain ${fromDomain} signed it`)
		: no("nothing vouched for the sender");
}

/** Only fields prepended on our side of the receiving hop can speak for that hop. */
export function receivingResults(headers: { key: string; value: string }[], trusted: string[]): string[] {
	const hop = headers.findIndex((h) => h.key === "received");
	const by = hop < 0 ? "" : (headers[hop]?.value.match(/\bby\s+([\w.-]+)/i)?.[1] ?? "");
	if (!trustedServer(by, trusted)) return [];
	return headers
		.slice(0, hop)
		.filter((h) => h.key === "authentication-results")
		.map((h) => h.value);
}
