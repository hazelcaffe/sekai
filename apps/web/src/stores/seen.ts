import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Last time each conversation was viewed, for unread dots in the sidebar. */
interface SeenState {
	seen: Record<string, number>;
	/**
	 * When this device started keeping track: what came before counts as read here, so a new browser or phone
	 * doesn't show every chat as unread. 0 on devices that kept track before this existed (nothing changes there).
	 */
	since: number | null;
	/** Starts keeping track on this device (once). */
	start(): void;
	markSeen(conversationId: string, at?: number): void;
	/** Marks chats read up to their last message (or now, whichever is later). */
	markRead(chats: { id: string; lastMessageAt?: number | null }[]): void;
}

export const useSeen = create<SeenState>()(
	persist(
		(set) => ({
			seen: {},
			since: null,
			start: () => set((s) => (s.since == null ? { since: Date.now() } : s)),
			markSeen: (id, at = Date.now()) =>
				set((s) => ((s.seen[id] ?? 0) >= at ? s : { seen: { ...s.seen, [id]: at } })),
			markRead: (chats) =>
				set((s) => {
					const now = Date.now();
					const seen = { ...s.seen };
					for (const c of chats) seen[c.id] = Math.max(seen[c.id] ?? 0, now, c.lastMessageAt ?? 0);
					return { seen };
				}),
		}),
		{
			name: "sekai.seen",
			version: 1,
			// Kept before `since` existed: everything this device hasn't seen stays unread, as it was.
			migrate: (old, version) => ({ ...(old as SeenState), since: version < 1 ? 0 : (old as SeenState).since }),
			// A first visit on this device: start now (and save it, so the next visit keeps the same start).
			onRehydrateStorage: () => (state) => state?.start(),
		},
	),
);
