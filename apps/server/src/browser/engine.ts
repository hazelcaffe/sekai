import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Machine } from "@sekai/shared";
import { type Browser, type BrowserContext, chromium, type Dialog, type Page } from "playwright-core";
import { actorFor } from "../auth/actor.ts";
import { config } from "../config.ts";
import { agentOwner } from "../events/scope.ts";
import { errorMessage } from "../lib/errors.ts";
import { log } from "../lib/log.ts";
import { cachedReach } from "../lib/net.ts";
import { driverFor, hasDesktop, pickMachine } from "../machines/drivers.ts";
import { listMachines } from "../machines/manager.ts";
import type { Tunnel } from "../machines/ssh.ts";
import { agentEnv } from "../providers/process.ts";
import { xvfbDisplay } from "./xvfb.ts";

/**
 * Each bot's browser. With a running computer it's Chrome on that computer (you can watch over VNC and take
 * over); otherwise a headless Chromium on the server with the bot's own profile, so sign-ins stick. When
 * you lend the bot your computer, it can also use a browser there (a separate Sekai profile in your Chrome
 * or Edge, opened by the desktop app), on: "device".
 * Pages are read as accessibility snapshots with element refs ([ref=e12]) that tools act on, the way the
 * Playwright MCP server does: reliable on complex web apps, no guessing at pixels.
 */

export type BrowserWhere = "computer" | "device" | "server";

export interface BrowserSession {
	agentId: string;
	where: BrowserWhere;
	/** The machine the browser runs on (null: the server). */
	machineId: string | null;
	/** Shown to the bot: "your computer", "the user's computer (Sam's MacBook)", "the server". */
	label: string;
	context: BrowserContext;
	browser: Browser | null;
	tunnel: Tunnel | null;
	page: Page;
	/** A dialog (alert, confirm, prompt) waiting for the bot to answer. */
	dialog: Dialog | null;
	consoleErrors: string[];
	lastUsed: number;
}

const sessions = new Map<string, BrowserSession>();
const opening = new Map<string, Promise<BrowserSession>>();
const IDLE_MS = 20 * 60_000;
export const SNAPSHOT_LIMIT = 24_000;

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

function watch(s: BrowserSession, page: Page): void {
	page.on("dialog", (d) => {
		s.dialog = d;
	});
	page.on("console", (m) => {
		if (m.type() === "error") s.consoleErrors = [...s.consoleErrors, m.text().slice(0, 300)].slice(-10);
	});
	page.on("close", () => {
		if (s.page === page) s.page = s.context.pages().at(-1) ?? s.page;
	});
}

interface Target {
	where: BrowserWhere;
	machine: Machine | null;
}

function labelOf(t: Target): string {
	if (t.where === "server") return "a browser on the Sekai server";
	if (t.where === "device") return `a browser on the user's computer (${t.machine?.name ?? "their computer"})`;
	return "Chrome on your computer";
}

/**
 * Where the browser should run. on: "computer", "device" (your computer), "server", or a machine name.
 * Without it: wherever it already runs, else the bot's computer if it's running, else the server.
 */
async function targetFor(agentId: string, on: string | undefined, current: BrowserSession | null): Promise<Target> {
	const all = await listMachines({ agentId });
	const r = on?.trim().toLowerCase();
	if (r === "server") return { where: "server", machine: null };
	if (r) {
		const m = pickMachine(all, on);
		if (!m) throw new Error(`There's no machine called "${on}" for this bot`);
		if (m.kind === "devbox") throw new Error(`${m.name} is a devbox: it has no screen or browser`);
		if (!hasDesktop(m)) {
			throw new Error(
				m.kind === "device"
					? `${m.name} is offline: the Sekai desktop app isn't connected there`
					: `${m.name} isn't running`,
			);
		}
		return { where: m.kind === "device" ? "device" : "computer", machine: m };
	}
	const computer = all.find((m) => m.kind === "computer" && hasDesktop(m)) ?? null;
	if (current) {
		const still = current.machineId ? all.find((m) => m.id === current.machineId) : null;
		// A bot that got a computer since moves its browser there; otherwise it stays where it is.
		if (current.where === "server" && !computer) return { where: "server", machine: null };
		if (still && hasDesktop(still)) return { where: current.where, machine: still };
	}
	return computer ? { where: "computer", machine: computer } : { where: "server", machine: null };
}

async function ownerIsAdmin(agentId: string): Promise<boolean> {
	const ownerId = await agentOwner(agentId);
	return ownerId ? (await actorFor(ownerId).catch(() => null))?.admin === true : false;
}

async function open(agentId: string, target: Target): Promise<BrowserSession> {
	let context: BrowserContext;
	let browser: Browser | null = null;
	let tunnel: Tunnel | null = null;
	if (target.machine) {
		const driver = await driverFor(target.machine);
		const port = await (await driver.desktop()).browser();
		tunnel = await driver.tunnel(port);
		try {
			browser = await chromium.connectOverCDP(`http://127.0.0.1:${tunnel.localPort}`, { timeout: 30_000 });
		} catch (err) {
			tunnel.close();
			throw err;
		}
		context = browser.contexts()[0] ?? (await browser.newContext());
	} else {
		const real = serverBrowserPath();
		if (!real) {
			throw new Error(
				"There's no browser on the server. Install Chrome or Chromium there (or set SEKAI_BROWSER_PATH), or give the bot a computer.",
			);
		}
		const profile = join(config.dataDir, "browser", agentId);
		mkdirSync(profile, { recursive: true });
		// A real window on the server's virtual display reads as a person's browser; only fall back to
		// headless when there's no display. Automation tells are stripped (see chromium-sandboxed.sh).
		const display = await xvfbDisplay();
		context = await chromium.launchPersistentContext(profile, {
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
	}
	// The server's own browser, for a bot whose owner isn't an admin: only the internet (not this server, its
	// network or tailnet: your router, Proxmox, Sekai itself…). A bot's own computer is its own business.
	if (!target.machine && !(await ownerIsAdmin(agentId))) {
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
	if (!target.machine) {
		await context
			.addInitScript(() => {
				Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false });
			})
			.catch(() => {});
	}
	const page = context.pages().at(-1) ?? (await context.newPage());
	const s: BrowserSession = {
		agentId,
		where: target.where,
		machineId: target.machine?.id ?? null,
		label: labelOf(target),
		context,
		browser,
		tunnel,
		page,
		dialog: null,
		consoleErrors: [],
		lastUsed: Date.now(),
	};
	for (const p of context.pages()) watch(s, p);
	// Links that open a new tab or popup: follow them.
	context.on("page", (p) => {
		watch(s, p);
		s.page = p;
	});
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

/** The bot's browser, opened (or reconnected, or moved to where `on` says) on first use. */
export async function browserFor(agentId: string, on?: string): Promise<BrowserSession> {
	const pending = opening.get(agentId);
	if (pending) await pending.catch(() => {});
	const existing = sessions.get(agentId) ?? null;
	const target = await targetFor(agentId, on, existing);
	if (
		existing &&
		existing.where === target.where &&
		existing.machineId === (target.machine?.id ?? null) &&
		!existing.page.isClosed()
	) {
		existing.lastUsed = Date.now();
		return existing;
	}
	if (existing) await closeBrowser(agentId);
	const next = open(agentId, target).finally(() => opening.delete(agentId));
	opening.set(agentId, next);
	return next;
}

/** Where the bot's browser runs right now, if it's open. */
export function browserWhere(agentId: string): { where: BrowserWhere; machineId: string | null } | null {
	const s = sessions.get(agentId);
	return s ? { where: s.where, machineId: s.machineId } : null;
}

export async function closeBrowser(agentId: string): Promise<void> {
	const s = sessions.get(agentId);
	if (!s) return;
	sessions.delete(agentId);
	try {
		// On a computer, leave the browser running (someone may be looking at it); just disconnect.
		if (s.browser) await s.browser.close();
		else await s.context.close();
	} catch (err) {
		log.warn(`closing browser: ${errorMessage(err)}`);
	}
	s.tunnel?.close();
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
	const tabs = s.context.pages();
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
		for (const [agentId, s] of sessions) if (s.lastUsed < cutoff) void closeBrowser(agentId);
	}, 60_000);
}

export async function shutdownBrowsers(): Promise<void> {
	if (sweeper) clearInterval(sweeper);
	await Promise.all([...sessions.keys()].map(closeBrowser));
}
