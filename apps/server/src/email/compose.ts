import { Marked } from "marked";

/**
 * A bot's email from its Markdown: an HTML part (formatted the way it reads in Sekai) and a plain-text part, its
 * signature, and when it replies a short quote of the email it answers.
 */

export function escapeHtml(s: string): string {
	return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

const safeHref = (href: string) => (/^(https?:|mailto:)/i.test(href.trim()) ? href.trim() : null);

const STYLE = {
	body: "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#1f2328;max-width:42em",
	code: "font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;background:#f3f4f6;border-radius:4px;padding:1px 4px",
	pre: "font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;background:#f3f4f6;border-radius:6px;padding:10px 12px;overflow:auto;white-space:pre-wrap",
	quote: "margin:0 0 0 .5em;padding:0 0 0 .8em;border-left:3px solid #d0d7de;color:#59636e",
	table: "border-collapse:collapse;margin:.5em 0",
	cell: "border:1px solid #d0d7de;padding:4px 8px;text-align:left",
	muted: "color:#59636e",
};

/** Markdown → email-safe HTML: raw HTML in the text is shown as text, links only to web and mail addresses. */
const marked = new Marked({
	gfm: true,
	breaks: true,
	renderer: {
		html({ text }) {
			return escapeHtml(text);
		},
		link({ href, tokens }) {
			const inner = this.parser.parseInline(tokens);
			const url = safeHref(href);
			return url ? `<a href="${escapeHtml(url)}" style="color:#0969da">${inner}</a>` : inner;
		},
		// Pictures from the web would load when it's opened (and track it): a link instead.
		image({ href, text }) {
			const url = safeHref(href);
			const label = escapeHtml(text || "image");
			return url ? `<a href="${escapeHtml(url)}" style="color:#0969da">${label}</a>` : label;
		},
		codespan({ text }) {
			return `<code style="${STYLE.code}">${escapeHtml(text)}</code>`;
		},
		code({ text }) {
			return `<pre style="${STYLE.pre}">${escapeHtml(text)}</pre>\n`;
		},
		blockquote({ tokens }) {
			return `<blockquote style="${STYLE.quote}">${this.parser.parse(tokens)}</blockquote>\n`;
		},
		table(token) {
			const head = token.header
				.map((c) => `<th style="${STYLE.cell}">${this.parser.parseInline(c.tokens)}</th>`)
				.join("");
			const rows = token.rows
				.map(
					(r) =>
						`<tr>${r.map((c) => `<td style="${STYLE.cell}">${this.parser.parseInline(c.tokens)}</td>`).join("")}</tr>`,
				)
				.join("");
			return `<table style="${STYLE.table}"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>\n`;
		},
	},
});

/** Markdown links and images as plain text: "text (address)". */
export function markdownToText(markdown: string): string {
	return markdown
		.replace(/\r\n/g, "\n")
		.replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, (_m, alt: string, url: string) => `${alt || "image"} (${url})`)
		.replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, (_m, text: string, url: string) =>
			text === url || `mailto:${text}` === url ? text : `${text} (${url.replace(/^mailto:/, "")})`,
		)
		.replace(/<(https?:[^>\s]+)>/g, "$1")
		.trim();
}

export interface Quote {
	/** "Mizuki <mizuki@example.com>". */
	from: string;
	date: number | null;
	text: string;
}

const QUOTE_LINES = 12;
const QUOTE_CHARS = 1200;

/** The start of the email being answered, a few lines of it (the whole history is in its own thread). */
export function quoteLines(text: string): string[] {
	const lines: string[] = [];
	let used = 0;
	for (const raw of text.replace(/\r/g, "").trim().split("\n")) {
		if (lines.length >= QUOTE_LINES || used + raw.length > QUOTE_CHARS) {
			lines.push("…");
			break;
		}
		lines.push(raw);
		used += raw.length;
	}
	while (lines.length && !lines[lines.length - 1]?.trim()) lines.pop();
	return lines;
}

function quoteIntro(q: Quote): string {
	const when = q.date
		? new Date(q.date).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })
		: null;
	return when ? `On ${when} UTC, ${q.from} wrote:` : `${q.from} wrote:`;
}

export interface EmailBody {
	text: string;
	html: string;
}

/** The text and HTML parts of an email written in Markdown, with its signature and a short quote. */
export function composeEmail(markdown: string, opts: { signature?: string; quote?: Quote | null } = {}): EmailBody {
	const body = markdown.trim();
	const signature = opts.signature?.trim() ?? "";
	const quote = opts.quote?.text.trim() ? opts.quote : null;
	const textParts = [markdownToText(body)];
	if (signature) textParts.push(`-- \n${signature}`);
	if (quote)
		textParts.push(
			`${quoteIntro(quote)}\n${quoteLines(quote.text)
				.map((l) => `> ${l}`.trimEnd())
				.join("\n")}`,
		);
	const html = [
		`<div style="${STYLE.body}">`,
		marked.parse(body, { async: false }),
		signature ? `<p style="${STYLE.muted}">-- <br>${escapeHtml(signature).replace(/\n/g, "<br>")}</p>` : "",
		quote
			? `<p style="${STYLE.muted}">${escapeHtml(quoteIntro(quote))}</p><blockquote style="${STYLE.quote}">${quoteLines(
					quote.text,
				)
					.map((l) => escapeHtml(l))
					.join("<br>")}</blockquote>`
			: "",
		"</div>",
	].join("");
	return { text: `${textParts.join("\n\n")}\n`, html: `<!doctype html><html><body>${html}</body></html>` };
}
