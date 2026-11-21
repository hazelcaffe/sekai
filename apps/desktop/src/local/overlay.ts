import { readFileSync } from "node:fs";
import { join } from "node:path";
import { app, BrowserWindow, nativeTheme, screen } from "electron";

/**
 * While a bot works on this computer, a small badge in the corner says so and how to stop it. It never
 * takes focus or clicks, and (on Windows and macOS) it's left out of screenshots, so the bot doesn't see it.
 */

const WIDTH = 388;
const HEIGHT = 48;
/** Transparent room around the badge so its shadow isn't cut off at the window's edge. */
const MARGIN = 12;
const HIDE_AFTER_MS = 8_000;

let win: BrowserWindow | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let lastPayload: { agent: string; shortcut: string } | null = null;
let cachedTokens: string | null = null;

function loadTokensCss(): string {
	if (cachedTokens !== null) return cachedTokens;
	try {
		cachedTokens = readFileSync(join(app.getAppPath(), "dist", "tokens.css"), "utf8");
	} catch {
		cachedTokens = "";
	}
	return cachedTokens;
}

/** Pure HTML generator (exported for testing and screenshot checks). */
export function renderOverlayHtml(agent: string, shortcut: string, tokensCss: string, dark: boolean): string {
	const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
	return `<!doctype html>
<html lang="en" class="${dark ? "dark" : "light"}">
<head>
<meta charset="utf-8">
<style>
${tokensCss}
html, body {
	margin: 0;
	background: transparent;
	overflow: hidden;
}
body {
	padding: ${MARGIN}px;
	font-family: var(--type-font);
	font-size: var(--type-small);
	line-height: var(--type-small-lh);
	-webkit-font-smoothing: antialiased;
}
.badge {
	box-sizing: border-box;
	height: ${HEIGHT}px;
	margin: 0;
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 0 14px;
	border-radius: var(--radius-lg);
	border: 1px solid var(--border);
	background: var(--surface-raised);
	color: var(--fg);
	box-shadow: var(--shadow-pop);
}
.dot-wrap {
	position: relative;
	width: 8px;
	height: 8px;
	flex-shrink: 0;
}
.dot-ring {
	position: absolute;
	inset: 0;
	border-radius: 9999px;
	background: var(--brand);
	animation: pulse 2.4s ease-out infinite;
}
.dot-core {
	position: relative;
	display: block;
	width: 8px;
	height: 8px;
	border-radius: 9999px;
	background: var(--brand);
}
@keyframes pulse {
	0% { transform: scale(1); opacity: 0.55; }
	70%, 100% { transform: scale(2.4); opacity: 0; }
}
.label {
	flex: 1;
	min-width: 0;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	color: var(--fg-muted);
}
.label strong {
	font-weight: 600;
	color: var(--fg);
}
.kbd {
	display: inline-flex;
	align-items: center;
	height: 22px;
	padding: 0 7px;
	border-radius: var(--radius-sm);
	border: 1px solid var(--border);
	background: var(--surface-2);
	color: var(--fg-muted);
	font-size: var(--type-caption);
	line-height: var(--type-caption-lh);
	font-weight: 500;
	white-space: nowrap;
	flex-shrink: 0;
}
</style>
</head>
<body>
	<div class="badge" role="status">
		<span class="dot-wrap" aria-hidden="true"><span class="dot-ring"></span><span class="dot-core"></span></span>
		<span class="label"><strong>${esc(agent)}</strong> is using this computer</span>
		<span class="kbd">${esc(shortcut)} to stop</span>
	</div>
</body>
</html>`;
}

function place(w: BrowserWindow): void {
	const area = screen.getPrimaryDisplay().workArea;
	w.setBounds({
		x: area.x + area.width - WIDTH - 16 - MARGIN,
		y: area.y + area.height - HEIGHT - 16 - MARGIN,
		width: WIDTH + 2 * MARGIN,
		height: HEIGHT + 2 * MARGIN,
	});
}

function loadOverlay(w: BrowserWindow, agent: string, shortcut: string): void {
	const dark = nativeTheme.shouldUseDarkColors;
	const key = `${agent}|${shortcut}|${dark ? "d" : "l"}`;
	if (w.webContents.getURL() === "" || (w as BrowserWindow & { sekaiKey?: string }).sekaiKey !== key) {
		(w as BrowserWindow & { sekaiKey?: string }).sekaiKey = key;
		const doc = renderOverlayHtml(agent, shortcut, loadTokensCss(), dark);
		void w.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(doc)}`);
	}
}

nativeTheme.on("updated", () => {
	if (win && !win.isDestroyed() && lastPayload) {
		loadOverlay(win, lastPayload.agent, lastPayload.shortcut);
	}
});

export function showActivity(agent: string, shortcut: string): void {
	lastPayload = { agent, shortcut };
	if (!win || win.isDestroyed()) {
		win = new BrowserWindow({
			width: WIDTH + 2 * MARGIN,
			height: HEIGHT + 2 * MARGIN,
			frame: false,
			transparent: true,
			resizable: false,
			movable: false,
			focusable: false,
			skipTaskbar: true,
			alwaysOnTop: true,
			hasShadow: false,
			show: false,
			webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
		});
		win.setAlwaysOnTop(true, "screen-saver");
		win.setIgnoreMouseEvents(true);
		win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
		win.setContentProtection(true);
	}
	loadOverlay(win, agent, shortcut);
	place(win);
	if (!win.isVisible()) win.showInactive();
	if (hideTimer) clearTimeout(hideTimer);
	hideTimer = setTimeout(hideActivity, HIDE_AFTER_MS);
}

export function hideActivity(): void {
	if (hideTimer) clearTimeout(hideTimer);
	hideTimer = null;
	if (win && !win.isDestroyed()) win.hide();
}

export function destroyActivity(): void {
	hideActivity();
	lastPayload = null;
	if (win && !win.isDestroyed()) win.destroy();
	win = null;
}
