/**
 * Splits a document into passages of about TARGET characters for search: whole paragraphs where possible, cut at
 * sentence ends when a paragraph is too long, never across pages. Each passage remembers its page and the nearest
 * Markdown heading above it, so a search hit can say where it is.
 */

export interface Passage {
	ord: number;
	page: number | null;
	heading: string | null;
	content: string;
}

const TARGET = 1200;
const MAX = 1800;

/** Long text broken at sentence ends (or spaces, failing that) into pieces of at most MAX characters. */
function splitLong(text: string): string[] {
	if (text.length <= MAX) return [text];
	const out: string[] = [];
	let rest = text;
	while (rest.length > MAX) {
		const window = rest.slice(0, MAX);
		let cut = Math.max(
			window.lastIndexOf(". "),
			window.lastIndexOf("? "),
			window.lastIndexOf("! "),
			window.lastIndexOf("\n"),
		);
		if (cut < MAX / 2) cut = window.lastIndexOf(" ");
		if (cut < MAX / 2) cut = MAX - 1;
		out.push(rest.slice(0, cut + 1).trim());
		rest = rest.slice(cut + 1);
	}
	if (rest.trim()) out.push(rest.trim());
	return out;
}

export function chunkSections(sections: { page: number | null; text: string }[]): Passage[] {
	const out: Passage[] = [];
	let heading: string | null = null;
	for (const section of sections) {
		let buffer: string[] = [];
		let size = 0;
		let bufferHeading = heading;
		const flush = () => {
			const content = buffer.join("\n\n").trim();
			if (content) out.push({ ord: out.length, page: section.page, heading: bufferHeading, content });
			buffer = [];
			size = 0;
			bufferHeading = heading;
		};
		const blocks = section.text
			.replace(/\r\n?/g, "\n")
			.split(/\n\s*\n/)
			.map((b) => b.trim())
			.filter(Boolean);
		for (const block of blocks) {
			const h = block.match(/^(#{1,6})\s+(.+)$/m);
			if (h && block.split("\n").length <= 2) {
				// A new heading starts a new passage (if the current one has anything worth keeping).
				if (size > TARGET / 3) flush();
				heading =
					(h[2] ?? "")
						.replace(/[#*_`]+/g, "")
						.trim()
						.slice(0, 200) || heading;
				if (!buffer.length) bufferHeading = heading;
			}
			for (const piece of splitLong(block)) {
				if (size && size + piece.length > TARGET) flush();
				buffer.push(piece);
				size += piece.length + 2;
			}
		}
		flush();
	}
	return out;
}
