import { statfs } from "node:fs/promises";
import type { HealthIssue, HealthReport } from "@sekai/shared";
import { sql } from "drizzle-orm";
import { config } from "../config.ts";
import { db } from "../db/index.ts";
import { bus } from "../events/bus.ts";
import { errorMessage } from "../lib/errors.ts";
import { log } from "../lib/log.ts";
import { readKey, writeKey } from "./kv.ts";

const GB = 1024 ** 3;
/** Warn when the database passes this size: worth a look at what's filling it (and at backup sizes). */
const DB_WARN = 10 * GB;
const CHECK_MS = 15 * 60_000;
const MEMORY_WARN = 2 * GB;
/** A problem that stays is notified about again after this long. */
const RENOTIFY_MS = 24 * 3_600_000;
const NOTIFIED = "health.notified";

const gb = (n: number) => `${(n / GB).toFixed(n < 10 * GB ? 1 : 0)} GB`;

/** Free space: warning under 10% (or 5 GB), danger under 3% (or 1 GB). */
export function diskIssue(free: number, total: number): HealthIssue["level"] | null {
	if (total <= 0) return null;
	const share = free / total;
	if (share < 0.03 || free < 1 * GB) return "danger";
	if (share < 0.1 || free < 5 * GB) return "warning";
	return null;
}

let last: HealthReport | null = null;

/** Checks the server now: disk, database, backups, Proxmox storage. */
export async function checkHealth(): Promise<HealthReport> {
	const issues: HealthIssue[] = [];
	let disk: HealthReport["disk"] = null;
	try {
		const s = await statfs(config.dataDir);
		disk = { path: config.dataDir, free: s.bavail * s.bsize, total: s.blocks * s.bsize };
		const level = diskIssue(disk.free, disk.total);
		if (level) {
			issues.push({
				id: "disk",
				level,
				title:
					level === "danger" ? "This server is almost out of disk space" : "This server is low on disk space",
				detail: `${gb(disk.free)} free of ${gb(disk.total)} where Sekai keeps its data. Delete old backups or uploads, or make room.`,
			});
		}
	} catch (err) {
		log.debug(`health: disk: ${errorMessage(err)}`);
	}

	let database: HealthReport["database"] = null;
	try {
		const [row] = (await db.execute(sql`select pg_database_size(current_database())::text as size`)) as unknown as {
			size: string;
		}[];
		database = { size: Number(row?.size ?? 0) };
		if (database.size > DB_WARN) {
			issues.push({
				id: "database",
				level: "warning",
				title: "The database is getting big",
				detail: `It's ${gb(database.size)}. Large code indexes and long chats are the usual cause; backups grow with it.`,
			});
		}
	} catch (err) {
		log.debug(`health: database: ${errorMessage(err)}`);
	}

	try {
		const { backupStatus } = await import("../backups/index.ts");
		const b = await backupStatus();
		if (b.lastError) {
			issues.push({
				id: "backup-failed",
				level: "danger",
				title: "The last automatic backup failed",
				detail: b.lastError.error ?? "See Admin → Backups.",
			});
		} else if (b.config.schedule !== "off") {
			const period = (b.config.schedule === "daily" ? 1 : 7) * 86_400_000;
			const newest = b.backups.find((x) => x.kind === "scheduled" || x.kind === "manual");
			const age = newest ? Date.now() - newest.createdAt : Number.POSITIVE_INFINITY;
			// A day's grace after the one that was due (Sekai may have been off, and catches up when it starts).
			if (age > period + 86_400_000) {
				issues.push({
					id: "backups",
					level: "warning",
					title: "Backups are overdue",
					detail: newest
						? `The newest is from ${new Date(newest.createdAt).toLocaleDateString()}. Make one now in Admin → Backups.`
						: "There isn't one yet. Make one now in Admin → Backups.",
				});
			}
		}
	} catch (err) {
		log.debug(`health: backups: ${errorMessage(err)}`);
	}

	let proxmox: HealthReport["proxmox"] = null;
	try {
		const { getSettings } = await import("./settings.ts");
		const px = (await getSettings()).machines.proxmox;
		if (px.url && px.tokenId && px.storage) {
			const { ProxmoxClient } = await import("../machines/proxmox.ts");
			const s = (await new ProxmoxClient(px).storages()).find((x) => x.storage === px.storage);
			if (s?.total && s.avail !== undefined) {
				proxmox = { storage: s.storage, free: s.avail, total: s.total };
				const level = diskIssue(s.avail, s.total);
				if (level) {
					issues.push({
						id: "proxmox-storage",
						level,
						title: `Proxmox storage "${s.storage}" is ${level === "danger" ? "almost full" : "filling up"}`,
						detail: `${gb(s.avail)} free of ${gb(s.total)}. Bots' computers and devboxes can't grow, and new ones may fail.`,
					});
				}
			}
		}
	} catch (err) {
		log.debug(`health: proxmox: ${errorMessage(err)}`);
	}

	// Bots, browsers and voice live in other processes; the server itself stays well under a gigabyte normally.
	const memory = process.memoryUsage().rss;
	if (memory > MEMORY_WARN) {
		issues.push({
			id: "memory",
			level: "warning",
			title: "Sekai is using a lot of memory",
			detail: `${gb(memory)} after ${Math.round(process.uptime() / 3600)} hours. Restarting it frees it (systemctl --user restart sekai); if it keeps growing, it's a bug worth reporting.`,
		});
	}

	last = {
		checkedAt: Date.now(),
		disk,
		database,
		proxmox,
		server: { memory, uptime: Math.round(process.uptime() * 1000) },
		issues,
	};
	return last;
}

/** The last check (checked now when there's none yet, or it's older than a minute). */
export async function healthReport(refresh = false): Promise<HealthReport> {
	if (!refresh && last && Date.now() - last.checkedAt < 60_000) return last;
	return checkHealth();
}

/** New problems (and ones still there a day later) become notifications on your devices. */
export async function watchHealth(): Promise<void> {
	try {
		const report = await checkHealth();
		const notified = ((await readKey(NOTIFIED)) as Record<string, number> | undefined) ?? {};
		const now = Date.now();
		const next: Record<string, number> = {};
		for (const issue of report.issues) {
			const at = notified[issue.id];
			if (at && now - at < RENOTIFY_MS) {
				next[issue.id] = at;
				continue;
			}
			next[issue.id] = now;
			log.warn(`health: ${issue.title}. ${issue.detail}`);
			bus.emit({
				type: "notification",
				title: issue.title,
				body: issue.detail,
				agentId: null,
				conversationId: null,
				url: "/admin",
			});
		}
		// Problems that went away are forgotten, so a new one notifies again.
		await writeKey(NOTIFIED, next);
	} catch (err) {
		log.debug(`health watch: ${errorMessage(err)}`);
	}
}

let timer: ReturnType<typeof setInterval> | null = null;
let first: ReturnType<typeof setTimeout> | null = null;

export function startHealthWatch(): void {
	if (timer) return;
	// The first look a few minutes in: right after starting, a catch-up backup may be about to run.
	first = setTimeout(() => void watchHealth(), 10 * 60_000);
	timer = setInterval(() => void watchHealth(), CHECK_MS);
}

export function stopHealthWatch(): void {
	if (timer) clearInterval(timer);
	if (first) clearTimeout(first);
	timer = null;
	first = null;
}
