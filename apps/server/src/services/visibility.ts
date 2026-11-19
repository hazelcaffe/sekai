import { and, eq, inArray, isNull, or, type SQL } from "drizzle-orm";
import { type Actor, currentActor } from "../auth/actor.ts";
import { db, schema } from "../db/index.ts";
import { HttpError } from "../lib/errors.ts";

/**
 * Who sees what. Everything personal belongs to one person (its userId). Bots can also be shared: with a person,
 * with everyone who has a role, or with everyone. Someone a bot is shared with chats with it in their own chats,
 * with their own memory of it, but can't change it. Sekai's own work (no actor) sees everything.
 */

const sharedCache = new Map<string, { ids: string[]; until: number }>();

export function forgetShares(): void {
	sharedCache.clear();
}

/** Bots shared with this person (not their own). */
export async function sharedAgentIds(actor: Pick<Actor, "userId" | "roleId">): Promise<string[]> {
	const key = `${actor.userId}:${actor.roleId}`;
	const hit = sharedCache.get(key);
	if (hit && hit.until > Date.now()) return hit.ids;
	const rows = await db
		.select({ agentId: schema.agentShares.agentId, owner: schema.agents.userId })
		.from(schema.agentShares)
		.innerJoin(schema.agents, eq(schema.agents.id, schema.agentShares.agentId))
		.innerJoin(schema.users, eq(schema.users.id, schema.agents.userId))
		.where(
			and(
				isNull(schema.users.disabledAt),
				or(
					and(eq(schema.agentShares.kind, "user"), eq(schema.agentShares.targetId, actor.userId)),
					and(eq(schema.agentShares.kind, "role"), eq(schema.agentShares.targetId, actor.roleId)),
					eq(schema.agentShares.kind, "everyone"),
				),
			),
		);
	const ids = [...new Set(rows.filter((r) => r.owner !== actor.userId).map((r) => r.agentId))];
	if (sharedCache.size > 1000) sharedCache.clear();
	sharedCache.set(key, { ids, until: Date.now() + 10_000 });
	return ids;
}

/** A condition limiting agents to the ones the actor sees (theirs and shared with them); none for Sekai itself. */
export async function visibleAgentsWhere(actor = currentActor()): Promise<SQL | undefined> {
	if (!actor) return undefined;
	const shared = await sharedAgentIds(actor);
	return shared.length
		? or(eq(schema.agents.userId, actor.userId), inArray(schema.agents.id, shared))
		: eq(schema.agents.userId, actor.userId);
}

export async function canSeeAgent(agent: { id: string; userId: string }, actor = currentActor()): Promise<boolean> {
	if (!actor || agent.userId === actor.userId) return true;
	return (await sharedAgentIds(actor)).includes(agent.id);
}

/**
 * Whether a bot may use a shared machine or browser (or its own machine) in this run, where Sekai acts for `actor`.
 * The one rule for every place that lists or uses them (tools, the browser, the prompt):
 * - in its owner's runs: any of its bots, and bots shared with the owner (while they still are);
 * - for someone else: only with the switch "Also for people these bots are shared with" on, and only bots the
 *   owner owns, chatting with someone they're shared with;
 * - a bot someone else owns never uses it in its own owner's chats, or anyone else's.
 * Sekai's own work for a bot (no actor) counts as its owner's.
 */
export async function mayUseShared(
	resource: { ownerId: string; shareWithViewers: boolean },
	agent: { id: string; userId: string },
	actor: Pick<Actor, "userId" | "roleId"> | null = currentActor(),
): Promise<boolean> {
	const sharedWithActor =
		actor && agent.userId !== actor.userId ? (await sharedAgentIds(actor)).includes(agent.id) : false;
	return sharedRule(resource, agent, actor?.userId ?? null, sharedWithActor);
}

/** mayUseShared's rule, given whether the bot is shared with the person Sekai acts for. */
export function sharedRule(
	resource: { ownerId: string; shareWithViewers: boolean },
	agent: { userId: string },
	actorId: string | null,
	sharedWithActor: boolean,
): boolean {
	const who = actorId ?? agent.userId;
	if (who === resource.ownerId) return agent.userId === who || sharedWithActor;
	return resource.shareWithViewers && agent.userId === resource.ownerId && sharedWithActor;
}

/** Whether the actor may change this bot (it's theirs; Sekai itself may). */
export function ownsAgent(agent: { userId: string }, actor = currentActor()): boolean {
	return !actor || agent.userId === actor.userId;
}

export function requireOwnAgent(agent: { userId: string; name: string }, actor = currentActor()): void {
	if (!ownsAgent(agent, actor))
		throw new HttpError(403, `${agent.name} is shared with you: only its owner can change it.`);
}

/** A condition limiting a table's rows to the actor's own (none for Sekai itself). */
export function ownWhere(column: Parameters<typeof eq>[0], actor = currentActor()): SQL | undefined {
	return actor ? eq(column, actor.userId) : undefined;
}

/** Whether a row with this owner is the actor's (or Sekai itself is looking). */
export function isMine(userId: string | null | undefined, actor = currentActor()): boolean {
	return !actor || userId === actor.userId;
}

/** Who a new row belongs to: the person Sekai acts for, else the given fallback (the bot's owner, say). */
export function newOwner(fallback?: string | null): string {
	const id = currentActor()?.userId ?? fallback;
	if (!id) throw new Error("Couldn't tell whose this is: no one to act for");
	return id;
}
