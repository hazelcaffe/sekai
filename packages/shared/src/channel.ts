import { z } from "zod";

/**
 * Messaging channels: give an agent its own bot on a chat platform so you can talk to it from there.
 * Every channel uses the platform's official bot API with credentials you create yourself.
 */
/** Bot accounts on Slack and Discord, plus Discord personal accounts. */
export const CHANNEL_TYPES = ["discord", "slack", "discord-user"] as const;
export const ChannelType = z.enum(CHANNEL_TYPES);
export type ChannelType = z.infer<typeof ChannelType>;

/**
 * Who may DM the bot:
 * - pairing: unknown senders get a one-time code you approve in Sekai (recommended).
 * - allowlist: only IDs in allowFrom.
 * - open: anyone (not recommended; the bot acts as you).
 * - disabled: ignore DMs.
 */
export const DmPolicy = z.enum(["pairing", "allowlist", "open", "disabled"]);
export type DmPolicy = z.infer<typeof DmPolicy>;

/**
 * In servers: reply when an allowed person mentions the bot, or never. A channel where you turned on /listen
 * gets every message from allowed people, mention or not.
 */
export const GroupPolicy = z.enum(["mention", "disabled"]);
export type GroupPolicy = z.infer<typeof GroupPolicy>;

/**
 * What the bot sends you on this channel:
 * - smart: replies to messages you sent there, plus reminders, routine results and handoffs.
 * - replies: only replies to messages you sent there.
 * - all: everything the agent posts in linked chats.
 */
export const ChannelDelivery = z.enum(["smart", "replies", "all"]);
export type ChannelDelivery = z.infer<typeof ChannelDelivery>;

export const Channel = z.object({
	id: z.string(),
	agentId: z.string(),
	type: ChannelType,
	name: z.string(),
	enabled: z.boolean(),
	/** Non-secret settings (homeserver URL, signal-cli URL…). */
	config: z.record(z.string(), z.string()),
	/** Tokens. Masked when read back; send "" or the masked value to keep the stored one. */
	secrets: z.record(z.string(), z.string()),
	dmPolicy: DmPolicy,
	/** Platform user IDs allowed to talk to the bot (yours, plus any test bots you allow). */
	allowFrom: z.array(z.string()),
	groupPolicy: GroupPolicy,
	delivery: ChannelDelivery,
	createdAt: z.number(),
	updatedAt: z.number(),
});
export type Channel = z.infer<typeof Channel>;

export const ChannelCreate = z.object({
	agentId: z.string().min(1),
	type: ChannelType,
	name: z.string().trim().max(120).default(""),
	enabled: z.boolean().default(true),
	config: z.record(z.string(), z.string()).default({}),
	secrets: z.record(z.string(), z.string()).default({}),
	dmPolicy: DmPolicy.default("pairing"),
	allowFrom: z.array(z.string().trim().min(1)).default([]),
	groupPolicy: GroupPolicy.default("mention"),
	delivery: ChannelDelivery.default("smart"),
});
export type ChannelCreate = z.input<typeof ChannelCreate>;

// Explicit (not ChannelCreate.partial()): Zod applies .default() values even to omitted keys of a partial,
// which would silently reset fields on every update.
export const ChannelUpdate = z
	.object({
		name: z.string().trim().max(120),
		enabled: z.boolean(),
		config: z.record(z.string(), z.string()),
		secrets: z.record(z.string(), z.string()),
		dmPolicy: DmPolicy,
		allowFrom: z.array(z.string().trim().min(1)),
		groupPolicy: GroupPolicy,
		delivery: ChannelDelivery,
		/** Move this bot to another Sekai agent: it speaks as that agent from now on. */
		agentId: z.string().min(1),
	})
	.partial();
export type ChannelUpdate = z.input<typeof ChannelUpdate>;

export interface ChannelStatus {
	channelId: string;
	state: "stopped" | "starting" | "connected" | "error";
	error: string | null;
	/** The bot's own name/handle on the platform once connected. */
	botName: string | null;
	botId: string | null;
	connectedAt: number | null;
	/** Link that adds the bot to a server (with the permissions and commands it needs). */
	inviteUrl: string | null;
	/** The bot can read messages that don't mention it (Discord: the Message Content intent is on). */
	readsAll: boolean;
	/** Slack's connected workspace and app, when available. */
	workspaceId?: string;
	workspaceName?: string;
	appId?: string;
}

export type ChannelWithStatus = Channel & { status: ChannelStatus };

export interface ChannelPairing {
	code: string;
	channelId: string;
	agentId: string;
	type: ChannelType;
	senderId: string;
	senderName: string;
	createdAt: number;
	expiresAt: number;
}

export interface ChannelBinding {
	id: string;
	channelId: string;
	externalChatId: string;
	conversationId: string;
	chatName: string;
	isGroup: boolean;
	/** Answer every message from allowed people here, not only mentions (/listen). */
	listen: boolean;
	lastInboundAt: number | null;
	createdAt: number;
}

export const ChannelBindingUpdate = z.object({ listen: z.boolean() }).partial();
export type ChannelBindingUpdate = z.input<typeof ChannelBindingUpdate>;

export interface ChannelField {
	key: string;
	label: string;
	secret: boolean;
	required: boolean;
	placeholder?: string;
	hint?: string;
}

export interface ChannelDefinition {
	type: ChannelType;
	title: string;
	/** What the owner's ID looks like on this platform, for the allowlist. */
	idHint: string;
	fields: ChannelField[];
	/** Step-by-step setup, using the platform's official bot flow. */
	setup: string[];
	docsUrl: string;
	approvals: "buttons" | "reactions";
}

export const CHANNEL_DEFINITIONS: Record<ChannelType, ChannelDefinition> = {
	slack: {
		type: "slack",
		title: "Slack",
		idHint: "Your Slack member ID (your profile → More → Copy member ID)",
		fields: [
			{
				key: "botToken",
				label: "Bot token",
				secret: true,
				required: true,
				placeholder: "xoxb-…",
				hint: "OAuth & permissions → Bot user OAuth token, after installing the app.",
			},
			{
				key: "appToken",
				label: "App-level token",
				secret: true,
				required: true,
				placeholder: "xapp-…",
				hint: "Basic information → App-level tokens. Generate one with connections:write.",
			},
		],
		setup: [
			"Create a separate Slack app for this bot using this manifest. No public server address is needed.",
			"In OAuth & permissions, install it to your workspace and copy the bot token (xoxb-…). Your workspace may need an admin to approve the install.",
			"In Basic information → App-level tokens, generate a token with connections:write (xapp-…). Paste both tokens here.",
			"Open the app's Messages tab in Slack and say hi, then approve its pairing code in Sekai. Invite the app to channels where you want to mention it.",
		],
		docsUrl: "https://docs.slack.dev/apis/events-api/using-socket-mode/",
		approvals: "buttons",
	},
	discord: {
		type: "discord",
		title: "Discord",
		idHint: "Your Discord user ID (Developer Mode → right-click your name → Copy User ID)",
		fields: [
			{
				key: "botToken",
				label: "Bot token",
				secret: true,
				required: true,
				placeholder: "MTI…",
				hint: "Developer Portal → your app → Bot → Reset Token",
			},
		],
		setup: [
			"Go to discord.com/developers/applications and create a New Application. Name it after your bot and give it its picture.",
			"Under Bot, click Reset Token and copy it. Keep it secret. Optional: turn on Message Content Intent there so /listen works (the bot answers without being mentioned).",
			"Paste the token here. Once connected, use Add to a server, or DM the bot from a server you share.",
			"Message the bot to get a pairing code, then approve it in Sekai. Type / in Discord to see its commands.",
		],
		docsUrl: "https://discord.com/developers/docs/quick-start/getting-started",
		approvals: "buttons",
	},
	"discord-user": {
		type: "discord-user",
		title: "Discord",
		idHint: "Your Discord user ID (Developer Mode → right-click your name → Copy User ID)",
		fields: [
			{
				key: "userToken",
				label: "Account token",
				secret: true,
				required: true,
				placeholder: "MTI…",
				hint: "DevTools (F12) → Network → any request to discord.com → the Authorization header",
			},
		],
		setup: [
			"Make a normal Discord account for the bot (its own email, name and picture) and sign in to it in a browser.",
			"On discord.com, open DevTools (F12) → Network, reload, click any request to discord.com and copy the Authorization request header. Keep it secret; it's the whole sign-in.",
			"Paste it here. The account's DMs and group chats show up as chats in Sekai, and what it answers there is sent as the account.",
			"It joins servers when you add it yourself (or the bot accepts an invite you forward it). Discord doesn't allow accounts to be used like this, so the account could get limited.",
		],
		docsUrl: "https://discord.com/developers/docs/reference#authentication",
		approvals: "buttons",
	},
};

/** A platform's display name. Older messages can name platforms Sekai no longer supports. */
export function channelTitle(type: string): string {
	return CHANNEL_DEFINITIONS[type as ChannelType]?.title ?? type.charAt(0).toUpperCase() + type.slice(1);
}

/** Where an inbound channel message came from; copied onto the agent's reply so it's routed back. */
export const ChannelOrigin = z.object({
	channelId: z.string(),
	/** A ChannelType; a plain string so messages from platforms that were removed still load. */
	type: z.string(),
	chatId: z.string(),
	chatName: z.string().optional(),
	isGroup: z.boolean(),
	senderId: z.string(),
	senderName: z.string(),
	messageId: z.string().optional(),
});
export type ChannelOrigin = z.infer<typeof ChannelOrigin>;
