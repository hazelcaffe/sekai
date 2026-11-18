import { existsSync } from "node:fs";
import { chmod, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	BackupConfig,
	BackupConfigUpdate,
	type BackupInfo,
	type BackupKind,
	type BackupOutcome,
	type BackupStatus,
} from "@sekai/shared";
import { Cron } from "croner";
import { config } from "../config.ts";
import { bus } from "../events/bus.ts";
import { badRequest, errorMessage, notFound, parse } from "../lib/errors.ts";
import { log } from "../lib/log.ts";
import { readKey, writeKey } from "../services/kv.ts";
import { effectiveTimezone } from "../services/settings.ts";
import { appliedMigrations, type Manifest, readManifest, restoreBackup, writeBackup } from "./archive.ts";

export const BACKUP_DIR = join(config.dataDir, "backups");
/** The backup to restore when Sekai next starts. */
const PENDING = join(BACKUP_DIR, ".restore-next-start");
const LAST_RESTORE = join(BACKUP_DIR, ".last-restore.json");
const CONFIG_KEY = "backups.config";
const STATE_KEY = "backups.state";
/** Sekai's own names; anything else in the folder that looks like a backup is listed too. */
const BACKUP_FILE = /^(sekai|feesh)-[\w.-]+\.tar\.gz$/;
const KINDS: BackupKind[] = ["scheduled", "manual", "before-restore", "uploaded"];

/** What the list shows without opening the archive, kept next to it. */
interface Summary {
	kind: BackupKind;
	app: string;
	createdAt: number;
	rows: number;
	files: number;
}

const changed = () => bus.emit({ type: "backups.changed" });

export async function backupConfig(): Promise<BackupConfig> {
	return BackupConfig.parse((await readKey(CONFIG_KEY)) ?? {});
}

async function readState(): Promise<{ lastCopy: BackupOutcome | null; lastError: BackupOutcome | null }> {
	const s = (await readKey(STATE_KEY)) as Partial<{ lastCopy: BackupOutcome; lastError: BackupOutcome }> | undefined;
	return { lastCopy: s?.lastCopy ?? null, lastError: s?.lastError ?? null };
}

async function saveState(patch: Partial<{ lastCopy: BackupOutcome | null; lastError: BackupOutcome | null }>) {
	await writeKey(STATE_KEY, { ...(await readState()), ...patch });
}

function kindOf(name: string): BackupKind {
	return (
		KINDS.find((k) => name.endsWith(`-${k}.tar.gz`) || new RegExp(`-${k}-\\d+\\.tar\\.gz$`).test(name)) ??
		"uploaded"
	);
}

/** The path of a backup by name (refusing anything that isn't one). */
function pathOf(name: string): string {
	if (!BACKUP_FILE.test(name)) throw notFound("Backup");
	const path = join(BACKUP_DIR, name);
	if (!existsSync(path)) throw notFound("Backup");
	return path;
}

export async function listBackups(): Promise<BackupInfo[]> {
	await mkdir(BACKUP_DIR, { recursive: true, mode: 0o700 });
	const names = (await readdir(BACKUP_DIR)).filter((n) => BACKUP_FILE.test(n));
	const list = await Promise.all(
		names.map(async (name): Promise<BackupInfo | null> => {
			const st = await stat(join(BACKUP_DIR, name)).catch(() => null);
			if (!st?.isFile()) return null;
			const s = (await Bun.file(join(BACKUP_DIR, `${name}.json`))
				.json()
				.catch(() => null)) as Summary | null;
			// Copied into the folder by hand: read what's in it once, and remember.
			if (!s && !unreadable.has(name)) {
				const m = await readManifest(join(BACKUP_DIR, name)).catch(() => null);
				if (m) {
					await writeSummary(name, m, kindOf(name));
					return listEntry(name, st.size, { kind: kindOf(name), ...summaryOf(m) });
				}
				unreadable.add(name);
			}
			return listEntry(name, st.size, s, st.mtimeMs);
		}),
	);
	return list.filter((b): b is BackupInfo => b !== null).sort((a, b) => b.createdAt - a.createdAt);
}

/** Files in the folder that aren't backups after all (not asked again until Sekai restarts). */
const unreadable = new Set<string>();

function listEntry(name: string, size: number, s: Summary | null, mtime = Date.now()): BackupInfo {
	return {
		name,
		kind: kindOf(name),
		size,
		createdAt: s?.createdAt ?? mtime,
		app: s?.app ?? null,
		rows: s?.rows ?? null,
		files: s?.files ?? null,
	};
}

function summaryOf(m: Manifest): Omit<Summary, "kind"> {
	return {
		app: m.app,
		createdAt: m.createdAt,
		rows: Object.values(m.tables).reduce((n, t) => n + t.rows, 0),
		files: m.files.count,
	};
}

async function writeSummary(name: string, m: Manifest, kind: BackupKind): Promise<void> {
	const summary: Summary = { kind, ...summaryOf(m) };
	await writeFile(join(BACKUP_DIR, `${name}.json`), JSON.stringify(summary), { mode: 0o600 });
}

/** sekai-20261117-033000-scheduled.tar.gz, in your time zone. */
async function newName(kind: BackupKind): Promise<string> {
	const tz = await effectiveTimezone();
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat("en-CA", {
			timeZone: tz,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
			hourCycle: "h23",
		})
			.formatToParts(new Date())
			.map((p) => [p.type, p.value]),
	);
	const stamp = `${parts.year}${parts.month}${parts.day}-${parts.hour}${parts.minute}${parts.second}`;
	for (let i = 1; ; i++) {
		const name = `sekai-${stamp}-${kind}${i > 1 ? `-${i}` : ""}.tar.gz`;
		if (!existsSync(join(BACKUP_DIR, name))) return name;
	}
}

async function deleteFiles(name: string): Promise<void> {
	await rm(join(BACKUP_DIR, name), { force: true });
	await rm(join(BACKUP_DIR, `${name}.json`), { force: true });
}

/** Keeps the newest `keep` automatic backups. */
async function prune(keep: number): Promise<void> {
	const scheduled = (await listBackups()).filter((b) => b.kind === "scheduled");
	for (const old of scheduled.slice(keep)) {
		await deleteFiles(old.name);
		log.info(`removed old backup ${old.name}`);
	}
}

/** Copies a backup to the device in the settings, keeping as many automatic ones there as here. */
async function copyOut(name: string, cfg: BackupConfig): Promise<void> {
	if (!cfg.copyTo) return;
	const { copyToHost } = await import("../machines/hosts.ts");
	try {
		const where = await copyToHost(cfg.copyTo.hostId, join(BACKUP_DIR, name), cfg.copyTo.dir, {
			pattern: "sekai-*-scheduled*.tar.gz",
			keep: cfg.keep,
		});
		log.info(`backup ${name} copied to ${where.name}:${where.path}`);
		await saveState({ lastCopy: { at: Date.now(), name, ok: true, error: null } });
	} catch (err) {
		log.warn(`couldn't copy backup ${name}: ${errorMessage(err)}`);
		await saveState({ lastCopy: { at: Date.now(), name, ok: false, error: errorMessage(err) } });
	}
	changed();
}

let running: Promise<BackupInfo> | null = null;

/** Makes a backup now (one at a time: asking during another one gets that one). */
export function makeBackup(kind: Exclude<BackupKind, "uploaded">): Promise<BackupInfo> {
	if (running) return running;
	const job = (async () => {
		await mkdir(BACKUP_DIR, { recursive: true, mode: 0o700 });
		const name = await newName(kind);
		const started = Date.now();
		const manifest = await writeBackup(join(BACKUP_DIR, name), kind);
		await writeSummary(name, manifest, kind);
		const cfg = await backupConfig();
		if (kind === "scheduled") await prune(cfg.keep);
		const info = (await listBackups()).find((b) => b.name === name);
		if (!info) throw new Error("The backup disappeared right after it was made");
		log.info(
			`backup ${name} (${Math.round(info.size / 1024)} KB) in ${((Date.now() - started) / 1000).toFixed(1)}s`,
		);
		if (kind !== "before-restore") void copyOut(name, cfg);
		return info;
	})();
	running = job;
	changed();
	void job
		.catch(() => {})
		.finally(() => {
			running = null;
			changed();
		});
	return job;
}

export async function deleteBackup(name: string): Promise<void> {
	pathOf(name);
	if ((await pendingRestore()) === name)
		throw badRequest("That backup is about to be restored. Cancel the restore first.");
	await deleteFiles(name);
	changed();
}

/** Adds a backup made elsewhere (checked to be one this Sekai can restore). */
export async function addBackup(file: File): Promise<BackupInfo> {
	await mkdir(BACKUP_DIR, { recursive: true, mode: 0o700 });
	const tmp = join(BACKUP_DIR, `.upload-${Date.now().toString(36)}`);
	await Bun.write(tmp, file);
	try {
		const manifest = await readManifest(tmp);
		const name = await newName("uploaded");
		await chmod(tmp, 0o600);
		await rename(tmp, join(BACKUP_DIR, name));
		await writeSummary(name, manifest, "uploaded");
		changed();
		const info = (await listBackups()).find((b) => b.name === name);
		if (!info) throw new Error("The backup disappeared right after it was added");
		return info;
	} finally {
		await rm(tmp, { force: true });
	}
}

/** The file a download streams. */
export function backupFile(name: string): string {
	return pathOf(name);
}

async function pendingRestore(): Promise<string | null> {
	return existsSync(PENDING) ? (await readFile(PENDING, "utf8")).trim() || null : null;
}

/** Asks for a restore at the next start (checked now, so a backup that can't be restored says so right away). */
export async function requestRestore(name: string): Promise<BackupStatus> {
	const manifest = await readManifest(pathOf(name));
	if (manifest.migrations > (await appliedMigrations())) {
		throw badRequest("This backup was made by a newer version of Sekai. Update Sekai first.");
	}
	await writeFile(PENDING, name, { mode: 0o600 });
	log.info(`backup ${name} will be restored when Sekai next starts`);
	changed();
	return backupStatus();
}

export async function cancelRestore(): Promise<BackupStatus> {
	await rm(PENDING, { force: true });
	changed();
	return backupStatus();
}

/**
 * At startup, before anything else runs: the restore you asked for, if any. What's here is backed up first, so it
 * can be undone. Tried once (a failing one doesn't repeat at every start); never throws.
 */
export async function restorePending(): Promise<void> {
	const name = await pendingRestore().catch(() => null);
	if (!name) return;
	await rm(PENDING, { force: true });
	let outcome: BackupOutcome;
	try {
		const file = pathOf(name);
		log.info(`restoring backup ${name}: backing up what's here first…`);
		const before = await makeBackup("before-restore");
		log.info(`saved ${before.name}; restoring…`);
		const { manifest, rows } = await restoreBackup(file);
		log.info(`restored ${name} (${rows} rows, ${manifest.files.count} files, made by Sekai ${manifest.app})`);
		outcome = { at: Date.now(), name, ok: true, error: null };
	} catch (err) {
		log.error(`couldn't restore ${name}: ${errorMessage(err)}`);
		outcome = { at: Date.now(), name, ok: false, error: errorMessage(err) };
	}
	await writeFile(LAST_RESTORE, JSON.stringify(outcome), { mode: 0o600 }).catch(() => {});
}

export async function backupStatus(): Promise<BackupStatus> {
	const lastRestore = (await Bun.file(LAST_RESTORE)
		.json()
		.catch(() => null)) as BackupOutcome | null;
	return {
		config: await backupConfig(),
		backups: await listBackups(),
		dir: BACKUP_DIR,
		running: running !== null,
		nextRunAt: job?.nextRun()?.getTime() ?? null,
		pendingRestore: await pendingRestore(),
		lastRestore,
		...(await readState()),
	};
}

export async function configureBackups(input: unknown): Promise<BackupStatus> {
	const patch = parse(BackupConfigUpdate, input);
	const next = BackupConfig.parse({ ...(await backupConfig()), ...patch });
	if (next.copyTo) {
		const { listHosts } = await import("../machines/hosts.ts");
		if (!(await listHosts()).some((h) => h.id === next.copyTo?.hostId))
			throw badRequest("That device isn't in Sekai");
	}
	await writeKey(CONFIG_KEY, next);
	await schedule();
	if (patch.keep !== undefined) await prune(next.keep);
	changed();
	return backupStatus();
}

// ---------------------------------------------------------------- schedule

let job: Cron | null = null;
let catchUp: ReturnType<typeof setTimeout> | null = null;
let unsubscribe: (() => void) | null = null;

async function scheduledRun(): Promise<void> {
	try {
		await makeBackup("scheduled");
		await saveState({ lastError: null });
	} catch (err) {
		log.error(`scheduled backup failed: ${errorMessage(err)}`);
		await saveState({ lastError: { at: Date.now(), name: "", ok: false, error: errorMessage(err) } });
		changed();
	}
}

/** 3:30 at night in your time zone: every night, or Sunday night. */
async function schedule(): Promise<void> {
	job?.stop();
	job = null;
	const cfg = await backupConfig();
	if (cfg.schedule === "off") return;
	job = new Cron(
		cfg.schedule === "daily" ? "30 3 * * *" : "30 3 * * 0",
		{ timezone: await effectiveTimezone() },
		() => {
			void scheduledRun();
		},
	);
}

export async function startBackups(): Promise<void> {
	await schedule();
	// Your time zone changed: so does 3:30.
	unsubscribe = bus.subscribe((ev) => {
		if (ev.type === "settings.changed") void schedule().catch(() => {});
	});
	// Sekai was off when one was due (or there's none yet): one a few minutes after starting.
	const cfg = await backupConfig();
	if (cfg.schedule === "off") return;
	const period = (cfg.schedule === "daily" ? 1 : 7) * 86_400_000;
	const last = (await listBackups()).find((b) => b.kind === "scheduled");
	if (!last || Date.now() - last.createdAt > period + 2 * 3_600_000) {
		catchUp = setTimeout(() => void scheduledRun(), 5 * 60_000);
	}
}

export function stopBackups(): void {
	job?.stop();
	job = null;
	if (catchUp) clearTimeout(catchUp);
	catchUp = null;
	unsubscribe?.();
	unsubscribe = null;
}
