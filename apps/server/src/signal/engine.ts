import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { chmod, mkdtemp, readdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { SIGNAL_CLI_VERSION, type SignalEngineState, type SignalEngineStatus } from "@sekai/shared";
import { type Subprocess, spawn } from "bun";
import { config } from "../config.ts";
import { bus } from "../events/bus.ts";
import { errorMessage, HttpError } from "../lib/errors.ts";
import { log } from "../lib/log.ts";
import { agentEnv } from "../providers/process.ts";
import { callRpc } from "./rpc.ts";

/**
 * signal-cli, the engine behind bots' Signal accounts: installed here (or found on the server), and one daemon for
 * every account (`daemon --http`, multi-account mode), started when a bot has a Signal account and watched.
 *
 * Safety: the daemon listens on 127.0.0.1 only, on a free port picked each start. Its HTTP interface has no password,
 * so it's reachable by anything running on this server, not from the network. Its folder (the accounts' keys) is
 * 0700, and it gets agentEnv, so it never sees Sekai's own secrets. The install is pinned to one release and checked
 * against its SHA-256 before anything is unpacked.
 */

/** The release Sekai installs: Linux x86_64's native build (no Java needed), checked against this digest. */
export const SIGNAL_CLI_RELEASE = {
	version: SIGNAL_CLI_VERSION,
	url: `https://github.com/AsamK/signal-cli/releases/download/v${SIGNAL_CLI_VERSION}/signal-cli-${SIGNAL_CLI_VERSION}-Linux-native.tar.gz`,
	sha256: "db9297789c5bbc6131df505d2f37abe43efa0b54200585f5e56b478e1cd93916",
	size: 118_889_585,
};

const START_TIMEOUT_MS = 90_000;
const RESTART_DELAYS_MS = [2_000, 5_000, 15_000, 60_000];
/** How long the daemon stays up after the last account stopped needing it (a restart shouldn't stop it). */
const IDLE_STOP_MS = 30_000;
/** Attachments signal-cli downloaded are read right away (or never, from people the bot doesn't answer). */
const ATTACHMENTS_KEEP_MS = 6 * 3_600_000;

/** signal-cli's folder: the accounts' keys and messages it hasn't handed over yet. */
export const signalDir = (dataDir = config.dataDir) => join(dataDir, "signal");
/** Where Sekai's own install of signal-cli goes. */
export const signalToolDir = (dataDir = config.dataDir) => join(dataDir, "tools", "signal-cli");

/** Whether Sekai can install signal-cli here itself, and if not, what to install by hand. */
export function installSupport(
	platform: string = process.platform,
	arch: string = process.arch,
): { ok: true } | { ok: false; note: string } {
	if (platform === "linux" && arch === "x64") return { ok: true };
	return {
		ok: false,
		note: `Sekai can install Signal only on Linux on x86_64. Here, install Java 21 or newer and signal-cli ${SIGNAL_CLI_VERSION} (the JVM build from its GitHub releases), then put signal-cli on the server's PATH or set SIGNAL_CLI to its path, and restart Sekai.`,
	};
}

/** The signal-cli to run: SIGNAL_CLI (a path) when set, else Sekai's own install, else one on the PATH. */
export function signalBinary(dataDir = config.dataDir): string | null {
	const fromEnv = process.env.SIGNAL_CLI?.trim();
	if (fromEnv) return existsSync(fromEnv) ? fromEnv : null;
	const installed = join(signalToolDir(dataDir), "signal-cli");
	if (existsSync(installed)) return installed;
	return Bun.which("signal-cli");
}

/**
 * How the daemon is started: every account in Sekai's folder (multi-account mode), JSON-RPC and events over HTTP on
 * loopback, receiving only while Sekai listens (so nothing arrives unseen), trust on first use for safety numbers.
 */
export function daemonArgs(dir: string, port: number): string[] {
	return [
		"--config",
		dir,
		"--trust-new-identities",
		"on-first-use",
		"--scrub-log",
		"daemon",
		"--http",
		`127.0.0.1:${port}`,
		"--receive-mode",
		"on-connection",
		"--no-receive-stdout",
		"--ignore-stories",
		"--ignore-stickers",
		"--ignore-avatars",
	];
}

// ---------------------------------------------------------------- installing

/**
 * Downloads a file while hashing it, and keeps it only when its SHA-256 is the expected one (a changed or broken
 * download is deleted, never unpacked).
 */
export async function downloadVerified(
	url: string,
	dest: string,
	expected: string,
	opts: { fetch?: typeof fetch; onProgress?: (bytes: number) => void; signal?: AbortSignal } = {},
): Promise<void> {
	const request = opts.fetch ?? fetch;
	const signals = [AbortSignal.timeout(20 * 60_000)];
	if (opts.signal) signals.push(opts.signal);
	let res: Response;
	try {
		res = await request(url, { redirect: "follow", signal: AbortSignal.any(signals) });
	} catch (err) {
		throw new Error(`Couldn't download signal-cli: ${errorMessage(err)}`);
	}
	if (!res.ok || !res.body) {
		await res.body?.cancel().catch(() => {});
		throw new Error(`Couldn't download signal-cli: GitHub answered ${res.status}.`);
	}
	const hasher = new Bun.CryptoHasher("sha256");
	const writer = Bun.file(dest).writer();
	let bytes = 0;
	try {
		for await (const chunk of res.body) {
			hasher.update(chunk);
			writer.write(chunk);
			bytes += chunk.byteLength;
			opts.onProgress?.(bytes);
		}
	} finally {
		await writer.end();
	}
	const digest = hasher.digest("hex");
	if (digest !== expected.toLowerCase()) {
		await rm(dest, { force: true });
		throw new Error(
			"The signal-cli download didn't match its checksum, so Sekai didn't install it. Try again later.",
		);
	}
}

async function run(cmd: string[], cwd?: string): Promise<{ code: number; out: string }> {
	const proc = spawn(cmd, { cwd, env: agentEnv({}), stdout: "pipe", stderr: "pipe", stdin: "ignore" });
	const [out, err, code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return { code, out: `${out}${err}`.trim() };
}

/** Unpacks a verified release and puts its signal-cli in `toolDir`, checking that it runs and is that version. */
export async function unpackRelease(archive: string, toolDir: string, version = SIGNAL_CLI_VERSION): Promise<string> {
	mkdirSync(toolDir, { recursive: true });
	const work = await mkdtemp(join(toolDir, ".unpack-"));
	try {
		const tar = await run(["tar", "-xzf", archive, "-C", work]);
		if (tar.code !== 0) throw new Error(`Couldn't unpack signal-cli: ${tar.out.split("\n").at(-1) ?? tar.code}`);
		const found = join(work, "signal-cli");
		if (!existsSync(found)) throw new Error("The signal-cli download didn't have the program in it.");
		await chmod(found, 0o755);
		const check = await run([found, "--version"]);
		if (check.code !== 0 || !check.out.includes(version))
			throw new Error(`The downloaded signal-cli didn't start: ${check.out.split("\n").at(-1) ?? check.code}`);
		const dest = join(toolDir, "signal-cli");
		await rename(found, dest);
		return dest;
	} finally {
		await rm(work, { recursive: true, force: true });
	}
}

/** Downloads, checks and installs the pinned signal-cli into `dataDir`/tools/signal-cli. Returns its path. */
export async function installSignalCli(
	opts: {
		dataDir?: string;
		release?: { url: string; sha256: string; version: string };
		fetch?: typeof fetch;
		onProgress?: (bytes: number) => void;
		signal?: AbortSignal;
	} = {},
): Promise<string> {
	const release = opts.release ?? SIGNAL_CLI_RELEASE;
	const toolDir = signalToolDir(opts.dataDir);
	mkdirSync(toolDir, { recursive: true });
	const archive = join(toolDir, ".download.tar.gz");
	try {
		await downloadVerified(release.url, archive, release.sha256, opts);
		return await unpackRelease(archive, toolDir, release.version);
	} finally {
		await rm(archive, { force: true });
	}
}

// ---------------------------------------------------------------- the daemon

interface Daemon {
	state: SignalEngineState;
	error: string | null;
	version: string | null;
	port: number;
	proc: Subprocess | null;
	output: string[];
	restart: ReturnType<typeof setTimeout> | null;
	idle: ReturnType<typeof setTimeout> | null;
	prune: ReturnType<typeof setInterval> | null;
	attempts: number;
	stopping: boolean;
	starting: Promise<void> | null;
	installing: AbortController | null;
	progress: number | null;
}

const daemon: Daemon = {
	state: "off",
	error: null,
	version: null,
	port: 0,
	proc: null,
	output: [],
	restart: null,
	idle: null,
	prune: null,
	attempts: 0,
	stopping: false,
	starting: null,
	installing: null,
	progress: null,
};
/** What needs the daemon now: running Signal accounts (their channel ids) and setups under way. */
const holds = new Set<string>();

function setState(state: SignalEngineState, error: string | null = null): void {
	if (state !== "ready") daemon.version = null;
	if (daemon.state === state && daemon.error === error) return;
	daemon.state = state;
	daemon.error = error;
	bus.emit({ type: "settings.changed" });
}

function missingText(): string {
	const support = installSupport();
	return support.ok
		? "Signal isn't set up on this server yet: an admin can install it from a bot's Signal page, or put signal-cli on the server's PATH (or set SIGNAL_CLI to its path)."
		: support.note;
}

function keepOutput(chunk: string): void {
	for (const line of chunk.split(/\r?\n/)) if (line.trim()) daemon.output.push(line.trim());
	if (daemon.output.length > 30) daemon.output = daemon.output.slice(-30);
}

async function readOutput(stream: ReadableStream<Uint8Array> | undefined): Promise<void> {
	if (!stream) return;
	const decoder = new TextDecoder();
	for await (const chunk of stream) keepOutput(decoder.decode(chunk));
}

/**
 * The last thing signal-cli said that looks like a problem, for a message a person can act on ("" when nothing does:
 * its startup notes aren't reasons).
 */
function lastWords(): string {
	return (daemon.output.filter((l) => /error|exception|failed|denied|in use/i.test(l)).at(-1) ?? "")
		.replace(/^(?:\S+\s+)?(?:\[[^\]]+\]\s+)?(?:ERROR|WARN|INFO|DEBUG)\s+\S+\s+-\s+/, "")
		.slice(0, 300);
}

async function freePort(): Promise<number> {
	const probe = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
	const port = probe.port;
	probe.stop(true);
	return port;
}

const pidFile = () => join(signalDir(), "daemon.pid");

/** Stops a daemon a crash left running: only the id Sekai wrote down, and only while it's still a signal-cli daemon. */
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
	if (!cmdline.includes("signal-cli") || !cmdline.includes("daemon")) return;
	try {
		process.kill(pid, "SIGTERM");
		log.info(`signal: stopped a signal-cli daemon left behind (process ${pid})`);
		for (let i = 0; i < 50 && existsSync(`/proc/${pid}`); i++) await Bun.sleep(100);
	} catch {
		// Already gone.
	}
}

/** Deletes attachments signal-cli downloaded a while ago (Sekai keeps its own copies of the ones it took). */
export async function pruneAttachments(dir = signalDir(), keepMs = ATTACHMENTS_KEEP_MS): Promise<number> {
	const folder = join(dir, "attachments");
	const names = await readdir(folder).catch(() => [] as string[]);
	let removed = 0;
	for (const name of names) {
		const path = join(folder, name);
		const info = await stat(path).catch(() => null);
		if (info?.isFile() && Date.now() - info.mtimeMs > keepMs) {
			await rm(path, { force: true }).catch(() => {});
			removed++;
		}
	}
	return removed;
}

const signalBase = () => `http://127.0.0.1:${daemon.port}`;

async function waitUntilUp(proc: Subprocess, until: number): Promise<void> {
	while (Date.now() < until) {
		if (proc.exitCode !== null) throw new Error(lastWords() || `it exited (${proc.exitCode})`);
		try {
			const res = await fetch(`${signalBase()}/api/v1/check`, { signal: AbortSignal.timeout(2_000) });
			if (res.ok) return;
		} catch {
			// Not listening yet.
		}
		await Bun.sleep(300);
	}
	throw new Error("it didn't start in time");
}

async function startDaemon(): Promise<void> {
	if (daemon.restart) clearTimeout(daemon.restart);
	daemon.restart = null;
	const binary = signalBinary();
	if (!binary) {
		setState("missing", missingText());
		return;
	}
	setState("starting");
	await stopLeftover();
	const dir = signalDir();
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	chmodSync(dir, 0o700);
	daemon.port = await freePort();
	daemon.output = [];
	const proc = spawn([binary, ...daemonArgs(dir, daemon.port)], {
		// Its own XDG config folder, so a signal-cli config.json someone made on this machine never applies.
		env: agentEnv({ XDG_CONFIG_HOME: join(dir, "xdg"), SIGNAL_CLI_CONFIG: "" }),
		stdout: "pipe",
		stderr: "pipe",
		stdin: "ignore",
	});
	daemon.proc = proc;
	await Bun.write(pidFile(), String(proc.pid ?? ""));
	void readOutput(proc.stdout as ReadableStream<Uint8Array> | undefined);
	void readOutput(proc.stderr as ReadableStream<Uint8Array> | undefined);
	void proc.exited.then((code) => {
		if (daemon.proc !== proc) return;
		daemon.proc = null;
		if (daemon.prune) clearInterval(daemon.prune);
		daemon.prune = null;
		if (daemon.stopping) return;
		const said = lastWords();
		log.warn(`signal: signal-cli stopped (exit ${code})${said ? `: ${said}` : ""}`);
		setState("error", `Signal's helper on this server stopped${said ? `: ${said}` : ""}. Sekai is restarting it.`);
		scheduleRestart();
	});
	try {
		await waitUntilUp(proc, Date.now() + START_TIMEOUT_MS);
		const v = await callRpc<{ version?: string }>(signalBase(), "version", {}, { timeoutMs: 10_000 }).catch(
			() => ({}) as { version?: string },
		);
		daemon.attempts = 0;
		setState("ready");
		daemon.version = v.version ?? null;
		log.info(`signal: signal-cli ${daemon.version ?? ""} on 127.0.0.1:${daemon.port}`);
		void pruneAttachments().catch(() => {});
		daemon.prune = setInterval(() => void pruneAttachments().catch(() => {}), 3_600_000);
		daemon.prune.unref?.();
	} catch (err) {
		const said = errorMessage(err);
		await stopProcess();
		setState("error", `Signal's helper didn't start: ${said}`);
		scheduleRestart();
	}
}

/** Tries again after a while (longer each time), while something still needs it. */
function scheduleRestart(): void {
	if (daemon.restart || daemon.stopping || holds.size === 0) return;
	const delay = RESTART_DELAYS_MS[Math.min(daemon.attempts, RESTART_DELAYS_MS.length - 1)] ?? 60_000;
	daemon.attempts++;
	daemon.restart = setTimeout(() => {
		daemon.restart = null;
		if (holds.size) void ensureDaemon();
	}, delay);
	daemon.restart.unref?.();
}

async function stopProcess(): Promise<void> {
	const proc = daemon.proc;
	if (daemon.prune) clearInterval(daemon.prune);
	daemon.prune = null;
	if (!proc) return;
	daemon.stopping = true;
	daemon.proc = null;
	try {
		proc.kill("SIGTERM");
		const done = await Promise.race([proc.exited.then(() => true), Bun.sleep(8_000).then(() => false)]);
		if (!done) proc.kill("SIGKILL");
	} catch {
		// Already gone.
	}
	await rm(pidFile(), { force: true }).catch(() => {});
	daemon.stopping = false;
}

/** Starts the daemon if it isn't running (or isn't being started already). Never throws. */
async function ensureDaemon(): Promise<void> {
	if (daemon.state === "ready" && daemon.proc) return;
	if (daemon.state === "installing") return;
	if (daemon.starting) return daemon.starting;
	daemon.starting = startDaemon().finally(() => {
		daemon.starting = null;
	});
	return daemon.starting;
}

/**
 * The daemon's address, starting it first if needed, for `holder` (an account's channel id, or a setup). It keeps
 * running (and is restarted after a crash) while anything holds it.
 */
export async function useSignalDaemon(holder: string): Promise<string> {
	holds.add(holder);
	if (daemon.idle) clearTimeout(daemon.idle);
	daemon.idle = null;
	await ensureDaemon();
	if (daemon.state !== "ready") {
		throw Object.assign(new Error(daemon.error ?? "Signal's helper isn't running yet."), {
			missing: daemon.state === "missing",
		});
	}
	return signalBase();
}

/** `holder` doesn't need the daemon any more: once nothing does, it stops. */
export function releaseSignalDaemon(holder: string): void {
	holds.delete(holder);
	if (holds.size || daemon.idle) return;
	daemon.idle = setTimeout(() => {
		daemon.idle = null;
		if (holds.size) return;
		if (daemon.restart) clearTimeout(daemon.restart);
		daemon.restart = null;
		void stopProcess().then(() => {
			if (!holds.size && daemon.state !== "installing") setState("off");
		});
	}, IDLE_STOP_MS);
	daemon.idle.unref?.();
}

/**
 * Admins' "Install it": downloads the pinned release in the background; the page follows the state. Throws at once
 * when it can't (another platform, already installing); the promise settles when the install is over.
 */
export function startSignalInstall(): Promise<void> {
	const support = installSupport();
	if (!support.ok) throw new HttpError(400, support.note);
	if (daemon.installing) throw new HttpError(409, "Signal is being installed already.");
	const controller = new AbortController();
	daemon.installing = controller;
	daemon.progress = 0;
	setState("installing");
	let lastShown = 0;
	return (async () => {
		try {
			await stopProcess();
			await installSignalCli({
				signal: controller.signal,
				onProgress: (bytes) => {
					daemon.progress = Math.min(1, bytes / SIGNAL_CLI_RELEASE.size);
					// A few updates a second at most.
					if (Date.now() - lastShown > 500) {
						lastShown = Date.now();
						bus.emit({ type: "settings.changed" });
					}
				},
			});
			log.info(`signal: installed signal-cli ${SIGNAL_CLI_VERSION}`);
			daemon.installing = null;
			daemon.progress = null;
			setState("off");
			if (holds.size) await ensureDaemon();
		} catch (err) {
			daemon.installing = null;
			daemon.progress = null;
			log.warn(`signal: install failed: ${errorMessage(err)}`);
			setState(signalBinary() ? "off" : "missing", errorMessage(err));
		}
	})();
}

export async function restartSignalDaemon(): Promise<void> {
	daemon.attempts = 0;
	await stopProcess();
	if (holds.size) await ensureDaemon();
	else setState("off");
}

/** On shutdown: stops the daemon and any install under way. */
export async function stopSignalDaemon(): Promise<void> {
	holds.clear();
	if (daemon.restart) clearTimeout(daemon.restart);
	if (daemon.idle) clearTimeout(daemon.idle);
	daemon.restart = daemon.idle = null;
	daemon.installing?.abort();
	daemon.installing = null;
	await stopProcess();
	setState("off");
}

export function signalEngineStatus(): SignalEngineStatus {
	const installed = signalBinary() !== null;
	const support = installSupport();
	const state: SignalEngineState = !installed && daemon.state !== "installing" ? "missing" : daemon.state;
	return {
		state,
		error: state === "missing" ? (daemon.error ?? missingText()) : daemon.error,
		version: daemon.version,
		installed,
		canInstall: support.ok && daemon.state !== "installing",
		installNote: support.ok ? null : support.note,
		progress: daemon.progress,
	};
}
