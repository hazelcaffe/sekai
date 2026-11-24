import { z } from "zod";
import { ChannelOrigin } from "./channel.ts";
import { ModelRef } from "./models.ts";

export const ToolCallStatus = z.enum(["pending", "awaiting_approval", "running", "done", "error", "denied"]);
export type ToolCallStatus = z.infer<typeof ToolCallStatus>;

export const TextPart = z.object({ type: z.literal("text"), text: z.string() });
export const ReasoningPart = z.object({
	type: z.literal("reasoning"),
	text: z.string(),
	startedAt: z.number().optional(),
	endedAt: z.number().optional(),
});
export const ToolApproval = z.object({
	decision: z.enum(["approved", "denied"]),
	/** Who decided: an explicit rule, the approval mode, the reviewer model, the primary bot, you, or a timeout. */
	by: z.enum(["rule", "mode", "reviewer", "primary", "user", "timeout"]),
	note: z.string().optional(),
});
export type ToolApproval = z.infer<typeof ToolApproval>;

export const ToolPart = z.object({
	type: z.literal("tool"),
	/** The model's tool-call id. */
	id: z.string(),
	name: z.string(),
	/** Human-readable label, e.g. "Saved to memory". */
	title: z.string().optional(),
	/** builtin: Sekai tools · mcp: your MCP servers · external: the BYOS agent's own tools (shell, file edits…). */
	source: z.enum(["builtin", "mcp", "external"]).default("builtin"),
	category: z.string().optional(),
	risk: z.enum(["read", "write", "external", "destructive"]).optional(),
	args: z.record(z.string(), z.unknown()),
	status: ToolCallStatus,
	/** Why this call needs approval (shown on the approval card). */
	reason: z.string().optional(),
	/** It always needs you (root on a device, a new computer…): approve it once; it can't become a rule. */
	alwaysAsk: z.boolean().optional(),
	approval: ToolApproval.optional(),
	result: z.string().optional(),
	error: z.string().optional(),
	/** Screenshots the tool took (upload URLs), e.g. of the bot's computer or browser. */
	images: z.array(z.string()).optional(),
	startedAt: z.number().optional(),
	endedAt: z.number().optional(),
});
/** Output from a planner or council advisor, shown collapsed above the reply. */
export const AdvisorPart = z.object({
	type: z.literal("advisor"),
	role: z.enum(["planner", "advisor"]),
	model: z.string(),
	text: z.string(),
	status: z.enum(["running", "done", "error"]),
});
export const NoticePart = z.object({
	type: z.literal("notice"),
	level: z.enum(["info", "warning", "error"]),
	text: z.string(),
});

/** An image a bot attached to its reply (a screenshot, a picture from the web, a file from its computer). */
export const ImagePart = z.object({
	type: z.literal("image"),
	url: z.string(),
	alt: z.string().default(""),
	name: z.string().optional(),
	width: z.number().optional(),
	height: z.number().optional(),
	/** Where it came from, e.g. the web page's address. */
	source: z.string().optional(),
});

/** A voice message (Ogg Opus), from you or a bot. Its words are in the message's text. */
export const AudioPart = z.object({
	type: z.literal("audio"),
	url: z.string(),
	mime: z.string().default("audio/ogg"),
	durationMs: z.number(),
	/** 0–255 loudness samples for drawing it (base64, Discord's format). */
	waveform: z.string().optional(),
});

export const MessagePart = z.discriminatedUnion("type", [
	TextPart,
	ReasoningPart,
	ToolPart,
	AdvisorPart,
	NoticePart,
	ImagePart,
	AudioPart,
]);
export type MessagePart = z.infer<typeof MessagePart>;
export type AudioPart = z.infer<typeof AudioPart>;
export type TextPart = z.infer<typeof TextPart>;
export type ReasoningPart = z.infer<typeof ReasoningPart>;
export type ToolPart = z.infer<typeof ToolPart>;
export type AdvisorPart = z.infer<typeof AdvisorPart>;
export type NoticePart = z.infer<typeof NoticePart>;
export type ImagePart = z.infer<typeof ImagePart>;

export const Attachment = z.object({
	id: z.string(),
	name: z.string(),
	mime: z.string(),
	size: z.number(),
	url: z.string(),
	kind: z.enum(["image", "file"]),
});
export type Attachment = z.infer<typeof Attachment>;

export const Usage = z.object({
	inputTokens: z.number(),
	outputTokens: z.number(),
	reasoningTokens: z.number(),
	cachedTokens: z.number(),
});
export type Usage = z.infer<typeof Usage>;

export const MessageSender = z.enum(["user", "agent", "system"]);
export type MessageSender = z.infer<typeof MessageSender>;

export const MessageStatus = z.enum(["streaming", "done", "error", "cancelled"]);
export type MessageStatus = z.infer<typeof MessageStatus>;

/** One answer to the same turn. Retrying keeps the earlier answers as versions you can switch between. */
export const MessageVersion = z.object({
	parts: z.array(MessagePart),
	model: z.string().nullable(),
	usage: Usage.nullable(),
	status: MessageStatus,
	error: z.string().nullable(),
	createdAt: z.number(),
});
export type MessageVersion = z.infer<typeof MessageVersion>;

export const MessageMeta = z.object({
	jobId: z.string().optional(),
	/** Why this message exists, when it wasn't typed by you. */
	trigger: z
		.enum([
			"user",
			"routine",
			"reminder",
			"job",
			"handoff",
			"ask",
			"group",
			"test",
			"regenerate",
			"channel",
			"outreach",
			"digest",
			"checkup",
			"email",
		])
		.optional(),
	routineId: z.string().optional(),
	/** The instruction an automatic reply responded to (routine/reminder prompt), replayed into history. */
	triggerText: z.string().optional(),
	/** Sent from (or replying to) a messaging channel. */
	channel: ChannelOrigin.optional(),
	/** For handoffs: the agent that sent this message. */
	fromAgentId: z.string().optional(),
	/** Agents @mentioned in this message. */
	mentions: z.array(z.string()).optional(),
	models: z.array(z.string()).optional(),
	/** Every answer to this turn, when it was retried. The one shown is versions[version] (also in parts). */
	versions: z.array(MessageVersion).optional(),
	version: z.number().int().optional(),
	/** Models that declined this turn before another one answered (automatic refusal retry). */
	declined: z.array(z.object({ model: z.string(), reason: z.string() })).optional(),
	/**
	 * An email: the one someone sent the bot (its Message-ID, sender and subject), or on the bot's reply, the email it
	 * sent back.
	 */
	email: z
		.object({
			messageId: z.string(),
			from: z.string(),
			fromName: z.string().optional(),
			subject: z.string(),
		})
		.optional(),
	/** A post on X: the mention you wrote (and on the bot's reply, the post it made). */
	x: z.object({ postId: z.string(), author: z.string() }).optional(),
	/** Said on a voice call (a transcript line), or a task the voice handed to the bot during one. */
	call: z
		.object({
			id: z.string(),
			kind: z.enum(["speech", "task"]),
			via: z.enum(["app", "discord"]).default("app"),
			/** Typed into the call instead of said. */
			typed: z.boolean().optional(),
		})
		.optional(),
});
export type MessageMeta = z.infer<typeof MessageMeta>;

/**
 * Retry an answer. keep: the old answer stays as a previous version (the new attempt never sees it).
 * wipe: the old answer is erased from the chat and from the bot's context, then it answers again.
 */
export const MessageRetry = z.object({
	model: ModelRef.nullable().default(null),
	wipe: z.boolean().default(false),
});
export type MessageRetry = z.input<typeof MessageRetry>;

export const Message = z.object({
	id: z.string(),
	conversationId: z.string(),
	sender: MessageSender,
	agentId: z.string().nullable(),
	parts: z.array(MessagePart),
	attachments: z.array(Attachment),
	replyToId: z.string().nullable(),
	status: MessageStatus,
	error: z.string().nullable(),
	model: z.string().nullable(),
	usage: Usage.nullable(),
	runId: z.string().nullable(),
	meta: MessageMeta,
	createdAt: z.number(),
	updatedAt: z.number(),
});
export type Message = z.infer<typeof Message>;

export const MessageSend = z.object({
	text: z.string().max(200_000).default(""),
	attachmentIds: z.array(z.string()).max(20).default([]),
	replyToId: z.string().nullable().default(null),
});
export type MessageSend = z.input<typeof MessageSend>;

export interface MessageSendResult {
	message: Message;
	/** Agents that will reply, in order. */
	responders: string[];
}

/** Plain text of a message, for previews and search. */
export function messageText(message: Pick<Message, "parts">): string {
	return message.parts
		.filter((p): p is TextPart => p.type === "text")
		.map((p) => p.text)
		.join("")
		.trim();
}
