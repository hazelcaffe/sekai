import { BrowserWindow, screen } from "electron";

/**
 * While a bot works on this computer, a small badge in the corner says so and how to stop it. It never
 * takes focus or clicks, and (on Windows and macOS) it's left out of screenshots, so the bot doesn't see it.
 */

const WIDTH = 380;
const HEIGHT = 46;
const HIDE_AFTER_MS = 8_000;

let win: BrowserWindow | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;

function html(agent: string, shortcut: string): string {
	const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
	return `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;background:transparent;overflow:hidden;font:13px/1.3 system-ui,-apple-system,"Segoe UI",sans-serif}
.b{box-sizing:border-box;height:${HEIGHT}px;margin:0;display:flex;align-items:center;gap:10px;padding:0 14px;border-radius:14px;
background:rgba(20,20,24,.88);color:#fff;box-shadow:0 6px 24px rgba(0,0,0,.25)}
.d{width:9px;height:9px;border-radius:50%;background:#a78bfa;animation:p 1.4s ease-in-out infinite}
@keyframes p{50%{opacity:.35}}
.t{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.k{opacity:.7;font-size:11px;white-space:nowrap}
</style><div class="b"><span class="d"></span><span class="t"><b>${esc(agent)}</b> is using this computer</span><span class="k">${esc(shortcut)} stops</span></div>`;
}

function place(w: BrowserWindow): void {
	const area = screen.getPrimaryDisplay().workArea;
	w.setBounds({
		x: area.x + area.width - WIDTH - 16,
		y: area.y + area.height - HEIGHT - 16,
		width: WIDTH,
		height: HEIGHT,
	});
}

export function showActivity(agent: string, shortcut: string): void {
	if (!win || win.isDestroyed()) {
		win = new BrowserWindow({
			width: WIDTH,
			height: HEIGHT,
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
	const w = win;
	const key = `${agent}|${shortcut}`;
	if (w.webContents.getURL() === "" || (w as BrowserWindow & { sekaiKey?: string }).sekaiKey !== key) {
		(w as BrowserWindow & { sekaiKey?: string }).sekaiKey = key;
		void w.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html(agent, shortcut))}`);
	}
	place(w);
	if (!w.isVisible()) w.showInactive();
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
	if (win && !win.isDestroyed()) win.destroy();
	win = null;
}
