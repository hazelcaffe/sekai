import { createHash } from "node:crypto";
import { statfsSync } from "node:fs";
import { connect, type Socket } from "node:net";
import { arch, cpus, homedir, hostname, totalmem, userInfo } from "node:os";
import { join } from "node:path";
import type { LocalComputerSettings } from "@sekai/shared";
import { app, clipboard } from "electron";
import { startBrowser } from "./browser.ts";
import { codeRead, codeScan } from "./code.ts";
import { readText, runCommand, writeText } from "./exec.ts";
import { LinuxPlatform } from "./linux.ts";
import { MacPlatform } from "./macos.ts";
import type { Platform } from "./types.ts";
import { WindowsPlatform } from "./windows.ts";

/**
 * Lending this computer to bots: the desktop app connects to Sekai, says which bots may use the computer,
 * and does what they ask (screenshots, mouse and keyboard, commands, files, a browser) for those bots only.
 * The choice lives here, on the computer: the server can narrow it (revoke) but never widen it.
 */

export type LocalState = "off" | "connecting" | "online" | "offline" | "problem";

export interface LocalStatus {
	state: LocalState;
	/** What's wrong, or what's needed (a permission, a missing tool). */
	message: string | null;
	/** The bot working here right now, if any. */
	activeAgent: string | null;
}

export interface LocalComputerOptions {
	serverUrl(): string;
	token(): string | null;
	deviceId(): string;
	settings(): LocalComputerSettings;
	saveSettings(next: LocalComputerSettings): void;
	onStatus(status: LocalStatus): void;
	/** A bot did something here (drives the on-screen indicator). */
	onActivity(agent: string, method: string): void;
}

const BROWSER_PORT = 9333;
const RECONNECT_MAX_MS = 60_000;

export function createPlatform(): Platform {
	if (process.platform === "win32") return new WindowsPlatform();
	if (process.platform === "darwin") return new MacPlatform();
	return new LinuxPlatform();
}

/** A friendly name for this computer, the one people see in Sekai. */
export function computerName(): string {
	const host = hostname().replace(/\.local$/, "");
	return host || `${userInfo().username}'s computer`;
}

type Message = Record<string, unknown> & { t?: string };

export class LocalComputer {
	private ws: WebSocket | null = null;
	private retry: ReturnType<typeof setTimeout> | null = null;
	private attempts = 0;
	private stopped = true;
	private platform: Platform | null = null;
	private calls = new Map<number, AbortController>();
	private tunnels = new Map<number, Socket>();
	/** Ports bots may reach through tunnels: only the browser this app started. */
	private allowedPorts = new Set<number>();
	private status: LocalStatus = { state: "off", message: null, activeAgent: null };
	private activeTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(private readonly opts: LocalComputerOptions) {}

	get current(): LocalStatus {
		return this.status;
	}

	private setStatus(patch: Partial<LocalStatus>): void {
		this.status = { ...this.status, ...patch };
		this.opts.onStatus(this.status);
	}

	private get platformImpl(): Platform {
		this.platform ??= createPlatform();
		return this.platform;
	}

	/** Connects (or reconnects with new settings); disconnects when lending is off. */
	async apply(): Promise<void> {
		const settings = this.opts.settings();
		if (!settings.enabled) {
			this.stop();
			return;
		}
		const problem = await this.platformImpl.problem().catch((err: unknown) => String(err));
		if (this.ws?.readyState === WebSocket.OPEN) {
			this.send(this.hello());
			this.setStatus({ state: problem ? "problem" : "online", message: problem });
			return;
		}
		this.stopped = false;
		this.connect();
		if (problem) this.setStatus({ message: problem });
	}

	stop(): void {
		this.stopped = true;
		if (this.retry) clearTimeout(this.retry);
		this.retry = null;
		this.abortAll();
		this.ws?.close(1000, "Lending turned off");
		this.ws = null;
		this.platform?.dispose();
		this.platform = null;
		this.setStatus({ state: "off", message: null, activeAgent: null });
	}

	/** The panic button: everything in progress here stops, and the bots' runs are cancelled. */
	stopBots(): void {
		this.abortAll();
		this.send({ t: "stop" });
		this.setStatus({ activeAgent: null });
	}

	private abortAll(): void {
		for (const c of this.calls.values()) c.abort();
		this.calls.clear();
		for (const s of this.tunnels.values()) s.destroy();
		this.tunnels.clear();
	}

	private url(): string {
		const base = this.opts.serverUrl().replace(/\/+$/, "").replace(/^http/, "ws");
		const token = this.opts.token();
		return `${base}/api/machines/bridge${token ? `?token=${encodeURIComponent(token)}` : ""}`;
	}

	private connect(): void {
		if (this.retry) clearTimeout(this.retry);
		this.retry = null;
		// Never two connections: an older socket (still connecting) is dropped before a new one opens.
		const old = this.ws;
		this.ws = null;
		if (old) {
			old.onmessage = null;
			old.onclose = null;
			old.close();
		}
		this.setStatus({ state: "connecting", message: null });
		let ws: WebSocket;
		try {
			ws = new WebSocket(this.url());
		} catch (err) {
			this.scheduleReconnect(String(err));
			return;
		}
		this.ws = ws;
		ws.onopen = async () => {
			this.attempts = 0;
			this.send(this.hello());
			const problem = await this.platformImpl.problem().catch((err: unknown) => String(err));
			this.setStatus({ state: problem ? "problem" : "online", message: problem });
		};
		ws.onmessage = (ev) => {
			let msg: Message;
			try {
				msg = JSON.parse(String(ev.data)) as Message;
			} catch {
				return;
			}
			void this.onMessage(msg);
		};
		ws.onclose = (ev) => {
			if (this.ws !== ws) return;
			this.ws = null;
			this.abortAll();
			if (this.stopped) return;
			this.scheduleReconnect(
				ev.reason || (ev.code === 1006 ? "The connection to Sekai dropped" : `Closed (${ev.code})`),
			);
		};
		ws.onerror = () => {};
	}

	private scheduleReconnect(reason: string): void {
		this.attempts++;
		const delay = Math.min(1000 * 2 ** Math.min(this.attempts, 6), RECONNECT_MAX_MS);
		this.setStatus({ state: "offline", message: reason, activeAgent: null });
		this.retry = setTimeout(() => this.connect(), delay);
	}

	private send(msg: unknown): void {
		if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
	}

	private hello() {
		let diskGb = 0;
		try {
			const fs = statfsSync(homedir());
			diskGb = Math.round((fs.blocks * fs.bsize) / 1024 ** 3);
		} catch {}
		return {
			t: "hello",
			deviceId: this.opts.deviceId(),
			name: computerName(),
			platform: process.platform,
			arch: arch(),
			user: userInfo().username,
			specs: { cores: cpus().length, memoryMb: Math.round(totalmem() / 1024 ** 2), diskGb: Math.max(diskGb, 4) },
			settings: this.opts.settings(),
			version: app.getVersion(),
		};
	}

	private async onMessage(msg: Message): Promise<void> {
		switch (msg.t) {
			case "call":
				await this.onCall(msg.id as number, String(msg.method), (msg.params ?? {}) as Record<string, unknown>);
				return;
			case "cancel":
				this.calls.get(msg.id as number)?.abort();
				return;
			case "revoke": {
				// You removed the bot from this computer in Sekai: it stays removed here too.
				const settings = this.opts.settings();
				this.opts.saveSettings({ ...settings, agentIds: settings.agentIds.filter((id) => id !== msg.agentId) });
				this.send(this.hello());
				return;
			}
			case "tunnel.open":
				this.openTunnel(msg.sid as number, msg.port as number);
				return;
			case "tunnel.data":
				this.tunnels.get(msg.sid as number)?.write(Buffer.from(String(msg.b64), "base64"));
				return;
			case "tunnel.close": {
				const s = this.tunnels.get(msg.sid as number);
				this.tunnels.delete(msg.sid as number);
				s?.end();
				return;
			}
		}
	}

	private openTunnel(sid: number, port: number): void {
		if (!this.allowedPorts.has(port)) {
			this.send({ t: "tunnel.close", sid });
			return;
		}
		const socket = connect({ host: "127.0.0.1", port });
		this.tunnels.set(sid, socket);
		socket.on("data", (chunk) => this.send({ t: "tunnel.data", sid, b64: chunk.toString("base64") }));
		const close = () => {
			if (!this.tunnels.has(sid)) return;
			this.tunnels.delete(sid);
			this.send({ t: "tunnel.close", sid });
		};
		socket.on("close", close);
		socket.on("error", close);
	}

	private async onCall(id: number, method: string, params: Record<string, unknown>): Promise<void> {
		const settings = this.opts.settings();
		const agentId = String(params.agentId ?? "");
		if (!settings.enabled || !settings.agentIds.includes(agentId)) {
			this.send({
				t: "result",
				id,
				ok: false,
				error: "This computer isn't lent to that bot (Sekai desktop app settings).",
			});
			return;
		}
		const agent = String(params.agent ?? "A bot");
		this.markActive(agent, method);
		const controller = new AbortController();
		this.calls.set(id, controller);
		try {
			const data = await this.handle(method, params, settings, controller.signal);
			if (controller.signal.aborted) throw new Error("Stopped on this computer");
			this.send({ t: "result", id, ok: true, data });
		} catch (err) {
			this.send({ t: "result", id, ok: false, error: err instanceof Error ? err.message : String(err) });
		} finally {
			this.calls.delete(id);
		}
	}

	private markActive(agent: string, method: string): void {
		this.opts.onActivity(agent, method);
		if (this.status.activeAgent !== agent) this.setStatus({ activeAgent: agent });
		if (this.activeTimer) clearTimeout(this.activeTimer);
		this.activeTimer = setTimeout(() => this.setStatus({ activeAgent: null }), 15_000);
	}

	private async handle(
		method: string,
		p: Record<string, unknown>,
		settings: LocalComputerSettings,
		signal: AbortSignal,
	): Promise<unknown> {
		const platform = this.platformImpl;
		const num = (k: string) => Number(p[k]);
		switch (method) {
			case "exec":
				return runCommand(
					{
						command: String(p.command),
						cwd: p.cwd ? String(p.cwd) : undefined,
						timeoutMs: num("timeoutMs") || 120_000,
						workdir: settings.workdir,
					},
					signal,
				);
			case "fs.read":
				return { text: await readText(String(p.path), num("maxBytes") || 60_000, settings.workdir) };
			case "fs.write":
				return {
					path: await writeText(String(p.path), String(p.content ?? ""), Boolean(p.append), settings.workdir),
				};
			case "code.scan":
				return codeScan(String(p.root ?? "."), settings.workdir);
			case "code.read":
				return codeRead(
					String(p.root ?? "."),
					Array.isArray(p.paths) ? p.paths.map(String) : [],
					settings.workdir,
				);
			case "screen.info":
				return platform.info();
			case "screen.shot":
				return { b64: (await platform.screenshot(num("maxWidth") || 1280)).toString("base64") };
			case "ui.tree":
				return platform.tree(p.app ? String(p.app) : undefined, Boolean(p.all));
			case "ui.act":
				return platform.act(String(p.id), p.action ? String(p.action) : undefined);
			case "ui.focus":
				await platform.focus(String(p.id));
				return { ok: true };
			case "input.click":
				await platform.click(num("x"), num("y"), (p.button as "left") ?? "left", num("count") || 1);
				return { ok: true };
			case "input.move":
				await platform.move(num("x"), num("y"));
				return { ok: true };
			case "input.drag":
				await platform.drag(num("x1"), num("y1"), num("x2"), num("y2"));
				return { ok: true };
			case "input.scroll":
				await platform.scroll(num("x"), num("y"), p.direction as "down", num("amount") || 3);
				return { ok: true };
			case "input.type":
				await platform.type(String(p.text ?? ""));
				return { ok: true };
			case "input.key":
				await platform.key((p.combos as string[]) ?? []);
				return { ok: true };
			case "windows.list":
				return platform.windows();
			case "windows.activate":
				await platform.activate(String(p.id));
				return { ok: true };
			case "app.open":
				await platform.open(String(p.command));
				return { ok: true };
			case "clipboard.read":
				return { text: await clipboard.readText() };
			case "clipboard.write":
				await clipboard.writeText(String(p.text ?? ""));
				return { ok: true };
			case "browser.start": {
				const port = num("port") || BROWSER_PORT;
				const r = await startBrowser(port, join(app.getPath("userData"), "browser"));
				this.allowedPorts.add(r.port);
				return r;
			}
			case "idle.wait":
				return { idle: await this.waitIdle(platform, num("seconds") || 3, signal) };
			default:
				throw new Error(`The desktop app doesn't know "${method}" (update it?)`);
		}
	}

	/** Waits until the screen stops changing (two small screenshots in a row are the same). */
	private async waitIdle(platform: Platform, seconds: number, signal: AbortSignal): Promise<boolean> {
		const deadline = Date.now() + seconds * 1000;
		let last = "";
		while (Date.now() < deadline && !signal.aborted) {
			const shot = await platform.screenshot(320).catch(() => null);
			if (!shot) return false;
			const digest = createHash("sha1").update(shot).digest("hex");
			if (digest === last) return true;
			last = digest;
			await new Promise((r) => setTimeout(r, 350));
		}
		return false;
	}
}
