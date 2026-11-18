/**
 * Splits source files into chunks for embedding: about 60 lines each, cut where the code naturally breaks
 * (blank lines before a top-level declaration, Markdown headings), with a little overlap so a match near a
 * boundary still has its context.
 */

export interface Chunk {
	startLine: number;
	endLine: number;
	symbol: string | null;
	content: string;
}

const TARGET_LINES = 60;
const MAX_LINES = 100;
const MAX_CHARS = 4000;
const OVERLAP = 4;

/** Starts of declarations in common languages, at the left margin (or one level in, for class members). */
const DECLARATION =
	/^(?:export\s+(?:default\s+)?)?(?:public\s+|private\s+|protected\s+|internal\s+|static\s+|async\s+|abstract\s+|final\s+|override\s+|pub(?:\([^)]*\))?\s+|unsafe\s+|inline\s+)*(?:function\*?|class|interface|type|enum|struct|trait|impl|fn|func|def|module|namespace|object|record|const|let|var|val|macro_rules!|protocol|extension|actor|resource|data|union)\s+([A-Za-z_$][\w$]*)/;
const METHOD =
	/^\s{0,4}(?:(?:public|private|protected|static|async|override|get|set)\s+)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::[^{=]+)?\{\s*$/;
const HEADING = /^#{1,6}\s+(.+)$/;

const MARKDOWN = /\.(md|mdx|markdown|rst|txt|adoc)$/i;

function symbolOf(line: string, markdown: boolean): string | null {
	if (markdown) return line.match(HEADING)?.[1]?.trim().slice(0, 80) ?? null;
	const d = line.match(DECLARATION);
	if (d?.[1]) return d[1];
	const m = line.match(METHOD);
	if (m?.[1] && !/^(if|for|while|switch|catch|with|return|function)$/.test(m[1])) return m[1];
	return null;
}

/** How good a place it is to start a new chunk at line i (0: no, higher is better). */
function breakScore(lines: string[], i: number, markdown: boolean): number {
	const line = lines[i] ?? "";
	const prev = lines[i - 1] ?? "";
	if (markdown) return HEADING.test(line) ? 3 : prev.trim() === "" && line.trim() !== "" ? 1 : 0;
	const atMargin = line.length > 0 && !/^\s/.test(line);
	if (atMargin && symbolOf(line, false)) return prev.trim() === "" || /^\s*(\/\/|#|\/\*|\*|@)/.test(prev) ? 4 : 3;
	if (prev.trim() === "" && atMargin) return 2;
	if (prev.trim() === "" && line.trim() !== "") return 1;
	return 0;
}

export function chunkFile(path: string, text: string): Chunk[] {
	const markdown = MARKDOWN.test(path);
	const lines = text.replace(/\r\n?/g, "\n").split("\n");
	if (lines.at(-1) === "") lines.pop();
	const chunks: Chunk[] = [];
	let start = 0;
	while (start < lines.length) {
		let end = Math.min(lines.length, start + TARGET_LINES);
		if (end < lines.length) {
			// Look for the best break between 60% of the target and the hard maximum.
			let best = -1;
			let bestScore = 0;
			for (let i = start + Math.floor(TARGET_LINES * 0.6); i < Math.min(lines.length, start + MAX_LINES); i++) {
				const score = breakScore(lines, i, markdown);
				// Prefer strong breaks, then the one closest to the target.
				if (
					score > bestScore ||
					(score === bestScore &&
						score > 0 &&
						Math.abs(i - start - TARGET_LINES) < Math.abs(best - start - TARGET_LINES))
				) {
					best = i;
					bestScore = score;
				}
			}
			end = best > start ? best : Math.min(lines.length, start + TARGET_LINES);
		}
		// Very long lines (minified or generated code): cap the characters too.
		let chars = 0;
		for (let i = start; i < end; i++) {
			chars += (lines[i]?.length ?? 0) + 1;
			if (chars > MAX_CHARS && i > start) {
				end = i;
				break;
			}
		}
		const body = lines.slice(start, end);
		if (body.some((l) => l.trim())) {
			let symbol: string | null = null;
			for (const l of body) {
				symbol = symbolOf(l, markdown);
				if (symbol) break;
			}
			chunks.push({
				startLine: start + 1,
				endLine: end,
				symbol,
				content: body.join("\n").slice(0, MAX_CHARS * 2),
			});
		}
		if (end >= lines.length) break;
		start = Math.max(start + 1, end - (breakScore(lines, end, markdown) >= 3 ? 0 : OVERLAP));
	}
	return chunks;
}

/** What the embedding model reads for a chunk: where it is, then the code. */
export function embeddingText(path: string, chunk: Chunk): string {
	const head = chunk.symbol ? `${path} · ${chunk.symbol}` : path;
	return `${head} (lines ${chunk.startLine}-${chunk.endLine})\n\n${chunk.content}`.slice(0, 8000);
}
