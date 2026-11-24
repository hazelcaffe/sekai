import { rm } from "node:fs/promises";
import { join } from "node:path";
import {
	type Agent,
	AgentCapabilities,
	AgentCreate,
	type AgentCreate as AgentCreateInput,
	AgentModels,
	AgentUpdate,
	type AgentUpdate as AgentUpdateInput,
	randomAvatar,
} from "@sekai/shared";
import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import { currentActor, requirePermission } from "../auth/actor.ts";
import { config } from "../config.ts";
import { db, schema } from "../db/index.ts";
import { bus } from "../events/bus.ts";
import { errorMessage, HttpError, notFound, parse } from "../lib/errors.ts";
import { ID } from "../lib/ids.ts";
import { log } from "../lib/log.ts";
import { getSettings } from "./settings.ts";
import { shareUploadWithUsers, uploadIdFromUrl } from "./uploads.ts";
import { canSeeAgent, forgetShares, newOwner, requireOwnAgent, visibleAgentsWhere } from "./visibility.ts";

type AgentRow = typeof schema.agents.$inferSelect;

/** Re-parses JSON columns so rows written by older versions pick up new defaults. */
export function toAgent(row: AgentRow, sharedBy: string | null = null): Agent {
	return {
		...row,
		models: AgentModels.parse(row.models),
		capabilities: AgentCapabilities.parse(row.capabilities),
		sharedBy,
	};
}

/** Names of the people who own these bots (for "shared by …"). */
async function ownerNames(userIds: string[]): Promise<Map<string, string>> {
	if (!userIds.length) return new Map();
	const rows = await db
		.select({ id: schema.users.id, name: schema.users.name })
		.from(schema.users)
		.where(inArray(schema.users.id, [...new Set(userIds)]));
	return new Map(rows.map((r) => [r.id, r.name]));
}

/** How a bot looks to the person Sekai acts for: someone else's bot is shared (not primary or pinned for them). */
async function present(rows: AgentRow[]): Promise<Agent[]> {
	const me = currentActor()?.userId;
	const others = rows.filter((r) => me && r.userId !== me);
	const names = await ownerNames(others.map((r) => r.userId));
	return rows.map((r) =>
		me && r.userId !== me
			? { ...toAgent(r, names.get(r.userId) ?? "someone"), isPrimary: false, pinned: false }
			: toAgent(r),
	);
}

/** Your bots, then the ones shared with you. Sekai itself (no one signed in) sees every bot. */
export async function listAgents(): Promise<Agent[]> {
	const rows = await db
		.select()
		.from(schema.agents)
		.where(await visibleAgentsWhere())
		.orderBy(desc(schema.agents.pinned), asc(schema.agents.sortOrder), asc(schema.agents.createdAt));
	const me = currentActor()?.userId;
	const mine = rows.filter((r) => !me || r.userId === me);
	const shared = rows.filter((r) => me && r.userId !== me).sort((a, b) => a.name.localeCompare(b.name));
	return present([...mine, ...shared]);
}

/**
 * A bot as someone it's shared with sees it in the app: its owner's standing instructions and which skills and apps
 * it has stay private (it still follows them when it replies).
 */
export function forViewer(agent: Agent): Agent {
	if (!agent.sharedBy) return agent;
	return { ...agent, instructions: "", skillIds: [], mcp: [] };
}

/** Only the bots this person owns (not shared ones). */
export async function listOwnAgents(): Promise<Agent[]> {
	const me = currentActor()?.userId;
	return (await listAgents()).filter((a) => !me || a.userId === me);
}

/** A bot, if the person Sekai acts for may see it (theirs or shared with them). */
export async function getAgent(id: string): Promise<Agent | null> {
	const row = await db.query.agents.findFirst({ where: eq(schema.agents.id, id) });
	if (!row || !(await canSeeAgent(row))) return null;
	const [agent] = await present([row]);
	return agent ?? null;
}

/** A bot regardless of who's looking (Sekai's own bookkeeping: whose it is, who it's shared with). */
export async function getAgentRow(id: string): Promise<AgentRow | null> {
	return (await db.query.agents.findFirst({ where: eq(schema.agents.id, id) })) ?? null;
}

/** A bot the person Sekai acts for owns (to change it). */
export async function requireOwnedAgent(id: string): Promise<Agent> {
	const agent = await requireAgent(id);
	requireOwnAgent(agent);
	return agent;
}

/**
 * Who hears about changes to a bot: its owner, and the people it's shared with (a role or everyone: everyone
 * signed in, since the app ignores bots it can't see).
 */
export async function agentAudience(agentId: string, ownerId: string): Promise<string[] | "everyone"> {
	const shares = await db.select().from(schema.agentShares).where(eq(schema.agentShares.agentId, agentId));
	if (shares.some((s) => s.kind !== "user")) return "everyone";
	return [ownerId, ...shares.map((s) => s.targetId).filter((x): x is string => Boolean(x))];
}

export async function requireAgent(id: string): Promise<Agent> {
	const agent = await getAgent(id);
	if (!agent) throw notFound("Bot");
	return agent;
}

/** Finds an agent by id or (case-insensitive) name. Agents refer to each other by name. */
export async function findAgent(ref: string): Promise<Agent | null> {
	const byId = await getAgent(ref);
	if (byId) return byId;
	const needle = ref.trim().replace(/^@/, "").toLowerCase();
	const all = await listAgents();
	return all.find((a) => a.name.toLowerCase() === needle) ?? null;
}

/** One primary bot per person. */
async function clearPrimary(exceptId: string, userId: string): Promise<void> {
	await db
		.update(schema.agents)
		.set({ isPrimary: false, updatedAt: Date.now() })
		.where(
			and(eq(schema.agents.isPrimary, true), eq(schema.agents.userId, userId), ne(schema.agents.id, exceptId)),
		);
}

/** Throws when the person's role caps their bots and they're at it. */
async function checkBotLimit(userId: string): Promise<void> {
	const actor = currentActor();
	const max = actor?.limits.maxBots;
	if (max === null || max === undefined) return;
	const own = await db.select({ id: schema.agents.id }).from(schema.agents).where(eq(schema.agents.userId, userId));
	if (own.length >= max) {
		throw new HttpError(
			403,
			`Your role allows ${max} bot${max === 1 ? "" : "s"}. Delete one, or ask an admin for more.`,
		);
	}
}

/** A bot's picture is shown to everyone it's shared with: its file becomes visible to people signed in. */
async function sharePicture(avatar: Agent["avatar"] | undefined): Promise<void> {
	if (avatar?.kind !== "image") return;
	const id = uploadIdFromUrl(avatar.url);
	if (id) await shareUploadWithUsers(id);
}

/** Apps a person may give their bot: theirs, or shared with everyone. */
async function checkApps(bindings: Agent["mcp"] | undefined): Promise<void> {
	if (!bindings?.length) return;
	const { getServer } = await import("../mcp/manager.ts");
	for (const b of bindings) {
		if (!(await getServer(b.serverId))) throw notFound("App");
	}
}

export async function createAgent(input: AgentCreateInput, opts: { ownerId?: string } = {}): Promise<Agent> {
	const data = parse(AgentCreate, input);
	requirePermission("bots");
	await checkApps(data.mcp);
	const settings = await getSettings();
	const now = Date.now();
	const userId = opts.ownerId ?? newOwner();
	await checkBotLimit(userId);
	const existing = (await db.select().from(schema.agents).where(eq(schema.agents.userId, userId))).map((r) =>
		toAgent(r),
	);
	const id = ID.agent();
	// The defaults from Settings → Models, or models on offer when they aren't (a fresh install).
	const { defaultModels } = await import("../agent/models.ts");
	const row: AgentRow = {
		id,
		userId,
		name: data.name,
		label: data.label,
		job: data.job,
		personality: data.personality,
		instructions: data.instructions,
		avatar: data.avatar ?? randomAvatar(data.name),
		models: data.models ?? AgentModels.parse(await defaultModels(settings)),
		capabilities: data.capabilities ?? AgentCapabilities.parse({}),
		skillIds: data.skillIds ?? [],
		mcp: data.mcp ?? [],
		isPrimary: data.isPrimary ?? existing.length === 0,
		pinned: false,
		hidden: false,
		section: data.section ?? null,
		status: "active",
		sortOrder: existing.reduce((max, a) => Math.max(max, a.sortOrder), 0) + 1,
		createdAt: now,
		updatedAt: now,
	};
	await db.insert(schema.agents).values(row);
	await sharePicture(row.avatar);
	if (row.isPrimary) await clearPrimary(id, userId);
	const agent = toAgent(row);
	bus.emit({ type: "agent.created", agent }, { to: [userId] });
	return agent;
}

/** Tells everyone who sees a bot that it changed (each app reads it again, as itself). */
export async function announceAgent(id: string): Promise<void> {
	const row = await getAgentRow(id);
	if (!row) return;
	const to = await agentAudience(id, row.userId);
	// Others get the bot as they see it (shared, never primary for them); the owner, as it is.
	bus.emit({ type: "agent.updated", agent: toAgent(row) }, { to: [row.userId] });
	const others = to === "everyone" ? "everyone" : to.filter((u) => u !== row.userId);
	if (others === "everyone" || others.length) {
		const [owner] = await db
			.select({ name: schema.users.name })
			.from(schema.users)
			.where(eq(schema.users.id, row.userId));
		const shared = forViewer({ ...toAgent(row, owner?.name ?? "someone"), isPrimary: false, pinned: false });
		bus.emit({ type: "agent.updated", agent: shared }, { to: others === "everyone" ? "everyone" : others });
	}
}

export async function updateAgent(id: string, input: AgentUpdateInput): Promise<Agent> {
	const patch = parse(AgentUpdate, input);
	const before = await requireOwnedAgent(id);
	await checkApps(patch.mcp);
	await sharePicture(patch.avatar);
	await db
		.update(schema.agents)
		.set({ ...patch, updatedAt: Date.now() })
		.where(eq(schema.agents.id, id));
	if (patch.isPrimary) await clearPrimary(id, before.userId);
	const agent = await requireAgent(id);
	await announceAgent(id);
	if (patch.isPrimary) {
		for (const other of await listOwnAgents()) {
			if (other.id !== id) bus.emit({ type: "agent.updated", agent: other }, { to: [before.userId] });
		}
	}
	return agent;
}

export async function deleteAgent(id: string): Promise<void> {
	const agent = await requireOwnedAgent(id);
	const audience = await agentAudience(id, agent.userId);
	// Its runs (and any approvals they wait on) stop first.
	const { cancelAgentRuns } = await import("../agent/runtime.ts");
	await cancelAgentRuns(id);
	const { stopWatcher } = await import("../email/watch.ts");
	await stopWatcher(id, { forget: true });
	// Its computer and devboxes would otherwise keep running on Proxmox; its seats on other bots' machines go too.
	const { deleteAgentMachines } = await import("../machines/manager.ts");
	await deleteAgentMachines(id);
	const { removeAgentSeats } = await import("../machines/seats.ts");
	await removeAgentSeats(id).catch((err: unknown) => log.warn(`${agent.name}'s seats: ${errorMessage(err)}`));
	const { closeBrowser } = await import("../browser/engine.ts");
	await closeBrowser(id);
	const { leaveSharedBrowsers } = await import("../browser/shared.ts");
	await leaveSharedBrowsers(id);
	// Its keys come off your devices and teammates' machines (the database would only forget that it had access).
	const { listGrants, revokeGrant } = await import("../machines/hosts.ts");
	for (const g of (await listGrants()).filter((x) => x.agentId === id)) {
		await revokeGrant(g.id).catch((err: unknown) =>
			log.warn(`couldn't take ${agent.name}'s key off a device: ${errorMessage(err)}`),
		);
	}
	// Group chats keep their history; the agent just leaves them (anyone's: a shared bot can be in others' groups).
	const groups = await db.select().from(schema.conversations).where(eq(schema.conversations.kind, "group"));
	for (const g of groups) {
		if (!g.memberIds.includes(id)) continue;
		const memberIds = g.memberIds.filter((m) => m !== id);
		await db
			.update(schema.conversations)
			.set({ memberIds, updatedAt: Date.now() })
			.where(eq(schema.conversations.id, g.id));
	}
	await db.delete(schema.agents).where(eq(schema.agents.id, id));
	// The folder its subscription agent worked in (files, attachments), its SSH key and its browser profile go with it.
	await rm(join(config.dataDir, "workspaces", id), { recursive: true, force: true }).catch(() => {});
	await rm(join(config.dataDir, "ssh", "keys", id), { force: true }).catch(() => {});
	await rm(join(config.dataDir, "browser", id), { recursive: true, force: true }).catch(() => {});
	forgetShares();
	bus.emit({ type: "agent.deleted", agentId: id }, { to: audience });
	if (agent.isPrimary) {
		const next = (await listOwnAgents()).find((a) => !a.hidden && a.userId === agent.userId);
		if (next) await updateAgent(next.id, { isPrimary: true });
	}
}

/**
 * Copies profile, model setup, skills, tools and routines. Not history, memory or notes. A copy of a bot shared
 * with you is yours (without its owner's apps and routines, which use their accounts).
 */
export async function duplicateAgent(id: string): Promise<Agent> {
	const src = await requireOwnedAgent(id);
	const mine = !src.sharedBy;
	const copy = await createAgent({
		name: `${src.name} copy`.slice(0, 60),
		label: src.label,
		job: src.job,
		personality: src.personality,
		instructions: src.instructions,
		avatar: src.avatar,
		models: src.models,
		capabilities: src.capabilities,
		skillIds: mine ? src.skillIds : [],
		mcp: mine ? src.mcp : [],
		isPrimary: false,
		section: mine ? src.section : null,
	});
	if (!mine) return copy;
	const routines = await db
		.select()
		.from(schema.routines)
		.where(and(eq(schema.routines.agentId, id), eq(schema.routines.userId, copy.userId)));
	const now = Date.now();
	for (const r of routines) {
		await db.insert(schema.routines).values({
			...r,
			id: ID.routine(),
			agentId: copy.id,
			conversationId: null,
			enabled: false,
			lastRunAt: null,
			lastStatus: null,
			runCount: 0,
			createdAt: now,
			updatedAt: now,
		});
	}
	return copy;
}

/** Orders your own bots (shared ones keep their place, after yours). */
export async function reorderAgents(ids: string[]): Promise<void> {
	const own = new Map((await listOwnAgents()).map((a) => [a.id, a]));
	let order = 1;
	for (const id of ids) {
		const agent = own.get(id);
		if (!agent) continue;
		await db.update(schema.agents).set({ sortOrder: order++ }).where(eq(schema.agents.id, id));
	}
	for (const agent of await listOwnAgents()) bus.emit({ type: "agent.updated", agent });
}
