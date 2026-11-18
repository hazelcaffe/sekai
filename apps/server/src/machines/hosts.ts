import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	type AccessGrant,
	AccountName,
	type Host,
	type HostAccountResult,
	HostCreate,
	type HostStatus,
	HostUpdate,
	type HostWithStatus,
	type Machine,
	type MasterKey,
	type TailnetDevice,
} from "@sekai/shared";
import { and, eq, isNull } from "drizzle-orm";
import { config } from "../config.ts";
import { db, schema } from "../db/index.ts";
import { bus } from "../events/bus.ts";
import { badRequest, errorMessage, HttpError, notFound, parse } from "../lib/errors.ts";
import { newId } from "../lib/ids.ts";
import { log } from "../lib/log.ts";
import { seal, unseal } from "../lib/secrets.ts";
import { getAgent } from "../services/agents.ts";
import { readKey, writeKey } from "../services/kv.ts";
import { agentKeyFile, agentKeypair, generate } from "./keys.ts";
import { getMachine, sshTarget } from "./manager.ts";
import { type ExecResult, type SshTarget, scpTo, shq, sshExec } from "./ssh.ts";

/**
 * Your servers and devices, and who may use them. Sekai holds one master key, which you install on each device.
 * When a bot is allowed on, Sekai logs in with the master key and adds that bot's own key to authorized_keys;
 * the bot then works with its own key, and revoking removes it again. Another bot's machine works the same way,
 * with the owner's key in place of the master key.
 */

const MASTER_KEY = "ssh.master";
/** By host and account: "hostId:account". */
const statuses = new Map<string, HostStatus>();
const statusKey = (hostId: string, account: string) => `${hostId}:${account}`;

/** Every account bots can be let into on a host: its own first. */
export const accountsOf = (h: Pick<Host, "user" | "accounts">): string[] => [
	h.user,
	...h.accounts.filter((a) => a !== h.user),
];

/** A grant's account, by name (null in the database means the host's own account). */
const grantAccount = (h: Pick<Host, "user">, g: { account: string | null }) => g.account ?? h.user;

// ---------------------------------------------------------------- master key

interface StoredMaster {
	publicKey: string;
	privateKey: string;
	createdAt: number;
}

function fingerprint(publicKey: string): string {
	const blob = publicKey.split(/\s+/)[1] ?? "";
	return `SHA256:${createHash("sha256").update(Buffer.from(blob, "base64")).digest("base64").replace(/=+$/, "")}`;
}

async function master(create = true): Promise<StoredMaster | null> {
	const raw = (await readKey(MASTER_KEY)) as StoredMaster | undefined;
	if (raw) return { ...raw, privateKey: unseal(raw.privateKey) };
	if (!create) return null;
	const pair = await generate("sekai-master");
	const m = { ...pair, createdAt: Date.now() };
	await writeKey(MASTER_KEY, { ...m, privateKey: seal(m.privateKey) });
	log.info("made Sekai's master SSH key");
	return m;
}

export async function masterKey(): Promise<MasterKey> {
	const m = await master();
	if (!m) throw new Error("No master key");
	return { publicKey: m.publicKey, fingerprint: fingerprint(m.publicKey), createdAt: m.createdAt };
}

/** A fresh master key (the old one stops working everywhere it was installed). */
export async function rotateMasterKey(): Promise<MasterKey> {
	const pair = await generate("sekai-master");
	await writeKey(MASTER_KEY, { ...pair, privateKey: seal(pair.privateKey), createdAt: Date.now() });
	return masterKey();
}

async function masterFile(): Promise<string> {
	const m = await master();
	if (!m) throw new Error("No master key");
	const dir = join(config.dataDir, "ssh", "keys");
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	const file = join(dir, "master");
	writeFileSync(file, m.privateKey.endsWith("\n") ? m.privateKey : `${m.privateKey}\n`, { mode: 0o600 });
	return file;
}

// ---------------------------------------------------------------- hosts

const toHost = (r: typeof schema.hosts.$inferSelect): Host => r;

async function grantsFor(where: { hostId?: string; machineId?: string }): Promise<AccessGrant[]> {
	const rows = await db
		.select()
		.from(schema.accessGrants)
		.where(
			where.hostId
				? eq(schema.accessGrants.hostId, where.hostId)
				: eq(schema.accessGrants.machineId, where.machineId ?? ""),
		);
	return rows;
}

const EMPTY: HostStatus = { ok: null, error: null, checkedAt: null, about: null };

function withStatus(h: Host, grants: AccessGrant[]): HostWithStatus {
	return {
		...h,
		status: statuses.get(statusKey(h.id, h.user)) ?? EMPTY,
		accountStatus: Object.fromEntries(
			accountsOf(h)
				.slice(1)
				.map((a) => [a, statuses.get(statusKey(h.id, a)) ?? EMPTY]),
		),
		grants: grants.filter((g) => g.hostId === h.id),
	};
}

/** Accounts being checked right now, so listing hosts starts each check once. */
const checking = new Set<string>();

export async function listHosts(): Promise<HostWithStatus[]> {
	const rows = await db.select().from(schema.hosts).orderBy(schema.hosts.name);
	const grants = await db.select().from(schema.accessGrants);
	// Not checked since Sekai started: find out in the background (the list updates when it's known).
	for (const r of rows) {
		const h = toHost(r);
		for (const a of accountsOf(h)) {
			const k = statusKey(h.id, a);
			if (statuses.has(k) || checking.has(k)) continue;
			checking.add(k);
			void checkAccount(h, a)
				.then(() => changed())
				.catch(() => {})
				.finally(() => checking.delete(k));
		}
	}
	return rows.map((r) => withStatus(toHost(r), grants));
}

async function requireHost(id: string): Promise<Host> {
	const [row] = await db.select().from(schema.hosts).where(eq(schema.hosts.id, id));
	if (!row) throw notFound("Host");
	return toHost(row);
}

function changed(): void {
	bus.emit({ type: "settings.changed" });
}

export async function createHost(input: unknown): Promise<HostWithStatus> {
	const data = parse(HostCreate, input);
	const now = Date.now();
	const id = newId("hst", 12);
	try {
		await db.insert(schema.hosts).values({ id, ...data, createdAt: now, updatedAt: now });
	} catch {
		throw new HttpError(409, `There's already a host called ${data.name}`);
	}
	changed();
	void checkHost(id).catch(() => {});
	return withStatus(await requireHost(id), []);
}

export async function updateHost(id: string, input: unknown): Promise<Host> {
	// Other accounts change through addHostAccount / removeHostAccount (they set keys up and take them off).
	const { accounts: _accounts, ...patch } = parse(HostUpdate, input);
	const before = await requireHost(id);
	const set: Partial<typeof schema.hosts.$inferInsert> = { ...patch, updatedAt: Date.now() };
	if (patch.user && patch.user !== before.user) {
		// Bots let in as the old account stay in that account (their keys are there), so it becomes one of the
		// device's other accounts; nobody silently gets the new one (which may be root).
		await db
			.update(schema.accessGrants)
			.set({ account: before.user })
			.where(and(eq(schema.accessGrants.hostId, id), isNull(schema.accessGrants.account)));
		const others = new Set([...before.accounts, before.user]);
		others.delete(patch.user);
		set.accounts = [...others];
		// Grants already made for the new account are now the device's own.
		await db
			.update(schema.accessGrants)
			.set({ account: null })
			.where(and(eq(schema.accessGrants.hostId, id), eq(schema.accessGrants.account, patch.user)));
	}
	await db.update(schema.hosts).set(set).where(eq(schema.hosts.id, id));
	forgetStatuses(id);
	changed();
	return requireHost(id);
}

function forgetStatuses(hostId: string): void {
	for (const k of [...statuses.keys()]) if (k.startsWith(`${hostId}:`)) statuses.delete(k);
}

/** Removes a host; bots' keys are taken off it first (when it's reachable). */
export async function deleteHost(id: string): Promise<void> {
	const host = await requireHost(id);
	for (const g of await grantsFor({ hostId: id })) {
		await removeKey(await masterTarget(host, grantAccount(host, g)), g.agentId, isWindows(host)).catch(
			(err: unknown) => log.warn(`couldn't take ${g.agentId}'s key off ${host.name}: ${errorMessage(err)}`),
		);
	}
	await db.delete(schema.hosts).where(eq(schema.hosts.id, id));
	forgetStatuses(id);
	changed();
}

async function masterTarget(h: Host, account = h.user): Promise<SshTarget> {
	return {
		machineId: `host-${h.id}${account === h.user ? "" : `-${account}`}`,
		host: h.address,
		port: h.port,
		user: account,
		keyFile: await masterFile(),
	};
}

function sshProblem(r: ExecResult): string {
	const e = r.stderr.trim();
	if (r.timedOut) return "It didn't answer in time (offline, or SSH isn't on?)";
	if (/Permission denied/i.test(e))
		return "It refused Sekai's master key. Install the master key for that account first.";
	if (/Could not resolve|Name or service not known/i.test(e)) return "That address doesn't resolve";
	if (/Connection refused/i.test(e)) return "SSH isn't running there (connection refused)";
	if (/timed out|No route/i.test(e)) return "Couldn't reach it";
	return e.split("\n").slice(-2).join(" ") || `exit ${r.code}`;
}

async function checkAccount(host: Host, account: string): Promise<HostStatus> {
	const probe = isWindows(host)
		? powershell(
				"Write-Output ((Get-CimInstance Win32_OperatingSystem).Caption + ' ' + [Environment]::OSVersion.Version); whoami",
			)
		: "uname -srm; whoami";
	const r = await sshExec(await masterTarget(host, account), probe, { timeoutMs: 15_000 });
	const status: HostStatus =
		r.code === 0
			? {
					ok: true,
					error: null,
					checkedAt: Date.now(),
					about: new TextDecoder().decode(r.stdout).trim().replace(/\n/g, " · "),
				}
			: { ok: false, error: sshProblem(r), checkedAt: Date.now(), about: null };
	statuses.set(statusKey(host.id, account), status);
	return status;
}

/** Logs in with the master key (as each of its accounts) and asks the device what it is. Returns its own account's. */
export async function checkHost(id: string): Promise<HostStatus> {
	const host = await requireHost(id);
	const [main] = await Promise.all(accountsOf(host).map((a) => checkAccount(host, a)));
	changed();
	return main as HostStatus;
}

/**
 * Another account bots can be let into (root, say). Sekai's master key has to be in it: if it isn't yet and
 * the host's own account may use sudo without a password, Sekai puts it there; otherwise you install it.
 */
export async function addHostAccount(id: string, input: unknown): Promise<HostAccountResult> {
	const account = parse(AccountName, input);
	const host = await requireHost(id);
	if (!accountsOf(host).includes(account)) {
		await db
			.update(schema.hosts)
			.set({ accounts: [...host.accounts, account], updatedAt: Date.now() })
			.where(eq(schema.hosts.id, id));
		changed();
	}
	const next = await requireHost(id);
	let status = await checkAccount(next, account);
	if (status.ok) return done("ready", null);
	if (isWindows(next)) return done("manual", "On Windows, install the master key from that account.");
	const m = await master();
	if (!m) return done("manual", null);
	const blob = m.publicKey.split(/\s+/)[1] ?? "";
	const script = [
		`u=${shq(account)}`,
		`h=$(getent passwd "$u" | cut -d: -f6)`,
		`[ -n "$h" ] || { echo "There's no account called $u there" >&2; exit 3; }`,
		`sudo -n sh -c 'umask 077; mkdir -p "$1/.ssh" && touch "$1/.ssh/authorized_keys" && (grep -qF "$2" "$1/.ssh/authorized_keys" || printf "%s\\n" "$3" >> "$1/.ssh/authorized_keys") && chown "$4" "$1/.ssh" "$1/.ssh/authorized_keys"' sh "$h" ${shq(blob)} ${shq(m.publicKey.trim())} "$u"`,
	].join("; ");
	const r = await sshExec(await masterTarget(next), script, { timeoutMs: 20_000 });
	if (r.code !== 0) {
		const e = r.stderr.trim();
		const why =
			r.code === 3
				? (e.split("\n").at(-1) ?? e)
				: /password is required|a terminal is required|sudo:/i.test(e)
					? `${next.user} can't use sudo without a password there, so install it from ${account} yourself.`
					: `Couldn't add it with sudo: ${sshProblem(r)}`;
		return done("manual", why);
	}
	status = await checkAccount(next, account);
	log.info(`added Sekai's master key to ${account} on ${next.name} (with sudo)`);
	return done(status.ok ? "sudo" : "manual", status.ok ? null : status.error);

	function done(setup: HostAccountResult["setup"], note: string | null): HostAccountResult {
		changed();
		return { account, setup, status, note };
	}
}

/** Stops bots using one of a host's other accounts: their keys come off it and their access there ends. */
export async function removeHostAccount(id: string, account: string): Promise<void> {
	const host = await requireHost(id);
	if (account === host.user) throw badRequest("That's the device's own account; change it instead.");
	for (const g of await grantsFor({ hostId: id })) {
		if (g.account !== account) continue;
		await removeKey(await masterTarget(host, account), g.agentId, isWindows(host)).catch((err: unknown) =>
			log.warn(`couldn't take ${g.agentId}'s key off ${account}@${host.name}: ${errorMessage(err)}`),
		);
		await db.delete(schema.accessGrants).where(eq(schema.accessGrants.id, g.id));
	}
	await db
		.update(schema.hosts)
		.set({ accounts: host.accounts.filter((a) => a !== account), updatedAt: Date.now() })
		.where(eq(schema.hosts.id, id));
	statuses.delete(statusKey(id, account));
	changed();
}

// ---------------------------------------------------------------- Windows

const isWindows = (h: { os?: string | null }) => /windows/i.test(h.os ?? "");

/** A PowerShell script as one ssh command (Windows' sshd runs cmd.exe; -EncodedCommand avoids its quoting). */
export function powershell(script: string): string {
	return `powershell -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(script, "utf16le").toString("base64")}`;
}

/** Where Windows' OpenSSH reads keys: admins share administrators_authorized_keys. */
const PS_KEYFILE = `$admin = (New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator); $f = if ($admin) { "$env:ProgramData\\ssh\\administrators_authorized_keys" } else { "$env:USERPROFILE\\.ssh\\authorized_keys" }`;

const psq = (s: string) => `'${s.replace(/'/g, "''")}'`;

// ---------------------------------------------------------------- keys on devices

const tag = (agentId: string) => `sekai-agent:${agentId}`;

async function keyLine(agentId: string): Promise<string> {
	const agent = await getAgent(agentId);
	if (!agent) throw notFound("Agent");
	const { publicKey } = await agentKeypair(agentId, agent.name);
	const [type, blob] = publicKey.split(/\s+/);
	return `${type} ${blob} ${tag(agentId)}`;
}

async function installKey(t: SshTarget, agentId: string, windows = false): Promise<void> {
	const line = await keyLine(agentId);
	const script = windows
		? powershell(
				`${PS_KEYFILE}; New-Item -ItemType Directory -Force (Split-Path $f) | Out-Null; if (!(Test-Path $f)) { New-Item -Force $f | Out-Null }; if (!(Select-String -Path $f -SimpleMatch ${psq(tag(agentId))} -Quiet)) { Add-Content -Path $f -Value ${psq(line)} }`,
			)
		: `umask 077; mkdir -p ~/.ssh && touch ~/.ssh/authorized_keys && (grep -qF ${shq(tag(agentId))} ~/.ssh/authorized_keys || printf '%s\\n' ${shq(line)} >> ~/.ssh/authorized_keys)`;
	const r = await sshExec(t, script, { timeoutMs: 20_000 });
	if (r.code !== 0) throw new Error(`Couldn't add the key: ${sshProblem(r)}`);
}

async function removeKey(t: SshTarget, agentId: string, windows = false): Promise<void> {
	if (windows) {
		const r = await sshExec(
			t,
			powershell(
				`${PS_KEYFILE}; if (Test-Path $f) { (Get-Content $f) | Where-Object { $_ -notlike ${psq(`*${tag(agentId)}*`)} } | Set-Content $f }`,
			),
			{ timeoutMs: 20_000 },
		);
		if (r.code !== 0) throw new Error(`Couldn't remove the key: ${sshProblem(r)}`);
		return;
	}
	// grep exits 1 when nothing is left (fine) and 2 on errors; a failed or partial copy (a full disk) must never
	// replace the real file, or every key there (the master key, your own) would be gone. mv swaps it in whole.
	const script = `umask 077; f=~/.ssh/authorized_keys; [ -f "$f" ] || exit 0; grep -vF ${shq(tag(agentId))} "$f" > "$f.sekai"; rc=$?; if [ $rc -gt 1 ]; then rm -f "$f.sekai"; exit 1; fi; mv -f "$f.sekai" "$f"`;
	const r = await sshExec(t, script, { timeoutMs: 20_000 });
	if (r.code !== 0) throw new Error(`Couldn't remove the key: ${sshProblem(r)}`);
}

// ---------------------------------------------------------------- what a bot can reach

export interface Reachable {
	kind: "host" | "machine";
	id: string;
	name: string;
	/** Who it belongs to: you, or a bot. */
	owner: string;
	/** Allowed in (as at least one account, on a host). */
	access: boolean;
	/** On a host: the accounts there (its own first), and which ones this bot may use. */
	accounts?: { name: string; access: boolean }[];
	about: string;
}

/** Hosts and other bots' machines, and whether this bot may use each. */
export async function reachableFor(agentId: string): Promise<Reachable[]> {
	// (Windows devices take PowerShell commands; their "about" says so.)
	const grants = await db.select().from(schema.accessGrants).where(eq(schema.accessGrants.agentId, agentId));
	const out: Reachable[] = [];
	for (const h of await listHosts()) {
		const mine = grants.filter((g) => g.hostId === h.id).map((g) => grantAccount(h, g));
		out.push({
			kind: "host",
			id: h.id,
			name: h.name,
			owner: "the user",
			access: mine.length > 0,
			accounts: accountsOf(h).map((a) => ({ name: a, access: mine.includes(a) })),
			about: [isWindows(h) ? "Windows (commands run in PowerShell)" : h.os, h.description, h.address]
				.filter(Boolean)
				.join(" · "),
		});
	}
	const { listMachines } = await import("./manager.ts");
	const { listAgents } = await import("../services/agents.ts");
	const agents = new Map((await listAgents()).map((a) => [a.id, a.name]));
	for (const m of await listMachines({})) {
		if (m.agentId === agentId || m.provider === "local") continue;
		out.push({
			kind: "machine",
			id: m.id,
			name: m.name,
			owner: agents.get(m.agentId) ?? "another bot",
			access: grants.some((g) => g.machineId === m.id),
			about: `${m.kind}, ${m.status}`,
		});
	}
	return out;
}

/** A host or bot machine by name or id. */
export async function findReachable(agentId: string, ref: string): Promise<Reachable> {
	const all = await reachableFor(agentId);
	const r = ref.trim().toLowerCase();
	const hit = all.find((x) => x.id === ref || x.name.toLowerCase() === r);
	if (!hit) {
		throw badRequest(
			`There's no device or bot machine called "${ref}". Known: ${all.map((x) => x.name).join(", ") || "none yet (the user adds devices in Admin → Devices & access)"}.`,
		);
	}
	return hit;
}

/** The account on a host a bot means (its own one when not said), checked against the host's accounts. */
function pickAccount(h: Host, account: string | null | undefined): string {
	const a = account?.trim() || h.user;
	if (!accountsOf(h).includes(a)) {
		throw badRequest(
			`${h.name} has no account "${a}" for bots. Its accounts: ${accountsOf(h).join(", ")} (the user adds more in Admin → Tailscale).`,
		);
	}
	return a;
}

/**
 * Lets a bot onto a host (as one of its accounts: its own by default) or another bot's machine: adds the bot's
 * key there and remembers who said yes.
 */
export async function grantAccess(
	agentId: string,
	ref: string,
	by: string,
	reason = "",
	account?: string | null,
): Promise<Reachable & { account?: string }> {
	const target = await findReachable(agentId, ref);
	let as: string | null = null;
	if (target.kind === "host") {
		const h = await requireHost(target.id);
		const a = pickAccount(h, account);
		if (target.accounts?.find((x) => x.name === a)?.access) return { ...target, account: a };
		await installKey(await masterTarget(h, a), agentId, isWindows(h));
		as = a === h.user ? null : a;
	} else if (target.access) {
		return target;
	} else {
		const m = await getMachine(target.id);
		if (!m) throw notFound("Machine");
		if (m.status !== "running") throw badRequest(`${m.name} isn't running`);
		// The owner's key logs in to its own machine.
		await installKey(await sshTarget(m), agentId);
	}
	await db.insert(schema.accessGrants).values({
		id: newId("grt", 12),
		hostId: target.kind === "host" ? target.id : null,
		machineId: target.kind === "machine" ? target.id : null,
		agentId,
		account: as,
		grantedBy: by,
		reason,
		createdAt: Date.now(),
	});
	changed();
	const agent = await getAgent(agentId);
	log.info(`${agent?.name ?? agentId} may now use ${target.name}${as ? ` as ${as}` : ""} (by ${by})`);
	return { ...target, access: true, ...(target.kind === "host" ? { account: account?.trim() || undefined } : {}) };
}

/** Takes a bot's access away: on a host, as one account, or as all of them when account isn't given. */
export async function revokeAccess(agentId: string, ref: string, account?: string | null): Promise<boolean> {
	const target = await findReachable(agentId, ref);
	if (!target.access) return false;
	if (target.kind === "machine") {
		try {
			const m = await getMachine(target.id);
			if (m?.status === "running") await removeKey(await sshTarget(m), agentId);
		} catch (err) {
			log.warn(`revoking ${agentId} on ${target.name}: ${errorMessage(err)}`);
		}
		await db
			.delete(schema.accessGrants)
			.where(and(eq(schema.accessGrants.agentId, agentId), eq(schema.accessGrants.machineId, target.id)));
		changed();
		return true;
	}
	const h = await requireHost(target.id);
	const rows = (await grantsFor({ hostId: h.id })).filter(
		(g) => g.agentId === agentId && (!account || grantAccount(h, g) === account),
	);
	for (const g of rows) {
		try {
			await removeKey(await masterTarget(h, grantAccount(h, g)), agentId, isWindows(h));
		} catch (err) {
			log.warn(`revoking ${agentId} on ${target.name}: ${errorMessage(err)}`);
		}
		await db.delete(schema.accessGrants).where(eq(schema.accessGrants.id, g.id));
	}
	changed();
	return rows.length > 0;
}

/**
 * Copies a file to one of your devices (as its own account, with the master key) into a folder there (relative to
 * that account's home unless it's a full path), then keeps only the newest `keep` files matching `prune` in it.
 * For backups.
 */
export async function copyToHost(
	hostId: string,
	file: string,
	dir: string,
	prune?: { pattern: string; keep: number },
): Promise<{ name: string; path: string }> {
	const host = await requireHost(hostId);
	const t = await masterTarget(host);
	const folder = dir.replace(/^~[\\/]/, "").replace(/[\\/]+$/, "") || ".";
	const name = file.split(/[\\/]/).pop() ?? "backup";
	const windows = isWindows(host);
	const prep = await sshExec(
		t,
		windows
			? powershell(`New-Item -ItemType Directory -Force -Path ${psq(folder)} | Out-Null`)
			: `mkdir -p -- ${shq(folder)}`,
		{ timeoutMs: 30_000 },
	);
	if (prep.code !== 0) throw new Error(`${host.name}: ${sshProblem(prep)}`);
	await scpTo(t, file, `${folder}/${name}`).catch((err: unknown) => {
		throw new Error(`${host.name}: ${errorMessage(err)}`);
	});
	if (prune) {
		const pattern = prune.pattern.replace(/[^\w*.-]/g, "");
		await sshExec(
			t,
			windows
				? powershell(
						`Get-ChildItem -Path ${psq(folder)} -Filter ${psq(pattern)} | Sort-Object LastWriteTime -Descending | Select-Object -Skip ${prune.keep} | Remove-Item -Force`,
					)
				: `cd -- ${shq(folder)} && ls -1t -- ${pattern} 2>/dev/null | tail -n +${prune.keep + 1} | while IFS= read -r f; do rm -f -- "$f"; done`,
			{ timeoutMs: 60_000 },
		).catch(() => {});
	}
	return { name: host.name, path: `${folder}/${name}` };
}

/** Runs a command on a host or bot machine with the bot's own key (works only if its key is there). */
export async function runAs(
	agentId: string,
	ref: string,
	command: string,
	opts: { cwd?: string; timeoutMs: number; signal?: AbortSignal; as?: string | null },
): Promise<ExecResult & { name: string; account?: string }> {
	const target = await findReachable(agentId, ref);
	if (!target.access) {
		throw badRequest(
			`You don't have access to ${target.name}. Ask for it with host_request_access (or ask the primary bot).`,
		);
	}
	const agent = await getAgent(agentId);
	const keyFile = await agentKeyFile(agentId, agent?.name ?? "bot");
	let t: SshTarget;
	let windows = false;
	let account: string | undefined;
	if (target.kind === "host") {
		const h = await requireHost(target.id);
		windows = isWindows(h);
		const mine = (target.accounts ?? []).filter((a) => a.access).map((a) => a.name);
		// The account asked for, else its own account, else the one this bot was let into.
		account = opts.as?.trim() || (mine.includes(h.user) ? h.user : mine[0]) || h.user;
		if (!mine.includes(account)) {
			throw badRequest(
				`You don't have access to ${target.name} as ${account} (you have: ${mine.join(", ")}). Ask with host_request_access (as: ${account}).`,
			);
		}
		t = {
			machineId: `host-${h.id}${account === h.user ? "" : `-${account}`}`,
			host: h.address,
			port: h.port,
			user: account,
			keyFile,
		};
	} else {
		const m = (await getMachine(target.id)) as Machine;
		const base = await sshTarget(m);
		t = { ...base, keyFile };
	}
	const full = opts.cwd ? `cd ${shq(opts.cwd)} && ${command}` : command;
	// Windows: PowerShell. Elsewhere bash when the device has it (login shell, so PATH is the user's), else sh.
	const script = windows
		? powershell(opts.cwd ? `Set-Location ${psq(opts.cwd)}; ${command}` : command)
		: `if command -v bash >/dev/null 2>&1; then exec bash -lc ${shq(full)}; else exec sh -c ${shq(full)}; fi`;
	const r = await sshExec(t, script, { timeoutMs: opts.timeoutMs, signal: opts.signal });
	if (r.code === 255 && /Permission denied/i.test(r.stderr)) {
		throw badRequest(`${target.name} refused your key: your access was removed there. Ask again.`);
	}
	return { ...r, name: target.name, account };
}

// ---------------------------------------------------------------- tailnet

/**
 * Devices on your tailnet: from the Tailscale API when you've added a key (owners, tags, key expiry), else from
 * the Sekai server's own Tailscale. Either way, online comes from this server's live view when it has one.
 */
export async function tailnetDevices(): Promise<{
	devices: TailnetDevice[];
	error: string | null;
	self: string | null;
	via: "api" | "cli";
}> {
	const { cliStatus, apiDevices } = await import("./tailscale.ts");
	const [{ status, error: cliError }, hosts, machines] = await Promise.all([
		cliStatus(),
		db.select().from(schema.hosts),
		(async () => (await import("./manager.ts")).listMachines({}))(),
	]);
	let api: Awaited<ReturnType<typeof apiDevices>> = null;
	let apiError: string | null = null;
	try {
		api = await apiDevices();
	} catch (err) {
		apiError = errorMessage(err);
	}
	const { listAgents } = await import("../services/agents.ts");
	const agentNames = new Map((await listAgents()).map((a) => [a.id, a.name]));
	const peers = Object.values(status?.Peer ?? {});
	const users = status?.User ?? {};
	const selfIps = new Set(status?.Self?.TailscaleIPs ?? []);
	const live = new Map<string, { online: boolean; lastSeen: string | null }>();
	for (const p of peers) {
		for (const ip of p.TailscaleIPs ?? [])
			live.set(ip, { online: Boolean(p.Online), lastSeen: p.LastSeen ?? null });
	}
	const realSeen = (s: string | null | undefined) => (s && !s.startsWith("0001") ? s : null);
	const botMachine = (address: string, dnsName: string) => {
		const m = machines.find(
			(x) => x.kind !== "device" && (x.addresses.tailscale === address || x.addresses.tailscale === dnsName),
		);
		return m
			? {
					machineId: m.id,
					agentId: m.agentId,
					name: `${agentNames.get(m.agentId) ?? "A bot"}'s ${m.kind === "devbox" ? "devbox" : "computer"}`,
				}
			: null;
	};
	const hostFor = (id: string, address: string, dnsName: string) =>
		hosts.find((h) => h.tailscaleId === id || h.address === address || h.address === dnsName)?.id ?? null;

	let devices: TailnetDevice[];
	if (api) {
		devices = api
			.filter((d) => !d.addresses.some((ip) => selfIps.has(ip)))
			.map((d) => {
				const address = d.addresses.find((ip) => ip.includes(".")) ?? d.addresses[0] ?? "";
				const dnsName = d.name.replace(/\.$/, "");
				const now = live.get(address);
				return {
					id: d.nodeId ?? d.id,
					name: d.hostname || dnsName.split(".")[0] || dnsName,
					dnsName,
					address,
					os: d.os ?? "",
					online: now?.online ?? Boolean(d.connectedToControl),
					lastSeen: realSeen(now?.lastSeen) ?? realSeen(d.lastSeen),
					hostId: hostFor(d.nodeId ?? d.id, address, dnsName),
					owner: d.tags?.length ? "Tagged" : d.user || null,
					tags: d.tags ?? [],
					botMachine: botMachine(address, dnsName),
					keyExpires: d.keyExpiryDisabled ? null : (d.expires ?? null),
					updateAvailable: Boolean(d.updateAvailable),
					clientVersion: d.clientVersion?.split("-")[0] ?? null,
				};
			});
	} else {
		devices = peers.map((p) => {
			const address = p.TailscaleIPs?.find((ip) => ip.includes(".")) ?? p.TailscaleIPs?.[0] ?? "";
			const dnsName = (p.DNSName ?? "").replace(/\.$/, "");
			const id = p.ID ?? p.HostName;
			const login = p.UserID !== undefined ? users[String(p.UserID)]?.LoginName : undefined;
			return {
				id,
				name: p.HostName,
				dnsName,
				address,
				os: p.OS ?? "",
				online: Boolean(p.Online),
				lastSeen: realSeen(p.LastSeen),
				hostId: hostFor(id, address, dnsName),
				owner: p.Tags?.length ? "Tagged" : (login ?? null),
				tags: p.Tags ?? [],
				botMachine: botMachine(address, dnsName),
				keyExpires: null,
				updateAvailable: false,
				clientVersion: null,
			};
		});
	}
	devices.sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
	return {
		devices,
		error: api ? null : (apiError ?? (peers.length || status ? null : cliError)),
		self: status?.Self?.HostName ?? null,
		via: api ? "api" : "cli",
	};
}

/** You took a bot's access away (from Admin). */
export async function revokeGrant(grantId: string): Promise<void> {
	const [g] = await db.select().from(schema.accessGrants).where(eq(schema.accessGrants.id, grantId));
	if (!g) throw notFound("Access");
	const h = g.hostId ? await requireHost(g.hostId) : null;
	await revokeAccess(g.agentId, g.hostId ?? g.machineId ?? "", h ? grantAccount(h, g) : null);
}

/** Every grant (hosts and bots' machines), for Admin. */
export async function listGrants(): Promise<AccessGrant[]> {
	return db.select().from(schema.accessGrants);
}
