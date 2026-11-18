import { mkdirSync } from "node:fs";
import { join } from "node:path";
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
