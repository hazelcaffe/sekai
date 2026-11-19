import { type Machine, type MachineMember, type MachineSeat, MemberAdd, type MemberStatus } from "@sekai/shared";
import { and, eq } from "drizzle-orm";
import { type Actor, actorFor, currentActor, requirePermission } from "../auth/actor.ts";
import { db, schema } from "../db/index.ts";
import { bus } from "../events/bus.ts";
import { agentOwner } from "../events/scope.ts";
import { badRequest, errorMessage, notFound, parse } from "../lib/errors.ts";
import { newId } from "../lib/ids.ts";
import { log } from "../lib/log.ts";
import { randomPassword, sealJson, unsealJson } from "../lib/secrets.ts";
import { getAgent, getAgentRow } from "../services/agents.ts";
import { mayUseShared } from "../services/visibility.ts";
import { generate, linuxUsername } from "./keys.ts";
import {
	desktopOf,
	forgetSeatKey,
	type MemberSecrets,
	memberRow,
	requireMachine,
	seatKeypair,
	seatPorts,
	setTakeover,
	setupFailure,
	sshTarget,
	toMachine,
} from "./manager.ts";
import { memberDir, memberRemoveScript, memberSetupScript, nextDisplay, uniqueUsername } from "./setup.ts";
import { shq, sshText } from "./ssh.ts";

/**
 * Bots sharing another bot's computer or devbox. Each member gets a seat: its own account with its own key and
 * passwordless sudo, and on a computer its own screen (display :N from :10, VNC on 5900+N, Chrome on 9222+N).
 * Seats are set up and removed over SSH as root (sudo from the machine's own account), detached and followed
 * like a container's setup. Machine-wide things (power, size, checkpoints, deleting it) stay with its owner.
 */

type MemberRow = typeof schema.machineMembers.$inferSelect;

const SETUP_TIMEOUT_MS = 30 * 60_000;

/** A machine as a bot uses it: its own, or another bot's shared with it (then `seat` says where it sits). */
export interface BotMachine extends Machine {
	/** null: the bot's own machine. */
	seat: { ownerBot: string; display: number | null; cdpPort: number } | null;
}

/** Another bot's machine as seen by a member: its account, screen and the seat's state in place of the machine's. */
export function seatView(m: Machine, s: MemberRow, ownerBot: string): BotMachine {
	const running = m.status === "running";
	const status: Machine["status"] = !running
		? m.status
		: s.status === "ready"
			? "running"
			: s.status === "error"
				? "error"
				: s.status === "removing"
					? "deleting"
					: "provisioning";
	return {
		...m,
		username: s.username,
		ports: { ...m.ports, vnc: s.vncPort },
		status,
		statusDetail: running && s.status !== "ready" ? s.statusDetail : m.statusDetail,
		seat: { ownerBot, display: s.display, cdpPort: s.cdpPort ?? 9222 },
	};
}

/**
 * The machines a bot may use in this run (see mayUseShared): its own machines first, then seats on other bots'
 * machines. Your own computer lent through the desktop app is only ever for your own runs.
 */
export async function machinesForBot(agentId: string, actor: Actor | null = currentActor()): Promise<BotMachine[]> {
	const agent = await getAgentRow(agentId);
	if (!agent) return [];
	const out: BotMachine[] = [];
	const own = await db.select().from(schema.machines).where(eq(schema.machines.agentId, agentId));
	for (const row of own.sort((a, b) => a.createdAt - b.createdAt)) {
		const ok =
			row.kind === "device"
				? (actor?.userId ?? agent.userId) === agent.userId
				: await mayUseShared({ ownerId: agent.userId, shareWithViewers: row.shareWithViewers }, agent, actor);
		if (ok) out.push({ ...toMachine(row), seat: null });
	}
	const seats = await db
		.select({
			s: schema.machineMembers,
			m: schema.machines,
			owner: schema.agents.userId,
			ownerBot: schema.agents.name,
		})
		.from(schema.machineMembers)
		.innerJoin(schema.machines, eq(schema.machines.id, schema.machineMembers.machineId))
		.innerJoin(schema.agents, eq(schema.agents.id, schema.machines.agentId))
		.where(eq(schema.machineMembers.agentId, agentId));
	for (const r of seats.sort((a, b) => a.s.createdAt - b.s.createdAt)) {
		if (!(await mayUseShared({ ownerId: r.owner, shareWithViewers: r.m.shareWithViewers }, agent, actor))) continue;
		out.push(seatView(toMachine(r.m), r.s, r.ownerBot));
	}
	return out;
}

// ---------------------------------------------------------------- the owner's view

/** Members as the machine's owner sees them: whose bot, and whether it's still theirs to use. */
async function present(rows: MemberRow[], ownerId: string): Promise<MachineMember[]> {
	const owner = await actorFor(ownerId).catch(() => null);
	const out: MachineMember[] = [];
	for (const r of rows) {
		const agent = await getAgentRow(r.agentId);
		if (!agent) continue;
		const sharedBy =
			agent.userId === ownerId
				? null
				: ((await db.query.users.findFirst({ where: eq(schema.users.id, agent.userId) }))?.name ?? "someone");
		const { secrets: _secrets, ...rest } = r;
		out.push({
			...rest,
			agentName: agent.name,
			sharedBy,
			available: owner ? await mayUseShared({ ownerId, shareWithViewers: false }, agent, owner) : false,
		});
	}
	return out.sort((a, b) => a.createdAt - b.createdAt);
}

async function ownerOf(m: Machine): Promise<string> {
	const id = await agentOwner(m.agentId);
	if (!id) throw notFound("Machine");
	return id;
}

const changed = (machineId: string) => bus.emit({ type: "machine.members", machineId });

async function patchMember(id: string, fields: Partial<MemberRow>): Promise<MemberRow | null> {
	await db
		.update(schema.machineMembers)
		.set({ ...fields, updatedAt: Date.now() })
		.where(eq(schema.machineMembers.id, id));
	const row = await db.query.machineMembers.findFirst({ where: eq(schema.machineMembers.id, id) });
	if (row) changed(row.machineId);
	return row ?? null;
}

/** The other bots on one of your machines. */
export async function listMembers(machineId: string): Promise<MachineMember[]> {
	const m = await requireMachine(machineId);
	const rows = await db.select().from(schema.machineMembers).where(eq(schema.machineMembers.machineId, m.id));
	return present(rows, await ownerOf(m));
}

/** Your machines this bot has a seat on, with the seat (for its Computer tab). */
export async function listSeats(agentId: string): Promise<MachineSeat[]> {
	const me = currentActor()?.userId;
	const rows = await db
		.select({
			s: schema.machineMembers,
			m: schema.machines,
			owner: schema.agents.userId,
			ownerBot: schema.agents.name,
		})
		.from(schema.machineMembers)
		.innerJoin(schema.machines, eq(schema.machines.id, schema.machineMembers.machineId))
		.innerJoin(schema.agents, eq(schema.agents.id, schema.machines.agentId))
		.where(and(eq(schema.machineMembers.agentId, agentId), me ? eq(schema.agents.userId, me) : undefined));
	const out: MachineSeat[] = [];
	for (const r of rows) {
		const [member] = await present([r.s], r.owner);
		if (member) out.push({ machine: toMachine(r.m), member, ownerBot: r.ownerBot });
	}
	return out;
}

/** The member's own seat on one of your machines (for its screen, passwords and takeover). */
export async function requireSeat(machineId: string, agentId: string): Promise<{ m: Machine; row: MemberRow }> {
	const m = await requireMachine(machineId);
	const row = await memberRow(m.id, agentId);
	if (!row) throw notFound("Seat");
	return { m, row };
}

/** One seat chosen at a time per machine, so two bots never get the same name or screen. */
const choosing = new Map<string, Promise<unknown>>();
function oneAtATime<T>(machineId: string, fn: () => Promise<T>): Promise<T> {
	const run = (choosing.get(machineId) ?? Promise.resolve()).catch(() => {}).then(fn);
	choosing.set(
		machineId,
		run.catch(() => {}),
	);
	return run;
}

/** Account names and screens the machine already uses (accounts made outside Sekai, RDP sessions…). */
async function inUse(m: Machine): Promise<{ users: string[]; displays: number[] }> {
	const out = await sshText(
		await sshTarget(m),
		"getent passwd | cut -d: -f1; echo ---; ls /tmp/.X11-unix 2>/dev/null || true",
		{ timeoutMs: 30_000 },
	);
	const [users = "", sockets = ""] = out.split("---\n");
	return {
		users: users
			.split("\n")
			.map((x) => x.trim())
			.filter(Boolean),
		displays: sockets
			.split("\n")
			.map((x) => /^X(\d+)$/.exec(x.trim())?.[1])
			.filter((x): x is string => Boolean(x))
			.map(Number),
	};
}

/**
 * A new seat's passwords (VNC's with a screen), and for a bot someone else owns a key of the seat's own: that bot's
 * usual key is one its owner can download, and it mustn't open your machine.
 */
export async function seatSecrets(username: string, screen: boolean, othersBot: boolean): Promise<MemberSecrets> {
	return {
		userPassword: randomPassword(20),
		vncPassword: screen ? randomPassword(8) : null,
		...(othersBot ? { key: await generate(`sekai-seat-${username}`) } : {}),
	};
}

/** Adds one of your bots, or a bot shared with you, to one of your computers or devboxes. */
export async function addMember(machineId: string, input: unknown): Promise<MachineMember> {
	const { agentId } = parse(MemberAdd, input);
	requirePermission("computers");
	const m = await requireMachine(machineId);
	if (m.kind !== "computer" && m.kind !== "devbox") throw badRequest("Only computers and devboxes can be shared");
	if (m.provider === "local") throw badRequest("Your own computer is lent from the desktop app");
	if (agentId === m.agentId) throw badRequest("That's this machine's own bot");
	if (m.status !== "running") throw badRequest(`Turn ${m.name} on first: its new account is made on it`);
	const ownerId = await ownerOf(m);
	const agent = await getAgent(agentId);
	const owner = await actorFor(ownerId);
	if (!agent || !(await mayUseShared({ ownerId, shareWithViewers: false }, agent, owner))) throw notFound("Agent");
	const row = await oneAtATime(m.id, async () => {
		const existing = await memberRow(m.id, agentId);
		if (existing) return existing;
		const others = await db.select().from(schema.machineMembers).where(eq(schema.machineMembers.machineId, m.id));
		const there = await inUse(m).catch((err: unknown) => {
			throw badRequest(`Can't reach ${m.name}: ${errorMessage(err)}`);
		});
		const username = uniqueUsername(linuxUsername(agent.name), [
			m.username,
			...others.map((o) => o.username),
			...there.users,
		]);
		let display: number | null = null;
		if (m.kind === "computer") {
			display = nextDisplay([
				...others.flatMap((o) => (o.display === null ? [] : [o.display])),
				...there.displays,
			]);
			if (display === null) throw badRequest(`${m.name} has as many screens as it can take`);
		}
		const ports = display === null ? null : seatPorts(display);
		const now = Date.now();
		const fresh: MemberRow = {
			id: newId("mbr"),
			machineId: m.id,
			agentId,
			username,
			display,
			vncPort: ports?.vncPort ?? null,
			cdpPort: ports?.cdpPort ?? null,
			status: "adding",
			statusDetail: "Getting ready",
			secrets: sealJson(await seatSecrets(username, display !== null, agent.userId !== ownerId)),
			createdAt: now,
			updatedAt: now,
		};
		await db.insert(schema.machineMembers).values(fresh);
		return fresh;
	});
	changed(m.id);
	if (row.status === "adding") void setupMember(row.id);
	const [out] = await present([row], ownerId);
	if (!out) throw notFound("Agent");
	return out;
}

/** Sets a seat that had a problem up again (the setup is safe to run twice). */
export async function retryMember(machineId: string, memberId: string): Promise<MachineMember> {
	const m = await requireMachine(machineId);
	const row = await db.query.machineMembers.findFirst({
		where: and(eq(schema.machineMembers.id, memberId), eq(schema.machineMembers.machineId, m.id)),
	});
	if (!row) throw notFound("Seat");
	if (m.status !== "running") throw badRequest(`Turn ${m.name} on first`);
	if (row.status === "error" || row.status === "ready") {
		await patchMember(row.id, { status: "adding", statusDetail: "Trying again" });
		void setupMember(row.id);
	}
	const fresh = await db.query.machineMembers.findFirst({ where: eq(schema.machineMembers.id, row.id) });
	const [out] = await present([fresh ?? row], await ownerOf(m));
	if (!out) throw notFound("Seat");
	return out;
}

/** Runs a root command on the machine through its own account's passwordless sudo. */
async function asRoot(m: Machine, command: string, opts: { input?: string; timeoutMs?: number } = {}) {
	try {
		return await sshText(await sshTarget(m), `sudo -n ${command}`, { timeoutMs: 60_000, ...opts });
	} catch (err) {
		const msg = errorMessage(err);
		if (/password is required|sudo: a terminal|not in the sudoers|sudo: command not found/i.test(msg)) {
			throw new Error(
				`Sekai needs passwordless sudo as ${m.username} on ${m.name} to manage other bots' accounts`,
			);
		}
		throw err;
	}
}

/** How a seat's setup is going: its progress line, and the end of its log if it stopped. */
function stateCommand(u: string): string {
	const d = memberDir(u);
	return shq(
		[
			`printf '%s\\n' "$(cat ${d}/progress 2>/dev/null)"`,
			`if [ -f ${d}/ready ]; then echo ready`,
			`elif [ -f ${d}/failed ]; then echo failed; tail -n 12 ${d}/log`,
			`elif systemctl is-active --quiet sekai-member-${u}; then echo running`,
			`else echo stopped; tail -n 12 ${d}/log 2>/dev/null; fi`,
		].join("\n"),
	);
}

const memberById = async (id: string) =>
	(await db.query.machineMembers.findFirst({ where: eq(schema.machineMembers.id, id) })) ?? null;

async function machineById(id: string): Promise<Machine | null> {
	const row = await db.query.machines.findFirst({ where: eq(schema.machines.id, id) });
	return row ? toMachine(row) : null;
}

/** Sets a seat up (or finishes one a restart interrupted): the script runs detached on the machine as root. */
async function setupMember(id: string): Promise<void> {
	try {
		const first = await memberById(id);
		if (!first) return;
		const m = await machineById(first.machineId);
		if (!m) return;
		const agent = await getAgentRow(first.agentId);
		if (!agent) throw new Error("The bot was deleted");
		const u = first.username;
		const dir = memberDir(u);
		const running = (await asRoot(m, `systemctl is-active sekai-member-${u}`).catch(() => "")).trim() === "active";
		if (!running) {
			const secrets = unsealJson<MemberSecrets>(first.secrets);
			const keys = await seatKeypair(first);
			const script = memberSetupScript({
				username: u,
				displayName: agent.name,
				password: secrets.userPassword,
				publicKey: keys.publicKey,
				desktop:
					m.kind === "computer" && first.display !== null && secrets.vncPassword
						? { display: first.display, vncPassword: secrets.vncPassword }
						: null,
			});
			await patchMember(id, { statusDetail: "Setting up its account" });
			await asRoot(
				m,
				`sh -c ${shq(`install -d -m 700 ${dir} && rm -f ${dir}/ready ${dir}/failed ${dir}/progress && umask 077 && cat > ${dir}/setup.sh`)}`,
				{ input: script },
			);
			await asRoot(m, `systemd-run --unit=sekai-member-${u} --collect --quiet /bin/bash ${dir}/setup.sh`);
		}
		const deadline = Date.now() + SETUP_TIMEOUT_MS;
		for (;;) {
			if (Date.now() > deadline) throw new Error("Setting up its account took too long");
			await Bun.sleep(4000);
			const row = await memberById(id);
			if (row?.status !== "adding") return;
			const out = await asRoot(m, `sh -c ${stateCommand(u)}`, { timeoutMs: 30_000 }).catch(() => null);
			if (out === null) continue;
			const [progress = "", state = "", ...rest] = out.split("\n");
			if (state === "ready") break;
			if (state === "failed" || state === "stopped") throw new Error(setupFailure(rest.join("\n")));
			if (progress.trim() && progress.trim() !== row.statusDetail)
				await patchMember(id, { statusDetail: progress.trim() });
		}
		if (m.kind === "computer") {
			await patchMember(id, { statusDetail: "Checking its screen" });
			let last: unknown = null;
			let seen = false;
			for (let i = 0; i < 12 && !seen; i++) {
				try {
					const d = await desktopOf(m, agent.id);
					await d.info();
					await d.screenshot();
					seen = true;
				} catch (err) {
					last = err;
					await Bun.sleep(5000);
				}
			}
			if (!seen) throw new Error(`Its screen doesn't answer: ${errorMessage(last)}`);
		}
		const row = await memberById(id);
		if (row?.status === "adding") await patchMember(id, { status: "ready", statusDetail: null });
		log.info(`${agent.name} has a seat on ${m.name} (${u})`);
	} catch (err) {
		log.warn(`seat ${id}: ${errorMessage(err)}`);
		const row = await memberById(id);
		if (row?.status === "adding") await patchMember(id, { status: "error", statusDetail: errorMessage(err) });
	}
}

/** Takes the seat's account, screen and files off the machine. */
async function cleanUp(m: Machine, row: Pick<MemberRow, "username" | "display">): Promise<void> {
	if (row.username === m.username || row.username === "root") throw new Error("That's not a member's account");
	if (m.status !== "running") throw new Error(`${m.name} is off: turn it on to remove the account`);
	await asRoot(m, "bash -s", { input: memberRemoveScript(row.username, row.display), timeoutMs: 90_000 });
}

/** The bot's sessions on the seat stop (its browser there, a takeover of its screen). */
async function leaveSeat(m: Machine, agentId: string): Promise<void> {
	setTakeover(m.id, agentId, false);
	const { closeSessionsOn } = await import("../browser/engine.ts");
	await closeSessionsOn(m.id, agentId);
}

/** Removes a bot from one of your machines: its account, home, screen and files there go. */
export async function removeMember(machineId: string, memberId: string): Promise<void> {
	const m = await requireMachine(machineId);
	const row = await db.query.machineMembers.findFirst({
		where: and(eq(schema.machineMembers.id, memberId), eq(schema.machineMembers.machineId, m.id)),
	});
	if (!row) throw notFound("Seat");
	const before: MemberStatus = row.status === "removing" ? "error" : row.status;
	await patchMember(row.id, { status: "removing", statusDetail: "Removing its account" });
	await leaveSeat(m, row.agentId);
	try {
		await asRoot(m, `systemctl stop sekai-member-${row.username}`).catch(() => {});
		await cleanUp(m, row);
	} catch (err) {
		await patchMember(row.id, { status: before, statusDetail: `Couldn't remove it: ${errorMessage(err)}` });
		throw badRequest(`Couldn't remove its account from ${m.name}: ${errorMessage(err)}`);
	}
	await db.delete(schema.machineMembers).where(eq(schema.machineMembers.id, row.id));
	forgetSeatKey(row.id);
	changed(m.id);
}

/**
 * Before a bot is deleted: its seats on other bots' machines are cleaned up while those exist (a machine that's
 * off or gone keeps a stray account, never blocking the delete); the rows go with the bot.
 */
export async function removeAgentSeats(agentId: string): Promise<void> {
	const rows = await db.select().from(schema.machineMembers).where(eq(schema.machineMembers.agentId, agentId));
	for (const row of rows) {
		const m = await machineById(row.machineId);
		if (!m) continue;
		await leaveSeat(m, agentId).catch(() => {});
		await cleanUp(m, row).catch((err: unknown) =>
			log.warn(`couldn't remove ${row.username} from ${m.name}: ${errorMessage(err)}`),
		);
		await db.delete(schema.machineMembers).where(eq(schema.machineMembers.id, row.id));
		forgetSeatKey(row.id);
		changed(m.id);
	}
}

/**
 * A machine you added over SSH stays when Sekai forgets it: its members' accounts (and their keys) come off
 * first. Proxmox machines are deleted whole, accounts and all.
 */
export async function removeAllMembers(m: Machine): Promise<void> {
	const rows = await db.select().from(schema.machineMembers).where(eq(schema.machineMembers.machineId, m.id));
	for (const row of rows) {
		await leaveSeat(m, row.agentId).catch(() => {});
		if (m.provider === "ssh") {
			await cleanUp(m, row).catch((err: unknown) =>
				log.warn(`couldn't remove ${row.username} from ${m.name}: ${errorMessage(err)}`),
			);
		}
		forgetSeatKey(row.id);
	}
}

/** After a restart: seats being set up carry on, removals are tried again. */
export async function initMembers(): Promise<void> {
	for (const row of await db.select().from(schema.machineMembers)) {
		if (row.status === "adding") void setupMember(row.id);
		if (row.status === "removing") {
			void (async () => {
				const m = await machineById(row.machineId);
				if (!m) return;
				try {
					await cleanUp(m, row);
					await db.delete(schema.machineMembers).where(eq(schema.machineMembers.id, row.id));
					forgetSeatKey(row.id);
					changed(m.id);
				} catch (err) {
					await patchMember(row.id, {
						status: "error",
						statusDetail: `Couldn't remove it: ${errorMessage(err)}`,
					});
				}
			})();
		}
	}
}
