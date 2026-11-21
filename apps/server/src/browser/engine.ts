import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Machine } from "@sekai/shared";
import { type Browser, type BrowserContext, chromium, type Dialog, type Page } from "playwright-core";
import { actorFor, currentActor } from "../auth/actor.ts";
import { config } from "../config.ts";
import { agentOwner } from "../events/scope.ts";
import { errorMessage } from "../lib/errors.ts";
import { log } from "../lib/log.ts";
import { cachedReach } from "../lib/net.ts";
import { driverFor, hasDesktop, pickMachine } from "../machines/drivers.ts";
import { type BotMachine, machinesForBot } from "../machines/seats.ts";
import type { Tunnel } from "../machines/ssh.ts";
import { agentEnv } from "../providers/process.ts";
import { browsersForBot, type UsableBrowser } from "./shared.ts";
import { xvfbDisplay } from "./xvfb.ts";

/**
 * Each bot's browser. With a running computer it's Chrome on that computer (you can watch over VNC and take
 * over); otherwise a headless Chromium on the server with the bot's own profile, so sign-ins stick. When
 * you lend the bot your computer, it can also use a browser there (a separate Sekai profile in your Chrome
 * or Edge, opened by the desktop app), on: "device". On another bot's computer shared with it, its own Chrome
 * there (its own account, screen and profile).
 * Shared browsers (see shared.ts) are sessions of their own, per bot and browser: with shared sign-ins every bot
 * gets its own tab of one profile, with separate sign-ins its own profile. A bot's tools act on the browser it
 * used last; `on` picks another.
 * Pages are read as accessibility snapshots with element refs ([ref=e12]) that tools act on, the way the
 * Playwright MCP server does: reliable on complex web apps, no guessing at pixels.
 */

export type BrowserWhere = "computer" | "device" | "server" | "shared";

export interface BrowserSession {
	agentId: string;
	where: BrowserWhere;
	/** The machine the browser runs on (null: the server). */
	machineId: string | null;
	/** The shared browser it is (null: the bot's own browser). */
	sharedId: string | null;
	/** Shown to the bot: "your computer", "the user's computer (Sam's MacBook)", "the server". */
	label: string;
	context: BrowserContext;
	browser: Browser | null;
	tunnel: Tunnel | null;
	page: Page;
	/** In a browser whose profile other bots use too: this bot's own tabs. null: every tab is the bot's. */
	tabs: Set<Page> | null;
	/** A dialog (alert, confirm, prompt) waiting for the bot to answer. */
	dialog: Dialog | null;
	consoleErrors: string[];
	lastUsed: number;
}

/** One browser that several bots' sessions use (a shared browser with shared sign-ins). */
interface Host {
	id: string;
	context: BrowserContext;
	browser: Browser | null;
	tunnel: Tunnel | null;
	users: Set<string>;
}

/** Sessions by key: the bot's own browser under its id, a shared browser under "<bot>|<browser>". */
const sessions = new Map<string, BrowserSession>();
const hosts = new Map<string, Host>();
const opening = new Map<string, Promise<unknown>>();
/** The session each bot used last (its tools act there unless they say otherwise). */
const current = new Map<string, string>();
const IDLE_MS = 20 * 60_000;
export const SNAPSHOT_LIMIT = 24_000;

const sharedKey = (agentId: string, browserId: string) => `${agentId}|${browserId}`;

/**
 * A browser the server can run. A real, installed Chrome/Chromium comes first: it reports itself
 * like a person's browser (its own client hints), where the Chromium Playwright downloads don't.
 * SEKAI_BROWSER_PATH wins when set.
 */
export function serverBrowserPath(): string | null {
	const env = process.env.SEKAI_BROWSER_PATH;
	if (env && existsSync(env)) return env;
	for (const p of [
		"/opt/google/chrome/chrome",
		"/usr/bin/google-chrome",
		"/usr/bin/google-chrome-stable",
		"/usr/bin/chromium",
		"/usr/bin/chromium-browser",
		"/snap/bin/chromium",
	]) {
		if (existsSync(p)) return p;
	}
	const cache = join(homedir(), ".cache", "ms-playwright");
	if (existsSync(cache)) {
		const dirs = readdirSync(cache)
			.filter((d) => /^chromium-\d+$/.test(d))
			.sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
		for (const d of dirs) {
			for (const sub of [
				"chrome-linux64/chrome",
				"chrome-linux/chrome",
				"chrome-mac/Chromium.app/Contents/MacOS/Chromium",
			]) {
				const p = join(cache, d, sub);
				if (existsSync(p)) return p;
			}
		}
	}
	return null;
}

/** Hides the switch that tells sites a browser is automated, when we can (Linux: bubblewrap). */
function sandboxedPath(real: string): string {
	if (process.platform !== "linux" || Bun.which("bwrap") === null) return real;
	const wrapper = join(import.meta.dir, "bin", "chromium-sandboxed.sh");
	return existsSync(wrapper) ? wrapper : real;
}

/** The bot's tabs in this session. */
export function tabsOf(s: BrowserSession): Page[] {
	return s.tabs ? [...s.tabs].filter((p) => !p.isClosed()) : s.context.pages();
}

function watch(s: BrowserSession, page: Page): void {
	page.on("dialog", (d) => {
		s.dialog = d;
	});
	page.on("console", (m) => {
		if (m.type() === "error") s.consoleErrors = [...s.consoleErrors, m.text().slice(0, 300)].slice(-10);
	});
	page.on("close", () => {
		s.tabs?.delete(page);
		if (s.page === page) s.page = tabsOf(s).at(-1) ?? s.page;
	});
	// In a shared profile only the bot's own pages' popups are its own.
	if (s.tabs) {
		page.on("popup", (p) => {
			s.tabs?.add(p);
			watch(s, p);
			s.page = p;
		});
	}
}

/** Opens a new tab for the bot and makes it the current one. */
export async function newTab(s: BrowserSession): Promise<Page> {
	const page = await s.context.newPage();
	if (s.tabs) {
		s.tabs.add(page);
		watch(s, page);
	}
	s.page = page;
	return page;
}

interface Target {
	where: "computer" | "device" | "server";
	machine: BotMachine | null;
}

function labelOf(t: Target): string {
	if (t.where === "server") return "a browser on the Sekai server";
	if (t.where === "device") return `a browser on the user's computer (${t.machine?.name ?? "their computer"})`;
	if (t.machine?.seat) {
		return `Chrome on ${t.machine.name} (${t.machine.seat.ownerBot}'s computer, shared with you: your own account, screen and profile there)`;
	}
	return "Chrome on your computer";
}

/** Whether this run is for someone other than the bot's owner (then only what's shared counts). */
async function foreignRun(agentId: string): Promise<boolean> {
	const actor = currentActor();
	if (!actor) return false;
	return (await agentOwner(agentId)) !== actor.userId;
}

class NoBrowser extends Error {}

/**
 * Where the bot's own browser should run. on: "computer", "device" (your computer), "server", or a machine name.
 * Without it: wherever it already runs, else the bot's computer if it's running (its own, else a shared one it
 * has a seat on), else the server. For someone it's shared with, the server's browser (its owner's sign-ins) is
 * out.
 */
async function targetFor(
	agentId: string,
	on: string | undefined,
	existing: BrowserSession | null,
	foreign: boolean,
): Promise<Target> {
	const all = await machinesForBot(agentId);
	const r = on?.trim().toLowerCase();
	if (r === "server") {
		if (foreign) throw new Error("Your own browser on the server isn't for this chat");
		return { where: "server", machine: null };
	}
	if (r) {
		const m = pickMachine(all, on);
		if (!m) throw new Error(`There's no computer or shared browser called "${on}" for this bot`);
		if (m.kind === "devbox") throw new Error(`${m.name} is a devbox: it has no screen or browser`);
		if (!hasDesktop(m)) {
			throw new Error(
				m.kind === "device"
					? `${m.name} is offline: the Sekai desktop app isn't connected there`
					: `${m.name} isn't ${m.status === "running" ? "ready" : "running"}${m.statusDetail ? ` (${m.statusDetail})` : ""}`,
			);
		}
		return { where: m.kind === "device" ? "device" : "computer", machine: m };
	}
	const computer = all.find((m) => m.kind === "computer" && hasDesktop(m)) ?? null;
	if (existing) {
		const still = existing.machineId ? all.find((m) => m.id === existing.machineId) : null;
		// A bot that got a computer since moves its browser there; otherwise it stays where it is.
		if (existing.where === "server" && !computer && !foreign) return { where: "server", machine: null };
		if (still && hasDesktop(still))
			return { where: existing.where === "device" ? "device" : "computer", machine: still };
	}
	if (computer) return { where: "computer", machine: computer };
	if (foreign) throw new NoBrowser("There's no browser you can use in this chat");
	if (!serverBrowserPath()) {
		throw new NoBrowser(
			"There's no browser on the server. Install Chrome or Chromium there (or set SEKAI_BROWSER_PATH), or give the bot a computer.",
		);
	}
	return { where: "server", machine: null };
}

async function isAdmin(userId: string | null): Promise<boolean> {
	return userId ? (await actorFor(userId).catch(() => null))?.admin === true : false;
}

/**
 * A browser on the server with its profile in `profile`. Its owner isn't an admin: only the internet (not this
 * server, its network or tailnet: your router, Proxmox, Sekai itself…).
 */
async function serverContext(profile: string, ownerId: string | null): Promise<BrowserContext> {
	const real = serverBrowserPath();
	if (!real) {
		throw new Error(
			"There's no browser on the server. Install Chrome or Chromium there (or set SEKAI_BROWSER_PATH), or give the bot a computer.",
		);
	}
	mkdirSync(profile, { recursive: true });
	// A real window on the server's virtual display reads as a person's browser; only fall back to
	// headless when there's no display. Automation tells are stripped (see chromium-sandboxed.sh).
	const display = await xvfbDisplay();
	const context = await chromium.launchPersistentContext(profile, {
		executablePath: sandboxedPath(real),
		// Without Sekai's own secrets (a page that escaped the sandbox mustn't find them in the environment).
		env: {
			...agentEnv({}),
			SEKAI_CHROME_REAL: real,
			...(display ? { DISPLAY: display } : {}),
		},
		headless: !display,
		timeout: 45_000,
		viewport: { width: 1280, height: 860 },
		args: [
			"--no-first-run",
			"--no-default-browser-check",
			"--disable-dev-shm-usage",
			"--disable-blink-features=AutomationControlled",
			"--disable-infobars",
		],
	});
	if (!(await isAdmin(ownerId))) {
		await context
			.route("**/*", async (route) => {
				const url = new URL(route.request().url());
				if ((url.protocol === "http:" || url.protocol === "https:") && (await cachedReach(url)) !== "public") {
					return route.abort("blockedbyclient");
				}
				return route.continue();
			})
			.catch(() => {});
	}
	// Some sites still check navigator.webdriver; the wrapper hides most of it, this the rest.
	await context
		.addInitScript(() => {
			Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false });
		})
		.catch(() => {});
	return context;
}

/** Chrome on a computer, started by the desktop helper as `agentId` there, reached through that seat's tunnel. */
async function computerBrowser(
	m: Machine,
	agentId: string,
	port: number | undefined,
	profile?: string,
): Promise<{ context: BrowserContext; browser: Browser; tunnel: Tunnel }> {
	const driver = await driverFor(m, agentId);
	const remote = await (await driver.desktop()).browser(port, profile);
	const tunnel = await driver.tunnel(remote);
	try {
		const browser = await chromium.connectOverCDP(`http://127.0.0.1:${tunnel.localPort}`, { timeout: 30_000 });
		return { context: browser.contexts()[0] ?? (await browser.newContext()), browser, tunnel };
	} catch (err) {
		tunnel.close();
		throw err;
	}
}

function session(
	agentId: string,
	fields: Pick<
		BrowserSession,
		"where" | "machineId" | "sharedId" | "label" | "context" | "browser" | "tunnel" | "tabs"
	>,
	page: Page,
): BrowserSession {
	const s: BrowserSession = { agentId, ...fields, page, dialog: null, consoleErrors: [], lastUsed: Date.now() };
	for (const p of tabsOf(s)) watch(s, p);
	if (!s.tabs) {
		// Links that open a new tab or popup: follow them.
		s.context.on("page", (p) => {
			watch(s, p);
			s.page = p;
		});
	}
	return s;
}

/** The bot's own browser: on the server, its computer (or its seat on a shared one), or your computer. */
async function openOwn(agentId: string, target: Target): Promise<BrowserSession> {
	let context: BrowserContext;
	let browser: Browser | null = null;
	let tunnel: Tunnel | null = null;
	if (target.machine) {
		const port = target.machine.seat ? target.machine.seat.cdpPort : undefined;
		({ context, browser, tunnel } = await computerBrowser(target.machine, agentId, port));
	} else {
		context = await serverContext(join(config.dataDir, "browser", agentId), await agentOwner(agentId));
	}
	const page = context.pages().at(-1) ?? (await context.newPage());
	const s = session(
		agentId,
		{
			where: target.where,
			machineId: target.machine?.id ?? null,
			sharedId: null,
			label: labelOf(target),
			context,
			browser,
			tunnel,
			tabs: null,
		},
		page,
	);
	const drop = () => {
		if (sessions.get(agentId) === s) sessions.delete(agentId);
		tunnel?.close();
	};
	browser?.on("disconnected", drop);
	context.on("close", drop);
	sessions.set(agentId, s);
	log.info(`browser for ${agentId} opened (${target.where})`);
	return s;
}

function sharedLabel(b: UsableBrowser): string {
	const where = b.machine ? `on ${b.machine.name}` : "on the Sekai server";
	const signIns =
		b.signIns === "shared"
			? `sign-ins shared with ${b.others.length ? b.others.join(", ") : "its other bots"}: what you sign in to, they're signed in to too; you work in your own tabs`
			: "your own sign-ins in it";
	return `the shared browser "${b.name}" (${where}; ${signIns})`;
}

/** The one browser a shared browser with shared sign-ins runs as, opened by its first bot. */
async function openHost(b: UsableBrowser): Promise<Host> {
	const known = hosts.get(b.id);
	if (known) return known;
	let host: Host;
	if (b.machine) {
		if (!hasDesktop(b.machine)) throw new Error(`${b.machine.name} isn't running`);
		const { context, browser, tunnel } = await computerBrowser(
			b.machine,
			b.machine.agentId,
			b.port ?? undefined,
			`~/.config/sekai-shared/${b.id}`,
		);
		host = { id: b.id, context, browser, tunnel, users: new Set() };
	} else {
		const context = await serverContext(join(config.dataDir, "browser", "shared", b.id), b.ownerId);
		host = { id: b.id, context, browser: null, tunnel: null, users: new Set() };
	}
	const drop = () => {
		if (hosts.get(b.id) !== host) return;
		hosts.delete(b.id);
		host.tunnel?.close();
		for (const [key, s] of sessions) if (s.sharedId === b.id && s.context === host.context) sessions.delete(key);
	};
	host.browser?.on("disconnected", drop);
	host.context.on("close", drop);
	hosts.set(b.id, host);
	log.info(`shared browser ${b.id} opened (${b.machine ? "computer" : "server"})`);
	return host;
}

async function closeHost(host: Host): Promise<void> {
	if (hosts.get(host.id) === host) hosts.delete(host.id);
	try {
		// On a computer, leave Chrome running (someone may be looking at it); just disconnect.
		if (host.browser) await host.browser.close();
		else await host.context.close();
	} catch (err) {
		log.warn(`closing a shared browser: ${errorMessage(err)}`);
	}
	host.tunnel?.close();
}

/** A bot's session in a shared browser: its own tab in the shared profile, or its own profile in it. */
async function openShared(agentId: string, b: UsableBrowser): Promise<BrowserSession> {
	const where = { where: "shared" as const, machineId: b.machine?.id ?? null, sharedId: b.id, label: sharedLabel(b) };
	let s: BrowserSession;
	if (b.signIns === "shared") {
		const host = await openHost(b);
		const page = await host.context.newPage();
		host.users.add(agentId);
		s = session(
			agentId,
			{ ...where, context: host.context, browser: null, tunnel: null, tabs: new Set([page]) },
			page,
		);
	} else {
		let context: BrowserContext;
		let browser: Browser | null = null;
		let tunnel: Tunnel | null = null;
		if (b.machine) {
			if (!hasDesktop(b.machine)) throw new Error(`${b.machine.name} isn't running`);
			({ context, browser, tunnel } = await computerBrowser(
				b.machine,
				b.machine.agentId,
				b.port ?? undefined,
				`~/.config/sekai-shared/${b.id}/${agentId}`,
			));
		} else {
			context = await serverContext(join(config.dataDir, "browser", "shared", b.id, agentId), b.ownerId);
		}
		const page = context.pages().at(-1) ?? (await context.newPage());
		s = session(agentId, { ...where, context, browser, tunnel, tabs: null }, page);
		const key = sharedKey(agentId, b.id);
		const drop = () => {
			if (sessions.get(key) === s) sessions.delete(key);
			tunnel?.close();
		};
		browser?.on("disconnected", drop);
		context.on("close", drop);
	}
	sessions.set(sharedKey(agentId, b.id), s);
	log.info(`shared browser ${b.id} opened for ${agentId}`);
	return s;
}

/** Runs one open at a time per bot. */
function serial<T>(agentId: string, fn: () => Promise<T>): Promise<T> {
	const run = (opening.get(agentId) ?? Promise.resolve()).catch(() => {}).then(fn);
	opening.set(
		agentId,
		run.catch(() => {}),
	);
	return run;
}

/**
 * The bot's browser, opened (or reconnected, or moved to where `on` says) on first use. on: a shared browser by
 * name, "server", "computer", "device" or a machine. Without it: the browser it used last (if it still may), or
 * with `open` (opening a page) its own browser, as before shared browsers. own: only its own browser (its accounts'
 * sign-ins never go into a shared one).
 */
export function browserFor(
	agentId: string,
	on?: string,
	opts: { own?: boolean; open?: boolean } = {},
): Promise<BrowserSession> {
	const actor = currentActor();
	return serial(agentId, async () => {
		const foreign = await foreignRun(agentId);
		const shared = opts.own ? [] : await browsersForBot(agentId, actor);
		const r = on?.trim().toLowerCase();
		let pick: UsableBrowser | null = null;
		if (r) pick = shared.find((b) => b.id === on || b.name.trim().toLowerCase() === r) ?? null;
		else if (!opts.open) {
			const last = current.get(agentId);
			pick = shared.find((b) => sharedKey(agentId, b.id) === last) ?? null;
		}
		if (!pick) {
			const existing = sessions.get(agentId) ?? null;
			try {
				const target = await targetFor(agentId, on, existing, foreign);
				if (
					existing &&
					existing.where === target.where &&
					existing.machineId === (target.machine?.id ?? null) &&
					!existing.page.isClosed()
				) {
					existing.lastUsed = Date.now();
					current.set(agentId, agentId);
					return existing;
				}
				if (existing) await closeSession(agentId);
				const s = await openOwn(agentId, target);
				current.set(agentId, agentId);
				return s;
			} catch (err) {
				// Nothing of its own to browse with here: the one shared browser it has, if just one.
				if (!(err instanceof NoBrowser)) throw err;
				if (shared.length === 1) pick = shared[0] ?? null;
				else if (shared.length > 1) {
					throw new Error(`Say which browser with on: ${shared.map((b) => `"${b.name}"`).join(", ")}`);
				} else throw err;
			}
		}
		if (!pick) throw new Error("There's no browser you can use in this chat");
		const key = sharedKey(agentId, pick.id);
		const existing = sessions.get(key);
		if (existing && !existing.page.isClosed()) {
			existing.lastUsed = Date.now();
			current.set(agentId, key);
			return existing;
		}
		if (existing) await closeSession(key);
		const s = await openShared(agentId, pick);
		current.set(agentId, key);
		return s;
	});
}

/** Where the bot's browser runs right now, if it's open. */
export function browserWhere(agentId: string): { where: BrowserWhere; machineId: string | null } | null {
	const s = sessions.get(current.get(agentId) ?? agentId);
	return s ? { where: s.where, machineId: s.machineId } : null;
}

async function closeSession(key: string): Promise<void> {
	const s = sessions.get(key);
	if (!s) return;
	sessions.delete(key);
	if (current.get(s.agentId) === key) current.delete(s.agentId);
	const host = s.sharedId ? hosts.get(s.sharedId) : null;
	if (host && host.context === s.context) {
		host.users.delete(s.agentId);
		if (host.users.size === 0) return closeHost(host);
		// The others keep the browser; the bot's tabs go (the last tab of a window stays, emptied).
		for (const p of tabsOf(s)) {
			const last = host.context.pages().length <= 1;
			await (last ? p.goto("about:blank").catch(() => {}) : p.close().catch(() => {}));
		}
		return;
	}
	try {
		// On a computer, leave the browser running (someone may be looking at it); just disconnect.
		if (s.browser) await s.browser.close();
		else await s.context.close();
	} catch (err) {
		log.warn(`closing browser: ${errorMessage(err)}`);
	}
	s.tunnel?.close();
}

/** Closes the browser the bot uses now (it reopens on the next use). */
export async function closeCurrentBrowser(agentId: string): Promise<void> {
	await closeSession(current.get(agentId) ?? agentId);
}

/** Closes every browser session of the bot (its own and its shared browsers'). */
export async function closeBrowser(agentId: string): Promise<void> {
	for (const [key, s] of [...sessions]) if (s.agentId === agentId) await closeSession(key);
	current.delete(agentId);
}

/** Sessions on a machine stop (it's being deleted, or a bot lost its seat there: then only that bot's). */
export async function closeSessionsOn(machineId: string, agentId?: string): Promise<void> {
	for (const [key, s] of [...sessions]) {
		if (s.machineId === machineId && (!agentId || s.agentId === agentId)) await closeSession(key);
	}
}

/** A shared browser changed or went: its sessions close (only this bot's, given one). */
export async function closeSharedBrowser(browserId: string, agentId?: string): Promise<void> {
	for (const [key, s] of [...sessions]) {
		if (s.sharedId === browserId && (!agentId || s.agentId === agentId)) await closeSession(key);
	}
	const host = hosts.get(browserId);
	if (host && !agentId) await closeHost(host);
}

/** Lets the page react to an action (navigation, requests, re-render) before the next snapshot. */
export async function settle(page: Page): Promise<void> {
	await page.waitForLoadState("domcontentloaded", { timeout: 8_000 }).catch(() => {});
	await page.waitForLoadState("networkidle", { timeout: 2_500 }).catch(() => {});
	await page.waitForTimeout(250);
}

/** What the bot sees of the page: where it is, open tabs, a waiting dialog, and the accessibility snapshot. */
export async function describePage(s: BrowserSession, opts: { limit?: number } = {}): Promise<string> {
	const page = s.page;
	const lines = [
		`Page: ${(await page.title().catch(() => "")) || "(untitled)"} | ${page.url()}`,
		`Browser: ${s.label}`,
	];
	const tabs = tabsOf(s);
	if (tabs.length > 1) {
		lines.push(`Tabs: ${tabs.map((t, i) => `[${i}]${t === page ? "*" : ""} ${t.url().slice(0, 80)}`).join("  ")}`);
	}
	if (s.dialog) {
		lines.push(
			`A ${s.dialog.type()} dialog is open: "${s.dialog.message().slice(0, 300)}". Answer it with browser_dialog before anything else.`,
		);
		return lines.join("\n");
	}
	let snap = await page
		.ariaSnapshot({ mode: "ai", timeout: 15_000 })
		.catch((err: unknown) => `(no snapshot: ${errorMessage(err)})`);
	const limit = opts.limit ?? SNAPSHOT_LIMIT;
	if (snap.length > limit) {
		snap = `${snap.slice(0, limit)}\n… (the page is longer: use browser_find to look for something specific, or scroll with browser_press PageDown and snapshot again)`;
	}
	lines.push("```yaml", snap, "```");
	if (s.consoleErrors.length) lines.push(`Console errors: ${s.consoleErrors.slice(-3).join(" | ")}`);
	return lines.join("\n");
}

/** Lines of the snapshot that mention some text, with a little context, for long pages. */
export async function findInPage(s: BrowserSession, text: string): Promise<string> {
	const snap = await s.page.ariaSnapshot({ mode: "ai", timeout: 15_000 });
	const lines = snap.split("\n");
	const needle = text.toLowerCase();
	const hits = new Set<number>();
	lines.forEach((l, i) => {
		if (l.toLowerCase().includes(needle))
			for (let j = Math.max(0, i - 2); j <= Math.min(lines.length - 1, i + 2); j++) hits.add(j);
	});
	if (hits.size === 0) return `"${text}" isn't on this page.`;
	const out: string[] = [];
	let prev = -2;
	for (const i of [...hits].sort((a, b) => a - b).slice(0, 200)) {
		if (i !== prev + 1) out.push("…");
		out.push(lines[i] ?? "");
		prev = i;
	}
	return out.join("\n");
}

let sweeper: ReturnType<typeof setInterval> | null = null;

export function initBrowsers(): void {
	sweeper = setInterval(() => {
		const cutoff = Date.now() - IDLE_MS;
		for (const [key, s] of sessions) if (s.lastUsed < cutoff) void closeSession(key);
	}, 60_000);
}

export async function shutdownBrowsers(): Promise<void> {
	if (sweeper) clearInterval(sweeper);
	await Promise.all([...sessions.keys()].map(closeSession));
	await Promise.all([...hosts.values()].map(closeHost));
}
