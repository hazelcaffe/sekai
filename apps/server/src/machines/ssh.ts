import { createHash } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Subprocess } from "bun";
import { config } from "../config.ts";

/**
 * SSH to bots' machines with the system ssh client. One connection per machine is kept open (ControlMaster)
 * so each command or screenshot costs a round trip, not a handshake. Host keys are trusted on first use and
 * remembered per machine (a rebuilt machine gets a fresh file).
 */

export interface SshTarget {
	machineId: string;
	host: string;
	port: number;
	user: string;
	keyFile: string;
}

export interface ExecResult {
	code: number;
	stdout: Uint8Array;
	stderr: string;
	timedOut: boolean;
}

const SSH_DIR = join(config.dataDir, "ssh");

/** mux: share one connection per machine. Tunnels get their own (a shared one hands the forward off and exits). */
/** user@host for ssh, refusing anything ssh would read as an option (a user or host starting with "-"). */
function dest(t: SshTarget): string {
	if (/^-|\s/.test(t.user) || /^-|\s/.test(t.host)) throw new Error(`Not a valid SSH address: ${t.user}@${t.host}`);
	return `${t.user}@${t.host}`;
}

/** A short tag for a key file, so connections opened with different keys never share a control socket. */
const keyTag = (keyFile: string) => createHash("sha256").update(keyFile).digest("hex").slice(0, 8);

function baseArgs(t: SshTarget, mux = true, portFlag = "-p"): string[] {
	mkdirSync(join(SSH_DIR, "ctl"), { recursive: true, mode: 0o700 });
	mkdirSync(join(SSH_DIR, "known_hosts"), { recursive: true, mode: 0o700 });
	return [
		"-i",
		t.keyFile,
		portFlag,
		String(t.port),
		"-o",
		"BatchMode=yes",
		"-o",
		"IdentitiesOnly=yes",
		"-o",
		"StrictHostKeyChecking=accept-new",
		"-o",
		`UserKnownHostsFile=${join(SSH_DIR, "known_hosts", t.machineId)}`,
		...(mux
			? [
					"-o",
					"ControlMaster=auto",
					"-o",
					// %C hashes host, port and user, so the socket path stays short. Which key is part of it too: a bot's
					// command must never ride a connection opened with the master key (or another bot's key).
					`ControlPath=${join(SSH_DIR, "ctl", `%C-${keyTag(t.keyFile)}`)}`,
					"-o",
					"ControlPersist=10m",
				]
			: ["-o", "ControlMaster=no", "-o", "ControlPath=none"]),
		"-o",
		"ConnectTimeout=10",
		"-o",
		"ServerAliveInterval=15",
		"-o",
		"LogLevel=ERROR",
	];
}

/** Runs a command (through the remote user's shell) and collects its output. */
export async function sshExec(
	t: SshTarget,
	command: string,
	opts: { input?: string | Uint8Array; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<ExecResult> {
	const proc = Bun.spawn(["ssh", ...baseArgs(t), dest(t), "--", command], {
		stdin: opts.input === undefined ? "ignore" : new Blob([opts.input]),
		stdout: "pipe",
		stderr: "pipe",
	});
	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		proc.kill();
	}, opts.timeoutMs ?? 120_000);
	const onAbort = () => proc.kill();
	opts.signal?.addEventListener("abort", onAbort, { once: true });
	try {
		const [stdout, stderr, code] = await Promise.all([
			new Response(proc.stdout).arrayBuffer(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);
		return { code, stdout: new Uint8Array(stdout), stderr, timedOut };
	} finally {
		clearTimeout(timer);
		opts.signal?.removeEventListener("abort", onAbort);
	}
}

/** Copies a local file to the machine (scp; a relative path is in the user's home). */
export async function scpTo(
	t: SshTarget,
	localPath: string,
	remotePath: string,
	timeoutMs = 30 * 60_000,
): Promise<void> {
	const proc = Bun.spawn(["scp", "-q", ...baseArgs(t, true, "-P"), "--", localPath, `${dest(t)}:${remotePath}`], {
		stdin: "ignore",
		stdout: "ignore",
		stderr: "pipe",
	});
	const timer = setTimeout(() => proc.kill(), timeoutMs);
	try {
		const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
		if (code !== 0) throw new Error(stderr.trim().split("\n").slice(-2).join(" ") || `scp exited with ${code}`);
	} finally {
		clearTimeout(timer);
	}
}

/** stdout as text; throws with stderr when the command fails. */
export async function sshText(
	t: SshTarget,
	command: string,
	opts: { input?: string | Uint8Array; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<string> {
	const r = await sshExec(t, command, opts);
	const out = new TextDecoder().decode(r.stdout);
	if (r.timedOut) throw new Error(`Timed out: ${command.slice(0, 80)}`);
	if (r.code !== 0) throw new Error((r.stderr || out).trim().slice(-2000) || `exit ${r.code}`);
	return out;
}

/** Whether the machine answers on SSH right now. */
export async function sshReachable(t: SshTarget, timeoutMs = 15_000): Promise<boolean> {
	const r = await sshExec(t, "true", { timeoutMs }).catch(() => null);
	return r?.code === 0;
}

export interface Tunnel {
	localPort: number;
	close(): void;
}

async function freePort(): Promise<number> {
	const server = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
	const port = server.port;
	server.stop(true);
	return port;
}

/** Forwards a local port to a port on the machine's loopback (e.g. Chrome's debugging port). */
export async function sshTunnel(t: SshTarget, remotePort: number): Promise<Tunnel> {
	const localPort = await freePort();
	const proc: Subprocess = Bun.spawn(
		[
			"ssh",
			...baseArgs(t, false),
			"-N",
			"-o",
			"ExitOnForwardFailure=yes",
			"-L",
			`127.0.0.1:${localPort}:127.0.0.1:${remotePort}`,
			dest(t),
		],
		{ stdin: "ignore", stdout: "ignore", stderr: "pipe" },
	);
	// Ready once the local port accepts connections.
	for (let i = 0; i < 50; i++) {
		if (proc.exitCode !== null) {
			throw new Error(`SSH tunnel failed: ${await new Response(proc.stderr as ReadableStream).text()}`);
		}
		const ok = await Bun.connect({ hostname: "127.0.0.1", port: localPort, socket: { data() {} } })
			.then((s) => {
				s.end();
				return true;
			})
			.catch(() => false);
		if (ok) return { localPort, close: () => proc.kill() };
		await Bun.sleep(200);
	}
	proc.kill();
	throw new Error("SSH tunnel didn't come up");
}

/** Forgets a machine's host key and closes its connection (after a rebuild or delete). */
export async function sshForget(t: SshTarget): Promise<void> {
	await Bun.spawn(["ssh", ...baseArgs(t), "-O", "exit", dest(t)], {
		stdout: "ignore",
		stderr: "ignore",
	}).exited.catch(() => {});
	rmSync(join(SSH_DIR, "known_hosts", t.machineId), { force: true });
}

/** Quotes a string for a POSIX shell. */
export function shq(s: string): string {
	return `'${s.replace(/'/g, `'\\''`)}'`;
}
