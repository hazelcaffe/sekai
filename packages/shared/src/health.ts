/** Something about the server that needs you: low disk space, a big database, overdue backups… */
export interface HealthIssue {
	id: "disk" | "database" | "backups" | "backup-failed" | "proxmox-storage" | "memory";
	level: "warning" | "danger";
	title: string;
	detail: string;
}

export interface HealthReport {
	checkedAt: number;
	/** The disk holding Sekai's data folder (uploads, backups…). */
	disk: { path: string; free: number; total: number } | null;
	database: { size: number } | null;
	/** The server's own memory use (bytes), and how long it has been running (ms). */
	server: { memory: number; uptime: number };
	/** Where bots' computers and devboxes live, when Proxmox is set up. */
	proxmox: { storage: string; free: number; total: number } | null;
	issues: HealthIssue[];
}
