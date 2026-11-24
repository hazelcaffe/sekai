import type { Agent, AudioPart, MessagePart } from "@sekai/shared";
import { bus } from "../events/bus.ts";
import { errorMessage } from "../lib/errors.ts";
import { log } from "../lib/log.ts";
import { getDirectConversation, listConversations } from "../services/conversations.ts";
import { createMessage } from "../services/messages.ts";
import { saveUpload } from "../services/uploads.ts";
import { encodeOggOpus } from "../voice/ogg.ts";
import { voiceFor } from "../voice/settings.ts";
import { speakAll } from "../voice/tts.ts";

export type Via = "auto" | "app" | "discord" | "slack" | "signal";
type Where = "app" | "discord" | "slack" | "signal";

/** Text said in the bot's voice, as a voice message (Ogg Opus, uploaded). */
export async function voiceMessage(agent: Agent, text: string): Promise<AudioPart> {
	const v = await voiceFor(agent);
	const pcm = await speakAll({ model: v.ttsModel, voice: v.ttsVoice, text, language: v.language });
	if (pcm.length < 4_800) throw new Error("The voice didn't say anything");
	const ogg = encodeOggOpus(pcm);
	const upload = await saveUpload(ogg.data, "voice-message.ogg", "audio/ogg");
	return { type: "audio", url: upload.url, mime: "audio/ogg", durationMs: ogg.durationMs, waveform: ogg.waveform };
}

/** The bot's main chat in the app (its newest one that isn't a messaging-app chat). */
export async function mainChat(agentId: string): Promise<string> {
	const { listAllBindings } = await import("../channels/manager.ts");
	const bound = new Set((await listAllBindings()).map((b) => b.conversationId));
	const own = (await listConversations())
		.filter((c) => c.kind === "direct" && c.agentId === agentId && !c.archived && !bound.has(c.id))
		.sort((a, b) => (b.lastMessageAt ?? b.createdAt) - (a.lastMessageAt ?? a.createdAt))[0];
	return own?.id ?? (await getDirectConversation(agentId)).id;
}

/**
 * A message from a bot to you, started by the bot: a Slack, Discord or Signal DM when it has one (auto), or in its
 * chat in the app. Either way you get a notification, and it can be a voice message.
 */
export async function messageUser(
	agent: Agent,
	input: { text: string; voice?: boolean; via?: Via },
): Promise<{ where: Where; conversationId: string; messageId: string; voice: boolean }> {
	const via = input.via ?? "auto";
	let where: Where = "app";
	let conversationId: string | null = null;
	if (via !== "app") {
		const { ownerDm } = await import("../channels/manager.ts");
		const dm = await ownerDm(agent.id, via === "auto" ? undefined : via).catch((err: unknown) => {
			log.warn(`couldn't open a DM for ${agent.name}: ${errorMessage(err)}`);
			return null;
		});
		if (dm) {
			where = dm.type === "slack" ? "slack" : dm.type === "signal" ? "signal" : "discord";
			conversationId = dm.conversationId;
		} else if (via !== "auto") {
			const app = via === "slack" ? "Slack bot" : via === "signal" ? "Signal account" : "Discord bot";
			throw new Error(
				`You have no connected ${app} with an owner to DM (set one up in the bot's Accounts section).`,
			);
		}
	}
	conversationId ??= await mainChat(agent.id);
	const parts: MessagePart[] = [];
	let voice = false;
	if (input.voice) {
		try {
			parts.push(await voiceMessage(agent, input.text));
			voice = true;
		} catch (err) {
			// The words still go out.
			log.warn(`voice message failed for ${agent.name}: ${errorMessage(err)}`);
		}
	}
	parts.push({ type: "text", text: input.text });
	const message = await createMessage({
		conversationId,
		sender: "agent",
		agentId: agent.id,
		parts,
		meta: { trigger: "outreach" },
	});
	bus.emit({
		type: "notification",
		title: agent.name,
		body: voice ? `🎤 ${input.text}` : input.text,
		agentId: agent.id,
		conversationId,
	});
	return { where, conversationId, messageId: message.id, voice };
}
