import type { Agent, CallRing } from "@sekai/shared";
import { currentActor } from "../auth/actor.ts";
import { bus } from "../events/bus.ts";
import { conversationOwner } from "../events/scope.ts";
import { errorMessage } from "../lib/errors.ts";
import { newId } from "../lib/ids.ts";
import { log } from "../lib/log.ts";
import { mainChat, messageUser } from "./messages.ts";

/** How long a call rings before the bot gives up and messages you instead. */
export const RING_MS = 40_000;

type Outcome = "answered" | "declined" | "missed";

interface Ring extends CallRing {
	settle: (o: Outcome) => void;
	outcome: Promise<Outcome>;
}

const rings = new Map<string, Ring>();

/** Why a bot is calling, for the call it opens (answered from a ring). */
export function ringReason(ringId: string | null | undefined): { agentId: string; reason: string } | null {
	const r = ringId ? rings.get(ringId) : null;
	return r ? { agentId: r.agentId, reason: r.reason } : null;
}

/** You picked up (the app's call socket opened for this ring). */
export function answerRing(ringId: string, conversationId: string): boolean {
	const r = rings.get(ringId);
	if (!r || r.conversationId !== conversationId) return false;
	r.settle("answered");
	return true;
}

/** Whether a ring is for the acting person (their chat). */
async function forMe(r: CallRing): Promise<boolean> {
	const me = currentActor()?.userId;
	return !me || (await conversationOwner(r.conversationId)) === me;
}

export async function declineRing(ringId: string): Promise<boolean> {
	const r = rings.get(ringId);
	if (!r || !(await forMe(r))) return false;
	r.settle("declined");
	return true;
}

/** Your rings currently ringing (an app that just opened shows them). */
export async function activeRings(): Promise<CallRing[]> {
	const out: CallRing[] = [];
	for (const { settle: _s, outcome: _o, ...r } of rings.values()) if (await forMe(r)) out.push(r);
	return out;
}

/**
 * A bot calls you: the Sekai app rings (and a Discord voice channel you're in, when its bot can join). If you
 * don't pick up, it sends `message` (as a voice message) instead.
 */
export async function callUser(
	agent: Agent,
	input: { reason: string; message?: string },
): Promise<{ outcome: Outcome; via: "app" | "discord" | null; fallback: { where: string; voice: boolean } | null }> {
	const conversationId = await mainChat(agent.id);
	const id = newId("ring", 10);
	let settle: (o: Outcome) => void = () => {};
	const outcome = new Promise<Outcome>((resolve) => {
		settle = resolve;
	});
	const ring: Ring = {
		id,
		agentId: agent.id,
		conversationId,
		reason: input.reason,
		expiresAt: Date.now() + RING_MS,
		settle,
		outcome,
	};
	rings.set(id, ring);
	const timer = setTimeout(() => settle("missed"), RING_MS);
	bus.emit({
		type: "call.ring",
		ring: { id, agentId: agent.id, conversationId, reason: input.reason, expiresAt: ring.expiresAt },
	});
	bus.emit({
		type: "notification",
		title: `📞 ${agent.name} is calling`,
		body: input.reason,
		agentId: agent.id,
		conversationId,
	});
	log.info(`${agent.name} is calling you: ${input.reason}`);

	// On Discord: join the voice channel you're in, if the bot can see you in one.
	let via: "app" | "discord" | null = null;
	void (async () => {
		try {
			const { callOwnerInVoice } = await import("../channels/voice.ts");
			if (await callOwnerInVoice(agent, input.reason)) {
				via = "discord";
				settle("answered");
			}
		} catch (err) {
			log.debug(`no Discord call: ${errorMessage(err)}`);
		}
	})();

	const result = await outcome;
	clearTimeout(timer);
	rings.delete(id);
	bus.emit({ type: "call.ring.ended", ringId: id, outcome: result });
	if (result === "answered") return { outcome: result, via: via ?? "app", fallback: null };
	const text = input.message?.trim() || input.reason;
	const sent = await messageUser(agent, { text, voice: true }).catch((err: unknown) => {
		log.warn(`couldn't send the missed-call message: ${errorMessage(err)}`);
		return null;
	});
	return { outcome: result, via: null, fallback: sent ? { where: sent.where, voice: sent.voice } : null };
}
