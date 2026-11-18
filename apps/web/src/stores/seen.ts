import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Last time each conversation was viewed, for unread dots in the sidebar. */
interface SeenState {
	seen: Record<string, number>;
	markSeen(conversationId: string, at?: number): void;
	/** Marks chats read up to their last message (or now, whichever is later). */
	markRead(chats: { id: string; lastMessageAt?: number | null }[]): void;
}

export const useSeen = create<SeenState>()(
	persist(
		(set) => ({
			seen: {},
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
		{ name: "sekai.seen" },
	),
);
