import type { ReactNode } from "react";

/** Safe http(s) URL check for inline Markdown links. */
function safeHref(raw: string): string | null {
	try {
		const url = new URL(raw);
		return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
	} catch {
		return null;
	}
}

/** Inline formatting: `code`, **bold**, *italic*, and [links](https://…). */
function renderInline(text: string): ReactNode[] {
	const out: ReactNode[] = [];
	const re = /`([^`\n]+)`|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g;
	let last = 0;
	let key = 0;
	for (const match of text.matchAll(re)) {
		const idx = match.index ?? 0;
		if (idx > last) out.push(text.slice(last, idx));
		if (match[1] !== undefined) {
			out.push(
				<code key={key++} className="rounded-sm bg-surface-2 px-1 py-0.5 font-mono text-small text-fg">
					{match[1]}
				</code>,
			);
		} else if (match[2] !== undefined) {
			out.push(
				<strong key={key++} className="font-semibold text-fg">
					{match[2]}
				</strong>,
			);
		} else if (match[3] !== undefined) {
			out.push(<em key={key++}>{match[3]}</em>);
		} else if (match[4] !== undefined && match[5] !== undefined) {
			const href = safeHref(match[5]);
			if (href) {
				out.push(
					<a
						key={key++}
						href={href}
						target="_blank"
						rel="noreferrer"
						className="text-brand-ink underline underline-offset-2 hover:opacity-80"
					>
						{match[4]}
					</a>,
				);
			} else {
				out.push(match[0]);
			}
		}
		last = idx + match[0].length;
	}
	if (last < text.length) out.push(text.slice(last));
	return out;
}

/** Lightweight Markdown for bot replies in the narrow extension panel (no raw HTML). */
export function ExtensionMarkdown({ text }: { text: string }) {
	const blocks: ReactNode[] = [];
	const lines = text.replace(/\r\n/g, "\n").split("\n");
	let i = 0;
	let key = 0;

	while (i < lines.length) {
		const line = lines[i] ?? "";

		// Fenced code block
		if (line.trimStart().startsWith("```")) {
			const code: string[] = [];
			i++;
			while (i < lines.length && !(lines[i] ?? "").trimStart().startsWith("```")) {
				code.push(lines[i] ?? "");
				i++;
			}
			i++; // skip closing fence
			blocks.push(
				<pre
					key={key++}
					className="overflow-x-auto rounded-lg border border-border bg-surface-2 p-2.5 font-mono text-small text-fg"
				>
					<code>{code.join("\n")}</code>
				</pre>,
			);
			continue;
		}

		// Blank line
		if (!line.trim()) {
			i++;
			continue;
		}

		// Heading (# … ###)
		const heading = line.match(/^#{1,3}\s+(.+)$/);
		if (heading?.[1]) {
			blocks.push(
				<p key={key++} className="font-semibold text-fg">
					{renderInline(heading[1])}
				</p>,
			);
			i++;
			continue;
		}

		// Unordered list
		if (/^\s*[-*]\s+/.test(line)) {
			const items: ReactNode[] = [];
			while (i < lines.length && /^\s*[-*]\s+/.test(lines[i] ?? "")) {
				items.push(
					<li key={items.length} className="break-words">
						{renderInline((lines[i] ?? "").replace(/^\s*[-*]\s+/, ""))}
					</li>,
				);
				i++;
			}
			blocks.push(
				<ul key={key++} className="list-disc space-y-1 pl-4">
					{items}
				</ul>,
			);
			continue;
		}

		// Ordered list
		if (/^\s*\d+\.\s+/.test(line)) {
			const items: ReactNode[] = [];
			while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i] ?? "")) {
				items.push(
					<li key={items.length} className="break-words">
						{renderInline((lines[i] ?? "").replace(/^\s*\d+\.\s+/, ""))}
					</li>,
				);
				i++;
			}
			blocks.push(
				<ol key={key++} className="list-decimal space-y-1 pl-4">
					{items}
				</ol>,
			);
			continue;
		}

		// Paragraph: group consecutive plain lines
		const para: string[] = [];
		while (
			i < lines.length &&
			(lines[i] ?? "").trim() !== "" &&
			!(lines[i] ?? "").trimStart().startsWith("```") &&
			!/^#{1,3}\s+/.test(lines[i] ?? "") &&
			!/^\s*([-*]|\d+\.)\s+/.test(lines[i] ?? "")
		) {
			para.push(lines[i] ?? "");
			i++;
		}
		blocks.push(
			<p key={key++} className="whitespace-pre-wrap break-words">
				{renderInline(para.join("\n"))}
			</p>,
		);
	}

	return <div className="space-y-2 text-body text-fg">{blocks}</div>;
}
