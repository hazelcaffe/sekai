/** Rough token estimate (≈4 chars per token). Good enough for budgeting and the context meter. */
export function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

export function truncate(text: string, max: number, marker = "…"): string {
	if (text.length <= max) return text;
	return text.slice(0, Math.max(0, max - marker.length)) + marker;
}

/** Keeps the head and tail of long tool output so both the start and the conclusion survive. */
export function truncateMiddle(text: string, max: number): string {
	if (text.length <= max) return text;
	const keep = Math.floor((max - 60) / 2);
	const dropped = text.length - keep * 2;
	return `${text.slice(0, keep)}\n\n[… ${dropped} characters truncated …]\n\n${text.slice(-keep)}`;
}

/** Extracts the first JSON object or array from model output (handles ```json fences and chatter). */
export function extractJson(text: string): unknown {
	const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
	const candidate = fenced?.[1] ?? text;
	const start = candidate.search(/[[{]/);
	if (start < 0) throw new Error("No JSON found");
	const open = candidate[start];
	const close = open === "{" ? "}" : "]";
	const end = candidate.lastIndexOf(close);
	if (end <= start) throw new Error("Unterminated JSON");
	return JSON.parse(candidate.slice(start, end + 1));
}

export function slugify(text: string, max = 40): string {
	return (
		text
			.toLowerCase()
			.normalize("NFKD")
			.replace(/[^\w\s-]/g, "")
			.trim()
			.replace(/[\s_]+/g, "-")
			.replace(/-+/g, "-")
			.slice(0, max)
			.replace(/^-|-$/g, "") || "item"
	);
}

/** Very small HTML → text conversion for web_fetch. */
export function htmlToText(html: string): string {
	return (
		html
			.replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, " ")
			.replace(/<!--[\s\S]*?-->/g, " ")
			.replace(/<br\s*\/?>/gi, "\n")
			.replace(/<\/(p|div|section|article|li|h[1-6]|tr|header|footer|blockquote|pre)>/gi, "\n")
			.replace(/<li[^>]*>/gi, "• ")
			.replace(/<[^>]+>/g, " ")
			.replace(/&nbsp;/g, " ")
			.replace(/&lt;/g, "<")
			.replace(/&gt;/g, ">")
			.replace(/&quot;/g, '"')
			.replace(/&#39;/g, "'")
			// Last, so "&amp;lt;" stays "&lt;" (the text it stood for) instead of turning into "<".
			.replace(/&amp;/g, "&")
			.replace(/[ \t\f\v]+/g, " ")
			.replace(/\n\s*\n\s*\n+/g, "\n\n")
			.trim()
	);
}

/**
 * One CSV cell, quoted when needed. Text a spreadsheet would run as a formula (starting with =, +, -, @, a tab or
 * a carriage return) gets a leading apostrophe, since names and arguments come from bots and other people.
 */
export function csvCell(v: unknown): string {
	let s = v === null || v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v);
	if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
	return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
