import { type Agent, type AudioPart, type Message, messageText } from "@sekai/shared";
import { errorMessage } from "../lib/errors.ts";
import { log } from "../lib/log.ts";
import { getConversation } from "../services/conversations.ts";
import { getMessage, updateMessage } from "../services/messages.ts";
import { saveUpload } from "../services/uploads.ts";
import { transcribe } from "./listen.ts";
import { decodeOggOpus, encodeOggOpus } from "./ogg.ts";
import { parseWav, wavToPcm } from "./pcm.ts";
import { voiceFor } from "./settings.ts";

/** A recording (WAV, or Ogg Opus like Discord's voice messages) as 24 kHz PCM. */
export function recordingToPcm(data: Uint8Array): Uint8Array {
	if (parseWav(data)) return wavToPcm(data);
	const ogg = decodeOggOpus(data);
	if (ogg) return ogg;
	throw new Error("Voice messages need to be WAV or Ogg Opus");
}

/**
 * Your voice message: kept as Ogg Opus to play back, and written down with the bot's speech-to-text model so the
 * bot can read it. Returns the audio part and the words.
 */
export async function prepareVoiceMessage(
	agentId: string | null,
	data: Uint8Array,
): Promise<{ part: AudioPart; text: string }> {
	const pcm = recordingToPcm(data);
	if (pcm.length < 9_600) throw new Error("That recording is too short");
	const v = await voiceFor(agentId);
	const [text, ogg] = await Promise.all([
		transcribe({ model: v.sttModel, pcm, language: v.language }),
		Promise.resolve(encodeOggOpus(pcm)),
	]);
	const upload = await saveUpload(ogg.data, "voice-message.ogg", "audio/ogg");
	return {
		part: { type: "audio", url: upload.url, mime: "audio/ogg", durationMs: ogg.durationMs, waveform: ogg.waveform },
		text,
	};
}

/** Answering a voice message: the bot's reply gets a voice message too (its words stay as text). */
export async function voiceReply(agent: Agent, reply: Message): Promise<void> {
	if (reply.parts.some((p) => p.type === "audio")) return;
	const text = messageText(reply);
	if (!text || text.length > 2500) return;
	try {
		const { voiceMessage } = await import("../outreach/messages.ts");
		const part = await voiceMessage(agent, text);
		const fresh = await getMessage(reply.id);
		if (!fresh) return;
		await updateMessage(reply.id, { parts: [part, ...fresh.parts] });
	} catch (err) {
		log.warn(`voice reply failed for ${agent.name}: ${errorMessage(err)}`);
	}
}

/** Whether a message is a voice message from you (so the bot answers in voice). */
export async function isVoiceMessage(messageId: string | null | undefined): Promise<boolean> {
	if (!messageId) return false;
	const m = await getMessage(messageId);
	return Boolean(m && m.sender === "user" && m.parts.some((p) => p.type === "audio"));
}

export async function conversationAgent(conversationId: string): Promise<string | null> {
	const c = await getConversation(conversationId);
	return c?.kind === "direct" ? c.agentId : null;
}
