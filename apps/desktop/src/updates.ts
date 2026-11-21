import { app, Notification } from "electron";

/**
 * Auto-update from your own Sekai server: it serves the newest desktop build (published with
 * `bun run --cwd apps/desktop publish:local`) at /api/desktop/updates. Downloads quietly, then offers a restart.
 */

type Updater = typeof import("electron-updater").autoUpdater;

let updater: Updater | null = null;
let coming = "";
let timer: ReturnType<typeof setInterval> | null = null;
let listeners: ((state: UpdateState) => void)[] = [];

export type UpdateState =
	| { state: "idle" | "checking" | "none" }
	| { state: "downloading"; version: string; percent: number }
	| { state: "ready"; version: string }
	| { state: "error"; message: string };

let current: UpdateState = { state: "idle" };
const set = (s: UpdateState) => {
	current = s;
	console.info(`[updates] ${JSON.stringify(s)}`);
	for (const l of listeners) l(s);
};

export function updateState(): UpdateState {
	return current;
}

export function onUpdateState(l: (s: UpdateState) => void): void {
	listeners.push(l);
}

export async function startUpdates(serverUrl: () => string): Promise<void> {
	// Only installed builds update themselves (not `electron .` in development).
	if (!app.isPackaged || updater) return;
	const { autoUpdater } = await import("electron-updater");
	updater = autoUpdater;
	autoUpdater.autoDownload = true;
	autoUpdater.autoInstallOnAppQuit = true;
	autoUpdater.on("checking-for-update", () => set({ state: "checking" }));
	autoUpdater.on("update-not-available", () => set({ state: "none" }));
	autoUpdater.on("download-progress", (p) =>
		set({ state: "downloading", version: coming, percent: Math.round(p.percent) }),
	);
	autoUpdater.on("update-available", (info) => {
		coming = info.version;
		set({ state: "downloading", version: info.version, percent: 0 });
	});
	autoUpdater.on("update-downloaded", (info) => {
		set({ state: "ready", version: info.version });
		if (Notification.isSupported()) {
			const n = new Notification({
				title: "Update ready",
				body: `Sekai ${info.version} is ready. Click to restart now, or it will install when you quit.`,
			});
			n.on("click", () => installNow());
			n.show();
		}
	});
	autoUpdater.on("error", (err) => set({ state: "error", message: err?.message ?? String(err) }));
	const check = () => {
		autoUpdater.setFeedURL({ provider: "generic", url: `${serverUrl().replace(/\/+$/, "")}/api/desktop/updates` });
		void autoUpdater.checkForUpdates().catch((err: unknown) => set({ state: "error", message: String(err) }));
	};
	check();
	timer = setInterval(check, 4 * 60 * 60 * 1000);
}

export function checkNow(serverUrl: () => string): void {
	if (!updater) return;
	updater.setFeedURL({ provider: "generic", url: `${serverUrl().replace(/\/+$/, "")}/api/desktop/updates` });
	void updater.checkForUpdates().catch(() => {});
}

export function installNow(): void {
	updater?.quitAndInstall(false, true);
}

export function stopUpdates(): void {
	if (timer) clearInterval(timer);
	timer = null;
	listeners = [];
}
