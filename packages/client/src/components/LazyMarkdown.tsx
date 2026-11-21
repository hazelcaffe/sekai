import { lazy, Suspense } from "react";
import { cn } from "../utils.ts";

/** Markdown's renderer (react-markdown, highlighting, math) is its own chunk, fetched the first time a reply shows. */
const Rich = lazy(() => import("./Markdown.tsx").then((m) => ({ default: m.Markdown })));

/** A reply's text as Markdown. Until the renderer has loaded (a moment, once), the plain text stands in. */
export function Markdown({ text, className }: { text: string; className?: string }) {
	return (
		<Suspense fallback={<div className={cn("prose-chat whitespace-pre-wrap", className)}>{text}</div>}>
			<Rich text={text} className={className} />
		</Suspense>
	);
}
