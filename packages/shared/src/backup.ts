import { z } from "zod";
import { patchOf } from "./patch.ts";

export const BackupSchedule = z.enum(["off", "daily", "weekly"]);
export type BackupSchedule = z.infer<typeof BackupSchedule>;

export const BackupConfig = z.object({
	/** Automatic backups: every night, or Sunday night (3:30 in your time zone). */
	schedule: BackupSchedule.default("daily"),
	/** How many automatic backups to keep (the ones you make stay until you delete them). */
	keep: z.number().int().min(1).max(100).default(7),
	/** Also copy each backup to one of your devices over SSH (with Sekai's master key), into this folder. */
	copyTo: z
		.object({
			hostId: z.string().min(1).max(60),
			dir: z
				.string()
				.trim()
				.min(1)
				.max(300)
				.refine((d) => !/["'`$\n\r]/.test(d), "Use a plain folder path, without quotes or $"),
		})
		.nullable()
		.default(null),
});
export type BackupConfig = z.infer<typeof BackupConfig>;
export const BackupConfigUpdate = patchOf(BackupConfig);
export type BackupConfigUpdate = z.infer<typeof BackupConfigUpdate>;

/** scheduled: made on the schedule. manual: you made it. before-restore: what was here before a restore. */
export type BackupKind = "scheduled" | "manual" | "before-restore" | "uploaded";

export interface BackupInfo {
	name: string;
	kind: BackupKind;
	size: number;
	createdAt: number;
	/** The Sekai version that made it; null when it couldn't be read. */
	app: string | null;
	/** Database rows and data files in it; null when unknown. */
	rows: number | null;
	files: number | null;
}

export interface BackupOutcome {
	at: number;
	name: string;
	ok: boolean;
	error: string | null;
}

export interface BackupStatus {
	config: BackupConfig;
	backups: BackupInfo[];
	/** Where backups are kept on the server. */
	dir: string;
	/** A backup is being made right now. */
	running: boolean;
	nextRunAt: number | null;
	/** The backup that will be restored when Sekai next starts. */
	pendingRestore: string | null;
	lastRestore: BackupOutcome | null;
	lastCopy: BackupOutcome | null;
	/** The last automatic backup failed (cleared by the next one that works). */
	lastError: BackupOutcome | null;
}
