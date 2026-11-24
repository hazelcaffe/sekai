// The channel manager with the Signal adapter and a fake signal-cli, end to end against a scratch database
// (DATABASE_URL) and a fake model gateway (GATEWAY_URL); prints a JSON report. signal-routing.test.ts runs it as its own
// process. Never point it at a live Sekai's database.
import { rmSync } from "node:fs";
import type { ToolPart } from "@sekai/shared";
import { requestApproval } from "../../src/agent/approvals.ts";
import { createApp } from "../../src/app.ts";
import { actorFor, runAs } from "../../src/auth/actor.ts";
import { ensureSetupCode, setupCodeForTests } from "../../src/auth/service.ts";
import {
	createChannel,
	decidePairing,
	getChannel,
	initChannels,
	listBindings,
	listPairings,
	registerAdapter,
	shutdownChannels,
} from "../../src/channels/manager.ts";
import { signalAdapter, signalDmChat, signalGroupChat } from "../../src/channels/signal.ts";
import { status } from "../../src/channels/state.ts";
import { config } from "../../src/config.ts";
import { closeDb, db, initDb, schema } from "../../src/db/index.ts";
import { bus } from "../../src/events/bus.ts";
import { createAgent } from "../../src/services/agents.ts";
import { getConversation } from "../../src/services/conversations.ts";
import { createMessage, listMessages } from "../../src/services/messages.ts";
import { envelope, fakeSignalCli } from "./fake-signal-cli.ts";

const BOT = "11111111-1111-4111-8111-111111111111";
const HAZEL = { uuid: "22222222-2222-4222-8222-222222222222", name: "Hazel", number: "+15550100001" };
const FERN = { uuid: "33333333-3333-4333-8333-333333333333", name: "Fern" };
const JOIN = "am9pbi1oYXplbHMtZ3JvdXAtMTIzNDU2Nzg5MGFiY2Q=";
const SPAM = "c3BhbS1ncm91cC0xMjM0NTY3ODkwYWJjZGVmZ2hpams=";

await initDb();
await db.delete(schema.users);
const fake = fakeSignalCli([{ number: "+15550109999", aci: BOT }]);
registerAdapter("signal", (channel) =>
	signalAdapter(channel, { connect: async () => fake.url, release: () => {}, reconnectMs: 20 }),
);

async function wait(check: () => boolean | Promise<boolean>, ms = 20_000) {
	const end = Date.now() + ms;
	while (!(await check())) {
		if (Date.now() > end) throw new Error("Signal manager integration timed out.");
		await Bun.sleep(20);
	}
}
/** The texts the bot sent to someone (or a group) on Signal, newest last. */
const sentTo = (who: { recipient?: string; groupId?: string }) =>
	fake
		.callsTo("send")
		.filter((c) =>
			who.groupId
				? c.params.groupId === who.groupId
				: (c.params.recipient as string[] | undefined)?.[0] === who.recipient,
		);
let ts = 1_800_000_001_000;
const report: Record<string, unknown> = {};
try {
	await ensureSetupCode("http://127.0.0.1");
	const res = await createApp().request("http://localhost/api/auth/setup", {
		method: "POST",
		headers: { host: "localhost", origin: "http://localhost", "content-type": "application/json" },
		body: JSON.stringify({
			username: "signal-test",
			name: "Hazel",
			password: "isolated test password only",
			code: setupCodeForTests(),
		}),
	});
	const setup = (await res.json()) as { user: { id: string } };
	if (!res.ok) throw new Error(`Scratch setup failed (${res.status}): ${JSON.stringify(setup)}`);
	await runAs(await actorFor(setup.user.id), async () => {
		const miku = await createAgent({ name: "Miku" });
		await initChannels();
		const channel = await createChannel({
			agentId: miku.id,
			type: "signal",
			config: { account: BOT, number: "+15550109999", mode: "linked", profileName: "" },
			allowFrom: [HAZEL.uuid],
		});
		await wait(() => status(channel.id).state === "connected" && fake.connected(BOT));
		report.connected = status(channel.id).botId === BOT;

		// A stranger gets a pairing code (and nothing else), shown in Needs you; approving it lets them in.
		fake.push(BOT, envelope(FERN, ts++, { message: "hey, who are you?" }));
		await wait(() => sentTo({ recipient: FERN.uuid }).length > 0);
		const pairingText = String(sentTo({ recipient: FERN.uuid })[0]?.params.message ?? "");
		const code = /Pairing code: ([A-Z0-9]{6})/.exec(pairingText)?.[1];
		const pairings = await listPairings();
		report.strangerGetsCode = Boolean(code) && pairings.some((p) => p.code === code && p.senderId === FERN.uuid);
		report.strangerNoChat = (await listBindings(channel.id)).length === 0;
		await decidePairing(code ?? "", true);
		await wait(() => sentTo({ recipient: FERN.uuid }).length === 2);
		report.pairedByAccountId = (await getChannel(channel.id))?.allowFrom.includes(FERN.uuid) ?? false;
		// Someone with the owner's name and number but another account is a stranger all the same.
		const impostor = { uuid: "55555555-5555-4555-8555-555555555555", name: HAZEL.name, number: HAZEL.number };
		fake.push(BOT, envelope(impostor, ts++, { message: "it's me, Hazel" }));
		await wait(() => sentTo({ recipient: impostor.uuid }).length > 0);
		report.sameNameIsStranger = String(sentTo({ recipient: impostor.uuid })[0]?.params.message).includes(
			"Pairing code",
		);

		// A DM in: a Sekai chat for it, the bot's reply (from the model) out, with Signal's styles, after typing.
		fake.push(BOT, envelope(HAZEL, ts++, { message: "Hello Miku" }));
		await wait(() => sentTo({ recipient: HAZEL.uuid }).length > 0);
		const reply = sentTo({ recipient: HAZEL.uuid })[0]?.params;
		report.reply = { message: reply?.message, textStyle: reply?.textStyle };
		report.typed = fake.callsTo("sendTyping").some((c) => (c.params.recipient as string[])?.[0] === HAZEL.uuid);
		const dm = (await listBindings(channel.id)).find((b) => b.externalChatId === signalDmChat(BOT, HAZEL.uuid));
		const conversationId = dm?.conversationId ?? "";
		report.chat = (await getConversation(conversationId))?.title;
		const messages = await listMessages(conversationId);
		report.inbound = messages.find((m) => m.sender === "user")?.meta.channel?.senderId === HAZEL.uuid;

		// An approval: asked in the DM, answered by typing /approve CODE; the request is then marked.
		const ask = async (id: string) => {
			const part: ToolPart = {
				type: "tool",
				id,
				name: "test_action",
				source: "builtin",
				status: "awaiting_approval",
				args: { token: "secret-should-be-hidden", where: "here" },
				title: "Test action",
				reason: "Test only",
			};
			const pendingMessage = await createMessage({
				conversationId,
				sender: "agent",
				agentId: miku.id,
				status: "streaming",
				parts: [part],
			});
			const decided = requestApproval(
				{
					toolCallId: id,
					runId: "run_test",
					agentId: miku.id,
					conversationId,
					messageId: pendingMessage.id,
					toolName: part.name,
					title: "Test",
					category: "contact",
					risk: "external",
					args: {},
					reason: "Test",
				},
				15_000,
				new AbortController().signal,
			);
			const before = sentTo({ recipient: HAZEL.uuid }).length;
			bus.emit({ type: "message.part", conversationId, messageId: pendingMessage.id, index: 0, part });
			await wait(() =>
				sentTo({ recipient: HAZEL.uuid })
					.slice(before)
					.some((c) => String(c.params.message).includes("Test action")),
			);
			const prompt = sentTo({ recipient: HAZEL.uuid })
				.slice(before)
				.find((c) => String(c.params.message).includes("Test action"));
			const promptIndex = fake.state.calls.indexOf(prompt as (typeof fake.state.calls)[number]);
			return { decided, prompt, promptIndex, part, pendingMessage };
		};
		const first = await ask("approval_signal_text");
		const promptText = String(first.prompt?.params.message ?? "");
		report.promptHidesSecrets = promptText.includes("•••") && !promptText.includes("secret-should-be-hidden");
		report.promptSaysHow = /React 👍 to approve or 👎 to deny, or type \/approve [A-Z0-9]{6}/.test(promptText);
		const approveCode = /\/approve ([A-Z0-9]{6})/.exec(promptText)?.[1] ?? "";
		fake.push(BOT, envelope(HAZEL, ts++, { message: `/approve ${approveCode}` }));
		report.approvedByText = (await first.decided).approve;
		// Its outcome goes onto the request (Signal: an edit of that message).
		bus.emit({
			type: "message.part",
			conversationId,
			messageId: first.pendingMessage.id,
			index: 0,
			part: { ...first.part, status: "done" },
		});
		await wait(() =>
			fake.state.calls
				.slice(first.promptIndex + 1)
				.some(
					(c) =>
						c.method === "send" &&
						c.params.editTimestamp &&
						String(c.params.message).includes("Approved by Hazel"),
				),
		);
		report.requestMarked = true;

		// The next one is answered with a 👍 on the request.
		const second = await ask("approval_signal_reaction");
		// A message's Signal id is the timestamp its send got back.
		const promptTs = (second.prompt?.result as { timestamp: number } | undefined)?.timestamp ?? 0;
		fake.push(
			BOT,
			envelope(HAZEL, ts++, {
				reaction: { emoji: "👍🏼", targetAuthorUuid: BOT, targetSentTimestamp: promptTs, isRemove: false },
			}),
		);
		report.approvedByReaction = (await second.decided).approve;

		// Groups: staying only where someone it answers added it. (signal-cli learns of a group from its invitation.)
		for (const id of [JOIN, SPAM])
			fake.state.groups.set(id, { id, name: id, isMember: false, members: [], pendingMembers: [{ uuid: BOT }] });
		fake.push(BOT, envelope(HAZEL, ts++, { groupInfo: { groupId: JOIN, revision: 1, type: "UPDATE" } }));
		fake.push(
			BOT,
			envelope({ uuid: "44444444-4444-4444-8444-444444444444", name: "Spammer" }, ts++, {
				groupInfo: { groupId: SPAM, revision: 1, type: "UPDATE" },
			}),
		);
		await wait(() => fake.callsTo("updateGroup").length === 1 && fake.callsTo("quitGroup").length === 1);
		report.joinedOwnersGroup = fake.callsTo("updateGroup")[0]?.params.groupId === JOIN;
		report.leftStrangersGroup = fake.callsTo("quitGroup")[0]?.params.groupId === SPAM;

		// In that group: a mention gets an answer (from the model) that quotes the question.
		const asked = ts++;
		fake.push(
			BOT,
			envelope(HAZEL, asked, {
				message: "\uFFFC what's the plan?",
				mentions: [{ uuid: BOT, start: 0, length: 1 }],
				groupInfo: { groupId: JOIN, groupName: "Hazel's group", revision: 2, type: "DELIVER" },
			}),
		);
		await wait(() => sentTo({ groupId: JOIN }).length > 0);
		const groupReply = sentTo({ groupId: JOIN })[0]?.params;
		report.groupReplyQuotes = groupReply?.quoteTimestamp === asked && groupReply?.quoteAuthor === HAZEL.uuid;
		report.groupChat = (await listBindings(channel.id)).some((b) => b.externalChatId === signalGroupChat(JOIN));
	});
} catch (error) {
	report.error = error instanceof Error ? error.stack : String(error);
} finally {
	await shutdownChannels();
	fake.stop();
	await db.delete(schema.users);
	await closeDb();
	rmSync(config.dataDir, { recursive: true, force: true });
	console.info(`REPORT ${JSON.stringify(report)}`);
	process.exit(0);
}
