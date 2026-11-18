import { Check, Copy } from "lucide-react";
import { type ComponentProps, memo, type ReactNode, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { assetUrl } from "../api.ts";
import { cn, copyText } from "../utils.ts";

function CodeBlock({ children, language }: { children: ReactNode; language: string | null }) {
	const ref = useRef<HTMLPreElement>(null);
	const [copied, setCopied] = useState(false);
	const copy = async () => {
		await copyText(ref.current?.textContent ?? "");
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	};
	return (
		<div className="group/code my-3 overflow-hidden rounded-2xl border border-border bg-bg-subtle">
			<div className="flex h-9 items-center justify-between border-b border-border px-3.5 text-xs text-fg-subtle">
				<span className="font-mono">{language ?? "text"}</span>
				<button
					type="button"
					onClick={copy}
					className="flex items-center gap-1 rounded-md px-1.5 py-1 hover:bg-surface-2 hover:text-fg"
				>
					{copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
					{copied ? "Copied" : "Copy"}
				</button>
			</div>
			<pre ref={ref} className="overflow-x-auto p-3.5 font-mono text-[13px] leading-6 scrollbar-thin">
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

/** Images from Sekai itself (uploads, screenshots) load right away; others wait for a tap. */
function isOwnImage(url: string): boolean {
	if (/^(data|blob):/i.test(url)) return true;
	try {
		return new URL(url, location.href).origin === location.origin;
	} catch {
		return false;
	}
}

/**
 * An image in a reply: shown whole (up to a sensible size), opens full size in a new tab. Pictures from other
 * sites load only when you tap (a reply shaped by a hostile page could otherwise send data out in an image URL).
 */
export function ChatImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
	const [broken, setBroken] = useState(false);
	const url = assetUrl(src);
	const [allowed, setAllowed] = useState(() => isOwnImage(url));
	if (!allowed) {
		let host = "another site";
		try {
			host = new URL(url).hostname;
		} catch {}
		return (
			<button
				type="button"
				onClick={() => setAllowed(true)}
				className={cn(
					"my-2 flex max-w-full items-center gap-2 rounded-2xl border border-dashed border-border px-3 py-2 text-left text-[13px] text-fg-muted hover:bg-surface-2",
					className,
				)}
			>
				<span className="truncate">
					{alt || "Image"} · <span className="text-fg-subtle">from {host}, tap to load</span>
				</span>
			</button>
		);
	}
	if (broken) {
		return (
			<a href={url} target="_blank" rel="noreferrer noopener" className="text-sm">
				{alt || "Image"} (couldn't load it)
			</a>
		);
	}
	return (
		<a
			href={url}
			target="_blank"
			rel="noreferrer noopener"
			className={cn("my-2 block w-fit max-w-full", className)}
		>
			<img
				src={url}
				alt={alt}
				referrerPolicy="no-referrer"
				loading="lazy"
				decoding="async"
				onError={() => setBroken(true)}
				className="max-h-[min(70vh,520px)] max-w-full rounded-2xl border border-border bg-bg-subtle object-contain"
			/>
		</a>
	);
}

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
