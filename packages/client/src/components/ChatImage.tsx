import { useState } from "react";
import { assetUrl } from "../api.ts";
import { cn } from "../utils.ts";

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
					"my-2 flex max-w-full items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-left text-small text-fg-muted hover:bg-surface-2",
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
			<a href={url} target="_blank" rel="noreferrer noopener" className="text-body">
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
				className="max-h-[min(70vh,520px)] max-w-full rounded-lg border border-border bg-bg-subtle object-contain"
			/>
		</a>
	);
}
