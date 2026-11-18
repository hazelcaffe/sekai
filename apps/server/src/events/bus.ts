import type { ServerEvent } from "@sekai/shared";
import { currentActor } from "../auth/actor.ts";
import { log } from "../lib/log.ts";

/**
 * Who an event is for: the people it's about (by user id), every admin, or everyone signed in. Live events only
 * reach their audience: someone's chats, bots and notifications never show up in another person's app.
 */
export type Audience = "everyone" | "admins" | readonly string[];

type Listener = (event: ServerEvent, audience: Audience) => void;

const listeners = new Set<Listener>();

/** Whether a signed-in person is in an event's audience. */
export function inAudience(audience: Audience, who: { userId: string; admin: boolean }): boolean {
	if (audience === "everyone") return true;
	if (audience === "admins") return who.admin;
	return audience.includes(who.userId);
}

/** In-process pub/sub. The SSE endpoint fans every event out to the clients in its audience. */
export const bus = {
	/**
	 * Sends an event. Without `to`, it's for the person Sekai is acting for (the one whose request, reply or routine
	 * this is); with no one to act for (Sekai's own work), it goes to admins only.
	 */
	emit(event: ServerEvent, opts: { to?: Audience } = {}): void {
		const actor = currentActor();
		const audience: Audience = opts.to ?? (actor ? [actor.userId] : "admins");
		for (const listener of listeners) {
			try {
				listener(event, audience);
			} catch (err) {
				log.error(`event listener failed for ${event.type}`, err);
			}
		}
	},
	subscribe(listener: Listener): () => void {
		listeners.add(listener);
		return () => listeners.delete(listener);
	},
	get size(): number {
		return listeners.size;
	},
};
