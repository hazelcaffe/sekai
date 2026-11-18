import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { Machine } from "@sekai/shared";
import { applyEdit } from "../src/agent/tools/machines.ts";
import { askOn, pick, riskOn } from "../src/agent/tools/targets.ts";
import { type BridgeSocket, bridgeWebSocket, upgradeBridge } from "../src/machines/bridge.ts";

describe("desktop app bridge", () => {
	let server: ReturnType<typeof Bun.serve<BridgeSocket>>;
	let url = "";
	beforeAll(() => {
		server = Bun.serve<BridgeSocket>({
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
		url = `ws://127.0.0.1:${server.port}/api/machines/bridge`;
	});
	afterAll(() => server.stop(true));

	test("web pages can't pose as the desktop app", async () => {
		const res = await fetch(url.replace("ws:", "http:"), {
			headers: {
				upgrade: "websocket",
				origin: "https://evil.example",
				"sec-websocket-version": "13",
				"sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
				connection: "Upgrade",
			},
		});
		expect(res.status).toBe(403);
	});

	test("the desktop app needs a token", async () => {
		const res = await fetch(url.replace("ws:", "http:"), {
			headers: {
				upgrade: "websocket",
				"sec-websocket-version": "13",
				"sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
				connection: "Upgrade",
			},
		});
		expect(res.status).toBe(401);
	});

	test.skipIf(!Bun.which("node"))(
		"hello, calls, cancel, tunnels, revoke and stop (with a Node client)",
		async () => {
			const p = Bun.spawn(["bun", join(import.meta.dir, "fixtures", "bridge-check.ts")], {
				stdout: "pipe",
				stderr: "pipe",
				env: { ...process.env, SEKAI_AUTH_TOKEN: "bridge-check-token" },
			});
			const out = await new Response(p.stdout).text();
			const line = out.split("\n").find((l) => l.startsWith("REPORT "));
			expect(line).toBeDefined();
			expect(JSON.parse(line?.slice(7) ?? "{}")).toEqual({
				online: true,
				hello: true,
				call: { width: 1920, agent: "agt_a" },
				failed: "rejected: nope",
				cancelled: "rejected: Cancelled",
				tunnel: "echo:ping",
				cancelSent: true,
				revokeSent: true,
				stopped: true,
				offline: true,
				afterwards: "rejected: That computer is offline (the Sekai desktop app isn't connected)",
			});
		},
		30_000,
	);
});

describe("edit_file", () => {
	test("exact, unique replacements", () => {
		expect(applyEdit("a\nb\nc\n", "b", "B", false)).toEqual({ text: "a\nB\nc\n", count: 1 });
		expect(applyEdit("x x x", "x", "y", true)).toEqual({ text: "y y y", count: 3 });
		expect(applyEdit("x x", "x", "y", false)).toMatch(/appears 2 times/);
		expect(applyEdit("abc", "zzz", "y", false)).toMatch(/isn't in the file/);
		// "$&" in the new text is literal, not a regex replacement pattern.
		expect(applyEdit("price", "price", "$& now", false)).toEqual({ text: "$& now", count: 1 });
	});

	test("line endings are matched to the file's", () => {
		expect(applyEdit("one\r\ntwo\r\n", "one\ntwo", "1\n2", false)).toEqual({ text: "1\r\n2\r\n", count: 1 });
	});
});

describe("which machine", () => {
	const m = (patch: Partial<Machine>): Machine =>
		({
			id: "m1",
			name: "x",
			hostname: "x",
			kind: "computer",
			status: "running",
			remoteId: null,
			...patch,
		}) as Machine;
	const computer = m({ id: "c", name: "Pip's computer", hostname: "pip" });
	const devbox = m({ id: "d", name: "api-test", hostname: "pip-api-test", kind: "devbox" });
	const laptop = m({
		id: "l",
		name: "studio",
		hostname: "studio",
		kind: "device",
		provider: "local",
		remoteId: "dev-test-1",
	});

	test("references", () => {
		const all = [computer, devbox, laptop];
		expect(pick(all, undefined)?.id).toBe("c");
		expect(pick(all, "computer")?.id).toBe("c");
		expect(pick(all, "device")?.id).toBe("l");
		expect(pick(all, "API-TEST")?.id).toBe("d");
		expect(pick(all, "pip-api-test")?.id).toBe("d");
		expect(pick([devbox], "computer")).toBeNull();
	});

	test("acting on your own computer counts as external", () => {
		expect(riskOn(laptop, "write")).toBe("external");
		expect(riskOn(laptop, "read")).toBe("read");
		expect(riskOn(laptop, "destructive")).toBe("destructive");
		expect(riskOn(computer, "write")).toBe("write");
		expect(riskOn(null, "write")).toBe("write");
		// Offline (no hello), so the device's "approve every action" setting isn't known: no extra ask.
		expect(askOn(laptop, "write")).toBeNull();
		expect(askOn(computer, "write")).toBeNull();
	});
});
