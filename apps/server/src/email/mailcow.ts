import { guardedFetch } from "../lib/net.ts";

/**
 * A small client for mailcow's API (/api/v1, key in X-API-Key): the domains it serves, and bots' mailboxes on them.
 * Write calls answer 200 even when they fail, with a list of {type, msg} messages; those become MailcowError with a
 * sentence a person understands.
 */

export class MailcowError extends Error {
	constructor(
		message: string,
		/** mailcow's own message key ("object_exists"…), or the HTTP status for transport problems. */
		readonly code: string,
	) {
		super(message);
		this.name = "MailcowError";
	}
}

export interface MailcowDomain {
	name: string;
	active: boolean;
	mailboxes: number;
	/** Mailboxes the domain may still get (null: no limit). */
	mailboxesLeft: number | null;
	/** What a new mailbox gets by default, and the most it may get, in MiB. */
	defaultQuotaMb: number;
	maxQuotaMb: number;
}

export interface MailcowMailbox {
	address: string;
	name: string;
	active: boolean;
	/** Bytes; 0 = no limit. */
	quotaBytes: number;
	usedBytes: number;
	messages: number;
}

export interface MailboxCreate {
	localPart: string;
	domain: string;
	name: string;
	password: string;
	quotaMb: number;
	active?: boolean;
}

export interface MailboxChange {
	name?: string;
	password?: string;
	quotaMb?: number;
	active?: boolean;
}

/** What mailcow's message keys mean, for people. */
const MESSAGES: Record<string, string> = {
	object_exists: "That address is already taken. Pick another name.",
	domain_not_found: "mailcow doesn't serve that domain.",
	domain_invalid: "mailcow doesn't serve that domain.",
	access_denied: "The mailcow key isn't allowed to do that.",
	password_complexity: "mailcow's password rules refused the generated password.",
	password_mismatch: "mailcow's password rules refused the generated password.",
	max_mailbox_exceeded: "That domain has no room for another mailbox in mailcow.",
	mailbox_quota_exceeded: "That mailbox size is more than the domain allows.",
	mailbox_quota_left_exceeded: "The domain has no space left for a mailbox that size.",
	mailbox_invalid: "That isn't a valid address.",
	mailbox_quota_exceeds_domain_quota: "That mailbox size is more than the domain allows.",
	goto_invalid: "That isn't a valid address.",
};

type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface RawMessage {
	type?: string;
	msg?: unknown;
}

/** The message key of one {type, msg}: msg is a key, or a list whose first item is the key. */
function keyOf(m: RawMessage): string {
	if (Array.isArray(m.msg)) return String(m.msg[0] ?? "");
	return typeof m.msg === "string" ? m.msg : "";
}

/** Turns a write call's answer into success, or a MailcowError naming what went wrong. */
export function checkWrite(body: unknown): void {
	const list: RawMessage[] = Array.isArray(body) ? body : body && typeof body === "object" ? [body] : [];
	if (list.length === 0) throw new MailcowError("mailcow gave an answer Sekai didn't understand.", "bad_answer");
	const failed = list.find((m) => m.type === "danger" || m.type === "error");
	if (!failed && list.every((m) => m?.type === "success")) return;
	if (!failed) throw new MailcowError("mailcow didn't confirm the change.", "bad_answer");
	const key = keyOf(failed);
	throw new MailcowError(MESSAGES[key] ?? `mailcow said: ${key || "it couldn't do that"}.`, key || "error");
}

/** An error answer (401/403 and friends) in words. */
function transportError(status: number, msg: string): MailcowError {
	if (/read\/write access denied/i.test(msg))
		return new MailcowError(
			"This mailcow key is read-only. Make a read-write key in mailcow (System → Configuration → Access → API).",
			"read_only",
		);
	if (/api access denied for ip/i.test(msg))
		return new MailcowError(
			"mailcow doesn't accept this key from Sekai's address. Add this server's IP to the key's allowed addresses in mailcow.",
			"ip_denied",
		);
	if (status === 401 || /authentication failed/i.test(msg))
		return new MailcowError("mailcow didn't accept that key. Check it and try again.", "auth");
	return new MailcowError(`mailcow answered ${status}${msg ? `: ${msg}` : ""}.`, String(status));
}

const num = (v: unknown): number => {
	const n = typeof v === "number" ? v : Number(v);
	return Number.isFinite(n) ? n : 0;
};

const MIB = 1024 * 1024;

export class MailcowClient {
	readonly base: string;
	private readonly fetchImpl: Fetch;

	constructor(
		url: string,
		private readonly apiKey: string,
		opts: { fetch?: Fetch } = {},
	) {
		this.base = normalizeMailcowUrl(url);
		this.fetchImpl =
			opts.fetch ??
			((url, init) =>
				guardedFetch(new URL(String(url)), { ...init, maxRedirects: 0, allowPrivate: true, configured: true }));
	}

	private async call(method: "GET" | "POST", path: string, body?: unknown): Promise<unknown> {
		let res: Response;
		try {
			res = await this.fetchImpl(`${this.base}/api/v1/${path}`, {
				method,
				headers: {
					"X-API-Key": this.apiKey,
					accept: "application/json",
					...(body !== undefined ? { "content-type": "application/json" } : {}),
				},
				body: body !== undefined ? JSON.stringify(body) : undefined,
				redirect: "error",
				signal: AbortSignal.timeout(20_000),
			});
		} catch (err) {
			const reason = err instanceof Error ? err.message : String(err);
			throw new MailcowError(`Couldn't reach mailcow at ${this.base} (${reason}).`, "unreachable");
		}
		const text = await res.text();
		let parsed: unknown = null;
		try {
			parsed = text ? JSON.parse(text) : null;
		} catch {
			throw new MailcowError(
				`${this.base} didn't answer like mailcow's API (status ${res.status}). Check the address.`,
				"not_mailcow",
			);
		}
		if (!res.ok) {
			const msg = parsed && typeof parsed === "object" && "msg" in parsed ? String(parsed.msg) : "";
			throw transportError(res.status, msg);
		}
		// Some read calls answer 200 with {type: "error"} (an inactive key on older versions).
		for (const p of (Array.isArray(parsed) ? parsed : [parsed]) as (RawMessage | null)[]) {
			if (p?.type !== "error" && p?.type !== "danger") continue;
			const msg = keyOf(p);
			if (/denied|authentication/i.test(msg)) throw transportError(res.status, msg);
			if (method === "GET") checkWrite([p]);
		}
		return parsed;
	}

	/** mailcow's version, when it says (null on servers that don't). */
	async version(): Promise<string | null> {
		const v = (await this.call("GET", "get/status/version")) as { version?: unknown } | null;
		return typeof v?.version === "string" ? v.version : null;
	}

	async domains(): Promise<MailcowDomain[]> {
		const raw = await this.call("GET", "get/domain/all");
		const list = Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
		return list
			.map((d) => ({
				name: String(d.domain_name ?? ""),
				active: num(d.active) === 1,
				mailboxes: num(d.mboxes_in_domain),
				mailboxesLeft: d.mboxes_left === undefined ? null : num(d.mboxes_left),
				defaultQuotaMb: Math.round(num(d.def_new_mailbox_quota) / MIB),
				maxQuotaMb: Math.round(num(d.max_new_mailbox_quota) / MIB),
			}))
			.filter((d) => d.name)
			.sort((a, b) => a.name.localeCompare(b.name));
	}

	/**
	 * Whether the key may change things: an edit of no mailboxes changes nothing, and a read-only key is refused
	 * before mailcow looks at the list.
	 */
	async canWrite(): Promise<boolean> {
		try {
			await this.call("POST", "edit/mailbox", { items: [], attr: {} });
			return true;
		} catch (err) {
			if (err instanceof MailcowError && err.code === "read_only") return false;
			throw err;
		}
	}

	async createMailbox(m: MailboxCreate): Promise<void> {
		const body = await this.call("POST", "add/mailbox", {
			local_part: m.localPart,
			domain: m.domain,
			name: m.name,
			password: m.password,
			password2: m.password,
			quota: Math.max(0, Math.round(m.quotaMb)),
			active: m.active === false ? 0 : 1,
			force_pw_update: 0,
			force_tfa: 0,
			tls_enforce_in: 0,
			tls_enforce_out: 0,
		});
		checkWrite(body);
	}

	/** One mailbox, or null when mailcow doesn't have it (it answers {} then). */
	async getMailbox(address: string): Promise<MailcowMailbox | null> {
		const raw = (await this.call("GET", `get/mailbox/${encodeURIComponent(address)}`)) as Record<
			string,
			unknown
		> | null;
		if (!raw || Array.isArray(raw) || !raw.username) return null;
		return {
			address: String(raw.username),
			name: String(raw.name ?? ""),
			active: num(raw.active) === 1,
			quotaBytes: num(raw.quota),
			usedBytes: num(raw.quota_used),
			messages: num(raw.messages),
		};
	}

	async updateMailbox(address: string, change: MailboxChange): Promise<void> {
		const attr: Record<string, unknown> = {};
		if (change.name !== undefined) attr.name = change.name;
		if (change.password !== undefined) {
			attr.password = change.password;
			attr.password2 = change.password;
		}
		if (change.quotaMb !== undefined) attr.quota = Math.max(0, Math.round(change.quotaMb));
		if (change.active !== undefined) attr.active = change.active ? 1 : 0;
		const body = await this.call("POST", "edit/mailbox", { items: [address], attr });
		checkWrite(body);
	}

	async deleteMailbox(address: string): Promise<void> {
		const body = await this.call("POST", "delete/mailbox", [address]);
		checkWrite(body);
	}
}

/** "mail.example.com" or "https://mail.example.com/" → "https://mail.example.com". */
export function normalizeMailcowUrl(url: string): string {
	const t = url.trim().replace(/\/+$/, "");
	if (!t) return "";
	const withScheme = /^https?:\/\//i.test(t) ? t : `https://${t}`;
	const u = new URL(withScheme);
	if (u.protocol !== "https:" || u.username || u.password || u.pathname !== "/" || u.search || u.hash)
		throw new Error("Use the HTTPS address of the mailcow server.");
	return `${u.protocol}//${u.host}`;
}

/** A password mailcow's password rules accept whatever they are: long, with every kind of character. */
export function mailboxPassword(random: (alphabet: string, n: number) => string): string {
	const lower = "abcdefghijkmnopqrstuvwxyz";
	const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
	const digits = "23456789";
	const special = "-_.+!";
	return `${random(lower + upper + digits, 24)}${random(upper, 1)}${random(lower, 1)}${random(digits, 1)}${random(special, 2)}`;
}
