import { join } from "node:path";
import type { LocalComputerSettings } from "@sekai/shared";
import {
	app,
	BrowserWindow,
	dialog,
	globalShortcut,
	ipcMain,
	Menu,
	type MenuItemConstructorOptions,
	Notification,
	nativeImage,
	nativeTheme,
	screen,
	shell,
	Tray,
} from "electron";
import { isBundledUrl } from "./bundled.ts";
import { loadConfig, normalizeServerUrl, saveConfig, saveServerToken, serverToken } from "./config.ts";
import { computerName, LocalComputer, type LocalStatus } from "./local/index.ts";
import { destroyActivity, hideActivity, showActivity } from "./local/overlay.ts";
import { checkNow, installNow, onUpdateState, startUpdates, updateState } from "./updates.ts";

const DEV = process.argv.includes("--dev");

/** Whether two URLs share an origin (scheme, host and port). */
function sameOrigin(a: string, b: string): boolean {
	try {
		return new URL(a).origin === new URL(b).origin;
	} catch {
		return false;
	}
}
const SCREENSHOT = process.env.SEKAI_DESKTOP_SCREENSHOT;
const PROTOCOL = "sekai";
// The bundler bakes __dirname in at build time, so find the files from the app's own folder (or its asar).
const assets = (name: string) => join(app.getAppPath(), "dist", name);
/** Only the app's own screens get their powers, not any file:// page (see bundled.ts). */
const isBundled = (url: string | undefined) => isBundledUrl(url, join(app.getAppPath(), "dist"));

let win: BrowserWindow | null = null;
let aboutWin: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let connected = false;
let pendingPath: string | null = null;
let badgeCount = 0;

interface ConnectContext {
	mode: "first-run" | "unreachable" | "change";
	serverUrl: string;
	error: string | null;
	canReturn: boolean;
	version: string;
}

let connectContext: ConnectContext = {
	mode: "first-run",
	serverUrl: "",
	error: null,
	canReturn: false,
	version: app.getVersion(),
};

function windowBackground(): string {
	return nativeTheme.shouldUseDarkColors ? __SEKAI_BG_DARK__ : __SEKAI_BG_LIGHT__;
}

// ---------------------------------------------------------------- single instance + deep links

if (!app.requestSingleInstanceLock()) {
	app.quit();
	process.exit(0);
}

if (process.defaultApp && process.argv[1]) {
	app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [join(process.cwd(), process.argv[1])]);
} else {
	app.setAsDefaultProtocolClient(PROTOCOL);
}

/** sekai://c/<conversationId> → /c/<conversationId> inside the app. */
function pathFromDeepLink(url: string): string | null {
	try {
		const u = new URL(url);
		if (u.protocol !== `${PROTOCOL}:`) return null;
		const path = `/${u.host}${u.pathname}`.replace(/\/+$/, "");
		return /^\/[\w/-]*$/.test(path) ? path || "/" : "/";
	} catch {
		return null;
	}
}

function navigate(path: string): void {
	// macOS opens sekai:// links before the app is ready: keep it for when the window exists.
	if (!app.isReady()) {
		pendingPath = path;
		return;
	}
	showWindow();
	if (win && connected) win.webContents.send("sekai:navigate", path);
	else pendingPath = path;
}

app.on("second-instance", (_e, argv) => {
	const link = argv.find((a) => a.startsWith(`${PROTOCOL}://`));
	const path = link ? pathFromDeepLink(link) : null;
	if (path) navigate(path);
	else showWindow();
});

app.on("open-url", (e, url) => {
	e.preventDefault();
	const path = pathFromDeepLink(url);
	if (path) navigate(path);
});

// ---------------------------------------------------------------- server connection

async function reachable(origin: string): Promise<{ ok: boolean; error?: string }> {
	try {
		const res = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(4000) });
		return res.ok
			? { ok: true }
			: {
					ok: false,
					error: `This server answered with an error (${res.status}). Check the address and try again.`,
				};
	} catch {
		return {
			ok: false,
			error: `Couldn't reach ${origin}. Check that Sekai is running and try again.`,
		};
	}
}

async function showConnectScreen(mode: ConnectContext["mode"], error: string | null, canReturn = false): Promise<void> {
	if (!win || win.isDestroyed()) return;
	connectContext = {
		mode,
		serverUrl: loadConfig().serverUrl,
		error,
		canReturn,
		version: app.getVersion(),
	};
	connected = false;
	await win.loadFile(assets("connect.html"));
}

async function loadApp(): Promise<void> {
	if (!win) return;
	const { serverUrl } = loadConfig();
	const check = await reachable(serverUrl);
	if (!check.ok) {
		await showConnectScreen("unreachable", check.error ?? null, false);
		return;
	}
	connected = true;
	await win.loadURL(pendingPath ? `${serverUrl}${pendingPath}` : serverUrl);
	pendingPath = null;
}

// ---------------------------------------------------------------- window

function createWindow(): BrowserWindow {
	const cfg = loadConfig();
	const area = screen.getPrimaryDisplay().workAreaSize;
	const width = Math.min(cfg.bounds.width, area.width);
	const height = Math.min(cfg.bounds.height, area.height);
	const w = new BrowserWindow({
		x: cfg.bounds.x,
		y: cfg.bounds.y,
		width,
		height,
		minWidth: 360,
		minHeight: 520,
		show: false,
		title: "Sekai",
		icon: assets("icon.png"),
		backgroundColor: windowBackground(),
		titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
		autoHideMenuBar: true,
		webPreferences: {
			preload: assets("preload.cjs"),
			contextIsolation: true,
			sandbox: true,
			nodeIntegration: false,
			spellcheck: true,
		},
	});
	if (cfg.bounds.maximized) w.maximize();

	w.once("ready-to-show", () => {
		if (!process.argv.includes("--hidden")) w.show();
	});

	const saveBounds = () => {
		if (w.isDestroyed() || w.isMinimized()) return;
		saveConfig({ bounds: { ...w.getNormalBounds(), maximized: w.isMaximized() } });
	};
	w.on("resize", saveBounds);
	w.on("move", saveBounds);

	w.on("close", (e) => {
		if (!quitting && loadConfig().keepInTray && tray) {
			e.preventDefault();
			w.hide();
		}
	});

	// Links to other sites open in the default browser; the app never navigates away from its server.
	w.webContents.setWindowOpenHandler(({ url }) => {
		if (/^https?:\/\//.test(url)) void shell.openExternal(url);
		return { action: "deny" };
	});
	w.webContents.on("will-navigate", (e, url) => {
		// Same origin exactly (a prefix would let https://sekai.example.com.evil.net through).
		if (sameOrigin(url, loadConfig().serverUrl) || isBundled(url)) return;
		e.preventDefault();
		if (/^https?:\/\//.test(url)) void shell.openExternal(url);
	});
	// Notifications and clipboard; the microphone (calls, dictation, voice messages; never the camera) and full screen
	// (taking over a bot's computer) only for your own Sekai server. Nothing else (geolocation…) is granted.
	w.webContents.session.setPermissionRequestHandler((wc, permission, callback, details) => {
		if (permission === "notifications" || permission === "clipboard-sanitized-write") return callback(true);
		const ours = sameOrigin(wc.getURL(), loadConfig().serverUrl);
		if (permission === "fullscreen") return callback(ours);
		if (permission === "media") {
			const types = (details as { mediaTypes?: string[] }).mediaTypes ?? [];
			return callback(ours && types.length > 0 && types.every((t) => t === "audio"));
		}
		callback(false);
	});
	w.webContents.on("did-fail-load", (_e, code, desc, url) => {
		if (code === -3 || url.startsWith("file://")) return;
		console.warn(`load failed (${code} ${desc}); showing connect screen`);
		void showConnectScreen(
			"unreachable",
			"Couldn't load Sekai from this server. Check your connection and try again.",
			false,
		);
	});
	return w;
}

function showWindow(): void {
	if (!win || win.isDestroyed()) {
		win = createWindow();
		void loadApp();
		return;
	}
	if (win.isMinimized()) win.restore();
	win.show();
	win.focus();
}

function toggleWindow(): void {
	if (win?.isVisible() && win.isFocused()) win.hide();
	else showWindow();
}

// ---------------------------------------------------------------- this computer, lent to bots

let local: LocalComputer | null = null;
let stopShortcut: string | null = null;
const greeted = new Set<string>();

/** The panic button: a global shortcut that works whatever app is in front. */
function registerStopShortcut(): void {
	if (stopShortcut) return;
	// ⌘⌥Esc is macOS's Force Quit and some Linux desktops use Ctrl+Alt+Esc, so there's a fallback.
	const options =
		process.platform === "darwin"
			? [
					["Command+Shift+Escape", "⌘⇧Esc"],
					["Command+Control+Escape", "⌃⌘Esc"],
				]
			: [
					["Control+Alt+Escape", "Ctrl+Alt+Esc"],
					["Control+Alt+Shift+Escape", "Ctrl+Alt+Shift+Esc"],
				];
	for (const [accelerator, label] of options) {
		if (accelerator && globalShortcut.register(accelerator, stopBots)) {
			stopShortcut = label ?? accelerator;
			return;
		}
	}
}

function unregisterStopShortcut(): void {
	if (!stopShortcut) return;
	for (const a of [
		"Command+Shift+Escape",
		"Command+Control+Escape",
		"Control+Alt+Escape",
		"Control+Alt+Shift+Escape",
	]) {
		globalShortcut.unregister(a);
	}
	stopShortcut = null;
}

function refreshTrayTooltip(): void {
	if (!tray) return;
	const active = local?.current.activeAgent;
	if (active) tray.setToolTip(`Sekai — ${active} is using this computer`);
	else if (badgeCount > 0) tray.setToolTip(`Sekai — ${badgeCount} waiting for you`);
	else tray.setToolTip("Sekai");
}

function stopBots(): void {
	if (!local) return;
	local.stopBots();
	hideActivity();
	if (Notification.isSupported()) {
		new Notification({
			title: "Bots stopped",
			body: "Bots stopped working on this computer.",
			icon: assets("icon.png"),
		}).show();
	}
}

function localInfo() {
	const cfg = loadConfig();
	return {
		settings: cfg.localComputer,
		status: local?.current ?? ({ state: "off", message: null, activeAgent: null } satisfies LocalStatus),
		computerName: computerName(),
		platform: process.platform,
		stopShortcut,
		hasToken: Boolean(serverToken()),
	};
}

function onLocalStatus(status: LocalStatus): void {
	for (const w of [win, aboutWin]) if (w && !w.isDestroyed()) w.webContents.send("sekai:local-status", localInfo());
	if (!status.activeAgent) hideActivity();
	refreshTrayTooltip();
	refreshTrayMenu();
}

function onLocalActivity(agent: string): void {
	showActivity(agent, stopShortcut ?? "Sekai tray");
	if (!greeted.has(agent) && Notification.isSupported()) {
		greeted.add(agent);
		new Notification({
			title: `${agent} is using this computer`,
			body: stopShortcut
				? `Press ${stopShortcut} at any time to stop.`
				: "Choose Stop bots now in the Sekai tray menu at any time.",
			icon: assets("icon.png"),
		}).show();
	}
}

async function applyLocal(): Promise<void> {
	const enabled = loadConfig().localComputer.enabled;
	if (enabled) registerStopShortcut();
	else {
		unregisterStopShortcut();
		destroyActivity();
	}
	await local?.apply();
}

function cleanSettings(input: unknown, current: LocalComputerSettings): LocalComputerSettings {
	const p = (input ?? {}) as Partial<Record<keyof LocalComputerSettings, unknown>>;
	return {
		enabled: typeof p.enabled === "boolean" ? p.enabled : current.enabled,
		agentIds: Array.isArray(p.agentIds)
			? [...new Set(p.agentIds.filter((x): x is string => typeof x === "string" && /^[\w-]{1,64}$/.test(x)))]
			: current.agentIds,
		workdir: typeof p.workdir === "string" && p.workdir.trim() ? p.workdir.trim().slice(0, 1000) : current.workdir,
		askEachAction: typeof p.askEachAction === "boolean" ? p.askEachAction : current.askEachAction,
	};
}

/**
 * Anything that gives bots more access here (lending at all, another bot, no per-action approval) is
 * confirmed in a native dialog: the web page can't click it, so a server can't widen access on its own.
 */
async function confirmWider(
	next: LocalComputerSettings,
	current: LocalComputerSettings,
	names: Record<string, string>,
): Promise<boolean> {
	const added = next.agentIds.filter((id) => !current.agentIds.includes(id) || (next.enabled && !current.enabled));
	const wider =
		(next.enabled && !current.enabled) ||
		(next.enabled && added.length > 0) ||
		(current.askEachAction && !next.askEachAction && next.enabled);
	if (!wider) return true;
	const picked = added.map((id) => names[id] ?? "a bot");
	const who = picked.length ? picked.join(", ") : "the bots you pick";
	const parent = win && !win.isDestroyed() ? win : undefined;
	const options = {
		type: "warning" as const,
		buttons: ["Allow", "Cancel"],
		defaultId: 1,
		cancelId: 1,
		noLink: true,
		title: "Lend this computer",
		message: picked.length ? `Let ${who} use ${computerName()}?` : `Lend ${computerName()} to bots?`,
		detail: `${who.charAt(0).toUpperCase()}${who.slice(1)} will be able to see your screen, use the mouse and keyboard, open apps, browse in a separate profile, run commands, and read and write files as ${process.env.USER ?? process.env.USERNAME ?? "you"}.${next.askEachAction ? " You'll approve each action in Sekai." : " Actions follow the bot's approvals rule."}\n\nA badge shows while a bot is working here. Press ${stopShortcut ?? (process.platform === "darwin" ? "⌘⇧Esc" : "Ctrl+Alt+Esc")} at any time to stop.`,
	};
	const r = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
	return r.response === 0;
}

// ---------------------------------------------------------------- tray + menu

function buildTray(): void {
	const image = nativeImage.createFromPath(assets("tray.png")).resize({ width: 18, height: 18 });
	tray = new Tray(image);
	tray.setToolTip("Sekai");
	tray.on("click", toggleWindow);
	refreshTrayMenu();
}

function refreshTrayMenu(): void {
	if (!tray) return;
	const cfg = loadConfig();
	tray.setContextMenu(
		Menu.buildFromTemplate([
			{ label: "Open Sekai", click: showWindow },
			...(() => {
				const u = updateState();
				if (u.state === "ready") return [{ label: `Restart to update (${u.version})`, click: installNow }];
				if (u.state === "downloading")
					return [{ label: `Downloading update (${u.percent}%)…`, enabled: false }];
				return [];
			})(),
			{ label: "Needs you", click: () => navigate("/inbox") },
			{ label: "Activity", click: () => navigate("/activity") },
			{ type: "separator" },
			{
				label: "This computer…",
				click: () => navigate("/settings/this-computer"),
			},
			...(cfg.localComputer.enabled
				? [
						{
							label: `Stop bots now${stopShortcut ? ` (${stopShortcut})` : ""}`,
							click: stopBots,
						},
						{
							label: "Turn off lending",
							click: () => {
								saveConfig({ localComputer: { ...loadConfig().localComputer, enabled: false } });
								void applyLocal();
							},
						},
					]
				: []),
			{ type: "separator" },
			{ label: "Change server…", click: openConnect },
			{
				label: "Keep running in tray",
				type: "checkbox",
				checked: cfg.keepInTray,
				click: (item) => saveConfig({ keepInTray: item.checked }),
			},
			{
				label: "Open at login",
				type: "checkbox",
				checked: cfg.launchAtLogin,
				click: (item) => {
					saveConfig({ launchAtLogin: item.checked });
					app.setLoginItemSettings({ openAtLogin: item.checked, args: ["--hidden"] });
				},
			},
			{ type: "separator" },
			{ label: "About Sekai", click: openAbout },
			{
				label: "Quit Sekai",
				click: () => {
					quitting = true;
					app.quit();
				},
			},
		]),
	);
}

function buildAppMenu(): void {
	const template: MenuItemConstructorOptions[] = [
		...(process.platform === "darwin"
			? [
					{
						label: app.name,
						submenu: [
							{ label: "About Sekai", click: openAbout },
							{ type: "separator" as const },
							{ label: "Change server…", click: openConnect },
							{ label: "Check for updates", click: () => checkNow(() => loadConfig().serverUrl) },
							{ type: "separator" as const },
							{ role: "services" as const },
							{ type: "separator" as const },
							{ role: "hide" as const },
							{ role: "hideOthers" as const },
							{ role: "unhide" as const },
							{ type: "separator" as const },
							{ role: "quit" as const },
						],
					},
				]
			: []),
		{ role: "fileMenu" },
		{ role: "editMenu" },
		{
			label: "View",
			submenu: [
				{ role: "reload" },
				{ role: "forceReload" },
				...(DEV ? [{ role: "toggleDevTools" as const }] : []),
				{ type: "separator" },
				{ role: "resetZoom" },
				{ role: "zoomIn" },
				{ role: "zoomOut" },
				{ type: "separator" },
				{ role: "togglefullscreen" },
			],
		},
		{ role: "windowMenu" },
		// On macOS these live in the app menu above.
		...(process.platform === "darwin"
			? []
			: [
					{
						role: "help" as const,
						submenu: [
							{ label: "Check for updates", click: () => checkNow(() => loadConfig().serverUrl) },
							{ label: "Change server…", click: openConnect },
							{ type: "separator" as const },
							{ label: "About Sekai", click: openAbout },
						],
					},
				]),
	];
	Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function openConnect(): void {
	const wasConnected = connected;
	showWindow();
	void showConnectScreen("change", null, wasConnected);
}

function openAbout(): void {
	if (aboutWin && !aboutWin.isDestroyed()) {
		aboutWin.show();
		aboutWin.focus();
		return;
	}
	// A hidden parent (the app kept in the tray) would hide its child too on some systems.
	const parent = win && !win.isDestroyed() && win.isVisible() ? win : undefined;
	aboutWin = new BrowserWindow({
		width: 380,
		height: 430,
		// The page's size, not counting a title bar, which would otherwise squeeze it on Windows and Linux.
		useContentSize: true,
		resizable: false,
		minimizable: false,
		maximizable: false,
		parent,
		show: false,
		title: "About Sekai",
		icon: assets("icon.png"),
		backgroundColor: windowBackground(),
		autoHideMenuBar: true,
		webPreferences: {
			preload: assets("preload.cjs"),
			contextIsolation: true,
			sandbox: true,
			nodeIntegration: false,
		},
	});
	aboutWin.removeMenu();
	// It shows one bundled page and never goes anywhere else.
	aboutWin.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
	aboutWin.webContents.on("will-navigate", (e) => e.preventDefault());
	aboutWin.once("ready-to-show", () => aboutWin?.show());
	aboutWin.on("closed", () => {
		aboutWin = null;
	});
	void aboutWin.loadFile(assets("about.html"));
}

// ---------------------------------------------------------------- IPC

ipcMain.on("sekai:server-url-sync", (e) => {
	e.returnValue = loadConfig().serverUrl;
});
ipcMain.on("sekai:version-sync", (e) => {
	e.returnValue = app.getVersion();
});

ipcMain.on("sekai:notify", (_e, msg: { title: string; body: string; conversationId: string | null }) => {
	if (!Notification.isSupported()) return;
	const n = new Notification({
		title: msg.title.slice(0, 120),
		body: msg.body.slice(0, 400),
		icon: assets("icon.png"),
		silent: false,
	});
	n.on("click", () => navigate(msg.conversationId ? `/c/${msg.conversationId}` : "/"));
	n.show();
});

ipcMain.on("sekai:badge", (_e, count: number) => {
	badgeCount = Math.max(0, Math.floor(count));
	app.setBadgeCount(badgeCount);
	refreshTrayTooltip();
});

ipcMain.on("sekai:open-connect", openConnect);

ipcMain.handle("sekai:local-get", () => localInfo());

ipcMain.handle("sekai:local-set", async (_e, patch: unknown, token: unknown, names: unknown) => {
	const current = loadConfig().localComputer;
	const next = cleanSettings(patch, current);
	const labels = names && typeof names === "object" ? (names as Record<string, string>) : {};
	if (!(await confirmWider(next, current, labels))) return { ...localInfo(), cancelled: true };
	if (typeof token === "string" || token === null) saveServerToken(token);
	saveConfig({ localComputer: next });
	await applyLocal();
	return localInfo();
});

const isBundledPage = (e: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) => isBundled(e.senderFrame?.url);

ipcMain.handle("sekai:connect-context", (e) => {
	if (!isBundledPage(e)) return null;
	return connectContext;
});

ipcMain.on("sekai:connect-cancel", (e) => {
	if (!isBundledPage(e) || !connectContext.canReturn) return;
	const { serverUrl } = loadConfig();
	connected = true;
	void win?.loadURL(serverUrl);
});

ipcMain.handle("sekai:connect", async (e, input: string) => {
	// Only from the bundled connect screen.
	if (!isBundledPage(e)) return { ok: false, error: "This action isn't allowed from here." };
	const origin = normalizeServerUrl(input);
	if (!origin) return { ok: false, error: "Enter a valid server address, like https://sekai.example.com." };
	const check = await reachable(origin);
	if (!check.ok) return check;
	const before = loadConfig().serverUrl;
	if (!sameOrigin(origin, before)) {
		// Another server: lending stops and the old server's token is forgotten before anything connects there
		// (the bots lent this computer, and the token, belong to the old server).
		local?.stop();
		saveServerToken(null);
		saveConfig({ localComputer: { ...loadConfig().localComputer, enabled: false, agentIds: [] } });
	}
	saveConfig({ serverUrl: origin });
	// The preload snapshot of serverUrl is per page load, so reload with the new origin.
	connected = true;
	await win?.loadURL(origin);
	if (local) void applyLocal();
	return { ok: true };
});

ipcMain.handle("sekai:about-info", (e) => {
	if (!isBundledPage(e)) return null;
	return {
		version: app.getVersion(),
		serverUrl: loadConfig().serverUrl,
		packaged: app.isPackaged,
		update: updateState(),
		local: localInfo(),
	};
});

ipcMain.handle("sekai:about-check-updates", (e) => {
	if (!isBundledPage(e)) return;
	checkNow(() => loadConfig().serverUrl);
});

ipcMain.on("sekai:about-install-update", (e) => {
	if (!isBundledPage(e)) return;
	installNow();
});

ipcMain.on("sekai:about-change-server", (e) => {
	if (!isBundledPage(e)) return;
	aboutWin?.close();
	openConnect();
});

ipcMain.on("sekai:about-open-local", (e) => {
	if (!isBundledPage(e)) return;
	aboutWin?.close();
	navigate("/settings/this-computer");
});

ipcMain.on("sekai:about-close", (e) => {
	if (!isBundledPage(e)) return;
	aboutWin?.close();
});

// ---------------------------------------------------------------- lifecycle

app.setAppUserModelId("sh.qwq.sekai");

app.whenReady().then(async () => {
	buildAppMenu();
	if (!SCREENSHOT) buildTray();
	win = createWindow();
	await loadApp();

	const initialLink = process.argv.find((a) => a.startsWith(`${PROTOCOL}://`));
	const initialPath = initialLink ? pathFromDeepLink(initialLink) : null;
	if (initialPath) navigate(initialPath);

	globalShortcut.register("CommandOrControl+Shift+Space", toggleWindow);

	local = new LocalComputer({
		serverUrl: () => loadConfig().serverUrl,
		token: serverToken,
		deviceId: () => loadConfig().deviceId,
		settings: () => loadConfig().localComputer,
		saveSettings: (next) => {
			saveConfig({ localComputer: next });
			onLocalStatus(local?.current ?? { state: "off", message: null, activeAgent: null });
		},
		onStatus: onLocalStatus,
		onActivity: onLocalActivity,
	});
	await applyLocal();
	await startUpdates(() => loadConfig().serverUrl);
	// Only the menu changes (download progress fires many times a second; a new Tray each time would stack icons).
	onUpdateState((state) => {
		refreshTrayMenu();
		if (aboutWin && !aboutWin.isDestroyed()) aboutWin.webContents.send("sekai:update-state", state);
	});
	nativeTheme.on("updated", () => {
		const bg = windowBackground();
		if (win && !win.isDestroyed()) win.setBackgroundColor(bg);
		if (aboutWin && !aboutWin.isDestroyed()) aboutWin.setBackgroundColor(bg);
	});

	// Test hook: SEKAI_DESKTOP_SCREENSHOT=out.png captures the window once loaded, then quits.
	if (SCREENSHOT && win) {
		const target = win;
		setTimeout(async () => {
			const image = await target.webContents.capturePage();
			const { writeFileSync } = await import("node:fs");
			writeFileSync(SCREENSHOT, image.toPNG());
			console.info(`screenshot saved to ${SCREENSHOT} (connected: ${connected})`);
			quitting = true;
			app.quit();
		}, 4000);
	}
});

app.on("activate", showWindow);
app.on("before-quit", () => {
	quitting = true;
});
app.on("will-quit", () => {
	globalShortcut.unregisterAll();
	local?.stop();
});
app.on("window-all-closed", () => {
	if (process.platform !== "darwin" && !tray) app.quit();
});
