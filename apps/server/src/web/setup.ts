import { readFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { join, resolve } from "node:path";
import type { WebSetup, WebSetupStep } from "@sekai/shared";
import { gatewayModel } from "../agent/models.ts";
import { currentActor, runAs } from "../auth/actor.ts";
import { config } from "../config.ts";
import { errorMessage, HttpError } from "../lib/errors.ts";
import { log } from "../lib/log.ts";
import { chat } from "../llm/gateway.ts";
import type { ChatMessage, ChatTool } from "../llm/types.ts";
import { agentEnv } from "../providers/process.ts";
import { getSettings } from "../services/settings.ts";
import { firecrawlBinary, startWebEngine, webEngineStatus } from "./engine.ts";
import { saveWebSettings, webSettings } from "./settings.ts";

/**
 * "Set it up for me": a model installs Firecrawl Local on this server. It runs shell commands here, as Sekai's own
 * account, one at a time and visible in Settings → Web reading; Sekai checks each one first (guardCommand) and turns
 * the engine on when the model says it's done, telling it what went wrong if it doesn't start.
 */

const MAX_TOOL_CALLS = 40;
const MAX_RUN_MS = 75 * 60_000;
const MAX_COMMAND_MS = 40 * 60_000;
/** What the model and the page see of a command's output: its end. */
const OUTPUT_FOR_MODEL = 3500;
const OUTPUT_KEPT = 8000;

const FRESH: WebSetup = { state: "idle", model: null, startedAt: null, finishedAt: null, steps: [], summary: null };

let setup: WebSetup = { ...FRESH, steps: [] };
let controller: AbortController | null = null;
let running: { pid: number } | null = null;

/** The current or last setup run. */
export function webSetupStatus(): WebSetup {
	return setup;
}

export function webSetupRunning(): boolean {
	return setup.state === "running";
}

// ---------------------------------------------------------------- what may run

/** Sekai's own files: its repository and its data folder. */
function sekaiPaths(): string[] {
	const repo = resolve(import.meta.dir, "../../../..");
	return [...new Set([repo, resolve(config.dataDir)])].filter((p) => p.length > 1);
}

/**
 * Why a command may not run, or null when it may. Setting up a program needs packages, a download and a build:
 * nothing that stops this server, touches Sekai's own files, other accounts or other machines.
 */
export function guardCommand(command: string, own: string[] = sekaiPaths(), home = homedir()): string | null {
	const c = command.trim();
	if (!c) return "That's an empty command.";
	if (c.length > 4000) return "That command is too long. Split it up.";
	const tilde = (p: string) => (p.startsWith(home) ? `~${p.slice(home.length)}` : p);
	for (const p of own) {
		if (c.includes(p) || c.includes(tilde(p)) || c.includes(p.replace(home, "$HOME"))) {
			return "That touches Sekai's own files, which setting up Firecrawl Local never needs.";
		}
	}
	if (/(^|[\s;&|/])\.env\b/.test(c)) return "That touches an environment file, which may hold secrets.";
	const rules: [RegExp, string][] = [
		[/\b(reboot|shutdown|poweroff|halt|init\s+[06])\b/, "That would stop this server."],
		[/\bsystemctl\b(?!\s+(status|is-active|list-units|show)\b)/, "Sekai doesn't let this start or stop services."],
		[/\b(service|kill|pkill|killall)\b/, "That stops programs, which setting up Firecrawl Local never needs."],
		[/\b(docker|podman|kubectl|tailscale)\b/, "That manages containers or the network, which isn't part of this."],
		[/\b(ssh|scp|sftp|rsync)\b/, "Setting it up happens on this server only."],
		[
			/\b(userdel|useradd|usermod|passwd|chpasswd|visudo|chown|crontab|mkfs|fdisk|parted|mount|umount)\b/,
			"That changes accounts, disks or schedules.",
		],
		[/\bdd\s+[^|]*of=|>\s*\/dev\/(sd|nvme|vd|xvd)/, "That writes to a disk directly."],
		[/\brm\s+(-[a-zA-Z]*\s+)*(\/|~|\$HOME|\/\*)\s*($|[;&|])/, "That would delete everything there."],
		[
			/\b(chmod|chgrp)\s+(-[a-zA-Z]*\s+)*[0-7a-z+=,-]+\s+\/(\s|$)/,
			"That changes permissions for the whole system.",
		],
	];
	for (const [re, why] of rules) if (re.test(c)) return why;
	// A shell fed from the internet: only Rust's own installer.
	if (
		/\b(curl|wget)\b[^|;&]*\|\s*(sudo\s+(-\S+\s+)*)?(ba|z|da)?sh\b/.test(c) &&
		!/https:\/\/sh\.rustup\.rs\b/.test(c)
	) {
		return "Only Rust's installer (https://sh.rustup.rs) may be piped into a shell.";
	}
	// Root only for the package manager, and never asking for a password.
	for (const m of c.matchAll(/\bsudo\b([^;&|]*)/g)) {
		const rest = (m[1] ?? "").trim();
		if (!/^-n\b/.test(rest)) return "Use sudo -n (Sekai can't type a password).";
		const what = rest.replace(/^(-[a-zA-Z]+\s+)*/, "").replace(/^(\w+=\S*\s+)*/, "");
		if (!/^(apt-get|apt|dpkg|dnf|yum|microdnf|apk|pacman|zypper)\b/.test(what)) {
			return "sudo is only for the package manager (apt-get, dnf, apk, pacman, zypper) here.";
		}
	}
	return null;
}

// ---------------------------------------------------------------- running a command

function stepOf(
	partial: Omit<WebSetupStep, "id" | "startedAt" | "finishedAt" | "output" | "exitCode" | "running" | "refused"> &
		Partial<WebSetupStep>,
): WebSetupStep {
	const step: WebSetupStep = {
		id: setup.steps.length + 1,
		output: "",
		exitCode: null,
		running: false,
		refused: null,
		startedAt: Date.now(),
		finishedAt: null,
		...partial,
	};
	setup.steps.push(step);
	return step;
}

const tail = (s: string, n: number) => (s.length > n ? `…${s.slice(-n)}` : s);

/** The environment commands get: no Sekai secrets, Rust's folder on the path, no prompts. */
function commandEnv(): Record<string, string> {
	const home = homedir();
	return agentEnv({
		HOME: home,
		PATH: `${join(home, ".cargo", "bin")}:${process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin"}`,
		DEBIAN_FRONTEND: "noninteractive",
		CARGO_TERM_COLOR: "never",
		CARGO_TERM_PROGRESS_WHEN: "never",
		NO_COLOR: "1",
		TERM: "dumb",
	});
}

async function runCommand(step: WebSetupStep, command: string, timeoutMs: number, signal: AbortSignal) {
	step.running = true;
	// setsid: the command leads its own process group, so stopping it stops what it started too (a build).
	const proc = Bun.spawn(["setsid", "bash", "-c", command], {
		cwd: homedir(),
		env: commandEnv(),
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
	});
	running = { pid: proc.pid };
	const stopGroup = () => {
		try {
			process.kill(-proc.pid, "SIGTERM");
		} catch {
			proc.kill();
		}
	};
	const timer = setTimeout(stopGroup, timeoutMs);
	signal.addEventListener("abort", stopGroup, { once: true });
	let out = "";
	const read = async (stream: ReadableStream<Uint8Array>) => {
		const decoder = new TextDecoder();
		for await (const chunk of stream) {
			out = tail(out + decoder.decode(chunk, { stream: true }).replace(/\r(?!\n)/g, "\n"), OUTPUT_KEPT);
			step.output = out;
		}
	};
	await Promise.all([
		read(proc.stdout as ReadableStream<Uint8Array>),
		read(proc.stderr as ReadableStream<Uint8Array>),
		proc.exited,
	]);
	clearTimeout(timer);
	signal.removeEventListener("abort", stopGroup);
	running = null;
	step.running = false;
	step.exitCode = proc.exitCode ?? -1;
	step.finishedAt = Date.now();
	const timedOut = Date.now() - step.startedAt >= timeoutMs - 50;
	return { exitCode: step.exitCode, output: out, timedOut };
}

// ---------------------------------------------------------------- the model's side

const TOOLS: ChatTool[] = [
	{
		type: "function",
		function: {
			name: "run_command",
			description:
				"Run a bash command on this server, as Sekai's own account, in its home folder. No prompts can be answered: pass -y and the like. You get the exit code and the end of the output. Builds take a while: give a longer timeout for cargo install.",
			parameters: {
				type: "object",
				properties: {
					why: { type: "string", description: "One short line: what this does, for the person watching." },
					command: { type: "string" },
					timeoutMinutes: { type: "number", description: "Default 5, at most 40." },
				},
				required: ["why", "command"],
			},
		},
	},
	{
		type: "function",
		function: {
			name: "check_installed",
			description: "Whether Sekai can find the firecrawl-local program now, where, and its version.",
			parameters: { type: "object", properties: {} },
		},
	},
	{
		type: "function",
		function: {
			name: "finish",
			description:
				"End the setup. success: true once check_installed finds it; Sekai then starts it and tells you if it doesn't answer (then fix that and call finish again). false when it can't be done: say why and what the person could do.",
			parameters: {
				type: "object",
				properties: {
					success: { type: "boolean" },
					summary: {
						type: "string",
						description: "Two or three plain sentences for the person: what you did, or what's in the way.",
					},
				},
				required: ["success", "summary"],
			},
		},
	},
];

function osRelease(): string {
	try {
		const text = readFileSync("/etc/os-release", "utf8");
		return /^PRETTY_NAME="?([^"\n]+)"?/m.exec(text)?.[1] ?? "Linux";
	} catch {
		return process.platform;
	}
}

async function canSudo(): Promise<boolean> {
	const p = Bun.spawn(["sudo", "-n", "true"], { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
	return (await p.exited) === 0;
}

export function systemPrompt(facts: { os: string; arch: string; user: string; home: string; sudo: boolean }): string {
	return [
		"You're setting up Firecrawl Local on the server Sekai runs on, so Sekai's bots can read web pages as clean Markdown. Firecrawl Local is a Rust program: `cargo install firecrawl-local --locked` builds it into ~/.cargo/bin, where Sekai looks for it.",
		"",
		`This server: ${facts.os}, ${facts.arch}. You run commands as ${facts.user} (home ${facts.home}). ${facts.sudo ? "sudo -n works, for the package manager only." : "sudo isn't available: install only what this account can (Rust's own installer works without root)."}`,
		"",
		"The usual way:",
		"1. Look first: is cargo there (~/.cargo/bin/cargo)? A C compiler (cc), make, pkg-config? How much disk is free?",
		`2. Build tools, if they're missing: ${facts.sudo ? "on Debian or Ubuntu `sudo -n apt-get update && sudo -n apt-get install -y build-essential pkg-config libssl-dev curl ca-certificates` (dnf, apk, pacman, zypper elsewhere)" : "they need root, so if cc is missing, stop and say what the person should install"}.`,
		"3. Rust, if cargo is missing: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal`.",
		"4. `~/.cargo/bin/cargo install firecrawl-local --locked`, with a long timeout (30 to 40 minutes). If it fails, read the error: usually a missing library (install its -dev package) or too little memory (try `--jobs 1`).",
		"5. check_installed, then finish with success: true.",
		"",
		"Rules: only do what setting up Firecrawl Local needs. Don't touch Sekai's own files or settings, other accounts, services or other machines; Sekai refuses such commands and tells you why. Keep each command short and check its result before the next. When something can't be done here, finish with success: false and say plainly what's in the way.",
	].join("\n");
}

function finish(state: WebSetup["state"], summary: string | null): void {
	setup.state = state;
	setup.summary = summary;
	setup.finishedAt = Date.now();
	controller = null;
	log.info(`web setup: ${state}${summary ? ` (${summary.slice(0, 200)})` : ""}`);
}

async function loop(signal: AbortSignal): Promise<void> {
	const settings = await getSettings();
	const model = gatewayModel(settings.defaultModel) ?? gatewayModel(settings.defaultFastModel);
	if (!model) {
		finish("failed", "There's no model to do it with: pick a default model in Settings → Models first.");
		return;
	}
	setup.model = model.model;
	const facts = {
		os: osRelease(),
		arch: process.arch,
		user: userInfo().username,
		home: homedir(),
		sudo: await canSudo(),
	};
	const messages: ChatMessage[] = [
		{ role: "system", content: systemPrompt(facts) },
		{ role: "user", content: "Set up Firecrawl Local on this server now." },
	];
	const deadline = Date.now() + MAX_RUN_MS;
	for (let calls = 0; calls < MAX_TOOL_CALLS; ) {
		if (signal.aborted) return;
		if (Date.now() > deadline) {
			finish("failed", "It took too long, so it stopped. The steps above show how far it got.");
			return;
		}
		const result = await chat({
			model: model.model,
			thinking: model.thinking,
			messages,
			tools: TOOLS,
			maxTokens: 4000,
			signal,
			meter: { agentId: null, purpose: "background" },
		});
		if (result.text.trim())
			stepOf({ kind: "note", text: result.text.trim().slice(0, 2000), command: null }).finishedAt = Date.now();
		messages.push({
			role: "assistant",
			content: result.text || null,
			tool_calls: result.toolCalls.length ? result.toolCalls : undefined,
		});
		if (!result.toolCalls.length) {
			messages.push({ role: "user", content: "Carry on with the tools, or call finish." });
			calls++;
			continue;
		}
		for (const call of result.toolCalls) {
			calls++;
			let args: Record<string, unknown> = {};
			try {
				args = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>;
			} catch {}
			const answer = await handle(call.function.name, args, signal);
			if (answer.done) return;
			messages.push({ role: "tool", tool_call_id: call.id, content: answer.content });
		}
	}
	finish("failed", "It used all its steps without finishing. The steps above show how far it got.");
}

async function handle(
	name: string,
	args: Record<string, unknown>,
	signal: AbortSignal,
): Promise<{ content: string; done?: boolean }> {
	if (name === "run_command") {
		const command = String(args.command ?? "");
		const why = String(args.why ?? "").slice(0, 300) || "Running a command";
		const step = stepOf({ kind: "command", text: why, command: command.slice(0, 4000) });
		const refused = guardCommand(command);
		if (refused) {
			step.refused = refused;
			step.finishedAt = Date.now();
			return { content: `Sekai didn't run it: ${refused}` };
		}
		const minutes = Math.min(40, Math.max(0.5, Number(args.timeoutMinutes) || 5));
		const r = await runCommand(step, command, Math.min(MAX_COMMAND_MS, minutes * 60_000), signal);
		if (signal.aborted) return { content: "Stopped.", done: true };
		return {
			content: `${r.timedOut ? `Timed out after ${minutes} minutes. ` : ""}Exit code ${r.exitCode}.\n${tail(r.output, OUTPUT_FOR_MODEL) || "(no output)"}`,
		};
	}
	if (name === "check_installed") {
		const binary = firecrawlBinary();
		if (!binary) return { content: "Not found in ~/.cargo/bin, /usr/local/bin or on the PATH." };
		const p = Bun.spawn([binary, "--version"], { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
		const version = (await new Response(p.stdout as ReadableStream).text()).trim();
		await p.exited;
		return { content: `Found ${binary}${version ? ` (${version})` : ""}.` };
	}
	if (name === "finish") {
		const summary = String(args.summary ?? "").slice(0, 1500) || null;
		if (!args.success) {
			finish("failed", summary);
			return { content: "", done: true };
		}
		if (!firecrawlBinary()) {
			return {
				content:
					"Sekai can't find firecrawl-local yet (check_installed). Install it first, or finish with success: false.",
			};
		}
		if ((await webSettings()).mode !== "here") await saveWebSettings({ mode: "here" });
		await startWebEngine();
		const status = await webEngineStatus();
		if (status.state === "ready") {
			finish("done", summary);
			return { content: "", done: true };
		}
		return {
			content: `It's installed, but it doesn't start: ${status.error ?? status.state}. Fix that if you can, then call finish again.`,
		};
	}
	return { content: `There's no tool called ${name}.` };
}

/** Starts a setup run (admins, from Settings → Web reading). Returns at once: the page follows the steps. */
export function startWebSetup(isInstalling: () => boolean): WebSetup {
	if (setup.state === "running") throw new HttpError(409, "It's setting it up already.");
	if (isInstalling()) throw new HttpError(409, "Firecrawl Local is installing already.");
	setup = { state: "running", model: null, startedAt: Date.now(), finishedAt: null, steps: [], summary: null };
	controller = new AbortController();
	const signal = controller.signal;
	const actor = currentActor();
	log.info("web setup: started");
	void runAs(actor, () =>
		loop(signal).catch((err: unknown) => {
			if (signal.aborted) return;
			finish("failed", `It stopped with an error: ${errorMessage(err).slice(0, 300)}`);
		}),
	);
	return setup;
}

/** Stops a setup run, and the command it's running. */
export function stopWebSetup(): WebSetup {
	if (setup.state !== "running") return setup;
	controller?.abort();
	if (running) {
		try {
			process.kill(-running.pid, "SIGTERM");
		} catch {}
	}
	for (const s of setup.steps) if (s.running) s.running = false;
	finish("stopped", null);
	return setup;
}

/** For tests. */
export function resetWebSetup(): void {
	stopWebSetup();
	setup = { ...FRESH, steps: [] };
}
