import type { Presence } from "@sekai/client";
import type { CallRing, Message, MessagePart, Run } from "@sekai/shared";
import { applyThemeChoice, parseThemeChoice, THEME_KEY, type ThemeChoice } from "@sekai/ui";

/** The saved theme (light, dark and system from before the group themes become Virtual Singers, Nightcord, auto). */
function savedTheme(): ThemeChoice {
	try {
		return parseThemeChoice(localStorage.getItem(THEME_KEY));
	} catch {
		return "auto";
	}
}

import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";

/**
 * localStorage, written at most every half second (the store is saved on every keystroke in a message box otherwise),
 * and at once when the page is hidden or closed so nothing typed is lost.
 */
function batchedStorage(): StateStorage {
	const pending = new Map<string, string>();
	let timer: ReturnType<typeof setTimeout> | null = null;
	const flush = () => {
		if (timer) clearTimeout(timer);
		timer = null;
		for (const [key, value] of pending) {
			try {
				localStorage.setItem(key, value);
			} catch {}
		}
		pending.clear();
	};
	if (typeof window !== "undefined") {
		window.addEventListener("pagehide", flush);
		document.addEventListener("visibilitychange", () => {
			if (document.visibilityState === "hidden") flush();
		});
	}
	return {
		getItem: (key) => pending.get(key) ?? localStorage.getItem(key),
		setItem: (key, value) => {
			pending.set(key, value);
			timer ??= setTimeout(flush, 500);
		},
		removeItem: (key) => {
			pending.delete(key);
			localStorage.removeItem(key);
		},
	};
}

import { useShallow } from "zustand/react/shallow";

/** One of the six group themes, or "auto" (Virtual Singers by day, Nightcord at 25:00 at night). */
export type Theme = ThemeChoice;
export type Connection = "connecting" | "online" | "offline";

/**
 * What a bot is up to, shown by its avatar's motion (and its current action on hover): idle, thinking,
 * working, waiting for you, blocked (something went wrong), or done (briefly, after it finishes).
 */
export type { Presence };

interface UiState {
	/** Tablets: the full sidebar opened over the screen from the collapsed rail. */
	sidebarOpen: boolean;
	/** Desktop: collapse the sidebar to an icon rail. */
	sidebarCollapsed: boolean;
	/** Bots calling you right now. */
	rings: CallRing[];
	setRings: (fn: (r: CallRing[]) => CallRing[]) => void;
	/** Sidebar sections you folded (Pinned, Bots, Groups, Discord…). */
	foldedSections: Record<string, boolean>;
	toggleSection: (id: string) => void;
	/** Folds (or unfolds) several sections at once. */
	foldSections: (ids: string[], folded: boolean) => void;
	panelOpen: boolean;
	/** What the side panel beside a chat shows: the chat's details, or the bot's computer. */
	panelView: "details" | "computer";
	theme: Theme;
	connection: Connection;
	/** Runs that are queued or in progress, by id (drives typing indicators and "working" avatars). */
	activeRuns: Record<string, Run>;
	/** What each active run is doing right now ("Searching the web"), from its latest message part. */
	runActivity: Record<string, { state: "thinking" | "working" | "waiting"; label: string; computer?: boolean }>;
	/** Bots that just finished or failed, by agent id (cleared after a few seconds). */
	settled: Record<string, { state: "done" | "blocked"; label: string; at: number }>;
	drafts: Record<string, string>;
	replyTo: Record<string, Message | null>;
	paletteOpen: boolean;
	/** What search (⌘K) looks through: everything, or Settings alone (opened from Settings on a phone). */
	paletteScope: "all" | "settings";
	newAgentOpen: boolean;
	importBotOpen: boolean;
	newGroupOpen: boolean;
	/** New chat: pick a bot. */
	newChatOpen: boolean;
	/** The chat you had open last (desktop "/" opens it again). */
	lastChatId: string | null;
	/** The "Get the apps" dialog (desktop and phone apps, browser extension). */
	getAppsOpen: boolean;
	/** Who skipped the first-bot welcome on this device (a person's id), so "/" opens the app for them instead. */
	welcomeSkippedBy: string | null;

	setSidebarOpen(open: boolean): void;
	toggleSidebarCollapsed(): void;
	openPanel(): void;
	openComputer(): void;
	closePanel(): void;
	togglePanel(): void;
	setTheme(theme: Theme): void;
	setConnection(c: Connection): void;
	trackRun(run: Run): void;
	/** After reconnecting: these are the runs still going; any other "active" run finished while we were away. */
	syncActiveRuns(runs: Run[]): void;
	noteActivity(messageId: string, part: MessagePart): void;
	setDraft(conversationId: string, text: string): void;
	setReplyTo(conversationId: string, message: Message | null): void;
	setPaletteOpen(open: boolean, scope?: "all" | "settings"): void;
	setNewAgentOpen(open: boolean): void;
	setImportBotOpen(open: boolean): void;
	setNewGroupOpen(open: boolean): void;
	setNewChatOpen(open: boolean): void;
	setLastChat(conversationId: string): void;
	setGetAppsOpen(open: boolean): void;
	skipWelcome(userId: string): void;
}

const ACTIVE = new Set(["queued", "running", "awaiting_approval"]);
const DONE_FOR_MS = 4_000;
const BLOCKED_FOR_MS = 60_000;

const COMPUTER_CATEGORIES = new Set(["computer", "browser", "machines"]);

function activityOf(
	part: MessagePart,
): { state: "thinking" | "working" | "waiting"; label: string; computer?: boolean } | null {
	switch (part.type) {
		case "tool":
			if (part.status === "awaiting_approval")
				return { state: "waiting", label: `Waiting for your OK: ${part.title ?? part.name}` };
			return {
				state: "working",
				label: part.title ?? part.name,
				computer: COMPUTER_CATEGORIES.has(part.category ?? ""),
			};
		case "reasoning":
			return part.endedAt ? null : { state: "thinking", label: "Thinking" };
		case "advisor":
			return { state: "thinking", label: "Asking for advice" };
		case "text":
			return part.text ? { state: "working", label: "Writing" } : null;
		default:
			return null;
	}
}

export const useUi = create<UiState>()(
	persist(
		(set) => ({
			sidebarOpen: false,
			sidebarCollapsed: false,
			foldedSections: {},
			rings: [],
			setRings: (fn) => set((s) => ({ rings: fn(s.rings) })),
			toggleSection: (id) =>
				set((s) => ({ foldedSections: { ...s.foldedSections, [id]: !s.foldedSections[id] } })),
			foldSections: (ids, folded) =>
				set((s) => ({
					foldedSections: { ...s.foldedSections, ...Object.fromEntries(ids.map((id) => [id, folded])) },
				})),
			panelOpen: false,
			panelView: "details",
			// The theme is saved on its own (sekai.theme), shared with other tabs: not in this store's saved state.
			theme: savedTheme(),
			connection: "connecting",
			activeRuns: {},
			runActivity: {},
			settled: {},
			drafts: {},
			replyTo: {},
			paletteOpen: false,
			paletteScope: "all",
			newAgentOpen: false,
			importBotOpen: false,
			newGroupOpen: false,
			newChatOpen: false,
			lastChatId: null,
			getAppsOpen: false,
			welcomeSkippedBy: null,

			setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
			toggleSidebarCollapsed: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
			openPanel: () => set({ panelOpen: true, panelView: "details" }),
			openComputer: () => set({ panelOpen: true, panelView: "computer" }),
			closePanel: () => set({ panelOpen: false }),
			togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
			setTheme: (theme) => {
				applyTheme(theme);
				set({ theme });
			},
			setConnection: (connection) => set({ connection }),
			syncActiveRuns: (runs) =>
				set((s) => {
					const live = new Set(runs.map((r) => r.id));
					const activeRuns = Object.fromEntries(runs.map((r) => [r.id, r]));
					const runActivity = Object.fromEntries(
						Object.entries(s.runActivity).filter(([id]) => live.has(id)),
					);
					return { activeRuns, runActivity };
				}),
			trackRun: (run) => {
				const at = Date.now();
				set((s) => {
					const activeRuns = { ...s.activeRuns };
					const runActivity = { ...s.runActivity };
					const settled = { ...s.settled };
					if (ACTIVE.has(run.status)) {
						activeRuns[run.id] = run;
						delete settled[run.agentId];
					} else {
						const wasActive = Boolean(activeRuns[run.id]);
						delete activeRuns[run.id];
						delete runActivity[run.id];
						if (wasActive && run.status === "done")
							settled[run.agentId] = { state: "done", label: "Done", at };
						if (wasActive && run.status === "error") {
							settled[run.agentId] = { state: "blocked", label: run.error ?? "Something went wrong", at };
						}
					}
					return { activeRuns, runActivity, settled };
				});
				if (run.status === "done" || run.status === "error") {
					setTimeout(
						() =>
							set((s) => {
								if (s.settled[run.agentId]?.at !== at) return {};
								const settled = { ...s.settled };
								delete settled[run.agentId];
								return { settled };
							}),
						run.status === "done" ? DONE_FOR_MS : BLOCKED_FOR_MS,
					);
				}
			},
			noteActivity: (messageId, part) =>
				set((s) => {
					const run = Object.values(s.activeRuns).find((r) => r.messageId === messageId);
					const activity = activityOf(part);
					if (!run || !activity) return {};
					const current = s.runActivity[run.id];
					if (
						current?.label === activity.label &&
						current.state === activity.state &&
						current.computer === activity.computer
					) {
						return {};
					}
					return { runActivity: { ...s.runActivity, [run.id]: activity } };
				}),
			setDraft: (id, text) =>
				set((s) => {
					const drafts = { ...s.drafts };
					if (text) drafts[id] = text;
					else delete drafts[id];
					return { drafts };
				}),
			setReplyTo: (id, message) => set((s) => ({ replyTo: { ...s.replyTo, [id]: message } })),
			setPaletteOpen: (paletteOpen, scope) =>
				set(paletteOpen ? { paletteOpen, paletteScope: scope ?? "all" } : { paletteOpen }),
			setNewAgentOpen: (newAgentOpen) => set({ newAgentOpen }),
			setImportBotOpen: (importBotOpen) => set({ importBotOpen }),
			setNewGroupOpen: (newGroupOpen) => set({ newGroupOpen }),
			setNewChatOpen: (newChatOpen) => set({ newChatOpen }),
			setLastChat: (lastChatId) => set((s) => (s.lastChatId === lastChatId ? {} : { lastChatId })),
			setGetAppsOpen: (getAppsOpen) => set({ getAppsOpen }),
			skipWelcome: (welcomeSkippedBy) => set({ welcomeSkippedBy }),
		}),
		{
			name: "sekai.ui",
			storage: createJSONStorage(batchedStorage),
			partialize: (s) => ({
				sidebarCollapsed: s.sidebarCollapsed,
				foldedSections: s.foldedSections,
				drafts: s.drafts,
				panelOpen: s.panelOpen,
				lastChatId: s.lastChatId,
				welcomeSkippedBy: s.welcomeSkippedBy,
			}),
		},
	),
);

export function applyTheme(theme: Theme): void {
	applyThemeChoice(theme);
}

/** Agents with work in progress in a conversation (or anywhere, without an id). */
export function useWorkingAgents(conversationId?: string): Run[] {
	return useUi(
		useShallow((s) =>
			Object.values(s.activeRuns).filter((r) => !conversationId || r.conversationId === conversationId),
		),
	);
}

/** A bot's presence (optionally in one conversation) and what it's doing, for its avatar and status line. */
export function useAgentPresence(
	agentId: string | undefined,
	conversationId?: string,
): {
	state: Presence;
	label: string | null;
	/** It's using its computer or browser right now. */
	computer?: boolean;
} {
	return useUi(
		useShallow((s) => {
			if (!agentId) return { state: "idle" as Presence, label: null };
			const runs = Object.values(s.activeRuns).filter(
				(r) => r.agentId === agentId && (!conversationId || r.conversationId === conversationId),
			);
			const waiting = runs.find(
				(r) => r.status === "awaiting_approval" || s.runActivity[r.id]?.state === "waiting",
			);
			if (waiting) {
				const a = s.runActivity[waiting.id];
				return {
					state: "waiting" as Presence,
					label: a?.state === "waiting" ? a.label : "Waiting for your OK",
				};
			}
			const running = runs.find((r) => r.status === "running");
			if (running) {
				const a = s.runActivity[running.id];
				return {
					state: (a?.state ?? "thinking") as Presence,
					label: a?.label ?? "Thinking",
					computer: a?.computer ?? false,
				};
			}
			if (runs.length) return { state: "thinking" as Presence, label: "Up next" };
			const settled = s.settled[agentId];
			if (settled) return { state: settled.state as Presence, label: settled.label };
			return { state: "idle" as Presence, label: null };
		}),
	);
}
