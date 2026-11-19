// The channel manager with a fake Slack, end to end against a scratch database (DATABASE_URL); prints a JSON report.
// slack-routing.test.ts runs it as its own process. Never point it at a live Sekai's database.
import { rmSync } from "node:fs";

import { slackDmThreads, type ToolPart } from "@sekai/shared";
import { requestApproval } from "../../src/agent/approvals.ts";
import { createApp } from "../../src/app.ts";
import { actorFor, currentActor, runAs } from "../../src/auth/actor.ts";
import { ensureSetupCode, setupCodeForTests } from "../../src/auth/service.ts";
import {
	createChannel,
	initChannels,
	listBindings,
	registerAdapter,
	shutdownChannels,
	updateChannel,
} from "../../src/channels/manager.ts";
import { bindingsForChat, status } from "../../src/channels/state.ts";
import type { ChannelAdapter, ChannelHandlers, InboundMessage, Reply } from "../../src/channels/types.ts";
import { config } from "../../src/config.ts";
import { closeDb, db, initDb, schema } from "../../src/db/index.ts";
import { bus } from "../../src/events/bus.ts";
import { messageUser } from "../../src/outreach/messages.ts";
import { createAgent, updateAgent } from "../../src/services/agents.ts";
import { createMessage, listMessages } from "../../src/services/messages.ts";

await initDb();
await db.delete(schema.users);
const callbacks = new Map<string, ChannelHandlers>();
const posts: { channelId: string; chatId: string; content: string | Reply; id: string; actor: string | null }[] = [];
let seq = 0;
registerAdapter(
	"slack",
	(channel): ChannelAdapter => ({
		maxText: 3900,
		threads: slackDmThreads(channel),
		mention: (id) => `<@${id}>`,
		subtext: (s) => s,
		start: async (h) => {
			callbacks.set(channel.id, h);
			return { botId: channel.name, botName: channel.name, readsAll: true, inviteUrl: null };
		},
		stop: async () => {},
		registerCommands: async () => {},
		send: async (chatId, content) => {
			const id = `200.${++seq}`;
			posts.push({ channelId: channel.id, chatId, content, id, actor: currentActor()?.userId ?? null });
			return id;
		},
		edit: async () => {},
		remove: async () => {},
		react: async () => {},
		typing: async () => {},
		canPost: async () => true,
		openDirect: async () => ({ chatId: "slack:T1:D1", name: "DM with Hazel" }),
	}),
);
async function wait(check: () => boolean) {
	for (let i = 0; i < 200; i++) {
		if (check()) return;
		await Bun.sleep(10);
	}
	throw new Error("Manager integration timed out.");
}
const text = (content: string | Reply) => (typeof content === "string" ? content : content.text);
const report: Record<string, unknown> = {};
try {
	await ensureSetupCode("http://127.0.0.1");
	const app = createApp();
	const res = await app.request("http://localhost/api/auth/setup", {
		method: "POST",
		headers: { host: "localhost", origin: "http://localhost", "content-type": "application/json" },
		body: JSON.stringify({
			username: "slack-test",
			name: "Hazel",
			password: "isolated test password only",
			code: setupCodeForTests(),
		}),
	});
	const setup = (await res.json()) as { user: { id: string } };
	if (!res.ok) throw new Error(`Scratch setup failed (${res.status}): ${JSON.stringify(setup)}`);
	await runAs(await actorFor(setup.user.id), async () => {
		const a = await createAgent({ name: "Miku" });
		const b = await createAgent({ name: "Kanade" });
		await updateAgent(a.id, { status: "paused" });
		await updateAgent(b.id, { status: "paused" });
		await initChannels();
		const ca = await createChannel({
			agentId: a.id,
			type: "slack",
			name: "UBOTA",
			allowFrom: ["UOWNER", "UGUEST"],
			enabled: false,
		});
		const cb = await createChannel({
			agentId: b.id,
			type: "slack",
			name: "UBOTB",
			allowFrom: ["UOWNER", "UGUEST"],
			enabled: false,
		});
		await updateChannel(ca.id, { enabled: true });
		await updateChannel(cb.id, { enabled: true });
		await wait(() => status(ca.id).state === "connected" && status(cb.id).state === "connected");
		const ha = callbacks.get(ca.id);
		const hb = callbacks.get(cb.id);
		if (!ha || !hb) throw new Error("No channel callbacks.");
		const parent = {
			chatId: "slack:T1:C1",
			chatName: "#general",
			isGroup: true,
			serverId: "T1",
			senderId: "UOWNER",
			senderName: "Hazel",
		};
		const linked = await ha.onCommand({
			...parent,
			name: "group",
			sub: "link",
			options: { bots: "Miku Kanade" },
			targetMessageId: null,
		});
		report.linked = linked.text.includes("now a group chat");
		const inbound: InboundMessage = {
			...parent,
			chatId: "slack:T1:C1:100.000001",
			parentChatId: parent.chatId,
			senderIsBot: false,
			text: "<@UBOTA> <@UBOTB> hello",
			messageId: "100.000001",
			replyToId: null,
			addressed: true,
			mentions: [
				{ id: "UBOTA", name: "Miku", bot: true, tokens: ["<@UBOTA>"] },
				{ id: "UBOTB", name: "Kanade", bot: true, tokens: ["<@UBOTB>"] },
			],
			attachments: [],
		};
		await Promise.all([ha.onMessage(inbound), hb.onMessage(inbound)]);
		const bindings = await bindingsForChat(inbound.chatId);
		const conversationId = bindings[0]?.conversationId;
		if (!conversationId) throw new Error("No inherited thread.");
		report.oneThread = bindings.length === 2 && new Set(bindings.map((x) => x.conversationId)).size === 1;
		report.freshHistory = (await bindingsForChat(parent.chatId))[0]?.conversationId !== conversationId;
		report.deduplicated = (await listMessages(conversationId)).filter((m) => m.sender === "user").length === 1;
		await createMessage({
			conversationId,
			sender: "agent",
			agentId: a.id,
			parts: [{ type: "text", text: "Miku's idea" }],
		});
		await createMessage({
			conversationId,
			sender: "agent",
			agentId: b.id,
			parts: [{ type: "text", text: "Kanade's idea" }],
		});
		await wait(() => posts.some((p) => text(p.content) === "Kanade's idea"));
		report.identities = posts
			.filter((p) => text(p.content).includes("idea"))
			.map((p) => ({
				bot: p.channelId === ca.id ? "Miku" : "Kanade",
				thread: p.chatId,
				owner: p.actor === setup.user.id,
			}));
		let downloaded = false;
		await ha.onMessage({
			...inbound,
			senderId: "USTRANGER",
			messageId: "100.000002",
			attachments: [
				{
					name: "not allowed",
					mime: "text/plain",
					load: async () => {
						downloaded = true;
						return new Uint8Array();
					},
				},
			],
		});
		report.noStrangerDownloads = !downloaded;
		const part: ToolPart = {
			type: "tool",
			id: "approval_slack_test",
			name: "test_action",
			source: "builtin",
			status: "awaiting_approval",
			args: {},
			title: "Test action",
			reason: "Test only",
		};
		const pendingMessage = await createMessage({
			conversationId,
			sender: "agent",
			agentId: a.id,
			status: "streaming",
			parts: [part],
		});
		const controller = new AbortController();
		const decided = requestApproval(
			{
				toolCallId: part.id,
				runId: "run_test",
				agentId: a.id,
				conversationId,
				messageId: pendingMessage.id,
				toolName: part.name,
				title: "Test",
				category: "contact",
				risk: "external",
				args: {},
				reason: "Test",
			},
			10_000,
			controller.signal,
		);
		bus.emit({ type: "message.part", conversationId, messageId: pendingMessage.id, index: 0, part });
		await wait(() => posts.some((p) => typeof p.content !== "string" && p.content.buttons?.length));
		const prompt = posts.find((p) => typeof p.content !== "string" && p.content.buttons?.length);
		const button = prompt && typeof prompt.content !== "string" ? prompt.content.buttons?.[0] : undefined;
		if (!prompt || !button) throw new Error("No approval button.");
		const refused = await ha.onAction({
			...parent,
			chatId: inbound.chatId,
			senderId: "UGUEST",
			id: button.id,
			values: [],
			messageId: prompt.id,
		});
		report.guestRefused = refused.whisper === "Only my owner can do that.";
		const allowed = await ha.onAction({
			...parent,
			chatId: inbound.chatId,
			id: button.id,
			values: [],
			messageId: prompt.id,
		});
		report.ownerApproved = (await decided).approve && allowed.update?.text.includes("by Hazel");
		report.ownerOnlyModel =
			(
				await ha.onCommand({
					...parent,
					senderId: "UGUEST",
					name: "model",
					sub: null,
					options: {},
					targetMessageId: null,
				})
			).text === "Only my owner can do that.";
		report.threadBindings = (await listBindings(ca.id)).length;

		// DMs: the bot's own messages go on in your latest thread or, with the DM kept as one chat, in the DM itself.
		const dmThread = {
			chatId: "slack:T1:D1:300.000001",
			chatName: "DM with Hazel: hi",
			isGroup: false,
			serverId: null,
			senderId: "UOWNER",
			senderName: "Hazel",
		};
		await ha.onCommand({ ...dmThread, name: "new", sub: null, options: {}, targetMessageId: null });
		const threadChat = (await bindingsForChat(dmThread.chatId))[0]?.conversationId;
		const toThread = await messageUser(a, { text: "Threaded hello", via: "slack" });
		await wait(() => posts.some((p) => text(p.content) === "Threaded hello"));
		report.dmThreads =
			Boolean(threadChat) &&
			toThread.conversationId === threadChat &&
			posts.find((p) => text(p.content) === "Threaded hello")?.chatId === dmThread.chatId;
		await updateChannel(ca.id, { config: { dmThreads: "off" } });
		await wait(() => status(ca.id).state === "connected");
		const toDm = await messageUser(a, { text: "Top-level hello", via: "slack" });
		await wait(() => posts.some((p) => text(p.content) === "Top-level hello"));
		const sent = posts.find((p) => text(p.content) === "Top-level hello");
		report.dmOneChat = sent?.chatId === "slack:T1:D1" && toDm.conversationId !== threadChat;
		// A thread you start under one of its messages is a chat of its own, and the DM keeps its chat.
		const sideChat = `slack:T1:D1:${sent?.id}`;
		await callbacks.get(ca.id)?.onMessage({
			...dmThread,
			chatId: sideChat,
			parentChatId: "slack:T1:D1",
			senderIsBot: false,
			text: "Replying in a thread",
			messageId: "300.000002",
			replyToId: sent?.id ?? null,
			threadReply: true,
			addressed: true,
			mentions: [],
			attachments: [],
		});
		const top = (await bindingsForChat("slack:T1:D1")).find((x) => x.channelId === ca.id);
		const side = (await bindingsForChat(sideChat)).find((x) => x.channelId === ca.id);
		report.dmKeepsItsChat =
			top?.conversationId === toDm.conversationId &&
			Boolean(side) &&
			side?.conversationId !== toDm.conversationId;
	});
} catch (error) {
	report.error = error instanceof Error ? error.stack : String(error);
} finally {
	await shutdownChannels();
	await db.delete(schema.users);
	await closeDb();
	rmSync(config.dataDir, { recursive: true, force: true });
	console.info(`REPORT ${JSON.stringify(report)}`);
	process.exit(0);
}
