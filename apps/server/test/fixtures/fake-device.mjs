// A stand-in for the Sekai desktop app, using Node's WebSocket (the client Electron uses). It answers a
// few calls, records what the server asks of it (one JSON line per message on stdout) and forwards tunnels.
import net from "node:net";

const [port, deviceId] = process.argv.slice(2);
const ws = new WebSocket(`ws://127.0.0.1:${port}/api/machines/bridge?token=${process.env.SEKAI_AUTH_TOKEN ?? ""}`);
const tunnels = new Map();
const send = (msg) => ws.send(JSON.stringify(msg));

ws.onopen = () =>
	send({
		t: "hello",
		deviceId,
		name: "test-laptop",
		platform: "linux",
		arch: "x64",
		user: "sam",
		specs: { cores: 8, memoryMb: 16384, diskGb: 512 },
		settings: { enabled: true, agentIds: ["agt_a"], workdir: "/tmp", askEachAction: true },
		version: "0.1.0",
	});

ws.onmessage = (ev) => {
	const msg = JSON.parse(String(ev.data));
	process.stdout.write(
		`${JSON.stringify({ t: msg.t, method: msg.method, agentId: msg.agentId ?? msg.params?.agentId })}\n`,
	);
	if (msg.t === "call" && msg.method === "screen.info") {
		send({ t: "result", id: msg.id, ok: true, data: { width: 1920, agent: msg.params.agentId } });
	}
	if (msg.t === "call" && msg.method === "fail") send({ t: "result", id: msg.id, ok: false, error: "nope" });
	if (msg.t === "revoke") send({ t: "stop" });
	if (msg.t === "tunnel.open") {
		const sock = net.connect({ host: "127.0.0.1", port: msg.port });
		sock.on("data", (d) => send({ t: "tunnel.data", sid: msg.sid, b64: d.toString("base64") }));
		sock.on("close", () => send({ t: "tunnel.close", sid: msg.sid }));
		tunnels.set(msg.sid, sock);
	}
	if (msg.t === "tunnel.data") tunnels.get(msg.sid)?.write(Buffer.from(msg.b64, "base64"));
	if (msg.t === "tunnel.close") tunnels.get(msg.sid)?.end();
};
