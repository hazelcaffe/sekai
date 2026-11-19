import { afterEach, describe, expect, test } from "bun:test";
import { type Channel, type Message, slackCommand, slackManifest } from "@sekai/shared";
import type { ServerWebSocket } from "bun";
import { type SlackTransport, slackAdapter, slackReply } from "../src/channels/slack.ts";
import { fromSlack, slackChat, slackMrkdwn, slackRef } from "../src/channels/slack-format.ts";
import { OutboundStream, type PostedStore } from "../src/channels/stream.ts";
import type { ChannelHandlers, InboundMessage } from "../src/channels/types.ts";

const channel = (bot = "A"): Channel => ({
	id: `chn_${bot}`,
	agentId: `agt_${bot}`,
	type: "slack",
	name: bot,
	enabled: true,
	config: {},
	secrets: { botToken: `xoxb-${bot}`, appToken: `xapp-${bot}` },
	allowFrom: ["UOWNER"],
	dmPolicy: "pairing",
	groupPolicy: "mention",
	delivery: "smart",
	createdAt: 0,
	updatedAt: 0,
});

/** Socket Mode plus the small Web API surface the adapter uses. Every call records which real bot sent it. */
function fakeSlack() {
	const sockets = new Map<string, ServerWebSocket<{ bot: string }>>();
	const acks: string[] = [];
	const calls: { method: string; bot: string; body: Record<string, unknown>; at: number }[] = [];
	const downloads: { url: string; auth: string | null; body?: string }[] = [];
	let opens = 0;
	let rateLimit = "";
	const denied = new Map<string, string>();
	const server = Bun.serve<{ bot: string }>({
		port: 0,
		hostname: "127.0.0.1",
		async fetch(req, s): Promise<Response | undefined> {
			const url = new URL(req.url);
			if (url.pathname === "/socket") {
				if (s.upgrade(req, { data: { bot: url.searchParams.get("bot") ?? "A" } })) return;
				return new Response(null, { status: 400 });
			}
			const method = url.pathname.slice(1);
			if (!req.headers.get("content-type")?.includes("application/x-www-form-urlencoded"))
				return Response.json({ ok: false, error: "invalid_post_type" });
			const bot = (req.headers.get("authorization") ?? "").replace(/^Bearer x(?:oxb|app)-/, "");
			const body: Record<string, unknown> = Object.fromEntries(new URLSearchParams(await req.text()));
			for (const key of ["blocks", "files"]) if (typeof body[key] === "string") body[key] = JSON.parse(body[key]);
			calls.push({ method, bot, body, at: Date.now() });
			if (rateLimit === method) {
				rateLimit = "";
				return Response.json(
					{ ok: false, error: "ratelimited" },
					{ status: 429, headers: { "retry-after": "1" } },
				);
			}
			if (bot === "bad") return Response.json({ ok: false, error: "invalid_auth" });
			if (denied.has(method)) return Response.json({ ok: false, error: denied.get(method) });
			const json = (data: object) => Response.json({ ok: true, ...data });
			if (method === "auth.test")
				return json({ team: "Sekai test", team_id: "T1", user_id: `UBOT${bot}`, user: bot, bot_id: `B${bot}` });
			if (method === "bots.info") return json({ bot: { app_id: `APP${bot}` } });
			if (method === "apps.connections.open") {
				opens++;
				return json({ url: `ws://127.0.0.1:${server.port}/socket?bot=${bot}` });
			}
			if (method === "users.info")
				return json({
					user: {
						id: body.user,
						name: body.user,
						profile: { display_name: body.user === "UOWNER" ? "Hazel" : body.user },
						is_bot: String(body.user).startsWith("UBOT"),
					},
				});
			if (method === "conversations.info")
				return json({
					channel: {
						id: body.channel,
						name: "general",
						is_im: String(body.channel).startsWith("D"),
						is_member: true,
					},
				});
			if (method === "conversations.open") return json({ channel: { id: "D1", is_im: true } });
			if (method === "chat.postMessage") return json({ ts: `2000.${String(calls.length).padStart(6, "0")}` });
			if (method === "files.getUploadURLExternal")
				return json({ upload_url: "https://files.slack.com/upload/fake", file_id: "F1" });
			return json({});
		},
		websocket: {
			open(socket) {
				sockets.set(socket.data.bot, socket);
				socket.send(
					JSON.stringify({
						type: "hello",
						num_connections: 1,
						connection_info: { app_id: `APP${socket.data.bot}` },
					}),
				);
			},
			message(_socket, message) {
				acks.push((JSON.parse(String(message)) as { envelope_id: string }).envelope_id);
			},
		},
	});
	const transport: SlackTransport = {
		api: `http://127.0.0.1:${server.port}`,
		socket: (url) => new WebSocket(url),
		reconnectMs: 10,
		postMs: 0,
		fileFetch: async (url, init) => {
			downloads.push({
				url: url.toString(),
				auth: new Headers(init.headers).get("authorization"),
				body: typeof init.body === "string" ? init.body : undefined,
			});
			return new Response("file content");
		},
	};
	let seq = 0;
	const emit = (bot: string, type: string, payload: unknown, id = `envelope-${++seq}`) => {
		sockets.get(bot)?.send(JSON.stringify({ type, envelope_id: id, payload }));
		return id;
	};
	return {
		sockets,
		acks,
		calls,
		downloads,
		transport,
		emit,
		get opens() {
			return opens;
		},
		limit: (method: string) => {
			rateLimit = method;
		},
		deny: (method: string, error: string) => denied.set(method, error),
		stop: () => server.stop(true),
	};
}

const handlers = (patch: Partial<ChannelHandlers> = {}): ChannelHandlers => ({
	onMessage: async () => {},
	onCommand: async () => ({ text: "Status" }),
	onAction: async () => ({}),
	onAutocomplete: async () => [],
	onFatal: () => {},
	log: () => {},
	...patch,
});
async function until(check: () => boolean) {
	for (let i = 0; i < 200; i++) {
		if (check()) return;
		await Bun.sleep(10);
	}
	throw new Error("Fake Slack didn't receive the expected call.");
}
const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
	for (const stop of cleanups.splice(0).reverse()) await stop();
});
async function setup(h = handlers(), bot = "A", fake = fakeSlack()) {
	cleanups.push(() => fake.stop());
	const adapter = slackAdapter(channel(bot), fake.transport);
	cleanups.push(() => adapter.stop());
	const identity = await adapter.start(h);
	return { fake, adapter, identity };
}

describe("Slack manifest and mrkdwn", () => {
	test("one native app and unique command per bot, with no public endpoints or credentials", () => {
		const bot = { id: "agt_1234567", name: "Miku", job: "Helps with music" };
		const manifest = slackManifest(bot);
		expect(manifest.display_information.name).toBe("Miku");
		expect(manifest.features.bot_user.always_online).toBe(true);
		expect(manifest.features.app_home.messages_tab_read_only_enabled).toBe(false);
		expect(manifest.features.agent_view.agent_description).toBe(bot.job);
		expect(manifest.settings.socket_mode_enabled).toBe(true);
		expect(manifest.settings.interactivity.is_enabled).toBe(true);
		expect(manifest.oauth_config.scopes.bot).toContain("files:write");
		expect(slackCommand(bot)).not.toBe(slackCommand({ ...bot, id: "agt_7654321" }));
		expect(slackCommand({ ...bot, name: "初音ミク" })).toMatch(/^\/sekai-bot-/);
		expect(JSON.stringify(manifest)).not.toMatch(/xoxb|xapp|request_url/);
	});
	test("emphasis, links, quotes, lists, headings, code, tables and safe markup", () => {
		expect(slackMrkdwn("**bold** *italic* _also_ ~~gone~~")).toBe("*bold* _italic_ _also_ ~gone~");
		expect(slackMrkdwn("# Title\n- one\n1. two\n> quoted\nA & B < C")).toBe(
			"*Title*\n• one\n1. two\n> quoted\nA &amp; B &lt; C",
		);
		expect(slackMrkdwn("[site](https://example.com/?a=1&b=2) <@UBOTA> <!channel>")).toBe(
			"<https://example.com/?a=1&amp;b=2|site> <@UBOTA> &lt;!channel&gt;",
		);
		expect(slackMrkdwn("`**not bold** <tag>`\n```ts\nconst x = a < b;\n```")).toBe(
			"`**not bold** &lt;tag&gt;`\n```\nconst x = a &lt; b;\n```",
		);
		expect(slackMrkdwn("| A | B |\n| --- | --- |\n| 1 | 2 |")).toBe(
			"```\n| A | B |\n| --- | --- |\n| 1 | 2 |\n```",
		);
		expect(fromSlack("<https://example.com|Site> &amp; <!here> <@U1>")).toBe(
			"[Site](https://example.com) & @everyone <@U1>",
		);
	});
	test("workspace and thread ids are distinct and invalid addresses fail closed", () => {
		expect(slackRef(slackChat("T1", "C1", "100.001"))).toEqual({ team: "T1", channel: "C1", thread: "100.001" });
		expect(() => slackRef("https://internal/")).toThrow();
	});
});

describe("Slack Socket Mode", () => {
	test("rejects invalid credentials and tokens from different apps without leaking them", async () => {
		await expect(setup(handlers(), "bad")).rejects.toThrow("invalid_auth");
		const fake = fakeSlack();
		cleanups.push(() => fake.stop());
		const c = channel();
		c.secrets.appToken = "xapp-B";
		const adapter = slackAdapter(c, fake.transport);
		cleanups.push(() => adapter.stop());
		await expect(adapter.start(handlers())).rejects.toThrow("different apps");
	});
	test("multiple connections warn, link_disabled is fatal, and unsupported native status uses a removable reaction", async () => {
		const warnings: string[] = [];
		const errors: unknown[] = [];
		const { fake, adapter } = await setup(
			handlers({
				log: (_level, text) => {
					warnings.push(text);
				},
				onFatal: (error) => {
					errors.push(error);
				},
			}),
		);
		fake.sockets
			.get("A")
			?.send(JSON.stringify({ type: "hello", num_connections: 2, connection_info: { app_id: "APPA" } }));
		await until(() => warnings.length === 1);
		expect(warnings[0]).toContain("another Socket Mode connection");
		fake.deny("assistant.threads.setStatus", "not_allowed");
		await adapter.typing("slack:T1:D1:100.000001");
		expect(fake.calls.find((c) => c.method === "reactions.add")?.body.name).toBe("thinking_face");
		await adapter.idle?.("slack:T1:D1:100.000001");
		expect(fake.calls.some((c) => c.method === "reactions.remove")).toBe(true);
		fake.sockets.get("A")?.send(JSON.stringify({ type: "disconnect", reason: "link_disabled" }));
		await until(() => errors.length === 1);
		expect(String(errors[0])).toContain("Socket Mode is off");
	});
	test("checks both tokens, reports workspace, acks before handlers finish, and deduplicates", async () => {
		const got: InboundMessage[] = [];
		let release = () => {};
		const blocked = new Promise<void>((resolve) => {
			release = resolve;
		});
		const { fake, identity } = await setup(
			handlers({
				onMessage: async (m) => {
					got.push(m);
					await blocked;
				},
			}),
		);
		expect(identity).toMatchObject({
			botId: "UBOTA",
			workspaceId: "T1",
			workspaceName: "Sekai test",
			appId: "APPA",
		});
		const payload = {
			team_id: "T1",
			event: {
				type: "message",
				channel: "D1",
				channel_type: "im",
				user: "UOWNER",
				text: "Hi",
				ts: "1000.000001",
			},
		};
		const id = fake.emit("A", "events_api", payload);
		fake.emit("A", "events_api", payload, id);
		fake.emit("A", "events_api", { ...payload, event: { ...payload.event, type: "app_mention" } });
		await until(() => fake.acks.length === 3 && got.length === 1);
		expect(got[0]).toMatchObject({
			chatId: "slack:T1:D1:1000.000001",
			addressed: true,
			isGroup: false,
			senderName: "Hazel",
		});
		release();
	});
	test("DM round trip and native thinking status stay in the initiating thread", async () => {
		let received: InboundMessage | undefined;
		const { fake, adapter } = await setup(
			handlers({
				onMessage: async (m) => {
					received = m;
				},
			}),
		);
		fake.emit("A", "events_api", {
			team_id: "T1",
			event: { type: "message", channel: "D1", user: "UOWNER", text: "Hi", ts: "1000.000002" },
		});
		await until(() => Boolean(received));
		const chat = received?.chatId ?? "";
		await adapter.typing(chat);
		await adapter.send(chat, "**Hello!**");
		expect(fake.calls.find((c) => c.method === "assistant.threads.setStatus")?.body).toMatchObject({
			status: "is thinking…",
			thread_ts: "1000.000002",
		});
		expect(fake.calls.find((c) => c.method === "chat.postMessage")?.body).toMatchObject({
			channel: "D1",
			thread_ts: "1000.000002",
			text: "*Hello!*",
		});
	});
	test("mentions, ordinary messages and thread replies translate without executing edits or own messages", async () => {
		const got: InboundMessage[] = [];
		const { fake } = await setup(
			handlers({
				onMessage: async (m) => {
					got.push(m);
				},
			}),
		);
		for (const event of [
			{ ts: "10.000001", text: "<@UBOTA> hi" },
			{ ts: "10.000002", text: "not addressed" },
			{ ts: "10.000003", thread_ts: "10.000001", text: "again" },
			{ ts: "10.000004", subtype: "message_changed", text: "edited" },
			{ ts: "10.000005", user: "UBOTA", text: "own" },
		])
			fake.emit("A", "events_api", {
				team_id: "T1",
				event: { type: "message", channel: "C1", user: "UOWNER", ...event },
			});
		await until(() => got.length === 3);
		expect(got[0]).toMatchObject({ isGroup: true, addressed: true, chatId: "slack:T1:C1:10.000001" });
		expect(got[1]?.addressed).toBe(false);
		expect(got[2]).toMatchObject({ threadReply: true, replyToId: "10.000001", chatId: "slack:T1:C1:10.000001" });
		expect(got[0]?.mentions[0]?.id).toBe("UBOTA");
	});
	test("slash command acknowledges immediately and responds privately; controls update or refuse privately", async () => {
		const seen: string[] = [];
		const { fake } = await setup(
			handlers({
				onCommand: async (c) => {
					seen.push(c.name);
					return { text: "Running" };
				},
				onAction: async (a) =>
					a.senderId === "UOWNER"
						? { update: { text: "Approved by Hazel" } }
						: { whisper: "Only my owner can do that." },
			}),
		);
		fake.emit("A", "slash_commands", {
			team_id: "T1",
			channel_id: "C1",
			user_id: "UOWNER",
			command: "/sekai-miku-1234567",
			text: "status",
			response_url: "https://hooks.slack.com/commands/fake",
		});
		for (const id of ["UOWNER", "USTRANGER"])
			fake.emit("A", "interactive", {
				type: "block_actions",
				team: { id: "T1" },
				channel: { id: "C1" },
				user: { id },
				message: { ts: "123.000001", thread_ts: "122.000001" },
				actions: [{ action_id: "ap:ABC:approve" }],
			});
		await until(() => seen.length === 1 && fake.calls.some((c) => c.method === "chat.postEphemeral"));
		expect(fake.acks.length).toBe(3);
		expect(fake.calls.find((c) => c.method === "chat.update")?.body).toMatchObject({
			text: "Approved by Hazel",
			blocks: [],
		});
		expect(fake.calls.find((c) => c.method === "chat.postEphemeral")?.body.user).toBe("USTRANGER");
		expect(fake.downloads[0]?.auth).toBeNull();
		fake.emit("A", "interactive", {
			type: "block_actions",
			team: { id: "T1" },
			channel: { id: "C1" },
			user: { id: "UOWNER" },
			message: { ts: "123.000003" },
			container: { is_ephemeral: true },
			response_url: "https://hooks.slack.com/actions/fake",
			actions: [{ action_id: "menu" }],
		});
		await until(() => fake.downloads.some((r) => r.url.includes("/actions/")));
		expect(JSON.parse(fake.downloads.find((r) => r.url.includes("/actions/"))?.body ?? "{}")).toMatchObject({
			replace_original: true,
			response_type: "ephemeral",
		});
		const reply = slackReply({
			text: "**Approve?**",
			buttons: [{ id: "ap:ABC:approve", label: "Approve once", style: "success" }],
		});
		expect(JSON.stringify(reply.blocks)).toContain('"action_id":"ap:ABC:approve"');
	});
	test("downloads files lazily with a cap and credential host check; uploads through the external flow", async () => {
		const got: InboundMessage[] = [];
		const { fake, adapter } = await setup(
			handlers({
				onMessage: async (m) => {
					got.push(m);
				},
			}),
		);
		fake.emit("A", "events_api", {
			team_id: "T1",
			event: {
				type: "message",
				channel: "D1",
				user: "UOWNER",
				ts: "30.000001",
				files: [
					{ name: "note.txt", url_private: "https://files.slack.com/files-pri/note", size: 12 },
					{ name: "bad", url_private: "https://internal.example/token-theft", size: 1 },
					{ name: "large", url_private: "https://files.slack.com/huge", size: 21 * 1024 * 1024 },
				],
			},
		});
		await until(() => got.length === 1);
		expect(fake.downloads.length).toBe(0);
		expect(got[0]?.attachments.length).toBe(2);
		expect(new TextDecoder().decode((await got[0]?.attachments[0]?.load()) ?? undefined)).toBe("file content");
		expect(await got[0]?.attachments[1]?.load()).toBeNull();
		expect(fake.downloads[0]?.auth).toBe("Bearer xoxb-A");
		await adapter.send("slack:T1:D1:30.000001", {
			text: "Here",
			files: [{ name: "out.txt", mime: "text/plain", data: new TextEncoder().encode("hello") }],
		});
		expect(fake.calls.find((c) => c.method === "files.completeUploadExternal")?.body).toMatchObject({
			channel_id: "D1",
			thread_ts: "30.000001",
			files: [{ id: "F1", title: "out.txt" }],
		});
		expect(fake.downloads.at(-1)?.auth).toBeNull();
		const dm = await adapter.openDirect?.("UOWNER");
		expect(dm).toEqual({ chatId: "slack:T1:D1", name: "DM with Hazel" });
	});
	test("disconnect refresh and unexpected close reconnect, stop cancels retries", async () => {
		const { fake, adapter } = await setup();
		fake.sockets.get("A")?.send(JSON.stringify({ type: "disconnect", reason: "refresh_requested" }));
		await until(() => fake.opens === 2);
		const first = fake.sockets.get("A");
		first?.close();
		await until(() => fake.opens === 3);
		await adapter.stop();
		await Bun.sleep(50);
		expect(fake.opens).toBe(3);
	});
	test("Retry-After is respected and an explicit platform can't post into another workspace", async () => {
		const { fake, adapter } = await setup();
		fake.limit("chat.postMessage");
		await adapter.send("slack:T1:D1", "hello");
		const calls = fake.calls.filter((c) => c.method === "chat.postMessage");
		expect((calls[1]?.at ?? 0) - (calls[0]?.at ?? 0)).toBeGreaterThanOrEqual(950);
		await expect(adapter.send("slack:T2:D1", "no")).rejects.toThrow(/another workspace/);
	});
	test("two bots in one group thread each post as themselves, without streaming edits", async () => {
		const fake = fakeSlack();
		const a = await setup(handlers(), "A", fake);
		const b = slackAdapter(channel("B"), fake.transport);
		cleanups.push(() => b.stop());
		await b.start(handlers());
		const store: PostedStore = { load: async () => [], add: async () => {}, trim: async () => {} };
		const make = (id: string): Message => ({
			id,
			conversationId: "cnv_group",
			sender: "agent",
			agentId: `agt_${id}`,
			parts: [{ type: "text", text: "A thought for @Kanade" }],
			status: "streaming",
			error: null,
			model: null,
			usage: null,
			runId: null,
			meta: {},
			attachments: [],
			replyToId: null,
			createdAt: 1,
			updatedAt: 1,
		});
		for (const [id, adapter] of [
			["A", a.adapter],
			["B", b],
		] as const) {
			const m = make(id);
			const stream = new OutboundStream(
				{
					channelId: `chn_${id}`,
					chatId: "slack:T1:C1:50.000001",
					header: null,
					replyTo: null,
					mentions: new Map([["kanade", "<@UBOTB>"]]),
				},
				m,
				() => adapter,
				store,
			);
			stream.update(m);
			await stream.settled();
			stream.update({ ...m, status: "done" });
			await stream.settled();
		}
		expect(
			fake.calls
				.filter((c) => c.method === "chat.postMessage")
				.map((c) => ({ bot: c.bot, thread: c.body.thread_ts, text: c.body.text })),
		).toEqual([
			{ bot: "A", thread: "50.000001", text: "A thought for <@UBOTB>" },
			{ bot: "B", thread: "50.000001", text: "A thought for <@UBOTB>" },
		]);
		expect(fake.calls.some((c) => c.method === "chat.update")).toBe(false);
	});
});
