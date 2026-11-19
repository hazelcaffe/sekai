import type { Channel } from "@sekai/shared";
import { guardedFetch } from "../lib/net.ts";

export interface InboundAttachment {
	name: string;
	mime: string;
	/** Downloads it (null when it's gone or too big). Called only once the sender may use the bot. */
	load(): Promise<Uint8Array | null>;
}

/** Someone mentioned in a message, and the exact text that mentions them (so it can become a name). */
export interface InboundMention {
	id: string;
	name: string;
	bot: boolean;
	tokens: string[];
}

export interface InboundMessage {
	/** Where to reply: a DM, channel, thread or group id on the platform. */
	chatId: string;
	/** Parent channel for thread-level bindings and inherited /listen or group settings. */
	parentChatId?: string;
	/** A reply inside a thread: once bound, allowed people can continue without mentioning the bot again. */
	threadReply?: boolean;
	chatName: string;
	isGroup: boolean;
	/** The server the chat belongs to, if any. */
	serverId: string | null;
	senderId: string;
	senderName: string;
	/** Bots are ignored unless you allowlisted them (for example a bot that tests your bots). */
	senderIsBot: boolean;
	/** The message as written; mentions appear as their tokens (see mentions). */
	text: string;
	messageId: string;
	/** The platform message this one replies to. */
	replyToId: string | null;
	/** In servers: the bot was mentioned or replied to (or @everyone / @here). Always true in DMs. */
	addressed: boolean;
	/** @everyone or @here: every bot in the chat is asked. */
	everyone?: boolean;
	mentions: InboundMention[];
	attachments: InboundAttachment[];
}

export interface ApprovalPrompt {
	/** Short code the owner can also type: /approve CODE. */
	token: string;
	title: string;
	reason: string;
	details: string;
}

export type ApprovalChoice = "approve" | "approve_chat" | "deny";

// ---------------------------------------------------------------- replies with controls

export interface ReplyButton {
	/** Comes back as ActionInvocation.id when pressed. Keep it under 100 characters. */
	id: string;
	label: string;
	style?: "primary" | "secondary" | "success" | "danger";
	url?: string;
}

export interface ReplySelect {
	id: string;
	placeholder: string;
	options: { value: string; label: string; description?: string; selected?: boolean }[];
	min?: number;
	max?: number;
}

/** A message with optional buttons or a menu. Platforms without them show the text only. */
export interface Reply {
	text: string;
	buttons?: ReplyButton[];
	select?: ReplySelect;
	/** A command that only needs acknowledging: typed commands get this reaction instead of a message. */
	react?: string;
	/** Images or files to post with it (the bot's attached images). */
	files?: { name: string; data: Uint8Array; mime: string; voice?: { durationMs: number; waveform: string } }[];
}

// ---------------------------------------------------------------- commands

export interface CommandOptionSpec {
	name: string;
	description: string;
	type: "string" | "boolean" | "integer";
	required?: boolean;
	choices?: { name: string; value: string }[];
	/** Suggestions come from ChannelHandlers.onAutocomplete as you type. */
	autocomplete?: boolean;
}

export interface CommandSpec {
	name: string;
	description: string;
	/** "chat": a slash command (also typed as /name). "message": an action on a message (Discord: Apps menu). */
	kind?: "chat" | "message";
	options?: CommandOptionSpec[];
	subcommands?: { name: string; description: string; options?: CommandOptionSpec[] }[];
	/** Only the person who used it sees the answer (default). Public answers show in the chat. */
	public?: boolean;
}

export type CommandOptions = Record<string, string | number | boolean | undefined>;

export interface ChatRef {
	chatId: string;
	chatName: string;
	isGroup: boolean;
	serverId: string | null;
	senderId: string;
	senderName: string;
}

export interface CommandInvocation extends ChatRef {
	name: string;
	sub: string | null;
	options: CommandOptions;
	/** The platform message a message command was used on. */
	targetMessageId: string | null;
}

export interface ActionInvocation extends ChatRef {
	/** The pressed button's or changed menu's id. */
	id: string;
	/** Chosen menu values. */
	values: string[];
	/** The platform message holding the control. */
	messageId: string;
}

/** What happens after a button or menu is used: the message holding it changes, and/or a private note. */
export interface ActionResult {
	update?: Reply;
	/** Only the person who used the control sees this. */
	whisper?: string;
}

export interface ChannelHandlers {
	onMessage(msg: InboundMessage): Promise<void>;
	onCommand(cmd: CommandInvocation): Promise<Reply>;
	onAutocomplete(cmd: CommandInvocation, option: string, value: string): Promise<{ name: string; value: string }[]>;
	onAction(action: ActionInvocation): Promise<ActionResult>;
	/** The connection died in a way the adapter can't recover from (bad token, revoked access). */
	onFatal(err: unknown): void;
	log(level: "info" | "warn", message: string): void;
}

export interface BotIdentity {
	botId: string;
	botName: string;
	inviteUrl: string | null;
	readsAll: boolean;
	workspaceId?: string;
	workspaceName?: string;
	appId?: string;
}

/**
 * One messaging platform. Adapters only translate between the platform and Sekai; access control, routing,
 * commands, streaming and delivery policy live in the channel manager so every platform behaves the same.
 */
export interface ChannelAdapter {
	/** Longest text one platform message can hold (with headroom for formatting). */
	readonly maxText: number;
	/** How this platform writes a mention of someone in text, e.g. <@123>. */
	mention(userId: string): string;
	/** Small print under a message (Discord: -# subtext). */
	subtext(text: string): string;
	start(handlers: ChannelHandlers): Promise<BotIdentity>;
	stop(): Promise<void>;
	/** Sends one message (text within maxText, or a reply with controls). Returns its platform id. */
	send(chatId: string, content: string | Reply, opts?: { replyTo?: string | null }): Promise<string>;
	edit(chatId: string, messageId: string, content: string | Reply): Promise<void>;
	remove(chatId: string, messageId: string): Promise<void>;
	react(chatId: string, messageId: string, emoji: string): Promise<void>;
	typing(chatId: string): Promise<void>;
	/** Clears a progress indicator, including replies that finished without text. */
	idle?(chatId: string): Promise<void>;
	/** Whether the bot can see and post in this chat (it's in that server and has access). */
	canPost(chatId: string): Promise<boolean>;
	/** Publishes the bot's commands so the platform can offer them (Discord: slash commands). */
	registerCommands(commands: CommandSpec[]): Promise<void>;
	/** Opens (or finds) the direct-message chat with someone, to message them first. */
	openDirect?(userId: string): Promise<{ chatId: string; name: string }>;
	/** The user ids in a group DM (a personal account), for "trust everyone in this GC". */
	groupMembers?(chatId: string): Promise<string[]>;
	/** Voice channels (Discord). */
	voice?: VoiceHooks;
}

export interface VoiceHooks {
	/** The voice channel someone is in, in a server the bot shares with them. */
	userVoice(userId: string): Promise<{ guildId: string; channelId: string; name: string } | null>;
	/** A voice channel by id or name, in a server (or the one a text chat belongs to). */
	findChannel(
		ref: string,
		near: { guildId?: string | null; chatId?: string | null },
	): Promise<{ guildId: string; channelId: string; name: string } | null>;
	/** The server a text chat belongs to. */
	guildOf(chatId: string): Promise<string | null>;
	/** Who's in a voice channel right now (user ids). */
	membersIn(guildId: string, channelId: string): string[];
	/** For @discordjs/voice's joinVoiceChannel. */
	adapterCreator(guildId: string): unknown;
}

export type AdapterFactory = (channel: Channel) => ChannelAdapter;

export const MAX_INBOUND_BYTES = 20 * 1024 * 1024;

/** Downloads an attachment with a size cap (from the internet only: the address comes from a message). */
export async function download(url: string, init?: RequestInit): Promise<Uint8Array | null> {
	let res: Response;
	try {
		res = await guardedFetch(new URL(url), { ...init, signal: AbortSignal.timeout(60_000) });
	} catch {
		return null;
	}
	if (!res.ok) return null;
	const length = Number(res.headers.get("content-length") ?? 0);
	if (length > MAX_INBOUND_BYTES) return null;
	const buf = new Uint8Array(await res.arrayBuffer());
	return buf.byteLength > MAX_INBOUND_BYTES ? null : buf;
}
