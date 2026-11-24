import { chmodSync, mkdirSync } from "node:fs";
import { delimiter, join } from "node:path";
import { PROVIDER_PRESETS, type Provider } from "@sekai/shared";
import { config } from "../config.ts";

/** Sekai's own secrets never reach a third-party agent process. */
const PRIVATE_ENV =
	/^(SEKAI_|GATEWAY_|DATABASE_URL$|POSTGRES_|PLNTR_|PGPASSWORD$|PROXMOX_|TAILSCALE_|DISCORD_|ELEVENLABS_|FISH_)/;

export function agentEnv(extra: Record<string, string>): Record<string, string> {
	const env: Record<string, string> = {};
	for (const [k, v] of Object.entries(process.env)) {
		if (v !== undefined && !PRIVATE_ENV.test(k)) env[k] = v;
	}
	for (const [k, v] of Object.entries(extra)) {
		if (v === "") delete env[k];
		else env[k] = v;
	}
	return env;
}

/** Sekai's own tools folder: CLIs it installed for subscriptions (see tools.ts). */
export function toolsDir(): string {
	return join(config.dataDir, "tools");
}

/** Links to the installed tools' executables; first on subscription CLIs' PATH. */
export function toolsBinDir(): string {
	return join(toolsDir(), "bin");
}

/** PATH with Sekai's tools first. */
export function withTools(path: string | undefined): string {
	const bin = toolsBinDir();
	const rest = (path ?? "").split(delimiter).filter((p) => p && p !== bin);
	return [bin, ...rest].join(delimiter);
}

/** A subscription's own folder, for the sign-in and settings of its CLI (only Sekai's account can read it). */
export function providerDir(providerId: string): string {
	if (!/^prv_[A-Za-z0-9_-]+$/.test(providerId)) throw new Error("Unexpected subscription id");
	return join(config.dataDir, "providers", providerId);
}

/**
 * Environment variables pointing the subscription's CLI at its own folders (its preset's configDirs), when it
 * keeps its own sign-in. Creates them, private to Sekai's account.
 */
export function configEnv(provider: Provider, create = true): Record<string, string> {
	if (!provider.ownConfig) return {};
	const root = join(config.dataDir, "providers");
	const base = providerDir(provider.id);
	const out: Record<string, string> = {};
	for (const [key, sub] of Object.entries(PROVIDER_PRESETS[provider.preset].configDirs)) {
		out[key] = join(base, sub);
	}
	if (create) {
		for (const dir of [root, base, ...Object.values(out)]) {
			mkdirSync(dir, { recursive: true, mode: 0o700 });
			chmodSync(dir, 0o700);
		}
	}
	return out;
}

/**
 * How a subscription's CLI runs: Sekai's secrets left out, Sekai's tools first on PATH, its own folders when it
 * keeps its own sign-in, then the env set on it (which wins).
 */
export function providerEnv(provider: Provider): Record<string, string> {
	const env = agentEnv({ ...configEnv(provider), ...provider.env });
	env.PATH = withTools(env.PATH);
	return env;
}

/** pi-acp doesn't ask before running Pi's native tools. Force a chat-only Pi underneath it. */
export function acpEnv(provider: Provider): Record<string, string> {
	const env = providerEnv(provider);
	if (provider.preset !== "pi") return env;
	if (process.platform === "win32") throw new Error("The Pi preset needs a Linux or macOS server (or Docker).");
	const launcher = join(import.meta.dir, "pi-chat.sh");
	const command = env.PI_ACP_PI_COMMAND || "pi";
	const pi = Bun.which(command, { PATH: env.PATH });
	if (!pi || pi === launcher) {
		throw new Error(
			"Install Pi on the server and put it on the server's PATH, or set PI_ACP_PI_COMMAND to its full path.",
		);
	}
	return { ...env, PI_ACP_PI_COMMAND: launcher, SEKAI_PI_EXECUTABLE: pi };
}

/** Each agent gets its own folder for the external agent's files, shell commands and attachments. */
export function workspaceDir(agentId: string): string {
	const dir = join(config.dataDir, "workspaces", agentId);
	mkdirSync(join(dir, "inbox"), { recursive: true });
	return dir;
}

/** A scratch folder for provider checks, so they never touch an agent's files. */
export function checkDir(): string {
	const dir = join(config.dataDir, "workspaces", "_check");
	mkdirSync(dir, { recursive: true });
	return dir;
}

/** Keeps the last few KB of a process's stderr, for error messages. */
export class OutputTail {
	private text = "";
	constructor(private readonly max = 8_000) {}

	push(chunk: string): void {
		this.text = (this.text + chunk).slice(-this.max);
	}

	/** The last meaningful lines, for showing next to an error. */
	last(lines = 6): string {
		return this.text
			.split(/\r?\n/)
			.map((l) => l.trim())
			.filter(Boolean)
			.slice(-lines)
			.join("\n");
	}
}

export async function pipeText(stream: ReadableStream<Uint8Array>, onText: (text: string) => void): Promise<void> {
	const decoder = new TextDecoder();
	try {
		for await (const chunk of stream) onText(decoder.decode(chunk, { stream: true }));
	} catch {
		// The process went away; nothing more to read.
	}
}

/** Rejects after ms with a readable message, unless the promise settles first. */
export function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | null = null;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new Error(`${what} timed out after ${Math.round(ms / 1000)}s`)), ms);
	});
	return Promise.race([promise, timeout]).finally(() => {
		if (timer) clearTimeout(timer);
	});
}
