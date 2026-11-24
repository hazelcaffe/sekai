import { createHash } from "node:crypto";
import PostalMime, { addressParser } from "postal-mime";
import { sniffImageMime } from "../lib/mime.ts";

/** Reading an email: its people, threading ids, readable text and files. */

export interface Person {
	address: string;
	name: string;
}

export interface EmailFile {
	name: string;
	/** Images carry their real type, read from their first bytes (labels are often wrong). */
	mime: string;
	data: Uint8Array;
	/** A picture shown inside the email's text (a logo, a signature image). */
	inline: boolean;
}

export interface ParsedEmail {
	/** Without angle brackets; made from the message's bytes when it has none. */
	messageId: string;
	inReplyTo: string | null;
	references: string[];
	from: Person | null;
	/** How many addresses its From line names (only one can be vouched for). */
	fromCount: number;
	replyTo: Person[];
	to: Person[];
	cc: Person[];
	subject: string;
	/** Its Date, when it parses. */
	date: number | null;
	/** Readable text: the plain part, else the HTML part turned into text. */
	text: string;
	html: string | null;
	files: EmailFile[];
	/** Every header in order, top first (names in lower case). */
	headers: { key: string; value: string }[];
	/** Authentication-Results values, topmost first. */
	authResults: string[];
	/** Sent by a machine: a bounce, an auto-reply, a newsletter or a list. Never acted on. */
	automated: boolean;
}

/** "<a@b> <c@d>" (or bare ids) → ["a@b", "c@d"]. */
export function idList(value: string | null | undefined): string[] {
	if (!value) return [];
	const bracketed = [...value.matchAll(/<([^<>\s]+)>/g)].map((m) => m[1] as string);
	if (bracketed.length) return bracketed;
	return value.split(/[\s,]+/).filter((v) => v.includes("@"));
}

/** The ids that tie a message to earlier ones, nearest first: In-Reply-To, then References from the end. */
export function threadKeys(m: { inReplyTo: string | null; references: string[] }): string[] {
	return [...new Set([...(m.inReplyTo ? [m.inReplyTo] : []), ...[...m.references].reverse()])];
}

/** The References a reply to this message carries: its own, then its id (kept to a sensible length). */
export function replyReferences(m: { messageId: string; references: string[]; inReplyTo: string | null }): string[] {
	const refs = m.references.length ? m.references : m.inReplyTo ? [m.inReplyTo] : [];
	const all = [...refs.filter((r) => r !== m.messageId), m.messageId];
	// Long threads keep the first one (the thread's start) and the latest.
	return all.length > 20 ? [all[0] as string, ...all.slice(-19)] : all;
}

/** Whether a machine sent it (RFC 3834 and the usual list and bounce signs). */
export function isAutomated(headers: { key: string; value: string }[], from: string | null): boolean {
	const get = (k: string) =>
		headers
			.find((h) => h.key === k)
			?.value.trim()
			.toLowerCase();
	const auto = get("auto-submitted");
	if (auto && auto !== "no") return true;
	if (/^(bulk|junk|list|auto_reply)$/.test(get("precedence") ?? "")) return true;
	if (headers.some((h) => h.key === "list-id" || h.key === "list-unsubscribe")) return true;
	if (headers.some((h) => /^x-auto(reply|respond|-response-suppress)/.test(h.key))) return true;
	if (get("return-path") === "<>") return true;
	return Boolean(from && /^(mailer-daemon|postmaster|no-?reply|do-?not-?reply)@/i.test(from));
}

const ENTITIES: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: " ",
	ndash: "–",
	mdash: "—",
	hellip: "…",
	rsquo: "’",
	lsquo: "‘",
	rdquo: "”",
	ldquo: "“",
	copy: "©",
	reg: "®",
	trade: "™",
	euro: "€",
	middot: "·",
	bull: "•",
};

function decodeEntities(s: string): string {
	return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
		if (e[0] === "#") {
			const code = e[1] === "x" || e[1] === "X" ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1));
			return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
		}
		return ENTITIES[e.toLowerCase()] ?? m;
	});
}

/** An email's HTML as readable text: paragraphs, lists, quotes ("> "), and links as "text (address)". */
export function htmlText(html: string): string {
	let s = html
		.replace(/<(head|script|style|noscript|svg|template|title)[\s\S]*?<\/\1>/gi, " ")
		.replace(/<!--[\s\S]*?-->/g, " ");
	s = s.replace(/<a\b[^>]*?href\s*=\s*["']?([^"'\s>]+)["']?[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, inner) => {
		const text = decodeEntities(String(inner).replace(/<[^>]+>/g, "")).trim();
		const url = decodeEntities(href);
		if (!/^(https?:|mailto:)/i.test(url) || !text) return text;
		const plain = url.replace(/^mailto:/i, "");
		return text === plain || text === url ? text : `${text} (${plain})`;
	});
	s = s
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<li[^>]*>/gi, "\n• ")
		.replace(/<\/(p|div|section|article|li|h[1-6]|tr|table|header|footer|ul|ol|pre)>/gi, "\n")
		.replace(/<(p|div|h[1-6]|table|ul|ol|pre)\b[^>]*>/gi, "\n")
		.replace(/<\/t[dh]>/gi, "\t");
	// Quoted earlier mail: each line gets "> ".
	s = s.replace(
		/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi,
		(_m, inner: string) =>
			`\n${htmlText(inner)
				.split("\n")
				.map((l) => `> ${l}`)
				.join("\n")}\n`,
	);
	s = decodeEntities(s.replace(/<[^>]+>/g, ""));
	return s
		.replace(/\r/g, "")
		.replace(/[ \t\f\v\u00a0]+/g, " ")
		.split("\n")
		.map((l) => l.trim())
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

/**
 * The new part of a reply: earlier mail quoted under it ("On … wrote:", "> " lines, Outlook's "Original Message")
 * is dropped, since the chat already has it. Text that's all quote stays as it was.
 */
export function stripQuoted(text: string): string {
	const lines = text.replace(/\r/g, "").split("\n");
	let cut = lines.length;
	for (let i = 0; i < lines.length; i++) {
		const line = (lines[i] as string).trim();
		const next = (lines[i + 1] ?? "").trim();
		const two = `${line} ${next}`;
		if (
			/^-{2,}\s*(original message|forwarded message)\s*-{2,}$/i.test(line) ||
			/^_{5,}$/.test(line) ||
			(/^from:\s/i.test(line) && /^(sent|date):\s/i.test(next))
		) {
			cut = i;
			break;
		}
		if (/^on\b.+\bwrote:$/i.test(line) || (/^on\b/i.test(line) && /\bwrote:$/i.test(two) && line.length < 200)) {
			const rest = lines.slice(i + (/wrote:$/i.test(line) ? 1 : 2));
			if (rest.every((l) => !l.trim() || l.trim().startsWith(">"))) {
				cut = i;
				break;
			}
		}
	}
	let kept = lines.slice(0, cut);
	// A trailing run of "> " lines with nothing after it.
	let end = kept.length;
	while (end > 0 && (!kept[end - 1]?.trim() || kept[end - 1]?.trim().startsWith(">"))) end--;
	if (kept.slice(end).some((l) => l.trim().startsWith(">"))) kept = kept.slice(0, end);
	const out = kept.join("\n").trim();
	return out || text.trim();
}

/** An address as postal-mime gives it: a mailbox, or a named group of them. */
type ParsedAddress = { name: string; address?: string; group?: { name: string; address: string }[] };

const people = (list: ParsedAddress[] | undefined): Person[] =>
	(list ?? []).flatMap((a) =>
		a.group
			? a.group.map((m) => ({ address: m.address.toLowerCase(), name: m.name }))
			: a.address
				? [{ address: a.address.toLowerCase(), name: a.name }]
				: [],
	);

const bytesOf = (content: ArrayBuffer | Uint8Array | string): Uint8Array =>
	typeof content === "string"
		? new TextEncoder().encode(content)
		: content instanceof Uint8Array
			? content
			: new Uint8Array(content);

/** Reads a raw RFC 5322 message. */
export async function parseEmail(raw: Uint8Array | string): Promise<ParsedEmail> {
	const mail = await PostalMime.parse(raw, { attachmentEncoding: "arraybuffer", maxNestingDepth: 50 });
	const headers = mail.headers.map((h) => ({ key: h.key, value: h.value }));
	const fields = headers.filter((h) => h.key === "from");
	const fromList = fields.length === 1 && fields[0] ? people(addressParser(fields[0].value)) : [];
	const from = fromList.length === 1 ? (fromList[0] as Person) : null;
	const messageId =
		idList(mail.messageId)[0] ??
		`no-id.${createHash("sha256")
			.update(typeof raw === "string" ? raw : Buffer.from(raw))
			.digest("hex")
			.slice(0, 24)}@sekai.invalid`;
	const date = mail.date ? Date.parse(mail.date) : Number.NaN;
	const html = mail.html ?? null;
	const text = mail.text?.trim() ? mail.text.replace(/\r/g, "").trim() : html ? htmlText(html) : "";
	const files: EmailFile[] = mail.attachments.map((a, i) => {
		const data = bytesOf(a.content);
		const sniffed = sniffImageMime(data);
		const mime = sniffed ?? (a.mimeType || "application/octet-stream");
		const ext =
			mime
				.split("/")[1]
				?.replace("jpeg", "jpg")
				.replace(/[^a-z0-9]/g, "") || "bin";
		return {
			name: a.filename?.trim() || `attachment-${i + 1}.${ext}`,
			mime,
			data,
			inline: a.disposition === "inline" || Boolean(a.related),
		};
	});
	return {
		messageId,
		inReplyTo: idList(mail.inReplyTo)[0] ?? null,
		references: idList(mail.references),
		from,
		fromCount: fromList.length,
		replyTo: people(mail.replyTo),
		to: people(mail.to),
		cc: people(mail.cc),
		subject: (mail.subject ?? "").replace(/\s+/g, " ").trim(),
		date: Number.isFinite(date) ? date : null,
		text,
		html,
		files,
		headers,
		authResults: headers.filter((h) => h.key === "authentication-results").map((h) => h.value),
		automated: isAutomated(headers, from?.address ?? null),
	};
}

/** A one-line preview. */
export function snippetOf(text: string, max = 160): string {
	const flat = text.replace(/\s+/g, " ").trim();
	return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}
