/**
 * Discord voice end to end: a tester bot sits in a voice channel, asks a Sekai bot to join ("join vc"), hears its
 * greeting, asks a question out loud and checks the spoken answer, then asks it to leave.
 *
 * The Sekai bot needs a speaking voice and a speech-to-text model (Admin → Voice).
 *
 *   DISCORD_BOT_B_TOKEN, DISCORD_TESTER_TOKEN, DISCORD_CHANNEL_ID, DISCORD_VOICE_CHANNEL_ID, SEKAI_AUTH_TOKEN
 *   VOICE_STT_MODEL: a batch speech-to-text model to check what the bot said (e.g. api_xxx::scribe_v2)
 *   VOICE_TTS_MODEL, VOICE_TTS_VOICE: the tester's own voice to ask its question (e.g. api_xxx::eleven_flash_v2_5)
 */
import { Readable } from "node:stream";
import {
	createAudioPlayer,
	createAudioResource,
	EndBehaviorType,
	entersState,
	joinVoiceChannel,
	StreamType,
	VoiceConnectionStatus,
} from "@discordjs/voice";
import { createApiClient } from "@sekai/shared";
import { Client, Events, GatewayIntentBits, type TextChannel } from "discord.js";
import { down24, up48 } from "../src/channels/voice.ts";
import { closeDb, initDb } from "../src/db/index.ts";
import { transcribe } from "../src/voice/listen.ts";
import { speakAll } from "../src/voice/tts.ts";

const env = (k: string) => {
	const v = process.env[k];
	if (!v) throw new Error(`Set ${k}`);
	return v;
};
const api = createApiClient({
	baseUrl: process.env.SEKAI_URL ?? "http://127.0.0.1:7420",
	getToken: () => env("SEKAI_AUTH_TOKEN"),
});
const stt = env("VOICE_STT_MODEL");
const tts = { model: env("VOICE_TTS_MODEL"), voice: env("VOICE_TTS_VOICE") };
await initDb();

let passed = 0;
const failed: string[] = [];
const check = (label: string, ok: unknown, detail = "") => {
	if (ok) {
		passed++;
		console.log(`  ✓ ${label}${detail ? ` (${detail})` : ""}`);
	} else {
		failed.push(label);
		console.log(`  ✗ ${label}${detail ? `\n      ${detail}` : ""}`);
	}
};
const waitFor = async <T>(fn: () => T | null | undefined | false, ms: number): Promise<T | null> => {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		const v = fn();
		if (v) return v;
		await Bun.sleep(300);
	}
	return null;
};

type Opus = { decode(p: Buffer): Buffer; delete(): void };
const OpusScript = (await import("opusscript")).default as unknown as (new (
	r: number,
	c: number,
	a: number,
) => Opus) & { Application: { VOIP: number } };

const tester = new Client({
	intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildVoiceStates],
});
await tester.login(env("DISCORD_TESTER_TOKEN"));
await new Promise<void>((r) => (tester.isReady() ? r() : tester.once(Events.ClientReady, () => r())));
const text = (await tester.channels.fetch(env("DISCORD_CHANNEL_ID"))) as TextChannel;
const vcId = env("DISCORD_VOICE_CHANNEL_ID");
const vc = await tester.channels.fetch(vcId);
if (!vc?.isVoiceBased()) throw new Error("DISCORD_VOICE_CHANNEL_ID isn't a voice channel");
console.log(`Tester ${tester.user?.tag}, voice channel #${vc.name}`);

const agent = await api.agents.create({
	name: `Vox${Math.floor(Math.random() * 900 + 100)}`,
	job: "Voice test bot. Answer in one short sentence.",
});
const channel = await api.channels.create({
	agentId: agent.id,
	type: "discord",
	secrets: { botToken: env("DISCORD_BOT_B_TOKEN") },
	allowFrom: [tester.user?.id ?? ""],
	dmPolicy: "allowlist",
});
let botId = "";
for (let i = 0; i < 60 && !botId; i++) {
	const s = (await api.channels.list()).find((c) => c.id === channel.id)?.status;
	if (s?.state === "connected") botId = s.botId ?? "";
	await Bun.sleep(500);
}
if (!botId) throw new Error("The Sekai bot didn't connect");

// What the Sekai bot says, as 24 kHz PCM.
const heard: Uint8Array[] = [];
const conn = joinVoiceChannel({
	channelId: vcId,
	guildId: vc.guildId,
	adapterCreator: vc.guild.voiceAdapterCreator,
	selfDeaf: false,
	selfMute: false,
});
try {
	await entersState(conn, VoiceConnectionStatus.Ready, 20_000);
	console.log("Joining");
	conn.receiver.speaking.on("start", (userId) => {
		if (userId !== botId) return;
		const dec = new OpusScript(48_000, 2, OpusScript.Application.VOIP);
		const s = conn.receiver.subscribe(userId, { end: { behavior: EndBehaviorType.AfterSilence, duration: 1500 } });
		s.on("data", (p: Buffer) => {
			try {
				heard.push(down24(dec.decode(p)));
			} catch {}
		});
		s.on("end", () => dec.delete());
	});
	const before = Date.now();
	await text.send(`<@${botId}> join vc`);
	const joined = await waitFor(() => vc.guild.voiceStates.cache.get(botId)?.channelId === vcId, 30_000);
	check("joins the voice channel you're in", joined, joined ? `${Date.now() - before} ms` : "");

	const greeting = await waitFor(
		() => heard.reduce((n, c) => n + c.length, 0) > 48_000 && Date.now() - before > 6000,
		25_000,
	);
	const said = async () => {
		const pcm = new Uint8Array(Buffer.concat(heard.splice(0)));
		return pcm.length > 9600 ? transcribe({ model: stt, pcm }) : "";
	};
	const hello = greeting ? await said() : "";
	check("says hello out loud", hello, hello);

	console.log("Talking");
	const question = await speakAll({ ...tts, text: "What's the capital of Japan? Just the city name." });
	const player = createAudioPlayer();
	conn.subscribe(player);
	const pcm48 = Buffer.concat([up48(question), Buffer.alloc(48_000 * 4 * 2)]);
	player.play(createAudioResource(Readable.from([pcm48]), { inputType: StreamType.Raw }));
	await Bun.sleep(question.length / 48 + 1000);
	heard.splice(0);
	await waitFor(() => heard.reduce((n, c) => n + c.length, 0) > 24_000, 25_000);
	await Bun.sleep(3500);
	const answer = await said();
	check("hears you and answers out loud", /tokyo/i.test(answer), answer || "(nothing)");

	await text.send(`<@${botId}> leave vc`);
	const left = await waitFor(() => !vc.guild.voiceStates.cache.get(botId)?.channelId, 15_000);
	check("leaves when asked", left);
	const chats = (await api.conversations.list()).filter((c) => c.agentId === agent.id);
	for (const c of chats) {
		for (const m of await api.conversations.messages(c.id)) {
			const t = m.parts.map((p) => (p.type === "text" ? p.text : "")).join(" ");
			if (m.meta.call) console.log(`      ${m.sender === "user" ? "heard" : "said "}: ${t}`);
		}
	}
} finally {
	conn.destroy();
	await api.channels.delete(channel.id).catch(() => {});
	await api.agents.delete(agent.id).catch(() => {});
	await tester.destroy();
	await closeDb();
}
console.log(`\n${passed} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
