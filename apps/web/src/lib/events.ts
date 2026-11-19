import { api, qk } from "@sekai/client";
import type { Agent, Conversation, Machine, Message, ServerEvent } from "@sekai/shared";
import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useUi } from "../stores/ui.ts";
import { pushOn, systemNotify } from "./notifications.ts";

/** The app's own script, to tell when the server has a newer build than the one running in this tab. */
const loadedBuild = (doc: Document) =>
	[...doc.querySelectorAll<HTMLScriptElement>("script[type=module][src]")]
		.map((s) => new URL(s.src, location.href).pathname)
		.join(",");
let updateOffered = false;

// A part of the app loaded on demand (the remote desktop viewer…) that a new build replaced: reload, once a minute
// at most so a real outage can't loop.
window.addEventListener("vite:preloadError", (e) => {
	const last = Number(sessionStorage.getItem("sekai.reloadedForBuild") ?? 0);
	if (Date.now() - last < 60_000) return;
	e.preventDefault();
	sessionStorage.setItem("sekai.reloadedForBuild", String(Date.now()));
	location.reload();
});

/** After the server restarts with a new build, offer to reload (an open tab keeps running the old one). */
async function checkForUpdate(): Promise<void> {
	if (updateOffered || !document.querySelector("script[type=module][src]")) return;
	try {
		const res = await fetch("/", { cache: "no-store" });
		if (!res.ok) return;
		const fresh = loadedBuild(new DOMParser().parseFromString(await res.text(), "text/html"));
		if (!fresh || fresh === loadedBuild(document)) return;
		updateOffered = true;
		// Not in front (the phone app in the background, a tab behind others): just reload. Drafts are kept.
		if (document.visibilityState === "hidden") {
			location.reload();
			return;
		}
		document.addEventListener("visibilitychange", () => {
			if (document.visibilityState === "hidden") location.reload();
		});
		toast("Sekai was updated", {
			description: "Reload to get the new version.",
			duration: Number.POSITIVE_INFINITY,
			action: { label: "Reload", onClick: () => location.reload() },
		});
	} catch {}
}

type Delta = { conversationId: string; messageId: string; index: number; delta: string };

function upsert<T extends { id: string }>(list: T[] | undefined, item: T, sort?: (a: T, b: T) => number): T[] {
	const next = list ? [...list] : [];
	const i = next.findIndex((x) => x.id === item.id);
	if (i >= 0) next[i] = item;
	else next.push(item);
	return sort ? next.sort(sort) : next;
}

const byCreated = (a: Message, b: Message) => a.createdAt - b.createdAt;

/** Whether the user is looking at this conversation right now (no need to notify). */
function isViewing(conversationId: string | null): boolean {
	return (
		Boolean(conversationId) &&
		document.visibilityState === "visible" &&
		location.pathname === `/c/${conversationId}`
	);
}

/**
 * Keeps the query cache in sync with the server over one SSE connection. Text deltas arrive many times a
 * second while agents stream, so they're batched and applied once per animation frame.
 */
export function connectEvents(qc: QueryClient): () => void {
	let source: EventSource | null = null;
	let closed = false;
	let retry: ReturnType<typeof setTimeout> | null = null;
	let attempts = 0;
	let pending: Delta[] = [];
	let frame = 0;

	const flush = () => {
		frame = 0;
		const batch = pending;
		pending = [];
		const byConversation = new Map<string, Delta[]>();
		for (const d of batch)
			byConversation.set(d.conversationId, [...(byConversation.get(d.conversationId) ?? []), d]);
		for (const [conversationId, deltas] of byConversation) {
			qc.setQueryData<Message[]>(qk.messages(conversationId), (list) => {
				if (!list) return list;
				const touched = new Map<string, Message>();
				for (const d of deltas) {
					const base = touched.get(d.messageId) ?? list.find((m) => m.id === d.messageId);
					if (!base) continue;
					const parts = [...base.parts];
					const part = parts[d.index];
					if (!part || !("text" in part)) continue;
					parts[d.index] = { ...part, text: part.text + d.delta };
					touched.set(d.messageId, { ...base, parts });
				}
				return list.map((m) => touched.get(m.id) ?? m);
			});
		}
	};

	const handle = (ev: ServerEvent) => {
		switch (ev.type) {
			case "hello":
				// Reloading everything: words from before the reconnect are in the fresh copies.
				if (frame) cancelAnimationFrame(frame);
				frame = 0;
				pending = [];
				attempts = 0;
				useUi.getState().setConnection("online");
				void checkForUpdate();
				// Anything could have changed while we were disconnected.
				void qc.invalidateQueries();
				void api.voice
					.rings()
					.then((rings) => useUi.getState().setRings(() => rings))
					.catch(() => {});
				void api.runs
					.list({ status: "queued,running,awaiting_approval", limit: 200 })
					.then((runs) => useUi.getState().syncActiveRuns(runs.filter((r) => r.status !== "done")))
					.catch(() => {});
				break;
			case "message.created":
			case "message.updated":
				// Words still waiting for a frame came before this full copy (background tabs get no frames):
				// apply them first, so they aren't added again on top of it.
				if (frame) cancelAnimationFrame(frame);
				if (pending.length) flush();
				else frame = 0;
				qc.setQueryData<Message[]>(qk.messages(ev.message.conversationId), (list) =>
					list ? upsert(list, ev.message, byCreated) : list,
				);
				// A reply while Sekai is in the background (bot messages you started; the bot's own outreach notifies itself).
				if (
					ev.type === "message.updated" &&
					ev.message.sender === "agent" &&
					ev.message.status === "done" &&
					!ev.message.meta.trigger &&
					document.visibilityState !== "visible"
				) {
					const name =
						qc.getQueryData<Agent[]>(qk.agents)?.find((a) => a.id === ev.message.agentId)?.name ?? "Sekai";
					const text = ev.message.parts
						.map((p) => (p.type === "text" ? p.text : ""))
						.join(" ")
						.trim();
					if (text) void systemNotify(name, text.slice(0, 180), ev.message.conversationId);
				}
				break;
			case "message.delta":
				pending.push(ev);
				if (!frame) frame = requestAnimationFrame(flush);
				break;
			case "message.part":
				useUi.getState().noteActivity(ev.messageId, ev.part);
				if (frame) {
					cancelAnimationFrame(frame);
					flush();
				}
				qc.setQueryData<Message[]>(qk.messages(ev.conversationId), (list) =>
					list?.map((m) => {
						if (m.id !== ev.messageId) return m;
						const parts = [...m.parts];
						parts[ev.index] = ev.part;
						return { ...m, parts };
					}),
				);
				break;
			case "message.deleted":
				qc.setQueryData<Message[]>(qk.messages(ev.conversationId), (list) =>
					list?.filter((m) => m.id !== ev.messageId),
				);
				break;
			case "conversation.created":
			case "conversation.updated":
				qc.setQueryData<Conversation[]>(qk.conversations, (list) =>
					list ? upsert(list, ev.conversation) : list,
				);
				qc.setQueryData(["conversation", ev.conversation.id], ev.conversation);
				break;
			case "conversation.deleted":
				qc.setQueryData<Conversation[]>(qk.conversations, (list) =>
					list?.filter((c) => c.id !== ev.conversationId),
				);
				qc.removeQueries({ queryKey: qk.messages(ev.conversationId) });
				break;
			case "conversation.reset":
				qc.setQueryData<Message[]>(qk.messages(ev.conversationId), []);
				break;
			case "agent.created":
			case "agent.updated":
				qc.setQueryData<Agent[]>(qk.agents, (list) => (list ? upsert(list, ev.agent) : list));
				void qc.invalidateQueries({ queryKey: ["context", ev.agent.id] });
				void qc.invalidateQueries({ queryKey: ["agentTools", ev.agent.id] });
				break;
			case "agent.deleted":
				qc.setQueryData<Agent[]>(qk.agents, (list) => list?.filter((a) => a.id !== ev.agentId));
				void qc.invalidateQueries({ queryKey: qk.conversations });
				// It may have been on your machines or shared browsers (or stopped being shared with you).
				void qc.invalidateQueries({ queryKey: ["machineMembers"] });
				void qc.invalidateQueries({ queryKey: ["sharedBrowsers"] });
				break;
			case "run.updated":
				useUi.getState().trackRun(ev.run);
				void qc.invalidateQueries({ queryKey: ["runs"] });
				break;
			case "routine.changed":
				void qc.invalidateQueries({ queryKey: ["routines"] });
				void qc.invalidateQueries({ queryKey: ["routineRuns", ev.routineId] });
				break;
			case "memory.changed":
				void qc.invalidateQueries({ queryKey: ["memories"] });
				void qc.invalidateQueries({ queryKey: ["context"] });
				break;
			case "note.changed":
				void qc.invalidateQueries({ queryKey: qk.notes(ev.agentId) });
				void qc.invalidateQueries({ queryKey: ["context", ev.agentId] });
				break;
			case "skill.changed":
				void qc.invalidateQueries({ queryKey: qk.skills });
				break;
			case "mcp.changed":
				void qc.invalidateQueries({ queryKey: qk.mcp });
				void qc.invalidateQueries({ queryKey: ["agentTools"] });
				break;
			case "settings.changed":
				void qc.invalidateQueries({ queryKey: qk.settings });
				void qc.invalidateQueries({ queryKey: ["voice"] });
				void qc.invalidateQueries({ queryKey: ["agentTools"] });
				break;
			case "call.ring":
				useUi.getState().setRings((r) => [...r.filter((x) => x.id !== ev.ring.id), ev.ring]);
				break;
			case "call.ring.ended":
				useUi.getState().setRings((r) => r.filter((x) => x.id !== ev.ringId));
				break;
			case "approvals.changed":
				void qc.invalidateQueries({ queryKey: qk.approvals });
				break;
			case "channel.changed":
				void qc.invalidateQueries({ queryKey: ["channels"] });
				void qc.invalidateQueries({ queryKey: qk.channelBindings(ev.channelId) });
				void qc.invalidateQueries({ queryKey: qk.channelLinks });
				break;
			case "pairing.changed":
				void qc.invalidateQueries({ queryKey: qk.pairings });
				break;
			case "code.changed":
				void qc.invalidateQueries({ queryKey: ["code", ev.agentId] });
				break;
			case "machine.changed":
				for (const key of [qk.machines(ev.machine.agentId), qk.machines()]) {
					qc.setQueryData<Machine[]>(key, (list) => (list ? upsert(list, ev.machine) : list));
				}
				// Bots with a seat on it see the machine's state in their Computer tab.
				void qc.invalidateQueries({ queryKey: ["seats"] });
				break;
			case "machine.deleted":
				for (const key of [qk.machines(ev.agentId), qk.machines()]) {
					qc.setQueryData<Machine[]>(key, (list) => list?.filter((m) => m.id !== ev.machineId));
				}
				void qc.invalidateQueries({ queryKey: ["seats"] });
				void qc.invalidateQueries({ queryKey: ["sharedBrowsers"] });
				break;
			case "machine.members":
				void qc.invalidateQueries({ queryKey: qk.machineMembers(ev.machineId) });
				void qc.invalidateQueries({ queryKey: ["seats"] });
				break;
			case "browsers.changed":
				void qc.invalidateQueries({ queryKey: ["sharedBrowsers"] });
				break;
			case "library.changed":
				void qc.invalidateQueries({ queryKey: qk.documents });
				break;
			case "machine.checkpoints":
				void qc.invalidateQueries({ queryKey: qk.checkpoints(ev.machineId) });
				break;
			case "credentials.changed":
				void qc.invalidateQueries({ queryKey: qk.credentials });
				void qc.invalidateQueries({ queryKey: ["savedLogins"] });
				break;
			case "provider.changed":
				// A check finished or a subscription changed: its models and reasoning levels may be new.
				void qc.invalidateQueries({ queryKey: qk.providers });
				void qc.invalidateQueries({ queryKey: qk.models });
				break;
			case "notification":
				if (isViewing(ev.conversationId)) break;
				// The ringing screen already says who's calling.
				if (
					document.visibilityState === "visible" &&
					useUi.getState().rings.some((r) => r.agentId === ev.agentId)
				)
					break;
				if (document.visibilityState === "visible") {
					toast(ev.title, {
						description: ev.body,
						action: ev.conversationId
							? {
									label: "Open",
									onClick: () =>
										window.dispatchEvent(
											new CustomEvent("sekai:navigate", { detail: `/c/${ev.conversationId}` }),
										),
								}
							: undefined,
					});
				} else if (!pushOn()) {
					// (With push on, the service worker shows it, even once this tab is closed.)
					void systemNotify(ev.title, ev.body, ev.conversationId, ev.approval);
				}
				break;
		}
	};

	const open = () => {
		if (closed) return;
		useUi.getState().setConnection(attempts === 0 ? "connecting" : "offline");
		source = new EventSource(api.eventsUrl());
		source.onmessage = (e: MessageEvent<string>) => {
			try {
				handle(JSON.parse(e.data) as ServerEvent);
			} catch (err) {
				console.error("bad event", err);
			}
		};
		source.onerror = () => {
			source?.close();
			source = null;
			if (closed) return;
			attempts++;
			useUi.getState().setConnection("offline");
			retry = setTimeout(open, Math.min(1000 * 2 ** Math.min(attempts, 5), 15_000));
		};
	};

	const onVisible = () => {
		if (document.visibilityState === "visible" && !source && !closed) {
			if (retry) clearTimeout(retry);
			open();
		}
	};
	document.addEventListener("visibilitychange", onVisible);
	open();

	return () => {
		closed = true;
		if (retry) clearTimeout(retry);
		if (frame) cancelAnimationFrame(frame);
		document.removeEventListener("visibilitychange", onVisible);
		source?.close();
	};
}
