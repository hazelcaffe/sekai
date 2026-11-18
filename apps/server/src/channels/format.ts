/** Chunking for chat platforms with message size limits. Code fences are closed and reopened across chunks. */

/** Splits long text at paragraph, line or word boundaries, keeping ``` fences balanced in every chunk. */
export function chunkText(text: string, limit: number): string[] {
	const chunks: string[] = [];
	let rest = text.trim();
	while (rest.length > limit) {
		let cut = rest.lastIndexOf("\n\n", limit);
		if (cut < limit * 0.5) cut = rest.lastIndexOf("\n", limit);
		if (cut < limit * 0.3) cut = rest.lastIndexOf(" ", limit);
		if (cut <= 0) cut = limit;
		let chunk = rest.slice(0, cut).trimEnd();
		rest = rest
			.slice(cut)
			.replace(/^\s*\n/, "")
			.trimStart();
		const fences = chunk.match(/^```.*$/gm) ?? [];
		if (fences.length % 2 === 1) {
			const lang = fences.at(-1)?.slice(3).trim() ?? "";
			chunk += "\n```";
			rest = `\`\`\`${lang}\n${rest}`;
		}
		chunks.push(chunk);
	}
	if (rest) chunks.push(rest);
	return chunks;
}
