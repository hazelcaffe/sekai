import { existsSync, mkdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { WebEngineCheck, WebEngineSettings, WebEngineState, WebEngineStatus } from "@sekai/shared";
import { type Subprocess, spawn } from "bun";
import { serverBrowserPath } from "../browser/engine.ts";
import { config } from "../config.ts";
import { bus } from "../events/bus.ts";
import { errorMessage, HttpError } from "../lib/errors.ts";
import { newId } from "../lib/ids.ts";
import { log } from "../lib/log.ts";
import { guardedFetch } from "../lib/net.ts";
import { agentEnv } from "../providers/process.ts";
import { checkWebUrl, webSettings } from "./settings.ts";

/**
 * Firecrawl Local, the web engine: `firecrawl-local serve` on this server (started and watched here), or one
 * that already runs somewhere else. It answers the Firecrawl v2 API, which the web tools call: scrape for clean
 * Markdown (PDFs and Office files too), map for a site's pages, crawl to follow its links, and search through
 * Firecrawl's cloud.
 *
 * Safety: the engine we start listens on loopback only, with a token made fresh each time (so nothing else on
 * the machine can use it; it goes in the environment, which other users can't read, not on the command line,
 * which they can), and never gets --allow-private, so it refuses this server, your own network and cloud
 * metadata by itself. Private addresses stay with web_fetch, which asks you first.
 */

const HEALTH_TIMEOUT_MS = 5_000;
const START_TIMEOUT_MS = 20_000;
const REQUEST_TIMEOUT_MS = 90_000;
const CRAWL_POLL_MS = 1_000;
/** How long a tool waits for a crawl before giving back what came in. */
const CRAWL_WAIT_MS = 180_000;
const RESTART_DELAYS_MS = [2_000, 5_000, 15_000, 60_000];

interface EngineState {
	state: WebEngineState;
	error: string | null;
	version: string | null;
	startedAt: number | null;
	/** The token the engine we started expects (never saved). */
	token: string;
	/** The port it listens on: the one in the settings, or a free one Sekai picked. */
	port: number;
	proc: Subprocess | null;
	/** The last lines the engine printed, for the error message. */
	output: string[];
	restart: ReturnType<typeof setTimeout> | null;
	/** A `cargo install` running now. */
	installer: Subprocess | null;
	attempts: number;
	stopping: boolean;
	starting: Promise<void> | null;
}

const engine: EngineState = {
	state: "off",
	error: null,
	version: null,
	startedAt: null,
	token: "",
	port: 0,
	proc: null,
	output: [],
	restart: null,
	installer: null,
	attempts: 0,
	stopping: false,
	starting: null,
};

function setState(state: WebEngineState, error: string | null = null): void {
	// Only a running engine has a version and a start time.
	if (state !== "ready") {
		engine.version = null;
		engine.startedAt = null;
	}
	if (engine.state === state && engine.error === error) return;
	engine.state = state;
	engine.error = error;
	bus.emit({ type: "settings.changed" });
}

// ---------------------------------------------------------------- the binary

/** Where Firecrawl Local may be installed, best first. SEKAI_FIRECRAWL_PATH wins. */
export function binaryCandidates(home = homedir()): string[] {
	const fromEnv = process.env.SEKAI_FIRECRAWL_PATH?.trim();
	return [
		...(fromEnv ? [fromEnv] : []),
		join(home, ".cargo", "bin", "firecrawl-local"),
		"/usr/local/bin/firecrawl-local",
		"/usr/bin/firecrawl-local",
	];
}

/** The firecrawl-local binary on this server, or null when it isn't installed. */
export function firecrawlBinary(): string | null {
	const fromEnv = process.env.SEKAI_FIRECRAWL_PATH?.trim();
	if (fromEnv) return existsSync(fromEnv) ? fromEnv : null;
	for (const path of binaryCandidates()) if (existsSync(path)) return path;
	return Bun.which("firecrawl-local");
}

/** Rust's cargo, which installs Firecrawl Local. */
function cargoPath(): string | null {
	const inHome = join(homedir(), ".cargo", "bin", "cargo");
	return Bun.which("cargo") ?? (existsSync(inHome) ? inHome : null);
}

// ---------------------------------------------------------------- starting it

/** How the engine is started: loopback, and the browser setting (its token goes in engineEnv). */
export function engineArgs(s: WebEngineSettings, port: number): string[] {
	return ["serve", "--host", "127.0.0.1", "--port", String(port), "--browser", s.browser];
}

/**
 * A free loopback port, for when the settings don't fix one. Picking one each time means a port something else
 * took (or an engine a crash left behind) never stops the engine from starting.
 */
async function freePort(): Promise<number> {
	const probe = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
	const port = probe.port;
	probe.stop(true);
	return port;
}

const pidFile = () => join(config.dataDir, "firecrawl", "engine.pid");

/**
 * Stops an engine a crash or a kill left running: only the process id Sekai wrote down, and only while that id
 * is still a Firecrawl Local (checked through /proc, so elsewhere nothing is killed).
 */
async function stopLeftover(): Promise<void> {
	const pid = Number(
		(
			await Bun.file(pidFile())
				.text()
				.catch(() => "")
		).trim(),
	);
	await rm(pidFile(), { force: true }).catch(() => {});
	if (!pid || pid === process.pid) return;
	const cmdline = await Bun.file(`/proc/${pid}/cmdline`)
		.text()
		.catch(() => "");
	if (!cmdline.includes("firecrawl-local")) return;
	try {
		process.kill(pid, "SIGTERM");
		log.info(`web engine: stopped a Firecrawl Local left behind (process ${pid})`);
	} catch {
		// Already gone, or someone else's now.
	}
}

/**
 * The engine's environment: the token it expects, what may go to Firecrawl's cloud, the key for it, its own
 * folder in Sekai's data (so it never picks up a login someone made on this machine), and the Chrome this server
 * already has. It goes through agentEnv, so this third-party binary never sees Sekai's own secrets (the database,
 * the gateway…).
 */
export function engineEnv(
	s: WebEngineSettings,
	dataDir: string,
	chrome: string | null,
	token: string,
): Record<string, string> {
	const home = join(dataDir, "firecrawl");
	// Empty values are removed by agentEnv: whatever this machine's environment says about them never counts.
	return {
		FIRECRAWL_LOCAL_TOKEN: token,
		FIRECRAWL_LOCAL_ALLOW_PRIVATE: "",
		FIRECRAWL_CLOUD: s.cloud,
		FIRECRAWL_LOCAL_HOME: home,
		FIRECRAWL_CLI_CREDENTIALS: join(home, "credentials.json"),
		FIRECRAWL_API_KEY: s.apiKey,
		FIRECRAWL_API_URL: "",
		FIRECRAWL_CHROME_PATH: chrome ?? "",
	};
}

/** Where the engine answers, and the token to send it. */
async function endpoint(): Promise<{ base: string; token: string; here: boolean } | null> {
	const s = await webSettings();
	if (s.mode === "here" && engine.port) {
		return { base: `http://127.0.0.1:${engine.port}`, token: engine.token, here: true };
	}
	if (s.mode === "elsewhere" && s.url) return { base: s.url.replace(/\/+$/, ""), token: s.token, here: false };
	return null;
}

function keepOutput(chunk: string): void {
	for (const line of chunk.split(/\r?\n/)) {
		if (line.trim()) engine.output.push(line.trim());
	}
	if (engine.output.length > 20) engine.output = engine.output.slice(-20);
}

/** The last thing the engine said, for a message a person can act on. */
function lastWords(): string {
	return engine.output.filter((l) => !l.startsWith("firecrawl-local listening")).at(-1) ?? "";
}

async function readOutput(stream: ReadableStream<Uint8Array> | undefined): Promise<void> {
	if (!stream) return;
	const decoder = new TextDecoder();
	for await (const chunk of stream) keepOutput(decoder.decode(chunk));
}

async function health(base: string, token: string, timeoutMs = HEALTH_TIMEOUT_MS): Promise<string | null> {
	const res = await request("GET", "/health", null, { base, token, timeoutMs });
	const version = (res as { version?: string }).version;
	return typeof version === "string" ? version : "";
}

/** Waits until the engine answers, so "ready" means a bot can really use it. */
async function waitForHealth(base: string, token: string, until: number): Promise<string> {
	let last = "";
	while (Date.now() < until) {
		if (engine.proc && engine.proc.exitCode !== null) break;
		try {
			return (await health(base, token, 2_000)) ?? "";
		} catch (err) {
			last = errorMessage(err);
			await Bun.sleep(300);
		}
	}
	throw new Error(last || "it didn't answer in time");
}

/** Starts (or re-checks) the engine for the saved settings. Safe to call again; never throws. */
export async function startWebEngine(): Promise<void> {
	if (engine.starting) return engine.starting;
	engine.starting = (async () => {
		await stopProcess();
		if (engine.restart) clearTimeout(engine.restart);
		engine.restart = null;
		const s = await webSettings();
		if (s.mode === "off") {
			setState("off");
			return;
		}
		if (s.mode === "elsewhere") {
			if (!s.url) {
				setState("error", "Give the address where Firecrawl Local answers.");
				return;
			}
			setState("starting");
			try {
				const url = checkWebUrl(s.url);
				engine.version = await health(url.href.replace(/\/+$/, ""), s.token);
				engine.startedAt = Date.now();
				setState("ready");
				log.info(`web engine: Firecrawl Local ${engine.version || ""} at ${s.url}`);
			} catch (err) {
				setState("error", `Can't reach Firecrawl Local at ${s.url}: ${reachReason(errorMessage(err))}.`);
			}
			return;
		}
		const binary = firecrawlBinary();
		if (!binary) {
			setState(
				"missing",
				"Firecrawl Local isn't installed on this server. Install it here, or run `cargo install firecrawl-local`.",
			);
			return;
		}
		setState("starting");
		await stopLeftover();
		engine.token = newId("fcl", 32);
		engine.port = s.port || (await freePort());
		engine.output = [];
		mkdirSync(join(config.dataDir, "firecrawl"), { recursive: true });
		const proc = spawn([binary, ...engineArgs(s, engine.port)], {
			env: agentEnv(engineEnv(s, config.dataDir, serverBrowserPath(), engine.token)),
			stdout: "pipe",
			stderr: "pipe",
			stdin: "ignore",
		});
		engine.proc = proc;
		await Bun.write(pidFile(), String(proc.pid ?? ""));
		void readOutput(proc.stdout as ReadableStream<Uint8Array> | undefined);
		void readOutput(proc.stderr as ReadableStream<Uint8Array> | undefined);
		void proc.exited.then((code) => {
			if (engine.proc !== proc) return;
			engine.proc = null;
			if (engine.stopping) return;
			const said = lastWords();
			setState("error", `Firecrawl Local stopped (exit ${code})${said ? `: ${said}` : ""}`);
			scheduleRestart();
		});
		try {
			engine.version = await waitForHealth(
				`http://127.0.0.1:${engine.port}`,
				engine.token,
				Date.now() + START_TIMEOUT_MS,
			);
			engine.startedAt = Date.now();
			engine.attempts = 0;
			setState("ready");
			log.info(`web engine: Firecrawl Local ${engine.version || ""} on 127.0.0.1:${engine.port}`);
		} catch (err) {
			const said = lastWords();
			await stopProcess();
			const busy = /address already in use/i.test(said);
			setState(
				"error",
				busy
					? `Something else already answers on 127.0.0.1:${engine.port}. Leave the port empty and Sekai picks a free one.`
					: said || `Firecrawl Local didn't start: ${reachReason(errorMessage(err))}.`,
			);
			scheduleRestart();
		}
	})();
	try {
		await engine.starting;
	} finally {
		engine.starting = null;
	}
}

/** Tries again after a while (longer each time), so a busy port or a crash sorts itself out. */
function scheduleRestart(): void {
	if (engine.restart || engine.stopping) return;
	const delay = RESTART_DELAYS_MS[Math.min(engine.attempts, RESTART_DELAYS_MS.length - 1)] ?? 60_000;
	engine.attempts++;
	engine.restart = setTimeout(() => {
		engine.restart = null;
		void startWebEngine();
	}, delay);
	engine.restart.unref?.();
}

async function stopProcess(): Promise<void> {
	const proc = engine.proc;
	if (!proc) return;
	engine.stopping = true;
	engine.proc = null;
	try {
		proc.kill();
		await Promise.race([proc.exited, Bun.sleep(3_000)]);
	} catch {
		// Already gone.
	}
	await rm(pidFile(), { force: true }).catch(() => {});
	engine.stopping = false;
}

/** Stops the engine Sekai started (on shutdown, or when it's turned off), and any install under way. */
export async function stopWebEngine(): Promise<void> {
	if (engine.restart) clearTimeout(engine.restart);
	engine.restart = null;
	engine.attempts = 0;
	const installer = engine.installer;
	engine.installer = null;
	installer?.kill();
	await stopProcess();
	setState("off");
}

export async function restartWebEngine(): Promise<void> {
	engine.attempts = 0;
	await startWebEngine();
}

/**
 * Installs Firecrawl Local with cargo (it's a Rust program), then starts it. Building it takes a few minutes,
 * so this returns as soon as it's under way: the page follows the state ("installing", then "ready").
 */
export async function installWebEngine(): Promise<void> {
	const cargo = cargoPath();
	if (!cargo) {
		throw new HttpError(
			400,
			"This server has no Rust, so Sekai can't install Firecrawl Local. Install Rust (rustup.rs) and `cargo install firecrawl-local`, or run the engine elsewhere and give its address.",
		);
	}
	if (engine.state === "installing") throw new HttpError(409, "It's installing already.");
	await stopWebEngine();
	setState("installing");
	engine.output = [];
	const proc = spawn([cargo, "install", "firecrawl-local", "--locked"], {
		env: agentEnv({}),
		stdout: "pipe",
		stderr: "pipe",
		stdin: "ignore",
	});
	void readOutput(proc.stdout as ReadableStream<Uint8Array> | undefined);
	void readOutput(proc.stderr as ReadableStream<Uint8Array> | undefined);
	engine.installer = proc;
	void proc.exited.then(async (code) => {
		if (engine.installer !== proc) return;
		engine.installer = null;
		if (code !== 0) {
			setState("error", `Installing Firecrawl Local failed: ${lastWords() || `cargo exited ${code}`}`);
			return;
		}
		log.info("web engine: installed Firecrawl Local");
		await startWebEngine();
	});
}

// ---------------------------------------------------------------- status

/** Whether Sekai's own `cargo install` is running now. */
export function webEngineInstalling(): boolean {
	return engine.installer !== null || engine.state === "installing";
}

export async function webEngineStatus(): Promise<WebEngineStatus> {
	const s = await webSettings();
	const ready = engine.state === "ready";
	return {
		settings: s,
		state: engine.state,
		error: engine.error,
		url: ready ? ((await endpoint())?.base ?? null) : null,
		version: engine.version,
		binary: firecrawlBinary(),
		canInstall: cargoPath() !== null,
		search: ready && s.cloud !== "off",
		crawl: ready && s.crawl,
		startedAt: engine.startedAt,
	};
}

/** Whether bots can read pages through the engine right now. */
export async function webEngineReady(): Promise<boolean> {
	return engine.state === "ready" && (await webSettings()).mode !== "off";
}

/** Whether web_search works: it goes to Firecrawl's cloud, so the cloud has to be on. */
export async function webSearchReady(): Promise<boolean> {
	return (await webEngineReady()) && (await webSettings()).cloud !== "off";
}

/** Whether bots get web_crawl and web_map. */
export async function webCrawlReady(): Promise<boolean> {
	return (await webEngineReady()) && (await webSettings()).crawl;
}

// ---------------------------------------------------------------- talking to it

interface RequestOptions {
	base: string;
	token: string;
	timeoutMs?: number;
	signal?: AbortSignal;
}

/**
 * A machine that couldn't be reached, in plain words: the errors fetch throws name system calls, which mean
 * nothing to the person reading the page.
 */
export function reachReason(message: string): string {
	if (/ECONNREFUSED|Unable to connect/i.test(message)) return "nothing is listening there";
	if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(message)) return "that name doesn't resolve";
	if (/timed? ?out|TimeoutError|signal is aborted/i.test(message)) return "it didn't answer in time";
	if (/certificate|SSL|TLS/i.test(message)) return "its certificate wasn't accepted";
	return message;
}

/** The message in a Firecrawl answer that went wrong. */
export function engineError(status: number, body: unknown): string {
	const data = body as { error?: unknown; code?: unknown; details?: unknown } | null;
	const said = typeof data?.error === "string" ? data.error : "";
	return said || `the engine answered ${status}`;
}

async function request(
	method: "GET" | "POST" | "DELETE",
	path: string,
	body: unknown,
	opts: RequestOptions,
): Promise<unknown> {
	const url = new URL(path, `${opts.base}/`);
	const signals = [AbortSignal.timeout(opts.timeoutMs ?? REQUEST_TIMEOUT_MS)];
	if (opts.signal) signals.push(opts.signal);
	const init: RequestInit = {
		method,
		headers: {
			...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
			...(body ? { "content-type": "application/json" } : {}),
			accept: "application/json",
		},
		...(body ? { body: JSON.stringify(body) } : {}),
		signal: AbortSignal.any(signals),
	};
	// Our own engine on loopback: a plain fetch (the network guard refuses this server's own addresses, rightly).
	// An engine somewhere else is an address an admin set, so the guard lets it reach your network.
	const res =
		url.hostname === "127.0.0.1"
			? await fetch(url, init)
			: await guardedFetch(url, { ...init, allowPrivate: true, configured: true });
	const text = await res.text();
	let data: unknown = null;
	try {
		data = text ? JSON.parse(text) : null;
	} catch {
		data = null;
	}
	if (!res.ok) throw new Error(engineError(res.status, data ?? { error: text.slice(0, 300) }));
	return data;
}

async function call(path: string, body: unknown, signal?: AbortSignal, timeoutMs?: number): Promise<unknown> {
	const where = await endpoint();
	if (!where) throw new Error("Web reading is off. Turn Firecrawl Local on in Settings → Web reading.");
	if (engine.state !== "ready") {
		throw new Error(engine.error ?? "Firecrawl Local isn't ready yet.");
	}
	return request("POST", path, body, { base: where.base, token: where.token, signal, timeoutMs });
}

// ---------------------------------------------------------------- what it does

export interface ScrapeResult {
	url: string;
	title: string;
	markdown: string;
	/** "local" (this machine fetched it) or "firecrawl-cloud". */
	source: string;
	/** A page nothing could load, with the reason. */
	blocked: boolean;
	warning: string | null;
	links: string[];
	statusCode: number | null;
}

interface FirecrawlDoc {
	markdown?: string;
	links?: string[];
	source?: string;
	blocked?: boolean;
	warning?: string;
	metadata?: {
		title?: string;
		sourceURL?: string;
		url?: string;
		statusCode?: number;
		[key: string]: unknown;
	};
}

/** A Firecrawl document, as the tools want it. */
export function toScrapeResult(doc: FirecrawlDoc, requested: string): ScrapeResult {
	const meta = doc.metadata ?? {};
	return {
		// Where the page ended up, after redirects (sourceURL is the address that was asked for).
		url: meta.url ?? meta.sourceURL ?? requested,
		title: (meta.title ?? "").trim(),
		markdown: (doc.markdown ?? "").trim(),
		source: doc.source ?? "local",
		blocked: Boolean(doc.blocked),
		warning: doc.warning ?? null,
		links: Array.isArray(doc.links) ? doc.links : [],
		statusCode: typeof meta.statusCode === "number" ? meta.statusCode : null,
	};
}

export interface ScrapeInput {
	formats?: string[];
	/** False keeps navigation, headers and footers. */
	onlyMainContent?: boolean;
	timeoutMs?: number;
}

/** Reads one page as Markdown (PDFs and Office files too). */
export async function scrapePage(url: string, input: ScrapeInput = {}, signal?: AbortSignal): Promise<ScrapeResult> {
	const data = (await call(
		"/v2/scrape",
		{
			url,
			formats: input.formats ?? ["markdown"],
			onlyMainContent: input.onlyMainContent ?? true,
			timeout: input.timeoutMs ?? 30_000,
			origin: "sekai",
		},
		signal,
	)) as { data?: FirecrawlDoc };
	return toScrapeResult(data?.data ?? {}, url);
}

export interface MapInput {
	search?: string;
	limit?: number;
}

/** Every page of a site the engine can find from its sitemaps and front page. */
export async function mapSite(url: string, input: MapInput = {}, signal?: AbortSignal): Promise<string[]> {
	const data = (await call(
		"/v2/map",
		{ url, ...(input.search ? { search: input.search } : {}), limit: input.limit ?? 100, origin: "sekai" },
		signal,
	)) as { links?: ({ url?: string } | string)[] };
	return (data?.links ?? [])
		.map((l) => (typeof l === "string" ? l : l.url))
		.filter((u): u is string => Boolean(u))
		.slice(0, input.limit ?? 100);
}

export interface CrawlInput {
	limit?: number;
	maxDepth?: number;
	include?: string[];
	exclude?: string[];
	/** Follow links anywhere on the site, not only under the starting path. */
	entireDomain?: boolean;
}

export interface CrawlOutcome {
	pages: ScrapeResult[];
	status: string;
	/** Pages that failed, as the engine described them. */
	errors: string[];
	/** True when the crawl was still going when we stopped waiting. */
	partial: boolean;
}

/** Follows links from a page and reads what it finds. Waits for the crawl, then gives back the pages. */
export async function crawlSite(url: string, input: CrawlInput = {}, signal?: AbortSignal): Promise<CrawlOutcome> {
	const limit = Math.max(1, Math.min(input.limit ?? 8, 50));
	const started = (await call(
		"/v2/crawl",
		{
			url,
			limit,
			...(input.maxDepth ? { maxDiscoveryDepth: input.maxDepth } : {}),
			...(input.include?.length ? { includePaths: input.include } : {}),
			...(input.exclude?.length ? { excludePaths: input.exclude } : {}),
			...(input.entireDomain ? { crawlEntireDomain: true } : {}),
			scrapeOptions: { formats: ["markdown"], onlyMainContent: true },
			origin: "sekai",
		},
		signal,
	)) as { id?: string };
	const id = started?.id;
	if (!id) throw new Error("the engine didn't start the crawl");
	const where = await endpoint();
	if (!where) throw new Error("Web reading is off.");
	const until = Date.now() + CRAWL_WAIT_MS;
	try {
		while (true) {
			const job = (await request("GET", `/v2/crawl/${id}`, null, {
				base: where.base,
				token: where.token,
				signal,
				timeoutMs: 30_000,
			})) as { status?: string; data?: FirecrawlDoc[]; errors?: { error?: string; url?: string }[] };
			const status = job.status ?? "scraping";
			const done = status !== "scraping" || Date.now() > until;
			if (done) {
				return {
					pages: (job.data ?? []).map((d) => toScrapeResult(d, url)),
					status,
					errors: (job.errors ?? []).map((e) => [e.url, e.error].filter(Boolean).join(": ")).filter(Boolean),
					partial: status === "scraping",
				};
			}
			await Bun.sleep(CRAWL_POLL_MS);
		}
	} finally {
		// A crawl we stopped waiting for (or that was cancelled) must not keep fetching the site.
		void request("DELETE", `/v2/crawl/${id}`, null, {
			base: where.base,
			token: where.token,
			timeoutMs: 5_000,
		}).catch(() => {});
	}
}

export interface SearchHit {
	url: string;
	title: string;
	description: string;
}

/** Web search, through Firecrawl's cloud (there's no search index on this machine). */
export async function searchWeb(query: string, limit = 5, signal?: AbortSignal): Promise<SearchHit[]> {
	const data = (await call("/v2/search", { query, limit, origin: "sekai" }, signal)) as {
		data?: { web?: { url?: string; title?: string; description?: string }[] };
	};
	return (data?.data?.web ?? [])
		.filter((r) => r.url)
		.map((r) => ({ url: r.url ?? "", title: (r.title ?? "").trim(), description: (r.description ?? "").trim() }));
}

/** Web reading's "Try a page": reads one page and reports how it went. */
export async function checkWebEngine(url: string, signal?: AbortSignal): Promise<WebEngineCheck> {
	const target = checkWebUrl(url);
	const started = Date.now();
	const page = await scrapePage(target.href, {}, signal);
	if (page.blocked) throw new HttpError(502, page.warning ?? "Nothing could load that page.");
	return {
		url: page.url,
		title: page.title,
		preview: page.markdown.slice(0, 600),
		source: page.source,
		ms: Date.now() - started,
	};
}

/** For tests. */
export function resetWebEngine(): void {
	engine.state = "off";
	engine.error = null;
	engine.version = null;
	engine.startedAt = null;
	engine.output = [];
	engine.attempts = 0;
}
