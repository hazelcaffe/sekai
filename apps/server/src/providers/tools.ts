import { existsSync, readFileSync } from "node:fs";
import { chmod, mkdir, rename, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import {
	PROVIDER_PRESETS,
	PROVIDER_TOOL_IDS,
	PROVIDER_TOOLS,
	type ProviderTool,
	type ProviderToolId,
	type ProviderToolState,
	type ToolJob,
} from "@sekai/shared";
import { bus } from "../events/bus.ts";
import { badRequest, errorMessage } from "../lib/errors.ts";
import { log } from "../lib/log.ts";
import { agentEnv, OutputTail, toolsBinDir, toolsDir, withTools } from "./process.ts";

/**
 * Installs and inspects command-line tools that subscriptions need, inside Sekai's own tools folder
 * (`<data>/tools/`, first on agents' PATH) so admins never have to SSH in to install or update a CLI.
 */

const INSTALL_TIMEOUT_MS = 5 * 60_000;
const VERSION_TIMEOUT_MS = 4_000;
const VERSION_CACHE_MS = 60_000;

interface ToolMeta {
	version: string | null;
	installedAt: number;
}

const jobs = new Map<ProviderToolId, ToolJob>();
const running = new Set<ProviderToolId>();
const versionCache = new Map<string, { version: string | null; at: number }>();
let nodeVersionCache: { version: string | null; at: number } | null = null;

/** Extracts a semver version (e.g. `2.4.1`, `0.171.0-beta.1`) from a CLI's `--version` output. */
export function parseVersion(output: string): string | null {
	const match = output.match(/\bv?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/);
	return match?.[1] ?? null;
}

/** Compares two semver strings: negative if `a < b`, 0 if equal, positive if `a > b`. */
export function compareVersions(a: string, b: string): number {
	const [aCore = "", aPre = ""] = a.split("-", 2);
	const [bCore = "", bPre = ""] = b.split("-", 2);
	const ap = aCore.split(".").map((n) => Number.parseInt(n, 10) || 0);
	const bp = bCore.split(".").map((n) => Number.parseInt(n, 10) || 0);
	for (let i = 0; i < 3; i++) {
		const diff = (ap[i] ?? 0) - (bp[i] ?? 0);
		if (diff !== 0) return diff;
	}
	if (!aPre && !bPre) return 0;
	if (!aPre) return 1;
	if (!bPre) return -1;
	return aPre.localeCompare(bPre);
}

/** Whether `installed` is strictly older than `wanted` (returns false if either isn't a valid semver). */
export function isOlderVersion(installed: string | null, wanted: string | null): boolean {
	if (!wanted || wanted === "latest") return true;
	if (!installed) return true;
	const a = parseVersion(installed);
	const b = parseVersion(wanted);
	if (!a || !b) return false;
	return compareVersions(a, b) < 0;
}

/** Replaces `VERSION` placeholders in script installer arguments. */
export function resolveInstallArgs(args: string[], version: string): string[] {
	return args.map((a) => (a === "VERSION" ? version : a));
}

/** Replaces `DIR` or `DIR/...` placeholders in script installer environment variables. */
export function resolveInstallEnv(env: Record<string, string>, dir: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(env)) {
		if (v === "DIR") out[k] = dir;
		else if (v.startsWith("DIR/")) out[k] = join(dir, v.slice(4));
		else out[k] = v;
	}
	return out;
}

export function isToolId(value: string): value is ProviderToolId {
	return (PROVIDER_TOOL_IDS as readonly string[]).includes(value);
}

function metaPath(id: ProviderToolId): string {
	return join(toolsDir(), "meta", `${id}.json`);
}

function readMeta(id: ProviderToolId): ToolMeta | null {
	try {
		const raw = readFileSync(metaPath(id), "utf8");
		const parsed = JSON.parse(raw) as Partial<ToolMeta>;
		return {
			version: typeof parsed.version === "string" ? parsed.version : null,
			installedAt: typeof parsed.installedAt === "number" ? parsed.installedAt : 0,
		};
	} catch {
		return null;
	}
}

async function writeMeta(id: ProviderToolId, meta: ToolMeta): Promise<void> {
	const dir = join(toolsDir(), "meta");
	await mkdir(dir, { recursive: true, mode: 0o755 });
	await writeFile(metaPath(id), JSON.stringify(meta, null, 2));
}

async function probeBinaryVersion(binPath: string): Promise<string | null> {
	const cached = versionCache.get(binPath);
	if (cached && Date.now() - cached.at < VERSION_CACHE_MS) return cached.version;
	let version: string | null = null;
	try {
		const proc = Bun.spawn([binPath, "--version"], {
			stdout: "pipe",
			stderr: "pipe",
			env: agentEnv({}),
		});
		const timer = setTimeout(() => {
			try {
				proc.kill();
			} catch {}
		}, VERSION_TIMEOUT_MS);
		try {
			const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
			await proc.exited;
			version = parseVersion(out) ?? parseVersion(err);
		} finally {
			clearTimeout(timer);
		}
	} catch {
		version = null;
	}
	versionCache.set(binPath, { version, at: Date.now() });
	return version;
}

async function detectNodeVersion(): Promise<string | null> {
	if (nodeVersionCache && Date.now() - nodeVersionCache.at < VERSION_CACHE_MS) return nodeVersionCache.version;
	const node = Bun.which("node");
	const version = node ? await probeBinaryVersion(node) : null;
	nodeVersionCache = { version, at: Date.now() };
	return version;
}

/** Clears cached version lookups (used after installs or in tests). */
export function clearToolCaches(): void {
	versionCache.clear();
	nodeVersionCache = null;
}

/** Whether a tool is managed by Sekai (its resolved binary is inside `<data>/tools`). */
function isManagedPath(binPath: string | null): boolean {
	if (!binPath) return false;
	const root = resolve(toolsDir());
	const full = resolve(binPath);
	return full === root || full.startsWith(`${root}/`) || full.startsWith(`${root}\\`);
}

/** Checks why a tool can't be installed automatically on this server, if at all. */
export async function toolUnavailableReason(tool: ProviderTool): Promise<string | null> {
	if (tool.install.kind === "manual") return tool.install.reason;
	if (tool.install.kind === "script" && process.platform === "win32") {
		return `${tool.title}'s installer only runs on Linux or macOS.`;
	}
	if (tool.install.kind === "npm" && tool.install.node) {
		const nodeVersion = await detectNodeVersion();
		if (!nodeVersion) {
			return `${tool.title} needs Node.js ${tool.install.node} or later on this server.`;
		}
		if (compareVersions(nodeVersion, tool.install.node) < 0) {
			return `${tool.title} needs Node.js ${tool.install.node} or later (this server has ${nodeVersion}).`;
		}
	}
	return null;
}

/** Inspects a tool's current state on this server. */
export async function inspectTool(
	id: ProviderToolId,
	role: "agent" | "signin",
	opts: { isAdmin: boolean; envPath?: string },
): Promise<ProviderToolState> {
	const tool = PROVIDER_TOOLS[id];
	const searchPath = withTools(opts.envPath ?? process.env.PATH);
	const found = Bun.which(tool.bin, { PATH: searchPath }) ?? null;
	const managed = isManagedPath(found);
	const meta = managed ? readMeta(id) : null;
	const version = found ? (meta?.version ?? (await probeBinaryVersion(found))) : null;
	const unavailable = await toolUnavailableReason(tool);
	const wanted = tool.install.kind === "manual" ? null : tool.install.version;
	const unpinned = tool.install.kind === "manual" ? null : (tool.install.unpinned ?? null);
	const updateAvailable =
		managed && !unavailable && wanted !== null && (wanted === "latest" || isOlderVersion(version, wanted));

	return {
		id,
		title: tool.title,
		role,
		path: opts.isAdmin ? found : null,
		installed: found !== null,
		managed,
		version,
		wanted,
		unpinned,
		updateAvailable,
		unavailable,
		job: jobs.get(id) ?? null,
	};
}

function setJob(id: ProviderToolId, job: ToolJob): void {
	jobs.set(id, job);
	bus.emit({ type: "provider.changed", providerId: "*" });
}

async function runInstallCommand(
	argv: string[],
	opts: { cwd: string; env: Record<string, string>; label: string },
): Promise<void> {
	const tail = new OutputTail();
	const proc = Bun.spawn(argv, {
		cwd: opts.cwd,
		env: opts.env,
		stdout: "pipe",
		stderr: "pipe",
	});
	const timer = setTimeout(() => {
		try {
			proc.kill();
		} catch {}
	}, INSTALL_TIMEOUT_MS);

	const drain = async (stream: ReadableStream<Uint8Array> | null) => {
		if (!stream) return;
		const reader = stream.getReader();
		const dec = new TextDecoder();
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				tail.push(dec.decode(value, { stream: true }));
			}
		} finally {
			reader.releaseLock();
		}
	};

	try {
		await Promise.all([drain(proc.stdout), drain(proc.stderr)]);
		const code = await proc.exited;
		if (code !== 0) {
			const detail = tail.last(4);
			throw new Error(detail ? `${opts.label} failed: ${detail}` : `${opts.label} exited with code ${code}.`);
		}
	} finally {
		clearTimeout(timer);
	}
}

async function linkToolBin(binName: string, targetPath: string): Promise<string> {
	const binDir = toolsBinDir();
	await mkdir(binDir, { recursive: true, mode: 0o755 });
	const linkPath = join(binDir, binName);
	await unlink(linkPath).catch(() => {});
	const rel = relative(binDir, targetPath);
	await symlink(rel, linkPath);
	return linkPath;
}

async function installNpmTool(
	tool: ProviderTool,
	install: Extract<ProviderTool["install"], { kind: "npm" }>,
	step: (s: string) => void,
): Promise<string | null> {
	const root = toolsDir();
	const tmpBase = join(root, ".tmp");
	const stage = join(tmpBase, `${tool.id}-${Date.now()}`);
	const pkgDest = join(root, "pkg", tool.id);
	const pkgOld = `${pkgDest}.old-${Date.now()}`;
	await mkdir(stage, { recursive: true, mode: 0o755 });
	await mkdir(join(root, "pkg"), { recursive: true, mode: 0o755 });
	try {
		await writeFile(
			join(stage, "package.json"),
			JSON.stringify({ private: true, trustedDependencies: [install.package] }, null, 2),
		);
		const spec = `${install.package}@${install.version}`;
		step(`Installing ${spec}…`);
		await runInstallCommand([process.execPath, "add", "--exact", spec], {
			cwd: stage,
			env: agentEnv({}),
			label: `Installing ${tool.title}`,
		});

		const binRel = join("node_modules", ".bin", tool.bin);
		if (!existsSync(join(stage, binRel))) {
			throw new Error(`Installed ${install.package}, but "${tool.bin}" wasn't found in its package.`);
		}

		let version: string | null = null;
		try {
			const pkgJson = JSON.parse(
				readFileSync(join(stage, "node_modules", install.package, "package.json"), "utf8"),
			) as {
				version?: string;
			};
			if (typeof pkgJson.version === "string") version = pkgJson.version;
		} catch {}

		step("Finishing up…");
		if (existsSync(pkgDest)) await rename(pkgDest, pkgOld);
		try {
			await rename(stage, pkgDest);
		} catch (err) {
			if (existsSync(pkgOld) && !existsSync(pkgDest)) await rename(pkgOld, pkgDest).catch(() => {});
			throw err;
		}
		await rm(pkgOld, { recursive: true, force: true }).catch(() => {});

		const linkPath = await linkToolBin(tool.bin, join(pkgDest, binRel));
		versionCache.delete(linkPath);
		if (!version) version = await probeBinaryVersion(linkPath);
		return version;
	} finally {
		await rm(stage, { recursive: true, force: true }).catch(() => {});
	}
}

async function installScriptTool(
	tool: ProviderTool,
	install: Extract<ProviderTool["install"], { kind: "script" }>,
	step: (s: string) => void,
): Promise<string | null> {
	if (!install.url.startsWith("https://")) {
		throw new Error("Refusing to download an installer over an unencrypted connection.");
	}
	const root = toolsDir();
	const tmpDir = join(root, ".tmp");
	const destDir = join(root, "native", tool.id);
	const scriptPath = join(tmpDir, `${tool.id}-${Date.now()}.sh`);
	await mkdir(tmpDir, { recursive: true, mode: 0o755 });
	await mkdir(destDir, { recursive: true, mode: 0o755 });

	try {
		step(`Downloading ${tool.title} installer…`);
		const res = await fetch(install.url, { signal: AbortSignal.timeout(30_000) });
		if (!res.ok) throw new Error(`Couldn't download the ${tool.title} installer (HTTP ${res.status}).`);
		const script = await res.text();
		if (!script.trim()) throw new Error(`The ${tool.title} installer download was empty.`);
		await writeFile(scriptPath, script, { mode: 0o700 });
		await chmod(scriptPath, 0o700);

		const args = resolveInstallArgs(install.args, install.version);
		const env = agentEnv(resolveInstallEnv(install.env, destDir));
		step(
			install.version === "latest" ? `Installing ${tool.title}…` : `Installing ${tool.title} ${install.version}…`,
		);
		await runInstallCommand(["bash", scriptPath, ...args], {
			cwd: destDir,
			env,
			label: `Installing ${tool.title}`,
		});

		const binTarget = join(destDir, install.binPath);
		if (!existsSync(binTarget)) {
			throw new Error(`The ${tool.title} installer finished, but "${install.binPath}" wasn't found.`);
		}

		step("Checking installed version…");
		const linkPath = await linkToolBin(tool.bin, binTarget);
		versionCache.delete(linkPath);
		versionCache.delete(binTarget);
		const version = await probeBinaryVersion(linkPath);
		return version ?? (install.version !== "latest" ? install.version : null);
	} finally {
		await rm(scriptPath, { force: true }).catch(() => {});
	}
}

/**
 * Starts installing (or updating) a tool into `<data>/tools/`. Returns immediately; progress and completion
 * arrive via `provider.changed` events and `setup.tools[].job`. Calls `onInstalled` once the tool is ready.
 */
export async function startToolInstall(
	id: ProviderToolId,
	onInstalled?: (toolId: ProviderToolId) => void,
): Promise<void> {
	const tool = PROVIDER_TOOLS[id];
	const unavailable = await toolUnavailableReason(tool);
	if (unavailable) throw badRequest(unavailable);
	if (running.has(id)) return;

	running.add(id);
	const startedAt = Date.now();
	const updateStep = (step: string) =>
		setJob(id, { state: "running", step, error: null, version: null, startedAt, endedAt: null });
	updateStep(`Starting ${tool.title} install…`);

	void (async () => {
		try {
			const version =
				tool.install.kind === "npm"
					? await installNpmTool(tool, tool.install, updateStep)
					: tool.install.kind === "script"
						? await installScriptTool(tool, tool.install, updateStep)
						: null;
			await writeMeta(id, { version, installedAt: Date.now() });
			clearToolCaches();
			setJob(id, {
				state: "done",
				step: version ? `Installed ${version}` : "Installed",
				error: null,
				version,
				startedAt,
				endedAt: Date.now(),
			});
			onInstalled?.(id);
		} catch (err) {
			const msg = errorMessage(err);
			log.warn(`install tool ${id}: ${msg}`);
			setJob(id, {
				state: "failed",
				step: "Install failed",
				error: msg,
				version: null,
				startedAt,
				endedAt: Date.now(),
			});
		} finally {
			running.delete(id);
		}
	})();
}

/** Presets that depend on a given tool (used to re-check affected subscriptions after an install). */
export function presetsUsingTool(id: ProviderToolId): Set<string> {
	const out = new Set<string>();
	for (const preset of Object.values(PROVIDER_PRESETS)) {
		if (preset.tools.some((t) => t.id === id)) out.add(preset.id);
	}
	return out;
}
