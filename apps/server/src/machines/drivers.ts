import type { Machine } from "@sekai/shared";
import scanScript from "../code/scan.py" with { type: "text" };
import { getAgentRow } from "../services/agents.ts";
import { BridgeDesktop, deviceCall, deviceTunnel } from "./bridge.ts";
import type { DesktopControl } from "./desktop.ts";
import { desktopOf, sshTarget } from "./manager.ts";
import { shq, sshExec, sshTunnel, type Tunnel } from "./ssh.ts";

/**
 * One way to work on any machine, whatever it is: bots' VMs and devboxes over SSH, your own computer through
 * the desktop app. Tools and the browser use this and don't care which.
 */

export interface ExecOutput {
	code: number;
	stdout: string;
	stderr: string;
	timedOut: boolean;
}

/** A folder's source files for the code index: [relative path, size, sha1]. */
export interface CodeScan {
	root: string;
	git: boolean;
	files: [string, number, string][];
	skipped: number;
}

export interface MachineDriver {
	exec(command: string, opts: { cwd?: string; timeoutMs: number; signal?: AbortSignal }): Promise<ExecOutput>;
	readFile(path: string, maxBytes: number): Promise<string>;
	writeFile(path: string, content: string, append?: boolean): Promise<void>;
	desktop(): Promise<DesktopControl>;
	tunnel(remotePort: number): Promise<Tunnel>;
	/** Lists and hashes a folder's source files (the absolute root comes back). */
	codeScan(root: string, signal?: AbortSignal): Promise<CodeScan>;
	/** Reads files under a folder, by relative path (null if one can't be read). */
	codeRead(root: string, paths: string[], signal?: AbortSignal): Promise<Record<string, string | null>>;
}

function parseScanOutput<T>(stdout: Uint8Array | string, stderr: string): T {
	const text = typeof stdout === "string" ? stdout : new TextDecoder().decode(stdout);
	let out: T & { error?: string };
	try {
		out = JSON.parse(text) as T & { error?: string };
	} catch {
		if (/python3: (command )?not found|No such file or directory.*python3/i.test(stderr)) {
			throw new Error("Indexing code here needs python3 on the machine");
		}
		throw new Error(stderr.trim().slice(0, 300) || "Couldn't read the folder");
	}
	if (out.error) throw new Error(out.error);
	return out;
}

/** Commands, files, the screen and tunnels as one bot on the machine: its own account (its seat). */
function sshDriver(m: Machine, agentId: string): MachineDriver {
	const target = () => sshTarget(m, agentId);
	return {
		async exec(command, opts) {
			const full = opts.cwd ? `cd ${shq(opts.cwd)} && ${command}` : command;
			const r = await sshExec(await target(), `bash -lc ${shq(full)}`, {
				timeoutMs: opts.timeoutMs,
				signal: opts.signal,
			});
			return { code: r.code, stdout: new TextDecoder().decode(r.stdout), stderr: r.stderr, timedOut: r.timedOut };
		},
		async readFile(path, maxBytes) {
			const r = await sshExec(await target(), `head -c ${maxBytes} ${shq(path)}`);
			if (r.code !== 0) throw new Error(r.stderr.trim() || "Couldn't read it");
			return new TextDecoder().decode(r.stdout);
		},
		async writeFile(path, content, append = false) {
			const p = shq(path);
			const r = await sshExec(await target(), `mkdir -p "$(dirname ${p})" && cat ${append ? ">>" : ">"} ${p}`, {
				input: content,
			});
			if (r.code !== 0) throw new Error(r.stderr.trim() || "Couldn't write it");
		},
		desktop: () => desktopOf(m, agentId),
		async tunnel(port) {
			return sshTunnel(await target(), port);
		},
		async codeScan(root, signal) {
			const r = await sshExec(await target(), `python3 -c ${shq(scanScript)} scan ${shq(root)}`, {
				timeoutMs: 180_000,
				signal,
			});
			return parseScanOutput<CodeScan>(r.stdout, r.stderr);
		},
		async codeRead(root, paths, signal) {
			const r = await sshExec(await target(), `python3 -c ${shq(scanScript)} read ${shq(root)}`, {
				input: JSON.stringify(paths),
				timeoutMs: 180_000,
				signal,
			});
			return parseScanOutput<Record<string, string | null>>(r.stdout, r.stderr);
		},
	};
}

function deviceDriver(deviceId: string, agent: { id: string; name: string }): MachineDriver {
	const call = <T>(method: string, params: Record<string, unknown>, timeoutMs?: number, signal?: AbortSignal) =>
		deviceCall<T>(deviceId, method, { ...params, agentId: agent.id, agent: agent.name }, timeoutMs, signal);
	return {
		exec: (command, opts) =>
			call<ExecOutput>(
				"exec",
				{ command, cwd: opts.cwd, timeoutMs: opts.timeoutMs },
				opts.timeoutMs + 10_000,
				opts.signal,
			),
		async readFile(path, maxBytes) {
			return (await call<{ text: string }>("fs.read", { path, maxBytes })).text;
		},
		async writeFile(path, content, append = false) {
			await call("fs.write", { path, content, append });
		},
		async desktop() {
			return new BridgeDesktop(deviceId, agent);
		},
		tunnel: (port) => deviceTunnel(deviceId, port),
		async codeScan(root, signal) {
			return call<CodeScan>("code.scan", { root }, 240_000, signal).catch((err: unknown) => {
				throw outdated(err);
			});
		},
		async codeRead(root, paths, signal) {
			return call<Record<string, string | null>>("code.read", { root, paths }, 240_000, signal).catch(
				(err: unknown) => {
					throw outdated(err);
				},
			);
		},
	};
}

/** Desktop apps from before the code index don't know these calls. */
function outdated(err: unknown): Error {
	const message = err instanceof Error ? err.message : String(err);
	return /unknown (method|call)|not supported/i.test(message)
		? new Error("Update the Sekai desktop app on this computer to index code here")
		: err instanceof Error
			? err
			: new Error(message);
}

/** Working on a machine as a bot (the machine's own bot by default; another bot works in its own seat there). */
export async function driverFor(m: Machine, agentId = m.agentId): Promise<MachineDriver> {
	if (m.provider === "local") {
		if (!m.remoteId) throw new Error("This computer isn't linked to a desktop app");
		const agent = await getAgentRow(m.agentId);
		return deviceDriver(m.remoteId, { id: m.agentId, name: agent?.name ?? "A bot" });
	}
	return sshDriver(m, agentId);
}

/** Machines a bot can see a desktop on right now: its own computer, and your computers lent to it. */
export function hasDesktop(m: Machine): boolean {
	return m.status === "running" && (m.kind === "computer" || m.kind === "device");
}

/**
 * A machine of a bot by reference: "computer" (or nothing: its own computer first, then a shared one it has a seat
 * on), "device" (your computer), an id, a name or a host. Its own machines come first in `all`.
 */
export function pickMachine<T extends Machine>(all: T[], ref: string | undefined): T | null {
	const r = ref?.trim().toLowerCase();
	if (!r || r === "computer" || r === "my computer") return all.find((m) => m.kind === "computer") ?? null;
	if (r === "device" || r === "user" || r === "local" || r === "user's computer") {
		return (
			all.find((m) => m.kind === "device" && m.status === "running") ??
			all.find((m) => m.kind === "device") ??
			null
		);
	}
	return all.find((m) => m.id === ref || m.name.toLowerCase() === r || m.hostname.toLowerCase() === r) ?? null;
}
