import { type AgentShare, ShareTarget as ShareTargetSchema } from "@sekai/shared";
import { and, eq, isNull, ne } from "drizzle-orm";
import { actorFor, requirePermission } from "../auth/actor.ts";
import { db, schema } from "../db/index.ts";
import { bus } from "../events/bus.ts";
import { badRequest, notFound, parse } from "../lib/errors.ts";
import { newId } from "../lib/ids.ts";
import { announceAgent, requireOwnedAgent } from "./agents.ts";
import { forgetShares, sharedAgentIds } from "./visibility.ts";

/**
 * Sharing a bot: with one person (anyone whose role can share), or with everyone who has a role, or everyone
 * (admins). They chat with it in their own chats, with their own memory of it; it can't use its owner's computer,
 * accounts or apps there.
 */

export async function listShares(agentId: string): Promise<AgentShare[]> {
	await requireOwnedAgent(agentId);
	const rows = await db.select().from(schema.agentShares).where(eq(schema.agentShares.agentId, agentId));
	const users = await db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users);
	const roles = await db.select({ id: schema.roles.id, name: schema.roles.name }).from(schema.roles);
	return rows.map((r) => ({
		id: r.id,
		kind: r.kind,
		targetId: r.targetId,
		name:
			r.kind === "everyone"
				? "Everyone"
				: r.kind === "role"
					? `Everyone with ${roles.find((x) => x.id === r.targetId)?.name ?? "a deleted role"}`
					: (users.find((x) => x.id === r.targetId)?.name ?? "Someone who left"),
		createdAt: r.createdAt,
	}));
}

/** Everyone who sees it now gets it (a bot newly shared with them appears in their app). */
function changed(agentId: string): void {
	forgetShares();
	void announceAgent(agentId);
}

export async function addShare(agentId: string, input: unknown): Promise<AgentShare[]> {
	const target = parse(ShareTargetSchema, input);
	requirePermission("share");
	const agent = await requireOwnedAgent(agentId);
	if (target.kind !== "user") requirePermission("admin");
	const targetId = target.kind === "user" ? target.userId : target.kind === "role" ? target.roleId : null;
	if (target.kind === "user") {
		if (target.userId === agent.userId) throw badRequest("It's already yours.");
		const [u] = await db
			.select({ id: schema.users.id })
			.from(schema.users)
			.where(eq(schema.users.id, target.userId));
		if (!u) throw notFound("Person");
	}
	if (target.kind === "role") {
		const [r] = await db
			.select({ id: schema.roles.id })
			.from(schema.roles)
			.where(eq(schema.roles.id, target.roleId));
		if (!r) throw notFound("Role");
	}
	const existing = await db.select().from(schema.agentShares).where(eq(schema.agentShares.agentId, agentId));
	if (!existing.some((s) => s.kind === target.kind && s.targetId === targetId)) {
		await db.insert(schema.agentShares).values({
			id: newId("shr", 16),
			agentId,
			kind: target.kind,
			targetId,
			createdAt: Date.now(),
		});
	}
	changed(agentId);
	return listShares(agentId);
}

export async function removeShare(agentId: string, shareId: string): Promise<AgentShare[]> {
	const agent = await requireOwnedAgent(agentId);
	const [row] = await db
		.select()
		.from(schema.agentShares)
		.where(and(eq(schema.agentShares.agentId, agentId), eq(schema.agentShares.id, shareId)));
	if (!row) throw notFound("Share");
	await db.delete(schema.agentShares).where(eq(schema.agentShares.id, shareId));
	forgetShares();
	// Whoever can't see it any more drops it from their app.
	const people = await db
		.select({ id: schema.users.id })
		.from(schema.users)
		.where(and(isNull(schema.users.disabledAt), ne(schema.users.id, agent.userId)));
	const lost: string[] = [];
	for (const p of people) {
		const who = await actorFor(p.id).catch(() => null);
		if (who && !(await sharedAgentIds(who)).includes(agentId)) lost.push(p.id);
	}
	if (lost.length) bus.emit({ type: "agent.deleted", agentId }, { to: lost });
	changed(agentId);
	return listShares(agentId);
}
