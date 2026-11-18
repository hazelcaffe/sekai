import { type ChildProcess, spawn } from "node:child_process";
import { appendFile, mkdir, open, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

/** Commands and files on this computer, for bots you've allowed. Paths are relative to the chosen folder. */

const MAX_OUTPUT = 2 * 1024 * 1024;

export function resolvePath(path: string, workdir: string): string {
	const expanded =
		path === "~"
			? homedir()
			: path.startsWith("~/") || path.startsWith("~\\")
				? join(homedir(), path.slice(2))
				: path;
	return isAbsolute(expanded) ? expanded : resolve(expandHome(workdir), expanded);
}

export function expandHome(dir: string): string {
	return dir === "~" || dir.startsWith("~/") || dir.startsWith("~\\") ? join(homedir(), dir.slice(1)) : dir;
}

/** The user's own shell: PowerShell on Windows, their login shell elsewhere (so PATH matches their terminal). */
function shellFor(command: string): { file: string; args: string[] } {
	if (process.platform === "win32") {
		return {
			file: "powershell.exe",
			args: [
				"-NoLogo",
				"-NoProfile",
				"-NonInteractive",
				"-ExecutionPolicy",
				"Bypass",
				"-Command",
				`[Console]::OutputEncoding = [Text.Encoding]::UTF8; $OutputEncoding = [Text.Encoding]::UTF8; ${command}`,
			],
		};
	}
	const shell = process.env.SHELL || (process.platform === "darwin" ? "/bin/zsh" : "/bin/bash");
	return { file: shell, args: ["-lc", command] };
}

function killTree(child: ChildProcess): void {
	if (!child.pid || child.exitCode !== null) return;
	if (process.platform === "win32") {
		spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
		return;
	}
	try {
		// Detached children lead their own process group: end the whole job, not just the shell.
		process.kill(-child.pid, "SIGTERM");
		setTimeout(() => {
			try {
				if (child.pid) process.kill(-child.pid, "SIGKILL");
			} catch {}
		}, 2000);
	} catch {
		child.kill("SIGKILL");
	}
}

export interface ExecResult {
	code: number;
	stdout: string;
	stderr: string;
	timedOut: boolean;
}

export async function runCommand(
	opts: { command: string; cwd?: string; timeoutMs: number; workdir: string },
	signal: AbortSignal,
): Promise<ExecResult> {
	const cwd = opts.cwd ? resolvePath(opts.cwd, opts.workdir) : expandHome(opts.workdir);
	const dir = await stat(cwd).catch(() => null);
	if (!dir?.isDirectory()) throw new Error(`The folder ${cwd} doesn't exist`);
	const { file, args } = shellFor(opts.command);
	const child = spawn(file, args, {
		cwd,
		env: process.env,
		detached: process.platform !== "win32",
		windowsHide: true,
		stdio: ["ignore", "pipe", "pipe"],
	});
	const out: Buffer[] = [];
	const err: Buffer[] = [];
	let outBytes = 0;
	let errBytes = 0;
	child.stdout?.on("data", (b: Buffer) => {
		if (outBytes < MAX_OUTPUT) out.push(b);
		outBytes += b.length;
	});
	child.stderr?.on("data", (b: Buffer) => {
		if (errBytes < MAX_OUTPUT) err.push(b);
		errBytes += b.length;
	});
	let timedOut = false;
	const timer = setTimeout(
		() => {
			timedOut = true;
			killTree(child);
		},
		Math.min(Math.max(opts.timeoutMs, 1_000), 30 * 60_000),
	);
	const onAbort = () => killTree(child);
	signal.addEventListener("abort", onAbort, { once: true });
	try {
		const code = await new Promise<number>((resolveCode, reject) => {
			child.on("error", reject);
			child.on("close", (c, sig) => resolveCode(c ?? (sig ? 128 : 1)));
		});
		const cut = (n: number) => (n > MAX_OUTPUT ? `\n… (${n - MAX_OUTPUT} more bytes)` : "");
		return {
			code,
			stdout: Buffer.concat(out).toString("utf8") + cut(outBytes),
			stderr: Buffer.concat(err).toString("utf8") + cut(errBytes),
			timedOut,
		};
	} finally {
		clearTimeout(timer);
		signal.removeEventListener("abort", onAbort);
	}
}

export async function readText(path: string, maxBytes: number, workdir: string): Promise<string> {
	const file = resolvePath(path, workdir);
	const handle = await open(file, "r");
	try {
		// At most 10 MB at a time, whatever was asked for.
		const buf = Buffer.alloc(Math.min(Math.max(1, Math.floor(maxBytes) || 1), 10 * 1024 * 1024));
		const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
		return buf.subarray(0, bytesRead).toString("utf8");
	} finally {
		await handle.close();
	}
}

export async function writeText(path: string, content: string, append: boolean, workdir: string): Promise<string> {
	const file = resolvePath(path, workdir);
	await mkdir(dirname(file), { recursive: true });
	if (append) await appendFile(file, content, "utf8");
	else await writeFile(file, content, "utf8");
	return file;
}
