import { createRequire } from "node:module";
import { Readable } from "node:stream";
import type { Agent, Conversation } from "@sekai/shared";
import { errorMessage } from "../lib/errors.ts";
import { log } from "../lib/log.ts";
import { getConversation } from "../services/conversations.ts";
import type { CallEvent, CallSession } from "../voice/voice-call.ts";
import { live, status } from "./state.ts";

/**
 * Calls in Discord voice channels: the bot joins, hears the people it may talk to (and nobody else), and talks
 * with the same call engine as the app (speech to text, the bot's own model, its speaking voice).
 */

type DiscordVoice = typeof import("@discordjs/voice");
let lib: DiscordVoice | null = null;
async function voiceLib(): Promise<DiscordVoice> {
	lib ??= await import("@discordjs/voice");
	return lib;
}

type Opus = { encode(pcm: Buffer, frame: number): Buffer; decode(packet: Buffer): Buffer; delete(): void };
const OpusScript = createRequire(import.meta.url)("opusscript") as (new (
	rate: number,
	ch: number,
	app: number,
) => Opus) & {
	Application: { VOIP: number };
};

/** 20 ms of 48 kHz stereo 16-bit: what Discord's player takes per packet. */
const FRAME48 = 3840;

/** 24 kHz mono → 48 kHz stereo (each sample twice, interpolated, on both sides). */
export function up48(pcm: Uint8Array): Buffer {
	const src = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
	const n = Math.floor(src.length / 2);
	const out = Buffer.alloc(n * 8);
	for (let i = 0; i < n; i++) {
		const a = src.readInt16LE(i * 2);
		const b = i + 1 < n ? src.readInt16LE((i + 1) * 2) : a;
		const mid = (a + b) >> 1;
		out.writeInt16LE(a, i * 8);
		out.writeInt16LE(a, i * 8 + 2);
		out.writeInt16LE(mid, i * 8 + 4);
		out.writeInt16LE(mid, i * 8 + 6);
	}
	return out;
}

/** 48 kHz stereo → 24 kHz mono. */
export function down24(pcm: Buffer): Uint8Array {
	const frames = Math.floor(pcm.length / 4);
	const out = Buffer.alloc(Math.floor(frames / 2) * 2);
	for (let i = 0, o = 0; i + 1 < frames; i += 2, o += 2) {
		const l = pcm.readInt16LE(i * 4);
		const r = pcm.readInt16LE(i * 4 + 2);
		const l2 = pcm.readInt16LE((i + 1) * 4);
		const r2 = pcm.readInt16LE((i + 1) * 4 + 2);
		out.writeInt16LE((l + r + l2 + r2) >> 2, o);
	}
	return new Uint8Array(out);
}

/** What the bot says, as a never-ending stream (silence between replies keeps Discord's player going). */
class Speaker extends Readable {
	private queue: Buffer[] = [];
	private size = 0;
	constructor() {
		super({ highWaterMark: FRAME48 * 3 });
	}
	say(pcm24: Uint8Array): void {
		const b = up48(pcm24);
		this.queue.push(b);
		this.size += b.length;
	}
	clear(): void {
		this.queue = [];
		this.size = 0;
	}
	get speaking(): boolean {
		return this.size > 0;
	}
	override _read(): void {
		const out = Buffer.alloc(FRAME48);
		let at = 0;
		while (at < FRAME48 && this.queue.length) {
			const head = this.queue[0] as Buffer;
			const take = Math.min(head.length, FRAME48 - at);
			head.copy(out, at, 0, take);
			at += take;
			if (take === head.length) this.queue.shift();
			else this.queue[0] = head.subarray(take);
			this.size -= take;
		}
		this.push(out);
	}
}

interface Session {
	key: string;
	agentId: string;
	channelId: string;
	guildId: string;
	voiceChannelId: string;
	name: string;
	call: CallSession;
	/** Plays speech (24 kHz mono) in the channel, after anything already playing. */
	play(pcm24: Uint8Array): void;
	leave(reason: string): void;
}

const sessions = new Map<string, Session>();
const keyOf = (channelId: string, guildId: string) => `${channelId}:${guildId}`;

export function voiceSessionFor(channelId: string, guildId: string): { name: string } | null {
	const s = sessions.get(keyOf(channelId, guildId));
	return s ? { name: s.name } : null;
}

/** The voice channels a bot is in right now. */
export function voiceSessionsOf(agentId: string): { channelId: string; guildId: string; name: string }[] {
	return [...sessions.values()]
		.filter((s) => s.agentId === agentId)
		.map((s) => ({ channelId: s.channelId, guildId: s.guildId, name: s.name }));
}

/**
 * Says text out loud in the voice channel the bot is in (the one in guildId when it's in several), in the voice
 * it talks with on calls. Returns the channel's name, or null when it isn't in one.
 */
export async function sayInVoice(agent: Agent, text: string, guildId?: string | null): Promise<string | null> {
	const mine = [...sessions.values()].filter((s) => s.agentId === agent.id);
	const s = mine.find((x) => x.guildId === guildId) ?? mine[0];
	if (!s) return null;
	const { voiceFor } = await import("../voice/settings.ts");
	const { speakAll } = await import("../voice/tts.ts");
	const v = await voiceFor(agent);
	const pcm = await speakAll({ model: v.ttsModel, voice: v.ttsVoice, text, language: v.language });
	if (pcm.length < 4_800) throw new Error("The voice didn't say anything");
	s.play(pcm);
	return s.name;
}

/**
 * Joins a voice channel and starts a call there. conversation: where the call's words are saved.
 * Only allowFrom (the people the bot answers) are heard.
 */
/** Joins in progress, so a second "join vc" while connecting waits for the first instead of making a second session. */
const joining = new Map<string, Promise<void>>();

export async function joinVoice(opts: Parameters<typeof joinVoiceNow>[0]): Promise<void> {
	const key = keyOf(opts.channelId, opts.guildId);
	const busy = joining.get(key);
	if (busy) return busy;
	const p = joinVoiceNow(opts).finally(() => joining.delete(key));
	joining.set(key, p);
	return p;
}

async function joinVoiceNow(opts: {
	channelId: string;
	guildId: string;
	voiceChannelId: string;
	voiceName: string;
	agent: Agent;
	conversation: Conversation;
	reason?: string;
}): Promise<void> {
	const entry = live(opts.channelId);
	if (!entry?.adapter.voice) throw new Error("This bot can't join voice channels");
	const key = keyOf(opts.channelId, opts.guildId);
	const existing = sessions.get(key);
	if (existing?.voiceChannelId === opts.voiceChannelId) return;
	existing?.leave("moved");
	const v = await voiceLib();
	const connection = v.joinVoiceChannel({
		channelId: opts.voiceChannelId,
		guildId: opts.guildId,
		adapterCreator: entry.adapter.voice.adapterCreator(opts.guildId) as never,
		selfDeaf: false,
		selfMute: false,
	});
	try {
		await v.entersState(connection, v.VoiceConnectionStatus.Ready, 20_000);
	} catch (err) {
		connection.destroy();
		throw new Error(`Couldn't connect to the voice channel: ${errorMessage(err)}`);
	}
	const speaker = new Speaker();
	const player = v.createAudioPlayer({ behaviors: { noSubscriber: v.NoSubscriberBehavior.Play } });
	player.play(v.createAudioResource(speaker, { inputType: v.StreamType.Raw }));
	connection.subscribe(player);
	player.on("error", (err) => log.warn(`voice player: ${errorMessage(err)}`));

	const allowed = new Set(entry.channel.allowFrom);
	const { VoiceCall } = await import("../voice/voice-call.ts");
	let ended = false;
	const timers: ReturnType<typeof setInterval>[] = [];
	const decoders = new Map<string, Opus>();
	const leave = (reason: string) => {
		if (ended) return;
		ended = true;
		for (const t of timers) clearInterval(t);
		for (const d of decoders.values()) d.delete();
		// A receive stream ending later must not free them again (opusscript shares one WASM heap).
		decoders.clear();
		sessions.delete(key);
		call.end(reason);
		player.stop(true);
		speaker.destroy();
		try {
			connection.destroy();
		} catch {}
		log.info(`left voice ${opts.voiceName} (${reason})`);
	};
	const emit = (ev: CallEvent) => {
		if (ev.type === "interrupt") speaker.clear();
		if (ev.type === "ended") setTimeout(() => leave(ev.reason), 1500);
		if (ev.type === "error") log.warn(`discord call: ${ev.message}`);
	};
	const call: CallSession = new VoiceCall(opts.conversation, opts.agent, emit, (pcm) => speaker.say(pcm), "discord");

	// Hearing: only the people the bot answers. Discord sends nothing while you're quiet, so a stretch of silence
	// follows each time you stop (the call needs it to know you've finished), and a little keeps flowing between.
	let lastHeard = 0;
	const silence = new Uint8Array(960);
	timers.push(
		setInterval(() => {
			if (decoders.size === 0 && Date.now() - lastHeard > 300) call.audio(silence);
		}, 20),
	);
	// Nobody to talk to (everyone it may hear has left): leave after a minute.
	let aloneSince: number | null = null;
	timers.push(
		setInterval(() => {
			const here = entry.adapter.voice?.membersIn(opts.guildId, opts.voiceChannelId) ?? [];
			const anyone = here.some((id) => allowed.has(id));
			if (anyone) aloneSince = null;
			else if (aloneSince === null) aloneSince = Date.now();
			else if (Date.now() - aloneSince > 60_000) leave("nobody left to talk to");
		}, 10_000),
	);
	connection.receiver.speaking.on("start", (userId) => {
		if (ended || !allowed.has(userId) || decoders.has(userId)) return;
		const stream = connection.receiver.subscribe(userId, {
			end: { behavior: v.EndBehaviorType.AfterSilence, duration: 300 },
		});
		const dec = new OpusScript(48_000, 2, OpusScript.Application.VOIP);
		decoders.set(userId, dec);
		stream.on("data", (packet: Buffer) => {
			if (ended || decoders.get(userId) !== dec) return;
			try {
				const pcm = down24(dec.decode(packet));
				lastHeard = Date.now();
				call.audio(pcm);
			} catch {}
		});
		stream.on("end", () => {
			if (decoders.get(userId) !== dec) return;
			dec.delete();
			decoders.delete(userId);
			if (ended) return;
			for (let i = 0; i < 25; i++) call.audio(silence);
			lastHeard = Date.now();
		});
	});
	connection.on(v.VoiceConnectionStatus.Disconnected, async () => {
		try {
			await Promise.race([
				v.entersState(connection, v.VoiceConnectionStatus.Signalling, 5_000),
				v.entersState(connection, v.VoiceConnectionStatus.Connecting, 5_000),
			]);
		} catch {
			leave("disconnected");
		}
	});
	sessions.set(key, {
		key,
		agentId: opts.agent.id,
		channelId: opts.channelId,
		guildId: opts.guildId,
		voiceChannelId: opts.voiceChannelId,
		name: opts.voiceName,
		call,
		play: (pcm) => speaker.say(pcm),
		leave,
	});
	log.info(`${opts.agent.name} joined voice ${opts.voiceName}`);
	await call.start({ greet: true, reason: opts.reason });
}

export function leaveVoice(channelId: string, guildId: string, reason = "asked to leave"): boolean {
	const s = sessions.get(keyOf(channelId, guildId));
	if (!s) return false;
	s.leave(reason);
	return true;
}

/** Ends every voice call a channel (bot) is in. */
export function leaveVoiceFor(channelId: string): void {
	for (const s of [...sessions.values()]) if (s.channelId === channelId) s.leave("the bot stopped");
}

export function leaveAllVoice(): void {
	for (const s of [...sessions.values()]) s.leave("shutting down");
}

/** call_user on Discord: when you're in a voice channel the bot can join, it joins and talks to you there. */
export async function callOwnerInVoice(agent: Agent, reason: string): Promise<boolean> {
	const { channelsOf, ownerDm } = await import("./manager.ts");
	for (const { id, channel, adapter } of channelsOf(agent.id)) {
		const owner = channel.allowFrom[0];
		if (!owner || !adapter.voice || status(id).state !== "connected") continue;
		const where = await adapter.voice.userVoice(owner);
		if (!where) continue;
		const dm = await ownerDm(agent.id);
		const conversation = dm ? await getConversation(dm.conversationId) : null;
		if (!conversation) continue;
		await joinVoice({
			channelId: id,
			guildId: where.guildId,
			voiceChannelId: where.channelId,
			voiceName: where.name,
			agent,
			conversation,
			reason,
		});
		return true;
	}
	return false;
}
