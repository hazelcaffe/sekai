/**
 * Live Slack check against a running Sekai (not a second server). Creates two temporary agents/channels.
 * Three separate Slack apps, all installed in one workspace and invited to the same test channel:
 *   SLACK_BOT_A_TOKEN=xoxb-… SLACK_APP_A_TOKEN=xapp-…
 *   SLACK_BOT_B_TOKEN=xoxb-… SLACK_APP_B_TOKEN=xapp-…
 *   SLACK_TESTER_BOT_TOKEN=xoxb-… SLACK_TESTER_APP_TOKEN=xapp-…
 *   SLACK_CHANNEL_ID=C…
 * Use the generated manifest for all three (the tester doesn't need a slash command).
 * Optional: SEKAI_URL (http://127.0.0.1:7420), SEKAI_AUTH_TOKEN, SLACK_OWNER_ID, SEKAI_E2E_KEEP=1.
 * Stop any other Socket Mode connection for these apps first. No tokens are printed or saved by this script.
 *
 * bun run test:slack
 *
 * Slack doesn't let bots invoke slash commands or click buttons, or DM another bot. Test the human-only
 * surfaces afterwards (SEKAI_E2E_KEEP=1 and SLACK_OWNER_ID keep the bots and give you the controls):
 * pair in the app's Messages tab; invoke its registered /sekai-… status command; ask for an action
 * that needs approval and try Approve once / Allow in this chat / Deny, including from a second member;
 * send a DM file; ask for an image/file and a proactive message_user via: slack. Huddles are out of scope.
 */
import { type Agent, type Channel, createApiClient } from "@sekai/shared";
import { slackAdapter } from "../src/channels/slack.ts";
import { slackChat } from "../src/channels/slack-format.ts";
import type { InboundMessage } from "../src/channels/types.ts";

function env(key: string): string {
	const value = process.env[key]?.trim();
	if (!value) throw new Error(`Set ${key}. See apps/server/scripts/slack-e2e.ts.`);
	return value;
}
const botA = env("SLACK_BOT_A_TOKEN");
const appA = env("SLACK_APP_A_TOKEN");
const botB = env("SLACK_BOT_B_TOKEN");
const appB = env("SLACK_APP_B_TOKEN");
const testChannel = env("SLACK_CHANNEL_ID");
const testerChannel: Channel = {
	id: "slack_tester",
	agentId: "slack_tester",
	type: "slack",
	name: "Tester",
	enabled: true,
	secrets: { botToken: env("SLACK_TESTER_BOT_TOKEN"), appToken: env("SLACK_TESTER_APP_TOKEN") },
	config: {},
	allowFrom: [],
	dmPolicy: "allowlist",
	groupPolicy: "mention",
	delivery: "replies",
	createdAt: 0,
	updatedAt: 0,
};
const tester = slackAdapter(testerChannel);
const api = createApiClient({
	baseUrl: process.env.SEKAI_URL ?? "http://127.0.0.1:7420",
	getToken: () => process.env.SEKAI_AUTH_TOKEN ?? null,
});
const seen: InboundMessage[] = [];
const agents: Agent[] = [];
async function wait<T>(read: () => Promise<T | undefined>, label: string): Promise<T> {
	const end = Date.now() + 120_000;
	while (Date.now() < end) {
		const result = await read();
		if (result !== undefined) return result;
		await Bun.sleep(500);
	}
	throw new Error(`Timed out: ${label}`);
}

try {
	const me = await tester.start({
		onMessage: async (m) => {
			seen.push(m);
		},
		onCommand: async () => ({ text: "Test bot" }),
		onAction: async () => ({}),
		onAutocomplete: async () => [],
		onFatal: () => {
			throw new Error("The Slack tester disconnected. Check its tokens and Socket Mode.");
		},
		log: (_level, text) => console.log(text),
	});
	const team = me.workspaceId;
	if (!team) throw new Error("Slack returned no workspace.");
	const channelIds: string[] = [];
	for (const [name, botToken, appToken] of [
		["SlackAlpha", botA, appA],
		["SlackBeta", botB, appB],
	]) {
		const agent = await api.agents.create({
			name: `${name}${Date.now().toString().slice(-5)}`,
			job: "Slack end-to-end test bot. Keep replies under two short sentences.",
		});
		agents.push(agent);
		const c = await api.channels.create({
			agentId: agent.id,
			type: "slack",
			secrets: { botToken: botToken ?? "", appToken: appToken ?? "" },
			allowFrom: [me.botId, ...(process.env.SLACK_OWNER_ID ? [process.env.SLACK_OWNER_ID] : [])],
			dmPolicy: "allowlist",
		});
		channelIds.push(c.id);
	}
	const connected = await wait(async () => {
		const all = (await api.channels.list()).filter((c) => channelIds.includes(c.id));
		if (all.some((c) => c.status.state === "error"))
			throw new Error("A Slack bot couldn't connect. Check its status in Sekai.");
		return all.length === 2 && all.every((c) => c.status.state === "connected") ? all : undefined;
	}, "both bots connected");
	const a = connected[0]?.status.botId;
	const b = connected[1]?.status.botId;
	if (!a || !b || a === b) throw new Error("Use two different Slack apps for the two bots.");
	const chatId = slackChat(team, testChannel);
	const root = await tester.send(chatId, `<@${a}> Say a short hello for the Slack test.`);
	await wait(
		async () => seen.find((m) => m.senderId === a && m.chatId === `${chatId}:${root}`),
		"mention reply in its thread",
	);
	console.log("✓ A channel mention gets a reply in its own thread");
	const thread = `${chatId}:${root}`;
	await tester.send(thread, `<@${a}> /status`);
	await wait(
		async () => seen.find((m) => m.senderId === a && m.chatId === thread && /model|context|mode/i.test(m.text)),
		"typed status",
	);
	console.log("✓ Thread controls use Sekai's shared command handler");
	await tester.send(thread, `<@${a}> /group link ${agents.map((x) => x.name).join(", ")}`);
	await wait(async () => seen.find((m) => m.chatId === thread && /now a group chat/.test(m.text)), "group link");
	const start = seen.length;
	await tester.send(thread, `<@${a}> <@${b}> Each give one tiny idea for a song, in your own voice.`);
	await wait(
		async () =>
			[a, b].every((id) => seen.slice(start).some((m) => m.senderId === id && m.chatId === thread))
				? true
				: undefined,
		"both bots speaking as themselves",
	);
	console.log("✓ Two bots answer in one group thread, each through its own app");
	const fileStart = seen.length;
	await tester.send(thread, {
		text: `<@${a}> Read the attachment and tell me the test word inside it.`,
		files: [
			{
				name: "slack-test.txt",
				mime: "text/plain",
				data: new TextEncoder().encode("The secret word for this test is starlight."),
			},
		],
	});
	await wait(
		async () =>
			seen.slice(fileStart).some((m) => m.chatId === thread && /starlight/i.test(m.text)) ? true : undefined,
		"the bot reading the inbound file",
	);
	console.log("✓ External file upload completed and a bot read the inbound attachment");
	if (process.env.SEKAI_E2E_KEEP === "1" && process.env.SLACK_OWNER_ID) {
		for (const id of channelIds)
			await api.channels.update(id, { allowFrom: [process.env.SLACK_OWNER_ID, me.botId], dmPolicy: "pairing" });
		console.log("The test bots are kept; SLACK_OWNER_ID is now their owner for the human-only checks.");
	}
	console.log("Automated live checks finished. Complete the human-only checklist at the top of this script.");
} finally {
	await tester.stop();
	if (process.env.SEKAI_E2E_KEEP !== "1")
		for (const agent of agents) await api.agents.delete(agent.id).catch(() => {});
}
