import { api } from "@sekai/client";
import type { ServerEvent } from "@sekai/shared";
import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

/** Chat traffic and other things Admin doesn't show: no refetch for them. */
const IGNORED = new Set<ServerEvent["type"]>([
	"hello",
	"message.created",
	"message.updated",
	"message.delta",
	"message.part",
	"message.deleted",
	"conversation.updated",
	"call.ring",
	"call.ring.ended",
	"notification",
]);

/** Admin's own script, to tell when the server has a newer build than the one running in this tab. */
const loadedBuild = (doc: Document) =>
	[...doc.querySelectorAll<HTMLScriptElement>("script[type=module][src]")]
		.map((s) => new URL(s.src, location.href).pathname)
		.join(",");
let updateOffered = false;

/** After a deploy (the server restarted with a new build), offer to reload; reload at once if the tab is hidden. */
async function checkForUpdate(): Promise<void> {
	if (updateOffered || !document.querySelector("script[type=module][src]")) return;
	try {
		const res = await fetch("/admin/", { cache: "no-store" });
		if (!res.ok) return;
		const fresh = loadedBuild(new DOMParser().parseFromString(await res.text(), "text/html"));
		if (!fresh || fresh === loadedBuild(document)) return;
		updateOffered = true;
		if (document.visibilityState === "hidden") {
			location.reload();
			return;
		}
		toast("Sekai was updated", {
			description: "Reload to get the new version.",
			duration: Number.POSITIVE_INFINITY,
			action: { label: "Reload", onClick: () => location.reload() },
		});
	} catch {}
}

/**
 * Keeps Admin current: the server's live events (anything saved here, by a bot, or in another tab) refetch what's
 * on screen, a moment later so a burst of changes refetches once. Returns a function that stops it.
 */
export function connectAdminEvents(qc: QueryClient): () => void {
	let source: EventSource | null = null;
	let retry: ReturnType<typeof setTimeout> | null = null;
	let pending: ReturnType<typeof setTimeout> | null = null;
	let attempts = 0;
	let closed = false;

	const refresh = () => {
		if (pending) return;
		pending = setTimeout(() => {
			pending = null;
			void qc.invalidateQueries();
		}, 250);
	};

	const open = () => {
		if (closed) return;
		source = new EventSource(api.eventsUrl());
		source.onopen = () => {
			// Back after a gap: whatever changed meanwhile.
			if (attempts > 0) refresh();
			attempts = 0;
		};
		source.onmessage = (e: MessageEvent<string>) => {
			try {
				const ev = JSON.parse(e.data) as ServerEvent;
				if (ev.type === "hello") void checkForUpdate();
				if (!IGNORED.has(ev.type)) refresh();
			} catch {}
		};
		source.onerror = () => {
			source?.close();
			source = null;
			if (closed) return;
			attempts++;
			retry = setTimeout(open, Math.min(1000 * 2 ** Math.min(attempts, 5), 15_000));
		};
	};
	open();
	return () => {
		closed = true;
		if (retry) clearTimeout(retry);
		if (pending) clearTimeout(pending);
		source?.close();
	};
}
