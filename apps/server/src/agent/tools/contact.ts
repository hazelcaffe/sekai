import { z } from "zod";
import { errorMessage } from "../../lib/errors.ts";
import { callUser } from "../../outreach/calls.ts";
import { messageUser } from "../../outreach/messages.ts";
import { defineTool, type ToolContext, ToolError } from "./types.ts";

/** Bots with a connected Discord bot. */
async function hasDiscord(agent: { id: string }): Promise<boolean> {
	const { channelsOf } = await import("../../channels/manager.ts");
	return channelsOf(agent.id).some((c) => c.adapter.voice);
}

/** The messaging-app chat this turn came from (a Discord channel or DM), if any. */
async function originOf(ctx: ToolContext) {
	const { getMessage } = await import("../../services/messages.ts");
	return (await getMessage(ctx.messageId))?.meta.channel ?? null;
}

export const contactTools = [
	defineTool({
		name: "message_user",
		category: "contact",
		description:
			"Message the user right now, on your own: a Discord DM from your bot if you have one (via auto/discord), otherwise in your chat in the Sekai app, with a notification either way. voice: true sends it as a voice message in your voice. For reminders, things they asked to be told about, finished work, or anything that needs them. Not for replying in this chat (just answer; for a voice message here, use voice_message).",
		parameters: z.object({
			text: z.string().min(1).max(4000),
			voice: z.boolean().optional().describe("Send as a voice message"),
			via: z.enum(["auto", "app", "discord"]).optional(),
		}),
		risk: "external",
		title: (a) =>
			a.voice ? "Sent a voice message" : a.via === "discord" ? "Messaged you on Discord" : "Messaged you",
		async execute(args, ctx) {
			try {
				const r = await messageUser(ctx.agent, args);
				return {
					sent: true,
					where: r.where === "discord" ? "Discord DM" : "the Sekai app",
					as: r.voice ? "voice message" : "text",
				};
			} catch (err) {
				throw new ToolError(errorMessage(err));
			}
		},
	}),
	defineTool({
		name: "voice_message",
		category: "contact",
		description:
			"Send a voice message in this chat: `text` said in your voice, posted right here (in a Discord channel or DM it's a Discord voice message; in Sekai, a voice note). Use when they ask for a voice message or voice note, or to hear you say something, here. Your reply can then be short or empty; don't repeat the words.",
		parameters: z.object({
			text: z.string().min(1).max(2000).describe("What to say, exactly as it should be spoken"),
		}),
		risk: "write",
		title: () => "Sent a voice message",
		async execute(args, ctx) {
			const { voiceMessage } = await import("../../outreach/messages.ts");
			const { createMessage } = await import("../../services/messages.ts");
			let audio: Awaited<ReturnType<typeof voiceMessage>>;
			try {
				audio = await voiceMessage(ctx.agent, args.text);
			} catch (err) {
				throw new ToolError(`Couldn't make the voice message: ${errorMessage(err)}`);
			}
			const origin = await originOf(ctx);
			await createMessage({
				conversationId: ctx.conversation.id,
				sender: "agent",
				agentId: ctx.agent.id,
				parts: [audio, { type: "text", text: args.text }],
				meta: { trigger: ctx.trigger, ...(origin ? { channel: origin } : {}) },
			});
			return {
				sent: true,
				where: origin ? `${origin.chatName ?? "this chat"} (${origin.type})` : "this chat in Sekai",
				seconds: Math.round(audio.durationMs / 1000),
			};
		},
	}),
	defineTool({
		name: "discord_voice",
		category: "contact",
		description:
			"Your Discord bot in voice channels (a live call). join: the voice channel the user is in, or one by name (when they ask you to hop in VC, a call, or voice). say: speak `text` out loud in the voice channel you're in, word for word (when they ask you to say something there, even by text). leave: hang up.",
		parameters: z.object({
			action: z.enum(["join", "leave", "say"]),
			channel: z.string().optional().describe("Voice channel name or id (default: where the user is)"),
			text: z.string().max(2000).optional().describe("say: what to say out loud"),
		}),
		risk: "write",
		available: hasDiscord,
		title: (a) =>
			a.action === "join"
				? "Joined a voice channel"
				: a.action === "say"
					? "Spoke in the voice channel"
					: "Left the voice channel",
		async execute(args, ctx) {
			const { channelsOf, ownerDm } = await import("../../channels/manager.ts");
			const { joinVoice, leaveVoice, sayInVoice } = await import("../../channels/voice.ts");
			const { getConversation } = await import("../../services/conversations.ts");
			if (args.action === "say") {
				const text = args.text?.trim();
				if (!text) throw new ToolError("say needs the text to say");
				const origin = await originOf(ctx);
				const here = origin ? channelsOf(ctx.agent.id).find((c) => c.id === origin.channelId) : null;
				const guildId = origin && here?.adapter.voice ? await here.adapter.voice.guildOf(origin.chatId) : null;
				let where: string | null;
				try {
					where = await sayInVoice(ctx.agent, text, guildId);
				} catch (err) {
					throw new ToolError(`Couldn't say it: ${errorMessage(err)}`);
				}
				if (!where)
					throw new ToolError("You're not in a voice channel. Join one first (action: join), then say it.");
				return { said: text, in: where };
			}
			for (const { id, channel, adapter } of channelsOf(ctx.agent.id)) {
				const voice = adapter.voice;
				const owner = channel.allowFrom[0];
				if (!voice || !owner) continue;
				const where = args.channel ? await voice.findChannel(args.channel, {}) : await voice.userVoice(owner);
				if (args.action === "leave") {
					const g = where?.guildId ?? (await voice.userVoice(owner))?.guildId;
					return { left: g ? leaveVoice(id, g) : false };
				}
				if (!where)
					throw new ToolError(
						args.channel
							? `No voice channel “${args.channel}”`
							: "The user isn't in a voice channel your bot can see. Ask them to join one, or name one.",
					);
				const dm = await ownerDm(ctx.agent.id);
				const conversation =
					(await getConversation(dm?.conversationId ?? ctx.conversation.id)) ?? ctx.conversation;
				await joinVoice({
					channelId: id,
					guildId: where.guildId,
					voiceChannelId: where.channelId,
					voiceName: where.name,
					agent: ctx.agent,
					conversation,
				});
				return {
					joined: where.name,
					note: "You're in the voice channel now; the call itself is your voice session.",
				};
			}
			throw new ToolError("You have no Discord bot that can join voice channels.");
		},
	}),
	defineTool({
		name: "call_user",
		category: "contact",
		description:
			"Call the user: it rings in the Sekai app (and joins a Discord voice channel they're in, if your bot can). Use for urgent things, or when they asked you to call (e.g. a reminder they wanted as a call). If they answer, you talk on the call; if not (40 seconds), `message` is sent to them as a voice message instead. Returns what happened.",
		parameters: z.object({
			reason: z.string().min(1).max(500).describe("Why you're calling, said when they pick up"),
			message: z
				.string()
				.max(2000)
				.optional()
				.describe("What to send if they don't pick up (defaults to the reason)"),
		}),
		risk: "external",
		title: () => "Called you",
		async execute(args, ctx) {
			const r = await callUser(ctx.agent, args);
			if (r.outcome === "answered")
				return {
					outcome: "answered",
					via: r.via,
					note: "You're on the call now; the call itself happens in your voice session.",
				};
			return {
				outcome: r.outcome === "declined" ? "they declined" : "no answer",
				fallback: r.fallback
					? `sent ${r.fallback.voice ? "a voice message" : "a message"} (${r.fallback.where})`
					: "couldn't send a message",
			};
		},
	}),
];
