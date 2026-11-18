/**
 * Live end-to-end test of the Discord client, with three real bots: two Sekai agents and a tester bot that
 * talks to them in a server channel (bots can't use each other's slash commands or DM each other, so the
 * tester uses typed commands, which work the same).
 *
 * Needs a running Sekai server and:
 *   DISCORD_BOT_A_TOKEN, DISCORD_BOT_B_TOKEN   tokens of the two agent bots
 *   DISCORD_TESTER_TOKEN                       token of the tester bot (turn on its Message Content Intent)
 *   DISCORD_CHANNEL_ID                         a server text channel all three bots can see and post in
 * Optional:
 *   DISCORD_OWNER_ID     your Discord user ID, allowed on both bots so you can join in
 *   SEKAI_URL            default http://127.0.0.1:7420
 *   SEKAI_AUTH_TOKEN     if your server requires one
 *   SEKAI_E2E_KEEP=1     keep the test agents and their bots connected afterwards
 *
 *   bun run test:discord
 */
import { type Agent, type ChannelWithStatus, createApiClient } from "@sekai/shared";
import {
	Client,
	Events,
	GatewayIntentBits,
	type Message,
	type PartialMessage,
	REST,
	Routes,
	type TextChannel,
} from "discord.js";

const env = (name: string, required = true): string => {
	const v = process.env[name]?.trim() ?? "";
	if (!v && required) {
		console.error(`Set ${name}. See the top of apps/server/scripts/discord-e2e.ts.`);
		process.exit(2);
	}
	return v;
};

const TOKEN_A = env("DISCORD_BOT_A_TOKEN");
const TOKEN_B = env("DISCORD_BOT_B_TOKEN");
const TOKEN_T = env("DISCORD_TESTER_TOKEN");
const CHANNEL_ID = env("DISCORD_CHANNEL_ID");
const OWNER = env("DISCORD_OWNER_ID", false);
const KEEP = process.env.SEKAI_E2E_KEEP === "1";
const api = createApiClient({
	baseUrl: process.env.SEKAI_URL ?? "http://127.0.0.1:7420",
	getToken: () => process.env.SEKAI_AUTH_TOKEN || null,
});

// ---------------------------------------------------------------- tester bot

const tester = new Client({
	intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});
const seen: Message[] = [];
const edits = new Map<string, number>();
tester.on(Events.MessageCreate, (m) => {
	if (m.channelId === CHANNEL_ID) seen.push(m);
});
tester.on(Events.MessageUpdate, (_old, m: Message | PartialMessage) => {
	if (m.channelId !== CHANNEL_ID) return;
	edits.set(m.id, (edits.get(m.id) ?? 0) + 1);
	const i = seen.findIndex((x) => x.id === m.id);
	if (i >= 0 && !m.partial) seen[i] = m as Message;
});
tester.on(Events.MessageDelete, (m) => {
	const i = seen.findIndex((x) => x.id === m.id);
	if (i >= 0) seen.splice(i, 1);
});

let passed = 0;
const failed: string[] = [];
function check(label: string, ok: unknown, detail = "") {
	if (ok) {
		passed++;
		console.log(`  ✓ ${label}`);
	} else {
		failed.push(label);
		console.log(`  ✗ ${label}${detail ? `\n      ${detail}` : ""}`);
	}
}

async function waitFor<T>(fn: () => T | null | undefined | false, ms = 90_000): Promise<T | null> {
	const start = Date.now();
	for (;;) {
		const v = fn();
		if (v) return v;
		if (Date.now() - start > ms) return null;
		await Bun.sleep(400);
	}
}

/** A bot's message once it's finished (no status line left). */
const done = (m: Message | undefined) => (m && !/^-# (💭|⏳|✋)/m.test(m.content) ? m : null);
const from = (botId: string, after: number) => seen.slice(after).filter((m) => m.author.id === botId);

async function main() {
	await tester.login(TOKEN_T);
	await new Promise<void>((r) => (tester.isReady() ? r() : tester.once(Events.ClientReady, () => r())));
	const testerId = tester.user?.id ?? "";
	const channel = (await tester.channels.fetch(CHANNEL_ID)) as TextChannel | null;
	if (!channel?.isSendable()) throw new Error("The tester bot can't post in DISCORD_CHANNEL_ID");
	console.log(`Tester ${tester.user?.tag} in #${channel.name} (${channel.guild.name})`);
	const say = (text: string) => channel.send({ content: text, allowedMentions: { parse: ["users", "everyone"] } });
	const canPingEveryone = channel.permissionsFor(tester.user?.id ?? "")?.has("MentionEveryone") ?? false;

	// Two fresh agents, each with its own bot.
	const taken = new Set((await api.agents.list()).map((a) => a.name.toLowerCase()));
	const name = (base: string) =>
		taken.has(base.toLowerCase()) ? `${base}${Math.floor(Math.random() * 900 + 100)}` : base;
	const models = { primary: { model: "claude-haiku-5-5", thinking: "default" }, strategy: { type: "single" } };
	const agents: Agent[] = [];
	const channels: ChannelWithStatus[] = [];
	try {
		for (const [base, token] of [
			["Alpha", TOKEN_A],
			["Beta", TOKEN_B],
		] as const) {
			const agent = await api.agents.create({
				name: name(base),
				job: "End-to-end test bot. Keep every reply very short.",
				models: models as never,
			});
			agents.push(agent);
			channels.push(
				await api.channels.create({
					agentId: agent.id,
					type: "discord",
					secrets: { botToken: token },
					allowFrom: [testerId, ...(OWNER ? [OWNER] : [])],
					dmPolicy: "allowlist",
				}),
			);
		}
		const [alpha, beta] = agents as [Agent, Agent];
		const [chA, chB] = channels as [ChannelWithStatus, ChannelWithStatus];
		const status = async (id: string) => (await api.channels.list()).find((c) => c.id === id)?.status;
		for (const c of [chA, chB]) {
			let s = await status(c.id);
			for (let i = 0; i < 60 && s?.state !== "connected" && s?.state !== "error"; i++) {
				await Bun.sleep(500);
				s = await status(c.id);
			}
			if (s?.state !== "connected") throw new Error(`A bot didn't connect: ${s?.error ?? "timed out"}`);
		}
		const sA = await status(chA.id);
		const sB = await status(chB.id);
		const A = sA?.botId ?? "";
		const B = sB?.botId ?? "";
		console.log(`${alpha.name} = ${sA?.botName}, ${beta.name} = ${sB?.botName}\n`);

		console.log("Slash commands");
		const app = (await new REST({ version: "10" }).setToken(TOKEN_A).get(Routes.currentApplication())) as {
			id: string;
		};
		await Bun.sleep(1500);
		const cmds = (await new REST({ version: "10" }).setToken(TOKEN_A).get(Routes.applicationCommands(app.id))) as {
			name: string;
			type: number;
		}[];
		check(
			"published",
			["retry", "model", "group", "listen"].every((n) => cmds.some((c) => c.name === n)),
		);
		check(
			"message actions in the Apps menu",
			cmds.some((c) => c.type === 3 && c.name === "Retry"),
		);

		console.log("Chatting");
		let n = seen.length;
		const q = await say(`<@${A}> Reply with exactly: PONG`);
		const pong = await waitFor(() => done(from(A, n).find((m) => m.content.includes("PONG"))));
		check("answers a mention, as a reply", pong?.reference?.messageId === q.id, pong?.content);

		// Answers are posted once they're finished (typing until then), never edited as they're written.
		n = seen.length;
		await say(`<@${A}> Write a 12-line poem about the sea, one short line each.`);
		const poem = await waitFor(() => done(from(A, n).find((m) => m.content.split("\n").length >= 8)), 120_000);
		await Bun.sleep(3000);
		check(
			"posts long answers whole, without edits",
			poem && (edits.get(poem.id) ?? 0) === 0,
			`edits: ${edits.get(poem?.id ?? "") ?? 0}`,
		);

		n = seen.length;
		await say(`<@${A}> /status`);
		const st = await waitFor(() => from(A, n).find((m) => m.content.startsWith(`**${alpha.name}**`)), 20_000);
		check("typed /status", st, st?.content);

		n = seen.length;
		await say(`<@${A}> /model`);
		const menu = await waitFor(() => from(A, n).find((m) => m.components.length > 0), 20_000);
		check("/model offers a menu", menu);

		// /retry redoes the latest reply (the poem).
		const last = poem ?? pong;
		if (last) {
			const before = edits.get(last.id) ?? 0;
			const cmd = await say(`<@${A}> /retry`);
			const edited = await waitFor(
				() => (edits.get(last.id) ?? 0) > before + 1 && done(seen.find((m) => m.id === last.id)),
			);
			check("/retry rewrites the same message", edited, `edits ${before} → ${edits.get(last.id)}`);
			const fresh = await cmd.fetch();
			check(
				"…and reacts to the command",
				fresh.reactions.cache.some((r) => r.emoji.name === "🔁"),
			);
		}

		n = seen.length;
		await say(
			`<@${A}> Use your attach_image tool to attach this picture: https://www.google.com/images/branding/googlelogo/2x/googlelogo_color_272x92dp.png (one short sentence of text is enough)`,
		);
		const pic = await waitFor(() => from(A, n).find((m) => m.attachments.size > 0), 120_000);
		check("attached images arrive as files", pic, `${from(A, n).length} replies, none with a file`);

		console.log("Group chat");
		n = seen.length;
		await say(`<@${A}> /group link ${beta.name}`);
		const linked = await waitFor(() => from(A, n).find((m) => m.content.includes("group chat with")), 20_000);
		check("/group link", linked, linked?.content ?? "no reply");
		n = seen.length;
		await say(`<@${A}> <@${B}> each of you: say your own name, nothing else`);
		const both = await waitFor(() => done(from(A, n).at(-1)) && done(from(B, n).at(-1)), 120_000);
		check(
			"each answers through its own bot",
			both,
			`${from(A, n).at(-1)?.content} / ${from(B, n).at(-1)?.content}`,
		);
		check(
			"one message → one answer each (no duplicates)",
			from(A, n).length === 1 && from(B, n).length === 1,
			`${from(A, n).length} + ${from(B, n).length}`,
		);
		if (canPingEveryone) {
			n = seen.length;
			await say("@everyone each of you: say your own name, nothing else");
			const all = await waitFor(() => done(from(A, n).at(-1)) && done(from(B, n).at(-1)), 120_000);
			check("@everyone: every bot answers (linked chat)", all, `${from(A, n).length} + ${from(B, n).length}`);
		}
		n = seen.length;
		await say(`<@${B}> What's 2+2? Just the number.`);
		const onlyB = await waitFor(() => done(from(B, n).find((m) => m.content.includes("4"))), 90_000);
		await Bun.sleep(5000);
		check(
			"@one bot: only that bot answers",
			onlyB && from(A, n).length === 0,
			`${from(A, n).length} from ${alpha.name}`,
		);

		console.log("Approvals");
		n = seen.length;
		await say(`<@${A}> /mode manual`);
		await waitFor(() => from(A, n).length > 0 || seen.slice(n).some((m) => m.reactions.cache.size), 15_000);
		n = seen.length;
		await say(`<@${A}> Save a memory that the Discord end-to-end test ran. Use your memory tool.`);
		const ask = await waitFor(() => from(A, n).find((m) => /\/approve [A-Z0-9]{6}/.test(m.content)), 120_000);
		check("asks with buttons and a code", ask && ask.components.length > 0, ask?.content);
		const code = ask?.content.match(/\/approve ([A-Z0-9]{6})/)?.[1];
		if (ask && code) {
			await say(`<@${A}> /approve ${code}`);
			const closed = await waitFor(
				() => seen.find((m) => m.id === ask.id && m.content.includes("**Approved**")),
				30_000,
			);
			check("/approve CODE approves and closes the request", closed);
		}
		await Bun.sleep(4000);
		await say(`<@${A}> /mode inherit`);

		if (sA?.readsAll || sB?.readsAll) {
			console.log("Listening");
			n = seen.length;
			await say(`<@${A}> /listen on`);
			await waitFor(() => from(A, n).length > 0, 15_000);
			n = seen.length;
			await say("What's 3+3? Just the number.");
			const any = await waitFor(
				() => done([...from(A, n), ...from(B, n)].find((m) => m.content.includes("6"))),
				90_000,
			);
			check("answers without a mention", any);
			await Bun.sleep(3000);
			n = seen.length;
			await say(`<@${B}> What's 5+5? Just the number.`);
			const bAns = await waitFor(() => done(from(B, n).find((m) => m.content.includes("10"))), 90_000);
			await Bun.sleep(5000);
			check(
				"a listening bot leaves messages for other bots alone",
				bAns && from(A, n).length === 0,
				`${from(A, n).length} from ${alpha.name}`,
			);
			await say(`<@${A}> /listen off`);
		} else {
			console.log("Listening: skipped (turn on Message Content Intent for an agent bot to test /listen)");
		}

		n = seen.length;
		await say(`<@${A}> /group unlink`);
		check("/group unlink", await waitFor(() => from(A, n).find((m) => m.content.startsWith("Unlinked")), 20_000));

		if (canPingEveryone) {
			n = seen.length;
			await say("@everyone reply with just the word HELLO");
			const all = await waitFor(
				() =>
					done(from(A, n).find((m) => /hello/i.test(m.content))) &&
					done(from(B, n).find((m) => /hello/i.test(m.content))),
				120_000,
			);
			check("@everyone: every bot answers (separate chats)", all, `${from(A, n).length} + ${from(B, n).length}`);
		} else {
			console.log('  (skipped @everyone: give the tester bot\'s role "Mention @everyone" to test it)');
		}

		console.log("Moving a bot to another agent");
		const gamma = await api.agents.create({
			name: name("Gamma"),
			job: "End-to-end test bot. Keep every reply very short.",
			models: models as never,
		});
		agents.push(gamma);
		await api.channels.update(chA.id, { agentId: gamma.id });
		let sm = await status(chA.id);
		for (let i = 0; i < 60 && sm?.state !== "connected"; i++) {
			await Bun.sleep(500);
			sm = await status(chA.id);
		}
		check("reconnects after the move", sm?.state === "connected", sm?.error ?? sm?.state);
		n = seen.length;
		await say(`<@${A}> What's your name? Just the name.`);
		const named = await waitFor(() => done(from(A, n).at(-1)), 90_000);
		check(`now answers as ${gamma.name}`, named?.content.includes(gamma.name), named?.content);
		check(
			"the channel belongs to the new agent",
			(await api.channels.list({ agentId: gamma.id })).some((c) => c.id === chA.id),
		);
	} finally {
		if (!KEEP) {
			// Linked group chats outlive their bots; remove the ones this run made.
			const chats = new Set<string>();
			for (const c of channels) {
				for (const b of await api.channels.bindings(c.id).catch(() => []))
					if (b.isGroup) chats.add(b.conversationId);
			}
			for (const id of chats) await api.conversations.delete(id).catch(() => {});
			for (const c of channels) await api.channels.delete(c.id).catch(() => {});
			for (const a of agents) await api.agents.delete(a.id).catch(() => {});
		}
		await tester.destroy();
	}
	console.log(`\n${passed} passed, ${failed.length} failed`);
	process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
