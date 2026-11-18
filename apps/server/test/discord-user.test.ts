import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Channel } from "@sekai/shared";
import { discordUserAdapter, endpoints } from "../src/channels/discord-user.ts";
import type { ChannelHandlers } from "../src/channels/types.ts";

/** A fake Discord: REST (user lookup, chats, messages) plus a gateway socket that speaks the v10 protocol. */
function fakeDiscord() {
	const state = {
		token: "user-token-abc",
		self: { id: "900", username: "sekaiie", global_name: "Sekaiie" } as {
			id: string;
			username: string;
			global_name?: string | null;
			bot?: boolean;
		},
		dm: {
			id: "dm1",
			type: 1,
			recipients: [
				{ id: "900", username: "sekaiie" },
				{ id: "7", username: "sam" },
			],
		},
		group: { id: "gc1", type: 3, name: "the gang", recipients: [{ id: "900", username: "sekaiie" }] },
		sent: [] as { chatId: string; body: Record<string, unknown> }[],
		deleted: [] as string[],
		reactions: [] as string[],
		typing: [] as string[],
		identified: null as Record<string, unknown> | null,
		heartbeats: 0,
		socket: null as import("bun").ServerWebSocket<unknown> | null,
	};
	const server = Bun.serve({
		port: 0,
		async fetch(req, server) {
			const url = new URL(req.url);
			if (url.pathname === "/gw") {
				if (server.upgrade(req)) return undefined;
				return new Response("ws only", { status: 400 });
			}
			const auth = req.headers.get("authorization");
			const json = (x: unknown, status = 200) =>
				new Response(JSON.stringify(x), { status, headers: { "content-type": "application/json" } });
			if (auth !== state.token) return json({ message: "401: Unauthorized" }, 401);
			const path = url.pathname.replace("/api/v10", "");
			if (req.method === "GET" && path === "/users/@me") return json(state.self);
			if (req.method === "GET" && path === `/channels/${state.dm.id}`) return json(state.dm);
			if (req.method === "GET" && path === `/channels/${state.group.id}`) return json(state.group);
			if (req.method === "POST" && path === "/users/@me/channels") {
				const body = (await req.json()) as { recipient_id: string };
				return json(Object.assign({}, state.dm, { id: `dm-${body.recipient_id}` }));
			}
			if (req.method === "POST" && path.endsWith("/messages")) {
				const chatId = path.split("/")[2] ?? "";
				state.sent.push({ chatId, body: (await req.json()) as Record<string, unknown> });
				return json({ id: `m${state.sent.length}`, channel_id: chatId });
			}
			if (req.method === "PATCH" && path.includes("/messages/")) {
				state.sent.push({
					chatId: path.split("/")[2] ?? "",
					body: Object.assign({ edited: true }, (await req.json()) as Record<string, unknown>),
				});
				return json({});
			}
			if (req.method === "DELETE" && path.includes("/messages/")) {
				state.deleted.push(path);
				return new Response(null, { status: 204 });
			}
			if (req.method === "PUT" && path.includes("/reactions/")) {
				state.reactions.push(path);
				return new Response(null, { status: 204 });
			}
			if (req.method === "POST" && path.endsWith("/typing")) {
				state.typing.push(path.split("/")[2] ?? "");
				return json({});
			}
			return json({ message: `no route ${req.method} ${path}` }, 404);
		},
		websocket: {
			open(ws) {
				state.socket = ws;
				ws.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 45_000 } }));
			},
			message(ws, msg) {
				const p = JSON.parse(String(msg)) as { op: number; d?: unknown };
				if (p.op === 2) {
					state.identified = p.d as Record<string, unknown>;
					ws.send(
						JSON.stringify({
							op: 0,
							t: "READY",
							s: 1,
							d: { user: state.self, session_id: "sess1", private_channels: [state.dm, state.group] },
						}),
					);
				} else if (p.op === 1) {
					state.heartbeats++;
					ws.send(JSON.stringify({ op: 11 }));
				}
			},
		},
	});
	return { state, url: `http://127.0.0.1:${server.port}`, stop: () => server.stop(true) };
}

function channelOf(token: string): Channel {
	return {
		id: "ch_test",
		agentId: "agt_1",
		type: "discord-user",
		name: "",
		enabled: true,
		config: {},
		secrets: { userToken: token },
		dmPolicy: "pairing",
		allowFrom: [],
		groupPolicy: "mention",
		delivery: "smart",
		createdAt: 0,
		updatedAt: 0,
	};
}

const handlers = (onMessage: (m: unknown) => void): ChannelHandlers => ({
	onMessage: async (m) => onMessage(m),
	onCommand: async () => ({ text: "" }),
	onAutocomplete: async () => [],
	onAction: async () => ({}),
	onFatal: (err) => {
		throw err;
	},
	log: () => {},
});

describe("discord user account adapter", () => {
	let fake: ReturnType<typeof fakeDiscord>;
	beforeAll(() => {
		fake = fakeDiscord();
		endpoints.api = `${fake.url}/api/v10`;
		endpoints.gateway = `ws://127.0.0.1:${new URL(fake.url).port}/gw`;
	});
	afterAll(() => fake.stop());

	test("rejects a bot token and a bad token", async () => {
		await expect(discordUserAdapter(channelOf("nope")).start(handlers(() => {}))).rejects.toThrow(/rejected/i);
		// A token that belongs to a bot application.
		const bot = fakeDiscord();
		bot.state.self = Object.assign({}, bot.state.self, { id: "1", username: "robot", bot: true });
		endpoints.api = `${bot.url}/api/v10`;
		await expect(discordUserAdapter(channelOf(bot.state.token)).start(handlers(() => {}))).rejects.toThrow(
			/bot application/i,
		);
		bot.stop();
		endpoints.api = `${fake.url}/api/v10`;
	});

	test("connects, identifies, and reports the account", async () => {
		const adapter = discordUserAdapter(channelOf(fake.state.token));
		const me = await adapter.start(handlers(() => {}));
		expect(me.botId).toBe("900");
		expect(me.botName).toBe("Sekaiie (@sekaiie)");
		expect(me.readsAll).toBe(true);
		expect(me.inviteUrl).toBeNull();
		await new Promise((r) => setTimeout(r, 150));
		expect((fake.state.identified as { token?: string } | null)?.token).toBe(fake.state.token);
		await adapter.stop();
	});

	test("DMs and group chats arrive as addressed messages with names", async () => {
		const got: { chatId: string; chatName: string; isGroup: boolean; text: string; addressed: boolean }[] = [];
		const adapter = discordUserAdapter(channelOf(fake.state.token));
		await adapter.start(handlers((m) => got.push(m as (typeof got)[0])));
		await new Promise((r) => setTimeout(r, 100));
		const send = (d: unknown) => fake.state.socket?.send(JSON.stringify({ op: 0, t: "MESSAGE_CREATE", s: 2, d }));
		send({
			id: "a1",
			channel_id: "dm1",
			type: 0,
			content: "hi there",
			author: { id: "7", username: "sam", global_name: "Sam" },
		});
		send({
			id: "a2",
			channel_id: "gc1",
			type: 0,
			content: "group hi",
			author: { id: "8", username: "fern" },
			mentions: [{ id: "900", username: "sekaiie" }],
		});
		// From the account itself, and a server channel: ignored.
		send({ id: "a3", channel_id: "dm1", type: 0, content: "me", author: { id: "900", username: "sekaiie" } });
		send({ id: "a4", channel_id: "srv", type: 0, content: "server", author: { id: "7", username: "sam" } });
		await new Promise((r) => setTimeout(r, 200));
		expect(got.length).toBe(2);
		expect(got[0]).toMatchObject({
			chatId: "dm1",
			chatName: "DM with sam",
			isGroup: false,
			text: "hi there",
			addressed: true,
		});
		expect(got[1]).toMatchObject({
			chatId: "gc1",
			chatName: "the gang",
			isGroup: true,
			text: "group hi",
			addressed: true,
		});
		await adapter.stop();
	});

	test("send, edit, react, typing, openDirect, groupMembers use the account REST", async () => {
		const adapter = discordUserAdapter(channelOf(fake.state.token));
		await adapter.start(handlers(() => {}));
		const id = await adapter.send("dm1", "hello back");
		expect(id).toBe("m1");
		await adapter.edit("dm1", id, "edited");
		await adapter.react("dm1", id, "👍");
		await adapter.typing("dm1");
		await adapter.remove("dm1", "mX");
		const dm = await adapter.openDirect?.("55");
		expect(dm).toEqual({ chatId: "dm-55", name: "DM with sam" });
		// Group members come from the group DM's recipients (for "trust everyone in this GC").
		const members = await adapter.groupMembers?.("gc1");
		expect(members).toContain("900");
		expect(fake.state.sent[0]).toMatchObject({ chatId: "dm1", body: { content: "hello back" } });
		expect(fake.state.sent[1]).toMatchObject({ body: { edited: true, content: "edited" } });
		expect(fake.state.reactions[0]).toContain("/reactions/%F0%9F%91%8D/@me");
		expect(fake.state.typing).toContain("dm1");
		expect(fake.state.deleted[0]).toContain("/messages/mX");
		await adapter.stop();
	});

	test("reconnects after the socket drops, resuming the session", async () => {
		const adapter = discordUserAdapter(channelOf(fake.state.token));
		await adapter.start(handlers(() => {}));
		await new Promise((r) => setTimeout(r, 100));
		const first = fake.state.socket;
		first?.close(4001); // a recoverable close code
		await new Promise((r) => setTimeout(r, 4500)); // reconnect delay is 4s
		expect(fake.state.socket).not.toBe(first);
		await adapter.stop();
	}, 10_000);
});
