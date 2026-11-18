// Runs the desktop-app bridge end to end with a fake app (Node's WebSocket, like Electron) and prints a JSON
// report. bridge.test.ts runs this as a plain Bun process: inside the test runner, Bun's WebSocket server
// trips over the frames ("new message inside a fragmented message"), which doesn't happen in `bun run`.
import { join } from "node:path";
import {
	type BridgeSocket,
	bridgeWebSocket,
	deviceCall,
	deviceTunnel,
	isDeviceOnline,
	revokeDevice,
	setBridgeHooks,
	upgradeBridge,
} from "../../src/machines/bridge.ts";

const DEVICE = "dev-test-1";
const report: Record<string, unknown> = {};
const seen: string[] = [];
setBridgeHooks({
	onHello: async (h) => void seen.push(`hello:${h.settings.agentIds.join(",")}`),
	onOffline: async (id) => void seen.push(`offline:${id}`),
	onStop: async (id) => void seen.push(`stop:${id}`),
});
const server = Bun.serve<BridgeSocket>({
	port: 0,
	async fetch(req, srv) {
		const res = await upgradeBridge(req, srv);
		return res === null ? new Response("nope", { status: 404 }) : res;
	},
	websocket: {
		message: (ws, m) => void bridgeWebSocket.message(ws, m),
		close: (ws) => bridgeWebSocket.close(ws),
	},
});
const echo = Bun.listen({
	hostname: "127.0.0.1",
	port: 0,
	socket: { data: (s, d) => void s.write(Buffer.from(`echo:${Buffer.from(d).toString()}`)) },
});
const device = Bun.spawn(["node", join(import.meta.dir, "fake-device.mjs"), String(server.port), DEVICE], {
	stdout: "pipe",
	stderr: "inherit",
});
const received: { t: string; method?: string; agentId?: string }[] = [];
void (async () => {
	let buffer = "";
	for await (const chunk of device.stdout) {
		buffer += new TextDecoder().decode(chunk);
		const lines = buffer.split("\n");
		buffer = lines.pop() ?? "";
		for (const l of lines) if (l.trim()) received.push(JSON.parse(l));
	}
})();
const wait = async (ok: () => boolean) => {
	for (let i = 0; i < 300 && !ok(); i++) await Bun.sleep(10);
};

try {
	await wait(() => isDeviceOnline(DEVICE));
	report.online = isDeviceOnline(DEVICE);
	report.hello = seen.includes("hello:agt_a");
	report.call = await deviceCall(DEVICE, "screen.info", { agentId: "agt_a" }).catch((e: Error) => e.message);
	report.failed = await deviceCall(DEVICE, "fail").catch((e: Error) => `rejected: ${e.message}`);
	const controller = new AbortController();
	const slow = deviceCall(DEVICE, "exec", {}, 10_000, controller.signal);
	controller.abort();
	report.cancelled = await slow.catch((e: Error) => `rejected: ${e.message}`);
	const tunnel = await deviceTunnel(DEVICE, echo.port);
	report.tunnel = await new Promise<string>((resolve) => {
		void Bun.connect({
			hostname: "127.0.0.1",
			port: tunnel.localPort,
			socket: {
				open: (s) => void s.write("ping"),
				data: (s, d) => {
					resolve(Buffer.from(d).toString());
					s.end();
				},
			},
		});
		setTimeout(() => resolve("timed out"), 5000);
	});
	tunnel.close();
	// The fake app presses stop when it's told a bot was removed.
	revokeDevice(DEVICE, "agt_a");
	await wait(() => seen.includes(`stop:${DEVICE}`));
	report.cancelSent = received.some((m) => m.t === "cancel");
	report.revokeSent = received.some((m) => m.t === "revoke" && m.agentId === "agt_a");
	report.stopped = seen.includes(`stop:${DEVICE}`);
} finally {
	device.kill();
	echo.stop(true);
}
await wait(() => !isDeviceOnline(DEVICE));
report.offline = !isDeviceOnline(DEVICE) && seen.includes(`offline:${DEVICE}`);
report.afterwards = await deviceCall(DEVICE, "screen.info").catch((e: Error) => `rejected: ${e.message}`);
server.stop(true);
process.stdout.write(`REPORT ${JSON.stringify(report)}\n`);
process.exit(0);
