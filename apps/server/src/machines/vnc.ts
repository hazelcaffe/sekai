import type { Server, ServerWebSocket, Socket } from "bun";
import { runAs } from "../auth/actor.ts";
import { socketActor } from "../auth/index.ts";
import { log } from "../lib/log.ts";
import { getMachine, setTakeover } from "./manager.ts";

/**
 * Takeover: the app's VNC viewer (noVNC) talks WebSocket; this bridges it to the computer's VNC port so you
 * can use the bot's desktop from Sekai without exposing VNC anywhere else.
 */

export interface VncSocket {
	kind: "vnc";
	machineId: string;
	host: string;
	port: number;
	tcp: Socket | null;
	queue: Uint8Array[];
}

const PATH = /^\/api\/machines\/([^/]+)\/vnc$/;

/**
 * Open takeover screens per computer. When the last one closes (the tab was closed, the laptop slept…), the
 * bot gets its computer back after a short grace period, so a dropped connection can come back first.
 */
const viewers = new Map<string, number>();
const RELEASE_AFTER_MS = 20_000;

function viewerJoined(id: string): void {
	viewers.set(id, (viewers.get(id) ?? 0) + 1);
	setTakeover(id, true);
}

function viewerLeft(id: string): void {
	const n = (viewers.get(id) ?? 1) - 1;
	if (n > 0) {
		viewers.set(id, n);
		return;
	}
	viewers.delete(id);
	setTimeout(() => {
		if (viewers.has(id)) return;
		setTakeover(id, false);
		log.info(`takeover of ${id} ended (no screen open)`);
	}, RELEASE_AFTER_MS);
}

/** Upgrades /api/machines/:id/vnc to a WebSocket. Returns a Response for errors, or undefined once upgraded. */
export async function upgradeVnc(req: Request, server: Server<VncSocket>): Promise<Response | undefined | null> {
	const url = new URL(req.url);
	const match = url.pathname.match(PATH);
	if (!match?.[1]) return null;
	const actor = await socketActor(req);
	if (actor instanceof Response) return actor;
	// Only your own bots' computers.
	const id = match[1];
	const m = await runAs(actor, () => getMachine(id));
	const host = m?.addresses.tailscale ?? m?.addresses.lan;
	if (m?.status !== "running" || !m.ports.vnc || !host) {
		return Response.json({ error: "The computer isn't running" }, { status: 409 });
	}
	const protocol = req.headers.get("sec-websocket-protocol")?.split(",")[0]?.trim();
	const ok = server.upgrade(req, {
		data: { kind: "vnc", machineId: m.id, host, port: m.ports.vnc, tcp: null, queue: [] },
		headers: protocol ? { "Sec-WebSocket-Protocol": protocol } : undefined,
	});
	return ok ? undefined : Response.json({ error: "Expected a WebSocket" }, { status: 400 });
}

export const vncWebSocket = {
	async open(ws: ServerWebSocket<VncSocket>) {
		viewerJoined(ws.data.machineId);
		try {
			ws.data.tcp = await Bun.connect({
				hostname: ws.data.host,
				port: ws.data.port,
				socket: {
					data(_sock, chunk) {
						ws.send(chunk);
					},
					close() {
						ws.close();
					},
					error() {
						ws.close();
					},
				},
			});
			for (const chunk of ws.data.queue) ws.data.tcp.write(chunk);
			ws.data.queue = [];
		} catch (err) {
			log.warn(`vnc: can't reach ${ws.data.host}:${ws.data.port}: ${String(err)}`);
			ws.close(1011, "Can't reach the computer's VNC");
		}
	},
	message(ws: ServerWebSocket<VncSocket>, message: string | Buffer) {
		const bytes = typeof message === "string" ? new TextEncoder().encode(message) : new Uint8Array(message);
		if (ws.data.tcp) ws.data.tcp.write(bytes);
		else ws.data.queue.push(bytes);
	},
	close(ws: ServerWebSocket<VncSocket>) {
		ws.data.tcp?.end();
		viewerLeft(ws.data.machineId);
	},
};
