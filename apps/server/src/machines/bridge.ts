import type { LocalComputerSettings, MachineSpecs } from "@sekai/shared";
import type { Server, ServerWebSocket, Socket } from "bun";
import { readBearer } from "../auth/request.ts";
import { principalFromToken, principalUserId } from "../auth/service.ts";
import { errorMessage } from "../lib/errors.ts";
import { log } from "../lib/log.ts";
import type { DesktopControl, DesktopInfo, DesktopWindow, Screenshot, UiElement } from "./desktop.ts";
import { pngSize, SHOT_WIDTH } from "./desktop.ts";
import type { Tunnel } from "./ssh.ts";

/**
 * Your own computer, lent to bots through the Sekai desktop app. The app connects here over a WebSocket,
 * says which bots may use the computer, and answers calls (screenshots, input, commands, files) and opens
 * tunnels (the browser's debugging port). Consent lives in the app: the server can't widen it.
 */

export interface BridgeSocket {
	kind: "bridge";
	deviceId: string | null;
	/** What it signed in with: checked again later, so revoking the token cuts the connection. */
	token: string;
	/** Which token (or "root"): a computer stays with the token that connected it while that token is valid. */
	tokenKey: string;
	/** Whose app it is: it lends the computer to their own bots only. */
	userId: string;
}

export interface DeviceHello {
	deviceId: string;
	name: string;
	platform: string;
	arch: string;
	user: string;
	specs: Pick<MachineSpecs, "cores" | "memoryMb" | "diskGb">;
	settings: LocalComputerSettings;
	version: string;
}

interface Device {
	hello: DeviceHello;
	ws: ServerWebSocket<BridgeSocket>;
	seq: number;
	pending: Map<
		number,
		{ resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
	>;
	tunnels: Map<number, Socket<{ sid: number }>>;
}

const devices = new Map<string, Device>();

type Hooks = {
	onHello(hello: DeviceHello, userId: string): Promise<void>;
	onOffline(deviceId: string): Promise<void>;
	onStop(deviceId: string): Promise<void>;
};
let hooks: Hooks | null = null;

/** The machine manager keeps device machines in step with what the app allows. */
export function setBridgeHooks(h: Hooks): void {
	hooks = h;
}

export function isDeviceOnline(deviceId: string): boolean {
	return devices.has(deviceId);
}

export function deviceSettings(deviceId: string): LocalComputerSettings | null {
	return devices.get(deviceId)?.hello.settings ?? null;
}

/** What the desktop app said about the computer when it connected (null while it's offline). */
export function deviceHello(deviceId: string): DeviceHello | null {
	return devices.get(deviceId)?.hello ?? null;
}

const OS_NAMES: Record<string, string> = { darwin: "macOS", win32: "Windows", linux: "Linux" };

export function osName(platform: string): string {
	return OS_NAMES[platform] ?? platform;
}

function send(d: Device, msg: unknown): void {
	d.ws.send(JSON.stringify(msg));
}

export async function upgradeBridge(req: Request, server: Server<BridgeSocket>): Promise<Response | undefined | null> {
	const url = new URL(req.url);
	if (url.pathname !== "/api/machines/bridge") return null;
	// Only the desktop app connects here, never a web page: browsers always send an Origin, the app doesn't.
	if (req.headers.get("origin")) return Response.json({ error: "Not from a browser" }, { status: 403 });
	// The desktop app signs in with a token it got from the web app (a "bridge" token) or a full API token.
	const token = readBearer(req);
	const principal = token ? await principalFromToken(token) : null;
	if (!token || !principal) return Response.json({ error: "Unauthorized" }, { status: 401 });
	// The root token acts for the first admin (if there's none yet, it lends to no one).
	const userId =
		principal.kind === "root"
			? ((await principalUserId(principal).catch(() => null)) ?? "root")
			: await principalUserId(principal);
	if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
	startTokenSweep();
	const tokenKey = principal.kind === "token" ? principal.tokenId : principal.kind;
	const ok = server.upgrade(req, { data: { kind: "bridge", deviceId: null, token, tokenKey, userId } });
	return ok ? undefined : Response.json({ error: "Expected a WebSocket" }, { status: 400 });
}

let sweep: ReturnType<typeof setInterval> | null = null;

/** Every minute: connections whose token was revoked (or replaced) are closed. */
function startTokenSweep(): void {
	if (sweep) return;
	sweep = setInterval(async () => {
		for (const d of [...devices.values()]) {
			if (await principalFromToken(d.ws.data.token).catch(() => null)) continue;
			dropDevice(d, "Signed out");
			d.ws.close(4001, "The desktop app's sign-in was revoked");
		}
	}, 60_000);
}

function dropDevice(d: Device, reason: string): void {
	for (const [, p] of d.pending) {
		clearTimeout(p.timer);
		p.reject(new Error(reason));
	}
	d.pending.clear();
	for (const [, sock] of d.tunnels) sock.end();
	d.tunnels.clear();
}

export const bridgeWebSocket = {
	async message(ws: ServerWebSocket<BridgeSocket>, raw: string | Buffer) {
		let msg: Record<string, unknown>;
		try {
			msg = JSON.parse(String(raw)) as Record<string, unknown>;
		} catch {
			return;
		}
		if (msg.t === "hello") {
			const hello = msg as unknown as DeviceHello;
			if (!hello.deviceId) return;
			const existing = devices.get(hello.deviceId);
			// Another token can't take over a connected computer (and get its bots' calls) while the token that
			// connected it is still valid; re-linking the app replaces that token, so the real app gets back in.
			if (
				existing &&
				existing.ws !== ws &&
				existing.ws.data.tokenKey !== ws.data.tokenKey &&
				(await principalFromToken(existing.ws.data.token))
			) {
				ws.close(4003, "This computer is connected with another token");
				return;
			}
			if (existing && existing.ws !== ws) {
				dropDevice(existing, "The desktop app reconnected");
				existing.ws.close(4000, "Replaced by a newer connection");
			}
			ws.data.deviceId = hello.deviceId;
			devices.set(
				hello.deviceId,
				existing?.ws === ws
					? { ...existing, hello }
					: { hello, ws, seq: 0, pending: new Map(), tunnels: new Map() },
			);
			log.info(
				`desktop app ${hello.name} (${hello.platform}) connected; bots allowed: ${hello.settings.enabled ? hello.settings.agentIds.length : 0}`,
			);
			await hooks
				?.onHello(hello, ws.data.userId)
				.catch((err: unknown) => log.warn(`device sync failed: ${errorMessage(err)}`));
			return;
		}
		const d = ws.data.deviceId ? devices.get(ws.data.deviceId) : undefined;
		if (!d) return;
		switch (msg.t) {
			case "result": {
				const p = d.pending.get(msg.id as number);
				if (!p) return;
				d.pending.delete(msg.id as number);
				clearTimeout(p.timer);
				if (msg.ok) p.resolve(msg.data);
				else p.reject(new Error(String(msg.error ?? "The desktop app couldn't do that")));
				return;
			}
			case "tunnel.data": {
				d.tunnels.get(msg.sid as number)?.write(Buffer.from(String(msg.b64), "base64"));
				return;
			}
			case "tunnel.close": {
				const sock = d.tunnels.get(msg.sid as number);
				d.tunnels.delete(msg.sid as number);
				sock?.end();
				return;
			}
			case "stop":
				log.info(`desktop app ${d.hello.name}: you stopped the bots`);
				await hooks?.onStop(d.hello.deviceId).catch(() => {});
				return;
		}
	},
	close(ws: ServerWebSocket<BridgeSocket>) {
		const id = ws.data.deviceId;
		const d = id ? devices.get(id) : undefined;
		if (!id || !d || d.ws !== ws) return;
		devices.delete(id);
		dropDevice(d, "The desktop app disconnected");
		log.info(`desktop app ${d.hello.name} disconnected`);
		void hooks?.onOffline(id).catch(() => {});
	},
};

/** Asks the desktop app to do something; rejects if it's offline, refuses, takes too long, or is cancelled. */
export function deviceCall<T>(
	deviceId: string,
	method: string,
	params: Record<string, unknown> = {},
	timeoutMs = 60_000,
	signal?: AbortSignal,
): Promise<T> {
	const d = devices.get(deviceId);
	if (!d) return Promise.reject(new Error("That computer is offline (the Sekai desktop app isn't connected)"));
	if (signal?.aborted) return Promise.reject(new Error("Cancelled"));
	const id = ++d.seq;
	return new Promise<T>((resolve, reject) => {
		const onAbort = () => {
			if (!d.pending.has(id)) return;
			const p = d.pending.get(id);
			d.pending.delete(id);
			if (p) clearTimeout(p.timer);
			send(d, { t: "cancel", id });
			reject(new Error("Cancelled"));
		};
		const timer = setTimeout(() => {
			d.pending.delete(id);
			signal?.removeEventListener("abort", onAbort);
			send(d, { t: "cancel", id });
			reject(new Error(`The desktop app didn't answer in time (${method})`));
		}, timeoutMs);
		d.pending.set(id, {
			resolve: (v) => {
				signal?.removeEventListener("abort", onAbort);
				resolve(v as T);
			},
			reject: (e) => {
				signal?.removeEventListener("abort", onAbort);
				reject(e);
			},
			timer,
		});
		signal?.addEventListener("abort", onAbort, { once: true });
		send(d, { t: "call", id, method, params });
	});
}

/** Tells the app to stop letting a bot use the computer (you removed it in Sekai). */
export function revokeDevice(deviceId: string, agentId: string): void {
	const d = devices.get(deviceId);
	if (d) send(d, { t: "revoke", agentId });
}

/** A local port that reaches a port on your computer through the desktop app (e.g. Chrome's debugging port). */
export async function deviceTunnel(deviceId: string, remotePort: number): Promise<Tunnel> {
	if (!devices.has(deviceId)) throw new Error("That computer is offline");
	const listener = Bun.listen<{ sid: number }>({
		hostname: "127.0.0.1",
		port: 0,
		socket: {
			open(sock) {
				const d = devices.get(deviceId);
				if (!d) {
					sock.end();
					return;
				}
				const sid = ++d.seq;
				sock.data = { sid };
				d.tunnels.set(sid, sock);
				send(d, { t: "tunnel.open", sid, port: remotePort });
			},
			data(sock, chunk) {
				const d = devices.get(deviceId);
				if (d) send(d, { t: "tunnel.data", sid: sock.data.sid, b64: Buffer.from(chunk).toString("base64") });
			},
			close(sock) {
				const d = devices.get(deviceId);
				if (!d?.tunnels.has(sock.data.sid)) return;
				d.tunnels.delete(sock.data.sid);
				send(d, { t: "tunnel.close", sid: sock.data.sid });
			},
		},
	});
	return { localPort: listener.port, close: () => listener.stop(true) };
}

/** Your computer's desktop, through the app. Same coordinates as bots' own computers: screenshot pixels. */
export class BridgeDesktop implements DesktopControl {
	private screen: { width: number; height: number; at: number } | null = null;

	constructor(
		private readonly deviceId: string,
		/** Which bot is asking: the app checks you allowed it, and shows its name while it works. */
		private readonly agent: { id: string; name: string },
	) {}

	private call<T>(method: string, params: Record<string, unknown> = {}, timeoutMs?: number): Promise<T> {
		return deviceCall<T>(
			this.deviceId,
			method,
			{ ...params, agentId: this.agent.id, agent: this.agent.name },
			timeoutMs,
		);
	}

	async info(): Promise<DesktopInfo> {
		const info = await this.call<DesktopInfo>("screen.info");
		this.screen = { width: info.width, height: info.height, at: Date.now() };
		return info;
	}

	private async size() {
		if (!this.screen || Date.now() - this.screen.at > 60_000) await this.info();
		return this.screen ?? { width: SHOT_WIDTH, height: 800 };
	}

	async scale(): Promise<number> {
		const { width } = await this.size();
		return width > SHOT_WIDTH ? width / SHOT_WIDTH : 1;
	}

	async screenshot(): Promise<Screenshot> {
		const r = await this.call<{ b64: string }>("screen.shot", { maxWidth: SHOT_WIDTH }, 30_000);
		const png = new Uint8Array(Buffer.from(r.b64, "base64"));
		const { width, height } = pngSize(png);
		const screen = await this.size();
		return { png, width, height, scale: screen.width / width };
	}

	tree(app?: string, all?: boolean) {
		return this.call<{ activeWindow: string | null; apps: string[]; elements: UiElement[] }>(
			"ui.tree",
			{ app, all },
			60_000,
		);
	}

	act(id: string, action?: string) {
		return this.call("ui.act", { id, action });
	}

	focusElement(id: string) {
		return this.call("ui.focus", { id });
	}

	private async px(...values: number[]): Promise<number[]> {
		const s = await this.scale();
		return values.map((v) => Math.round(v * s));
	}

	async click(x: number, y: number, button: "left" | "middle" | "right" = "left", count = 1) {
		const [sx, sy] = await this.px(x, y);
		return this.call("input.click", { x: sx, y: sy, button, count });
	}

	async move(x: number, y: number) {
		const [sx, sy] = await this.px(x, y);
		return this.call("input.move", { x: sx, y: sy });
	}

	async drag(x1: number, y1: number, x2: number, y2: number) {
		const [a, b, c, d] = await this.px(x1, y1, x2, y2);
		return this.call("input.drag", { x1: a, y1: b, x2: c, y2: d });
	}

	async scroll(x: number, y: number, direction: "up" | "down" | "left" | "right", amount: number) {
		const [sx, sy] = await this.px(x, y);
		return this.call("input.scroll", { x: sx, y: sy, direction, amount });
	}

	type(text: string) {
		return this.call("input.type", { text });
	}

	key(...combos: string[]) {
		return this.call("input.key", { combos });
	}

	windows() {
		return this.call<{ activeWindow: string | null; windows: DesktopWindow[] }>("windows.list");
	}

	activate(windowId: string) {
		return this.call("windows.activate", { id: windowId });
	}

	open(command: string) {
		return this.call("app.open", { command });
	}

	async readClipboard() {
		return (await this.call<{ text: string }>("clipboard.read")).text;
	}

	async writeClipboard(text: string) {
		await this.call("clipboard.write", { text });
	}

	async browser(port = 9333) {
		return (await this.call<{ port: number }>("browser.start", { port }, 60_000)).port;
	}

	waitIdle(seconds = 3) {
		return this.call("idle.wait", { seconds }, (seconds + 10) * 1000);
	}
}
