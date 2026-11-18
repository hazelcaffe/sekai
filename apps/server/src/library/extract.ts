import { strFromU8, unzipSync } from "fflate";
import { badRequest } from "../lib/errors.ts";

/** A document's text, in the pieces it naturally comes in (pages of a PDF, the whole of a text file). */
export interface Extracted {
	pages: number | null;
	sections: { page: number | null; text: string }[];
}

const TEXT_EXT =
	/\.(md|markdown|mdx|txt|text|csv|tsv|json|jsonl|ya?ml|toml|xml|log|rst|org|tex|ini|cfg|conf|srt|vtt|html?|ts|tsx|js|jsx|py|rb|go|rs|java|kt|swift|c|h|cpp|hpp|cs|php|sh|sql)$/i;

export const SUPPORTED = "PDF, Word (.docx), Markdown, text, HTML, CSV and JSON";

/** The kind of file, from its type or name: what extract() can read, or null. */
export function kindOf(name: string, mime: string): "pdf" | "docx" | "html" | "text" | null {
	const m = mime.toLowerCase();
	if (m === "application/pdf" || /\.pdf$/i.test(name)) return "pdf";
	if (m.includes("wordprocessingml") || /\.docx$/i.test(name)) return "docx";
	if (m === "text/html" || /\.html?$/i.test(name)) return "html";
	if (
		m.startsWith("text/") ||
		m === "application/json" ||
		m.endsWith("+json") ||
		m.endsWith("+xml") ||
		TEXT_EXT.test(name)
	)
		return "text";
	return null;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(s: string): string {
	return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) => {
		if (e[0] === "#") {
			const code = e[1]?.toLowerCase() === "x" ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1));
			return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : all;
		}
		return ENTITIES[e.toLowerCase()] ?? all;
	});
}

/** HTML as plain text, headings kept as Markdown headings so chunks know where they are. */
export function htmlToText(html: string): string {
	return decodeEntities(
		html
			.replace(/<(script|style|noscript|template|svg)[\s\S]*?<\/\1>/gi, " ")
			.replace(/<!--[\s\S]*?-->/g, " ")
			.replace(
				/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi,
				(_all, n: string, t: string) => `\n\n${"#".repeat(Number(n))} ${t}\n\n`,
			)
			.replace(/<li[^>]*>/gi, "\n- ")
			.replace(/<(br|\/p|\/div|\/tr|\/section|\/article|\/blockquote|\/pre)[^>]*>/gi, "\n")
			.replace(/<\/t[dh]>/gi, " | ")
			.replace(/<[^>]+>/g, " "),
	)
		.replace(/[ \t\u00a0]+/g, " ")
		.replace(/ *\n */g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

/** A Word document's paragraphs (headings as Markdown headings, list items as bullets). */
export function docxToText(bytes: Uint8Array): string {
	let xml: string;
	try {
		const files = unzipSync(bytes, { filter: (f) => f.name === "word/document.xml" });
		const doc = files["word/document.xml"];
		if (!doc) throw new Error("no document.xml");
		xml = strFromU8(doc);
	} catch {
		throw badRequest("That Word file couldn't be opened (it may be damaged, or an older .doc file).");
	}
	const paragraphs = xml.split(/<\/w:p>/).map((p) => {
		const level = p.match(/<w:pStyle w:val="(?:Heading|heading|Title)(\d?)"/);
		const bullet = /<w:numPr>/.test(p);
		const text = decodeEntities(
			p
				.replace(/<w:tab\/>/g, "\t")
				.replace(/<w:br\/>/g, "\n")
				.replace(/<[^>]+>/g, ""),
		).trim();
		if (!text) return "";
		if (level) return `${"#".repeat(Math.min(Number(level[1] || 1), 6))} ${text}`;
		return bullet ? `- ${text}` : text;
	});
	return paragraphs.filter(Boolean).join("\n\n");
}

async function pdfToSections(bytes: Uint8Array): Promise<Extracted> {
	const { extractText, getDocumentProxy } = await import("unpdf");
	let doc: Awaited<ReturnType<typeof getDocumentProxy>>;
	try {
		doc = await getDocumentProxy(bytes);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		throw badRequest(
			/password/i.test(msg)
				? "That PDF is locked with a password. Save an unlocked copy and upload that."
				: "That PDF couldn't be opened (it may be damaged).",
		);
	}
	const { totalPages, text } = await extractText(doc, { mergePages: false });
	const pages = (Array.isArray(text) ? text : [text]).map((t, i) => ({ page: i + 1, text: t.trim() }));
	if (!pages.some((p) => p.text)) {
		throw badRequest(
			"That PDF has no text to read: it's probably scanned pages (pictures). Run it through OCR first, then upload it again.",
		);
	}
	return { pages: totalPages, sections: pages };
}

/** Reads a file's text. Throws a friendly error for files it can't read. */
export async function extract(bytes: Uint8Array, name: string, mime: string): Promise<Extracted> {
	const kind = kindOf(name, mime);
	if (kind === "pdf") return pdfToSections(bytes);
	if (kind === "docx") return { pages: null, sections: [{ page: null, text: docxToText(bytes) }] };
	if (kind === "html" || kind === "text") {
		// A NUL byte in the first few KB: not text after all.
		if (bytes.subarray(0, 8192).includes(0)) throw badRequest(`That file isn't text. Sekai reads ${SUPPORTED}.`);
		const raw = new TextDecoder().decode(bytes);
		return { pages: null, sections: [{ page: null, text: kind === "html" ? htmlToText(raw) : raw }] };
	}
	throw badRequest(`Sekai can't read that kind of file yet. It reads ${SUPPORTED}.`);
}
