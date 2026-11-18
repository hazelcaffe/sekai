import { existsSync } from "node:fs";
import { readdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { lt } from "drizzle-orm";
import { config } from "../config.ts";
import { db, schema } from "../db/index.ts";
import { errorMessage } from "../lib/errors.ts";
import { log } from "../lib/log.ts";
import { listAgents } from "./agents.ts";

/**
 * Housekeeping, a few minutes after starting and then once a day: what would otherwise pile up over months of use.
 * - read-aloud audio not played for 30 days (and the oldest, past 500 MB)
 * - browser profiles and workspaces of bots that were deleted
 * - desktop app builds older than the published version
 * - half-finished backup files a crash left behind
 * - expired sign-ins
 */

const DAY = 86_400_000;
const VOICE_KEEP_MS = 30 * DAY;
const VOICE_MAX_BYTES = 500 * 1024 ** 2;

async function sizeOf(path: string): Promise<number> {
	const s = await stat(path).catch(() => null);
	if (!s) return 0;
	if (!s.isDirectory()) return s.size;
	let total = 0;
	for (const e of await readdir(path, { withFileTypes: true }).catch(() => []))
		total += await sizeOf(join(path, e.name));
	return total;
}

async function remove(path: string): Promise<number> {
	const size = await sizeOf(path);
	await rm(path, { recursive: true, force: true });
	return size;
}

/** Old read-aloud audio (playing it again counts as using it: see read-aloud.ts). */
export async function pruneVoiceCache(dir = join(config.dataDir, "voice-cache"), now = Date.now()): Promise<number> {
	if (!existsSync(dir)) return 0;
	const files = (
		await Promise.all(
			(
				await readdir(dir)
			).map(async (name) => {
				const s = await stat(join(dir, name)).catch(() => null);
				return s?.isFile() ? { path: join(dir, name), size: s.size, at: s.mtimeMs } : null;
			}),
		)
	)
		.filter((f): f is { path: string; size: number; at: number } => f !== null)
		.sort((a, b) => b.at - a.at);
	let freed = 0;
	let kept = 0;
	for (const f of files) {
		// Unfinished writes older than a day, anything unplayed for 30 days, and the oldest past the cap.
		const stale = f.path.endsWith(".part") ? now - f.at > DAY : now - f.at > VOICE_KEEP_MS;
		if (stale || kept + f.size > VOICE_MAX_BYTES) {
			await rm(f.path, { force: true });
			freed += f.size;
		} else {
			kept += f.size;
		}
	}
	return freed;
}

/** Per-bot folders (browser profiles, workspaces) whose bot is gone. */
async function pruneOrphanBotFolders(): Promise<number> {
	const ids = new Set((await listAgents()).map((a) => a.id));
	let freed = 0;
	for (const parent of ["browser", "workspaces"]) {
		const dir = join(config.dataDir, parent);
		if (!existsSync(dir)) continue;
		for (const name of await readdir(dir)) {
			if (name.startsWith("agt_") && !ids.has(name)) freed += await remove(join(dir, name));
		}
	}
	return freed;
}

/** Desktop app builds that aren't the published version (kept a day, in case a newer one is being uploaded). */
async function pruneDesktopReleases(now = Date.now()): Promise<number> {
	const dir = join(config.dataDir, "desktop-releases");
	if (!existsSync(dir)) return 0;
	const names = await readdir(dir);
	const versions = new Set<string>();
	for (const name of names.filter((n) => /^latest(-[a-z]+)?\.yml$/.test(n))) {
		const v = (await readFile(join(dir, name), "utf8")).match(/^version:\s*(.+)$/m)?.[1]?.trim();
		if (v) versions.add(v);
	}
	if (!versions.size) return 0;
	let freed = 0;
	for (const name of names) {
		if (name.endsWith(".yml") || [...versions].some((v) => name.includes(v))) continue;
		const s = await stat(join(dir, name)).catch(() => null);
		if (s && now - s.mtimeMs > DAY) freed += await remove(join(dir, name));
	}
	return freed;
}

/** What a crashed backup, restore or upload left in the backups folder. */
async function pruneBackupLeftovers(now = Date.now()): Promise<number> {
	const dir = join(config.dataDir, "backups");
	if (!existsSync(dir)) return 0;
	let freed = 0;
	for (const name of await readdir(dir)) {
		if (!/\.(work|part|restore)$/.test(name) && !name.startsWith(".upload-")) continue;
		const s = await stat(join(dir, name)).catch(() => null);
		if (s && now - s.mtimeMs > DAY) freed += await remove(join(dir, name));
	}
	return freed;
}

async function pruneSessions(): Promise<number> {
	const rows = await db
		.delete(schema.sessions)
		.where(lt(schema.sessions.expiresAt, Date.now()))
		.returning({ id: schema.sessions.id });
	return rows.length;
}

export async function housekeeping(): Promise<void> {
	const freed: Record<string, number> = {};
	const step = async (name: string, fn: () => Promise<number>) => {
		try {
			freed[name] = await fn();
		} catch (err) {
			log.warn(`housekeeping (${name}): ${errorMessage(err)}`);
		}
	};
	await step("read-aloud audio", () => pruneVoiceCache());
	await step("deleted bots' folders", pruneOrphanBotFolders);
	await step("old desktop builds", () => pruneDesktopReleases());
	await step("backup leftovers", () => pruneBackupLeftovers());
	const sessions = await pruneSessions().catch(() => 0);
	// Sign-in links, codes and waiting second steps that ran out.
	const { pruneTickets } = await import("../auth/tickets.ts");
	await pruneTickets().catch(() => 0);
	const bytes = Object.values(freed).reduce((a, b) => a + b, 0);
	if (bytes || sessions) {
		const parts = Object.entries(freed)
			.filter(([, n]) => n > 0)
			.map(([k, n]) => `${k} ${(n / 1024 ** 2).toFixed(1)} MB`);
		log.info(
			`housekeeping: freed ${parts.join(", ") || "nothing"}${sessions ? `; ${sessions} expired sign-ins` : ""}`,
		);
	}
}

let first: ReturnType<typeof setTimeout> | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

export function startHousekeeping(): void {
	first = setTimeout(() => void housekeeping(), 5 * 60_000);
	timer = setInterval(() => void housekeeping(), DAY);
}

export function stopHousekeeping(): void {
	if (first) clearTimeout(first);
	if (timer) clearInterval(timer);
	first = null;
	timer = null;
}
