import { chunkText } from "./format.ts";

/**
 * Markdown to Signal: Signal messages are plain text plus style ranges (bold, italic, strikethrough, monospace,
 * spoiler) and mention ranges, counted in UTF-16 code units (what JavaScript's string length counts). Links stay
 * as their address so Signal makes them tappable; headings become bold lines and lists get bullets.
 */

export type SignalStyle = "BOLD" | "ITALIC" | "STRIKETHROUGH" | "MONOSPACE" | "SPOILER";

export interface SignalText {
	text: string;
	/** signal-cli's text-style ranges: "start:length:STYLE". */
	styles: string[];
	/** signal-cli's mention ranges: "start:length:ACI". */
	mentions: string[];
}

/** How Sekai writes a mention of a Signal account in Markdown (the adapter's mention()). */
export const mentionToken = (aci: string) => `<@${aci}>`;
/** What a mention takes up in the text: Signal shows the person's name in its place. */
const MENTION_CHAR = "\uFFFC";
/** Signal sends longer text as an attachment; keep each message within this (UTF-8 bytes). */
export const SIGNAL_MAX_BYTES = 2000;

const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const MENTION_AT = new RegExp(`^<@(${UUID})>`);

class Builder {
	text = "";
	private ranges: { start: number; length: number; style: SignalStyle }[] = [];
	private people: { start: number; aci: string }[] = [];

	add(s: string): void {
		this.text += s;
	}
	styled(style: SignalStyle, fn: () => void): void {
		const start = this.text.length;
		fn();
		const length = this.text.length - start;
		if (length > 0) this.ranges.push({ start, length, style });
	}
	mention(aci: string): void {
		this.people.push({ start: this.text.length, aci });
		this.text += MENTION_CHAR;
	}
	/** Drops trailing whitespace (ranges are clipped to the text that's left). */
	done(): SignalText {
		const text = this.text.replace(/\s+$/, "");
		const clip = (start: number, length: number) => Math.max(0, Math.min(start + length, text.length) - start);
		return {
			text,
			styles: this.ranges
				.map((r) => ({ ...r, length: clip(r.start, r.length) }))
				.filter((r) => r.length > 0)
				.sort((a, b) => a.start - b.start || b.length - a.length)
				.map((r) => `${r.start}:${r.length}:${r.style}`),
			mentions: this.people.filter((p) => p.start < text.length).map((p) => `${p.start}:1:${p.aci}`),
		};
	}
}

const isSpace = (c: string | undefined) => c === undefined || /\s/.test(c);
const isWord = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}_]/u.test(c);

/** Where a run of `delim` closes in `src` after `from`, or -1 (code spans are skipped, never closed inside). */
function closer(src: string, from: number, delim: string): number {
	let i = from;
	while (i < src.length) {
		const c = src[i];
		if (c === "\\") {
			i += 2;
			continue;
		}
		if (c === "`") {
			const end = src.indexOf("`", i + 1);
			if (end === -1) return -1;
			i = end + 1;
			continue;
		}
		if (src.startsWith(delim, i) && !isSpace(src[i - 1])) {
			// Single * and _ need a non-word character after them (so snake_case and 2*3*4 stay as they are).
			if (delim.length === 1 && (isWord(src[i + delim.length]) || src[i + 1] === delim)) {
				i++;
				continue;
			}
			return i;
		}
		i++;
	}
	return -1;
}

/** The address in a link's (…), allowing one level of brackets in it (Wikipedia links). */
function linkTarget(src: string, open: number): { url: string; end: number } | null {
	let depth = 0;
	for (let i = open; i < src.length; i++) {
		const c = src[i];
		if (c === "(") depth++;
		else if (c === ")") {
			depth--;
			if (depth === 0) {
				const raw = src.slice(open + 1, i).trim();
				const url = raw.replace(/^<|>$/g, "").replace(/\s+"[^"]*"$/, "");
				return /^(https?:\/\/|mailto:)\S+$/i.test(url) ? { url, end: i + 1 } : null;
			}
		} else if (c === "\n") return null;
	}
	return null;
}

function inline(src: string, b: Builder): void {
	let i = 0;
	while (i < src.length) {
		const c = src[i] ?? "";
		const rest = src.slice(i);
		// Escaped punctuation is the character itself.
		if (c === "\\" && /[\\`*_{}[\]()#+\-.!|~<>]/.test(src[i + 1] ?? "")) {
			b.add(src[i + 1] ?? "");
			i += 2;
			continue;
		}
		if (c === "`") {
			const ticks = /^`+/.exec(rest)?.[0] ?? "`";
			const end = src.indexOf(ticks, i + ticks.length);
			if (end !== -1) {
				const code = src.slice(i + ticks.length, end).replace(/^ (.+) $/, "$1");
				b.styled("MONOSPACE", () => b.add(code));
				i = end + ticks.length;
				continue;
			}
		}
		if (c === "<") {
			const m = MENTION_AT.exec(rest);
			if (m?.[1]) {
				b.mention(m[1].toLowerCase());
				i += m[0].length;
				continue;
			}
			const auto = /^<((?:https?:\/\/|mailto:)[^\s>]+)>/i.exec(rest);
			if (auto?.[1]) {
				b.add(auto[1]);
				i += auto[0].length;
				continue;
			}
		}
		// Bare addresses as they are: a _ or * inside one is part of it, not emphasis.
		if ((c === "h" || c === "H") && !isWord(src[i - 1])) {
			const url = /^https?:\/\/[^\s<>]+/i.exec(rest)?.[0];
			if (url) {
				const trimmed = url.replace(/[.,;:!?)\]]+$/, "");
				b.add(trimmed);
				i += trimmed.length;
				continue;
			}
		}
		if (c === "!" && src[i + 1] === "[") {
			const close = src.indexOf("]", i + 2);
			const target = close !== -1 && src[close + 1] === "(" ? linkTarget(src, close + 1) : null;
			if (target) {
				const alt = src.slice(i + 2, close).trim();
				b.add(alt ? `${alt} (${target.url})` : target.url);
				i = target.end;
				continue;
			}
		}
		if (c === "[") {
			const close = src.indexOf("]", i + 1);
			const target = close !== -1 && src[close + 1] === "(" ? linkTarget(src, close + 1) : null;
			if (target) {
				const label = src.slice(i + 1, close);
				const plain = label.replace(/[*_`~|]/g, "").trim();
				if (!plain || plain === target.url || `mailto:${plain}` === target.url) b.add(target.url);
				else {
					inline(label, b);
					b.add(` (${target.url})`);
				}
				i = target.end;
				continue;
			}
		}
		const pairs: [string, SignalStyle][] = [
			["***", "BOLD"],
			["**", "BOLD"],
			["__", "BOLD"],
			["~~", "STRIKETHROUGH"],
			["||", "SPOILER"],
		];
		let matched = false;
		for (const [delim, style] of pairs) {
			if (!rest.startsWith(delim) || isSpace(src[i + delim.length])) continue;
			// __bold__ only at a word's edge, like _italic_.
			if (delim === "__" && isWord(src[i - 1])) continue;
			const end = closer(src, i + delim.length, delim);
			if (end === -1) continue;
			const inner = src.slice(i + delim.length, end);
			if (delim === "***") b.styled("BOLD", () => b.styled("ITALIC", () => inline(inner, b)));
			else b.styled(style, () => inline(inner, b));
			i = end + delim.length;
			matched = true;
			break;
		}
		if (matched) continue;
		if ((c === "*" || c === "_") && !isSpace(src[i + 1]) && src[i + 1] !== c && !isWord(src[i - 1])) {
			const end = closer(src, i + 1, c);
			if (end !== -1) {
				b.styled("ITALIC", () => inline(src.slice(i + 1, end), b));
				i = end + 1;
				continue;
			}
		}
		b.add(c);
		i++;
	}
}

const TABLE_ROW = /^\s*\|?.*\|.*$/;
const TABLE_RULE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

/** Markdown (a reply, or one of its parts) as Signal text with its styles and mentions. */
export function toSignalText(markdown: string): SignalText {
	const b = new Builder();
	const lines = markdown
		.replace(/\r\n?/g, "\n")
		.replace(/\uFFFC/g, "")
		.split("\n");
	for (let n = 0; n < lines.length; n++) {
		const line = lines[n] ?? "";
		const fence = /^\s*(```|~~~)/.exec(line);
		if (fence?.[1]) {
			// A code block: its lines as they are, in monospace, without the fences.
			const body: string[] = [];
			let m = n + 1;
			while (m < lines.length && !(lines[m] ?? "").trim().startsWith(fence[1])) body.push(lines[m++] ?? "");
			if (body.length) b.styled("MONOSPACE", () => b.add(body.join("\n")));
			n = m;
			if (n < lines.length - 1) b.add("\n");
			continue;
		}
		if (TABLE_ROW.test(line) && TABLE_RULE.test(lines[n + 1] ?? "")) {
			// Signal has no tables: keep it lined up in monospace.
			const rows = [line];
			let m = n + 1;
			while (m < lines.length && TABLE_ROW.test(lines[m] ?? "") && (lines[m] ?? "").trim())
				rows.push(lines[m++] ?? "");
			b.styled("MONOSPACE", () => b.add(rows.map((r) => r.trim()).join("\n")));
			n = m - 1;
			if (n < lines.length - 1) b.add("\n");
			continue;
		}
		const heading = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
		if (heading?.[1]) {
			const text = heading[1];
			b.styled("BOLD", () => inline(text, b));
		} else if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
			b.add("———");
		} else if (/^-#\s+/.test(line)) {
			// Discord's small print, which Sekai's own notices use: plain text here.
			inline(line.replace(/^-#\s+/, ""), b);
		} else {
			const bullet = /^(\s*)[-*+]\s+(.*)$/.exec(line);
			const quote = /^\s*>\s?(.*)$/.exec(line);
			if (bullet) {
				b.add(`${bullet[1] ?? ""}• `);
				inline(bullet[2] ?? "", b);
			} else if (quote) {
				b.add("> ");
				inline(quote[1] ?? "", b);
			} else inline(line, b);
		}
		if (n < lines.length - 1) b.add("\n");
	}
	return b.done();
}

const utf8 = (s: string) => Buffer.byteLength(s, "utf8");

/**
 * A reply in Markdown, split into parts that each fit one Signal message (2,000 bytes once styled): at paragraphs,
 * lines or words, with code blocks closed and reopened across parts.
 */
export function signalChunks(markdown: string, maxBytes = SIGNAL_MAX_BYTES): string[] {
	const out: string[] = [];
	const fit = (part: string, limit: number) => {
		if (utf8(toSignalText(part).text) <= maxBytes || limit < 50) {
			out.push(part);
			return;
		}
		const bytes = utf8(toSignalText(part).text);
		const next = Math.max(50, Math.floor(Math.min(limit, part.length) * (maxBytes / bytes) * 0.9));
		for (const p of chunkText(part, next)) fit(p, next);
	};
	for (const part of chunkText(markdown, maxBytes)) fit(part, maxBytes);
	return out;
}

const MARKS: Record<string, string> = {
	BOLD: "**",
	ITALIC: "*",
	STRIKETHROUGH: "~~",
	MONOSPACE: "`",
	SPOILER: "||",
};

/**
 * A message someone sent, as Markdown for the bot: its mentions (ranges Signal shows as names) become mention
 * tokens, and its styles become Markdown marks. Ranges are UTF-16 offsets into the original text.
 */
export function fromSignalText(
	text: string,
	mentions: { start: number; length: number; id: string }[],
	styles: { style: string; start: number; length: number }[] = [],
): string {
	const inRange = (start: number, length: number) => length > 0 && start >= 0 && start + length <= text.length;
	const at = new Map<number, { open: string[]; close: string[] }>();
	const slot = (n: number) => {
		let s = at.get(n);
		if (!s) {
			s = { open: [], close: [] };
			at.set(n, s);
		}
		return s;
	};
	for (const s of styles) {
		const mark = MARKS[s.style];
		if (!mark || !inRange(s.start, s.length)) continue;
		slot(s.start).open.push(mark);
		slot(s.start + s.length).close.unshift(mark);
	}
	const people = new Map<number, { length: number; id: string }>();
	for (const m of mentions) if (inRange(m.start, m.length)) people.set(m.start, m);
	let out = "";
	for (let i = 0; i <= text.length; ) {
		const s = at.get(i);
		if (s) out += s.close.join("") + s.open.join("");
		if (i === text.length) break;
		const person = people.get(i);
		if (person) {
			out += mentionToken(person.id);
			// Marks that open or close inside a mention land after it.
			for (let j = i + 1; j < i + person.length; j++) {
				const inner = at.get(j);
				if (inner) out += inner.close.join("") + inner.open.join("");
			}
			i += person.length;
			continue;
		}
		out += text[i];
		i++;
	}
	return out.replace(/\uFFFC/g, "");
}
