import { rm } from "node:fs/promises";
import { join } from "node:path";
import {
	type Machine,
	type SharedBrowser,
	SharedBrowserInput,
	SharedBrowserUpdate,
	type SignInMode,
} from "@sekai/shared";
import { and, eq, inArray } from "drizzle-orm";
import { type Actor, actorFor, currentActor, requirePermission } from "../auth/actor.ts";
import { config } from "../config.ts";
import { db, schema } from "../db/index.ts";
import { bus } from "../events/bus.ts";
import { badRequest, errorMessage, notFound, parse } from "../lib/errors.ts";
import { newId } from "../lib/ids.ts";
import { log } from "../lib/log.ts";
import { requireMachine, sshTarget, toMachine } from "../machines/manager.ts";
import { sshText } from "../machines/ssh.ts";
import { getAgent, getAgentRow } from "../services/agents.ts";
import { mayUseShared, newOwner, ownWhere } from "../services/visibility.ts";

/**
 * Shared browsers: one browser several bots use, on the server or on one of the owner's computers (Chrome on that
 * computer's own screen, as its own account). With shared sign-ins every bot works in its own tab of one profile;
 * with separate sign-ins each bot gets its own profile in it. Who may use one in a run: mayUseShared.
 */

type Row = typeof schema.sharedBrowsers.$inferSelect;

/** Chrome debugging ports for shared browsers on a computer (bots' own Chromes use 9222 and 9232–9291). */
export const FIRST_SHARED_PORT = 9300;
const LAST_SHARED_PORT = 9399;

/** Names that already mean something to the browser tools' `on`. */
const RESERVED = new Set(["server", "computer", "my computer", "device", "user", "local", "user's computer"]);

const changed = (userId: string) => bus.emit({ type: "browsers.changed", userId }, { to: [userId] });

async function present(row: Row): Promise<SharedBrowser> {
	const owner = await actorFor(row.userId).catch(() => null);
	const members = await db
		.select()
		.from(schema.sharedBrowserMembers)
		.where(eq(schema.sharedBrowserMembers.browserId, row.id));
	const out: SharedBrowser["members"] = [];
	for (const m of members.sort((a, b) => a.createdAt - b.createdAt)) {
		const agent = await getAgentRow(m.agentId);
		if (!agent) continue;
		const sharedBy =
			agent.userId === row.userId
				? null
				: ((await db.query.users.findFirst({ where: eq(schema.users.id, agent.userId) }))?.name ?? "someone");
		out.push({
			agentId: agent.id,
			agentName: agent.name,
			sharedBy,
			available: owner
				? await mayUseShared({ ownerId: row.userId, shareWithViewers: false }, agent, owner)
				: false,
		});
	}
	const machine = row.machineId
		? await db.query.machines.findFirst({ where: eq(schema.machines.id, row.machineId) })
		: null;
	return {
		id: row.id,
		name: row.name,
		machineId: row.machineId,
		machineName: machine?.name ?? null,
		signIns: row.signIns,
		shareWithViewers: row.shareWithViewers,
		members: out,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

async function requireOwn(id: string): Promise<Row> {
	const [row] = await db
		.select()
		.from(schema.sharedBrowsers)
		.where(and(eq(schema.sharedBrowsers.id, id), ownWhere(schema.sharedBrowsers.userId)));
	if (!row) throw notFound("Shared browser");
	return row;
}

/** Your shared browsers (with agentId: the ones that bot is in). */
export async function listSharedBrowsers(agentId?: string): Promise<SharedBrowser[]> {
	let rows = await db.select().from(schema.sharedBrowsers).where(ownWhere(schema.sharedBrowsers.userId));
	if (agentId) {
		const ids = new Set(
			(
				await db
					.select({ id: schema.sharedBrowserMembers.browserId })
					.from(schema.sharedBrowserMembers)
					.where(eq(schema.sharedBrowserMembers.agentId, agentId))
			).map((r) => r.id),
		);
		rows = rows.filter((r) => ids.has(r.id));
	}
	return Promise.all(rows.sort((a, b) => a.createdAt - b.createdAt).map(present));
}

/** A computer of yours that can run a shared browser (Chrome on its screen). */
async function checkMachine(machineId: string): Promise<Machine> {
	const m = await requireMachine(machineId);
	if (m.kind !== "computer" || m.provider === "local") {
		throw badRequest("A shared browser runs on the server or on one of your bots' computers");
	}
	return m;
}

/** Your bots and bots shared with you. */
async function checkAgents(agentIds: string[]): Promise<string[]> {
	const actor = currentActor();
	const ids = [...new Set(agentIds)];
	for (const id of ids) {
		const agent = await getAgent(id);
		if (
			!agent ||
			!(await mayUseShared({ ownerId: actor?.userId ?? agent.userId, shareWithViewers: false }, agent))
		) {
			throw notFound("Agent");
		}
	}
	return ids;
}

async function checkName(name: string, userId: string, except?: string): Promise<string> {
	const clean = name.trim();
	if (RESERVED.has(clean.toLowerCase()))
		throw badRequest(`Pick another name: bots already use "${clean}" for something else`);
	const others = await db.select().from(schema.sharedBrowsers).where(eq(schema.sharedBrowsers.userId, userId));
	if (others.some((o) => o.id !== except && o.name.trim().toLowerCase() === clean.toLowerCase())) {
		throw badRequest(`You already have a shared browser called "${clean}"`);
	}
	return clean;
}

/** Ports are handed out one at a time, so two Chromes on one computer never get the same one. */
let assigning: Promise<unknown> = Promise.resolve();

/** The first free port from 9300, given the ones taken. */
export function nextSharedPort(taken: Iterable<number>): number | null {
	const used = new Set(taken);
	for (let p = FIRST_SHARED_PORT; p <= LAST_SHARED_PORT; p++) if (!used.has(p)) return p;
	return null;
}

/**
 * Gives a shared browser on a computer its debugging ports: one for its Chrome (shared sign-ins), or one per bot
 * (separate sign-ins). On the server there are none.
 */
function assignPorts(id: string): Promise<void> {
	const run = assigning.then(async () => {
		const [b] = await db.select().from(schema.sharedBrowsers).where(eq(schema.sharedBrowsers.id, id));
		if (!b) return;
		const members = await db
			.select()
			.from(schema.sharedBrowserMembers)
			.where(eq(schema.sharedBrowserMembers.browserId, id));
		if (!b.machineId) {
			await db.update(schema.sharedBrowsers).set({ port: null }).where(eq(schema.sharedBrowsers.id, id));
			await db
				.update(schema.sharedBrowserMembers)
				.set({ port: null })
				.where(eq(schema.sharedBrowserMembers.browserId, id));
			return;
		}
		const neighbours = (
			await db.select().from(schema.sharedBrowsers).where(eq(schema.sharedBrowsers.machineId, b.machineId))
		).filter((x) => x.id !== id);
		const taken = neighbours.flatMap((x) => (x.port ? [x.port] : []));
		if (neighbours.length) {
			const theirs = await db
				.select({ port: schema.sharedBrowserMembers.port })
				.from(schema.sharedBrowserMembers)
				.where(
					inArray(
						schema.sharedBrowserMembers.browserId,
						neighbours.map((x) => x.id),
					),
				);
			taken.push(...theirs.flatMap((x) => (x.port ? [x.port] : [])));
		}
		const take = () => {
			const p = nextSharedPort(taken);
			if (p === null) throw badRequest("That computer runs as many shared browsers as it can");
			taken.push(p);
			return p;
		};
		if (b.signIns === "shared") {
			const port = b.port && !taken.includes(b.port) ? b.port : take();
			await db.update(schema.sharedBrowsers).set({ port }).where(eq(schema.sharedBrowsers.id, id));
			await db
				.update(schema.sharedBrowserMembers)
				.set({ port: null })
				.where(eq(schema.sharedBrowserMembers.browserId, id));
		} else {
			await db.update(schema.sharedBrowsers).set({ port: null }).where(eq(schema.sharedBrowsers.id, id));
			for (const m of members) {
				const port = m.port && !taken.includes(m.port) ? m.port : take();
				if (port !== m.port) {
					await db
						.update(schema.sharedBrowserMembers)
						.set({ port })
						.where(
							and(
								eq(schema.sharedBrowserMembers.browserId, id),
								eq(schema.sharedBrowserMembers.agentId, m.agentId),
							),
						);
				} else taken.push(port);
			}
		}
	});
	assigning = run.catch(() => {});
	return run;
}

async function setMembers(id: string, agentIds: string[]): Promise<string[]> {
	const before = (
		await db.select().from(schema.sharedBrowserMembers).where(eq(schema.sharedBrowserMembers.browserId, id))
	).map((m) => m.agentId);
	const gone = before.filter((a) => !agentIds.includes(a));
	if (gone.length) {
		await db
			.delete(schema.sharedBrowserMembers)
			.where(
				and(eq(schema.sharedBrowserMembers.browserId, id), inArray(schema.sharedBrowserMembers.agentId, gone)),
			);
	}
	const added = agentIds.filter((a) => !before.includes(a));
	if (added.length) {
		const now = Date.now();
		await db
			.insert(schema.sharedBrowserMembers)
			.values(added.map((agentId) => ({ browserId: id, agentId, port: null, createdAt: now })))
			.onConflictDoNothing();
	}
	return gone;
}

export async function createSharedBrowser(input: unknown): Promise<SharedBrowser> {
	const data = parse(SharedBrowserInput, input);
	requirePermission("browser");
	const userId = newOwner();
	if (data.machineId) await checkMachine(data.machineId);
	const agentIds = await checkAgents(data.agentIds);
	const now = Date.now();
	const row: Row = {
		id: newId("sbr"),
		userId,
		name: await checkName(data.name, userId),
		machineId: data.machineId,
		signIns: data.signIns,
		shareWithViewers: data.shareWithViewers,
		port: null,
		createdAt: now,
		updatedAt: now,
	};
	await db.insert(schema.sharedBrowsers).values(row);
	await setMembers(row.id, agentIds);
	await assignPorts(row.id);
	changed(userId);
	return present(await requireOwn(row.id));
}

export async function updateSharedBrowser(id: string, input: unknown): Promise<SharedBrowser> {
	const data = parse(SharedBrowserUpdate, input);
	const row = await requireOwn(id);
	const fields: Partial<Row> = {};
	if (data.name !== undefined) fields.name = await checkName(data.name, row.userId, id);
	if (data.machineId !== undefined && data.machineId !== row.machineId) {
		if (data.machineId) await checkMachine(data.machineId);
		fields.machineId = data.machineId;
	}
	if (data.signIns !== undefined) fields.signIns = data.signIns as SignInMode;
	if (data.shareWithViewers !== undefined) fields.shareWithViewers = data.shareWithViewers;
	await db
		.update(schema.sharedBrowsers)
		.set({ ...fields, updatedAt: Date.now() })
		.where(eq(schema.sharedBrowsers.id, id));
	const gone = data.agentIds ? await setMembers(id, await checkAgents(data.agentIds)) : [];
	await assignPorts(id);
	// Where it runs or how sign-ins work changed: everyone reconnects (its Chromes on a computer stop, their
	// ports may be someone else's now). A bot taken off it leaves now.
	const { closeSharedBrowser } = await import("./engine.ts");
	if (fields.machineId !== undefined || (fields.signIns !== undefined && fields.signIns !== row.signIns)) {
		await closeSharedBrowser(id);
		if (row.machineId) await stopOnComputer(row.machineId, id, false);
	} else {
		for (const agentId of gone) {
			await closeSharedBrowser(id, agentId);
			if (row.machineId && row.signIns === "separate") await stopOnComputer(row.machineId, id, false, agentId);
		}
	}
	changed(row.userId);
	return present(await requireOwn(id));
}

/**
 * Stops a shared browser's Chromes on a computer (their ports may go to another browser), and with `wipe` deletes
 * their profiles. ([-] keeps pkill from matching the shell that runs it.)
 */
async function stopOnComputer(machineId: string, id: string, wipe: boolean, agentId?: string): Promise<void> {
	const m = await db.query.machines.findFirst({ where: eq(schema.machines.id, machineId) });
	if (m?.status !== "running" || !/^[\w-]+$/.test(id) || (agentId && !/^[\w-]+$/.test(agentId))) return;
	const dir = `$HOME/.config/sekai-shared/${id}${agentId ? `/${agentId}` : ""}`;
	await sshText(
		await sshTarget(toMachine(m)),
		`pkill -f "[-]-user-data-dir=${dir}" || true${wipe ? `; sleep 1; rm -rf "${dir}"` : ""}`,
		{ timeoutMs: 30_000 },
	).catch((err: unknown) => log.warn(`shared browser ${id} on ${m.name}: ${errorMessage(err)}`));
}

/** Deletes a shared browser and its sign-ins (its profiles on the server, or on the computer it ran on). */
export async function deleteSharedBrowser(id: string): Promise<void> {
	const row = await requireOwn(id);
	const { closeSharedBrowser } = await import("./engine.ts");
	await closeSharedBrowser(id);
	await db.delete(schema.sharedBrowsers).where(eq(schema.sharedBrowsers.id, id));
	await rm(join(config.dataDir, "browser", "shared", id), { recursive: true, force: true }).catch(() => {});
	if (row.machineId) await stopOnComputer(row.machineId, id, true);
	changed(row.userId);
}

/** A shared browser as one bot uses it in a run. */
export interface UsableBrowser {
	id: string;
	name: string;
	ownerId: string;
	signIns: SignInMode;
	/** The computer it runs on (null: the server). */
	machine: Machine | null;
	/** Its Chrome's debugging port on the computer (this bot's own Chrome with separate sign-ins). */
	port: number | null;
	/** The other bots in it. */
	others: string[];
}

/** The shared browsers a bot may use in this run (see mayUseShared). */
export async function browsersForBot(agentId: string, actor: Actor | null = currentActor()): Promise<UsableBrowser[]> {
	const agent = await getAgentRow(agentId);
	if (!agent) return [];
	const rows = await db
		.select({ b: schema.sharedBrowsers, port: schema.sharedBrowserMembers.port })
		.from(schema.sharedBrowserMembers)
		.innerJoin(schema.sharedBrowsers, eq(schema.sharedBrowsers.id, schema.sharedBrowserMembers.browserId))
		.where(eq(schema.sharedBrowserMembers.agentId, agentId));
	const out: UsableBrowser[] = [];
	for (const { b, port } of rows.sort((x, y) => x.b.createdAt - y.b.createdAt)) {
		if (!(await mayUseShared({ ownerId: b.userId, shareWithViewers: b.shareWithViewers }, agent, actor))) continue;
		const machineRow = b.machineId
			? await db.query.machines.findFirst({ where: eq(schema.machines.id, b.machineId) })
			: null;
		const others = await db
			.select({ name: schema.agents.name })
			.from(schema.sharedBrowserMembers)
			.innerJoin(schema.agents, eq(schema.agents.id, schema.sharedBrowserMembers.agentId))
			.where(eq(schema.sharedBrowserMembers.browserId, b.id));
		out.push({
			id: b.id,
			name: b.name,
			ownerId: b.userId,
			signIns: b.signIns,
			machine: machineRow ? toMachine(machineRow) : null,
			port: b.signIns === "shared" ? b.port : port,
			others: others.map((o) => o.name).filter((n) => n !== agent.name),
		});
	}
	return out;
}

/** Before a bot is deleted: the owners of the shared browsers it's in hear about it (the rows go with the bot). */
export async function leaveSharedBrowsers(agentId: string): Promise<void> {
	const rows = await db
		.select({ id: schema.sharedBrowsers.id, userId: schema.sharedBrowsers.userId })
		.from(schema.sharedBrowserMembers)
		.innerJoin(schema.sharedBrowsers, eq(schema.sharedBrowsers.id, schema.sharedBrowserMembers.browserId))
		.where(eq(schema.sharedBrowserMembers.agentId, agentId));
	await db.delete(schema.sharedBrowserMembers).where(eq(schema.sharedBrowserMembers.agentId, agentId));
	for (const userId of new Set(rows.map((r) => r.userId))) changed(userId);
}
