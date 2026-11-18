import type { ServerEvent } from "@sekai/shared";
import { eq } from "drizzle-orm";
import type { Actor } from "../auth/actor.ts";
import { db, schema } from "../db/index.ts";
import { sharedAgentIds } from "../services/visibility.ts";
import { type Audience, inAudience } from "./bus.ts";

/**
 * Whose things events are about. A chat, a bot's computer or a run belongs to one person and never changes hands,
 * so owners are remembered after the first lookup. The live event stream and push notifications check these on
 * top of an event's audience: a chat's messages reach only its owner, whoever's work emitted them.
 */

const conversations = new Map<string, string>();
const agents = new Map<string, string>();
const machines = new Map<string, string>();
const LIMIT = 20_000;

function remember(map: Map<string, string>, key: string, value: string): void {
	if (map.size > LIMIT) map.clear();
	map.set(key, value);
}

export function rememberConversationOwner(conversationId: string, userId: string): void {
	remember(conversations, conversationId, userId);
}

export async function conversationOwner(conversationId: string): Promise<string | null> {
	const hit = conversations.get(conversationId);
	if (hit) return hit;
	const [row] = await db
		.select({ userId: schema.conversations.userId })
		.from(schema.conversations)
		.where(eq(schema.conversations.id, conversationId));
	if (row) remember(conversations, conversationId, row.userId);
	return row?.userId ?? null;
}

export async function agentOwner(agentId: string): Promise<string | null> {
	const hit = agents.get(agentId);
	if (hit) return hit;
	const [row] = await db
		.select({ userId: schema.agents.userId })
		.from(schema.agents)
		.where(eq(schema.agents.id, agentId));
	if (row) remember(agents, agentId, row.userId);
	return row?.userId ?? null;
}

async function machineOwner(machineId: string): Promise<string | null> {
	const hit = machines.get(machineId);
	if (hit) return hit;
	const [row] = await db
		.select({ userId: schema.agents.userId })
		.from(schema.machines)
		.innerJoin(schema.agents, eq(schema.agents.id, schema.machines.agentId))
		.where(eq(schema.machines.id, machineId));
	if (row) remember(machines, machineId, row.userId);
	return row?.userId ?? null;
}

async function seesAgent(agentId: string, who: Actor): Promise<boolean> {
	const owner = await agentOwner(agentId);
	if (!owner) return false;
	return owner === who.userId || (await sharedAgentIds(who)).includes(agentId);
}

/** The chat an event is about, if any. */
function conversationOf(ev: ServerEvent): string | null {
	switch (ev.type) {
		case "message.created":
		case "message.updated":
			return ev.message.conversationId;
		case "message.delta":
		case "message.part":
		case "message.deleted":
		case "conversation.deleted":
		case "conversation.reset":
			return ev.conversationId;
		case "conversation.created":
		case "conversation.updated":
			return ev.conversation.id;
		case "run.updated":
			return ev.run.conversationId;
		case "call.ring":
			return ev.ring.conversationId;
		case "notification":
			return ev.conversationId;
		default:
			return null;
	}
}

/**
 * Whether someone gets an event: chat events go to the chat's owner only; a bot's computer and code to the bot's
 * owner; bot changes to those who see the bot (and are in the audience); the rest by audience.
 */
export async function eventVisibleTo(ev: ServerEvent, audience: Audience, who: Actor): Promise<boolean> {
	const conversationId = conversationOf(ev);
	if (conversationId) {
		const owner = await conversationOwner(conversationId);
		// A chat that's gone (deleted just now): whoever it was emitted for.
		return owner ? owner === who.userId : inAudience(audience, who);
	}
	switch (ev.type) {
		case "agent.created":
		case "agent.updated":
			// The owner gets their bot as it is; others only the shared view (without its private setup).
			if (ev.agent.userId === who.userId) return !ev.agent.sharedBy && inAudience(audience, who);
			return Boolean(ev.agent.sharedBy) && inAudience(audience, who) && (await seesAgent(ev.agent.id, who));
		case "memory.changed":
		case "note.changed":
			return ev.agentId ? await seesAgent(ev.agentId, who) : inAudience(audience, who);
		case "code.changed":
			return (await agentOwner(ev.agentId)) === who.userId;
		case "machine.changed":
			return (await agentOwner(ev.machine.agentId)) === who.userId;
		case "machine.deleted":
			return (await agentOwner(ev.agentId)) === who.userId || inAudience(audience, who);
		case "machine.checkpoints":
			return (await machineOwner(ev.machineId)) === who.userId;
		case "notification":
			return inAudience(audience, who) && (!ev.agentId || (await seesAgent(ev.agentId, who)));
		default:
			return inAudience(audience, who);
	}
}
