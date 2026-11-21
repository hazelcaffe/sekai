import { Check, Copy } from "lucide-react";
import { type ComponentProps, memo, type ReactNode, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { cn, copyText } from "../utils.ts";
import { ChatImage } from "./ChatImage.tsx";

function CodeBlock({ children, language }: { children: ReactNode; language: string | null }) {
	const ref = useRef<HTMLPreElement>(null);
	const [copied, setCopied] = useState(false);
	const copy = async () => {
		await copyText(ref.current?.textContent ?? "");
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	};
	return (
		<div className="group/code my-3 overflow-hidden rounded-lg border border-border bg-bg-subtle">
			<div className="flex h-9 items-center justify-between border-b border-border px-3.5 text-small text-fg-subtle">
				<span className="font-mono">{language ?? "text"}</span>
				<button
					type="button"
					onClick={copy}
					className="flex items-center gap-1 rounded-sm px-1.5 py-1 hover:bg-surface-2 hover:text-fg"
				>
					{copied ? <Check className="size-4" /> : <Copy className="size-4" />}
					{copied ? "Copied" : "Copy"}
				</button>
			</div>
			<pre ref={ref} className="overflow-x-auto p-3.5 font-mono text-small scrollbar-thin">
				{children}
			</pre>
		</div>
	);
}

function languageOf(children: ReactNode): string | null {
	const child = Array.isArray(children) ? children[0] : children;
	const className = (child as { props?: { className?: string } } | undefined)?.props?.className ?? "";
	return className.match(/language-([\w+-]+)/)?.[1] ?? null;
}

const components: ComponentProps<typeof ReactMarkdown>["components"] = {
	pre: ({ children }) => <CodeBlock language={languageOf(children)}>{children}</CodeBlock>,
	a: ({ href, children }) => (
		<a href={href} target="_blank" rel="noreferrer noopener">
			{children}
		</a>
	),
	table: ({ children }) => (
		<div className="my-3 overflow-x-auto scrollbar-thin">
			<table>{children}</table>
		</div>
	),
	img: ({ src, alt }) => (typeof src === "string" && src ? <ChatImage src={src} alt={alt ?? ""} /> : null),
};

function escapePrices(text: string): string {
	let fence: string | null = null;
	return text
		.split("\n")
		.map((line) => {
			const f = line.match(/^\s*(```|~~~)/)?.[1];
			if (f) fence = fence === f ? null : (fence ?? f);
			if (fence || f) return line;
			// Not inside `inline code`, and not $$ (display math).
			return line
				.split(/(`[^`]*`)/)
				.map((piece, i) => (i % 2 ? piece : piece.replace(/(^|[^\\$])\$(?=\d)/g, "$1\\$")))
				.join("");
		})
		.join("\n");
}

/**
 * Models often write display math on one line ($$x = …$$) or with \[ … \]; remark-math only treats $$ on
 * lines of their own as display math. Rewrites those (outside code) into that form.
 */
export function normalizeMath(input: string): string {
	// Prices aren't math: "$5 to $10" would otherwise render as a formula. ($ before a digit, outside code.)
	const text = /\$\d/.test(input) ? escapePrices(input) : input;
	if (!text.includes("$$") && !text.includes("\\[")) return text;
	let fence: string | null = null;
	return text
		.split("\n")
		.map((line) => {
			const f = line.match(/^\s*(```|~~~)/)?.[1];
			if (f) fence = fence === f ? null : (fence ?? f);
			if (fence || f) return line;
			const one = line.match(/^(\s*)\$\$(.+?)\$\$\s*$/) ?? line.match(/^(\s*)\\\[(.+?)\\\]\s*$/);
			return one ? `${one[1]}$$\n${one[1]}${one[2]?.trim()}\n${one[1]}$$` : line;
		})
		.join("\n");
}

/** The full renderer (GitHub-flavoured Markdown, math, highlighted code): loaded on demand, see LazyMarkdown.tsx. */
export const Markdown = memo(function Markdown({ text, className }: { text: string; className?: string }) {
	return (
		<div className={cn("prose-chat", className)}>
			<ReactMarkdown
				remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: true }]]}
				rehypePlugins={[
					[rehypeKatex, { throwOnError: false, strict: false }],
					[rehypeHighlight, { detect: false }],
				]}
				components={components}
			>
				{normalizeMath(text)}
			</ReactMarkdown>
		</div>
	);
});
