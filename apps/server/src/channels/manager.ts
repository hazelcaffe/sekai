import {
	type Agent,
	type AudioPart,
	CHANNEL_DEFINITIONS,
	type Channel,
	type ChannelBinding,
	ChannelBindingUpdate,
	type ChannelBindingUpdate as ChannelBindingUpdateInput,
	ChannelCreate,
	type ChannelCreate as ChannelCreateInput,
	type ChannelOrigin,
	type ChannelPairing,
	ChannelUpdate,
	type ChannelUpdate as ChannelUpdateInput,
	type ChannelWithStatus,
	type Message,
	type ServerEvent,
	type ToolPart,
} from "@sekai/shared";
import { eq } from "drizzle-orm";
import { decideApproval, listPendingApprovals } from "../agent/approvals.ts";
import { actorFor, can, currentActor, requirePermission, runAs } from "../auth/actor.ts";
import { db, schema } from "../db/index.ts";
import { bus } from "../events/bus.ts";
import { agentOwner } from "../events/scope.ts";
import { errorMessage, notFound, parse } from "../lib/errors.ts";
import { newId, randomChars } from "../lib/ids.ts";
import { log } from "../lib/log.ts";
import { truncate } from "../lib/text.ts";
import { getAgent, listAgents, listOwnAgents, requireOwnedAgent } from "../services/agents.ts";
import { createConversation, getConversation, updateConversation } from "../services/conversations.ts";
import { createMessage, getMessage } from "../services/messages.ts";
import { getSettings } from "../services/settings.ts";
import { saveUpload, toAttachment } from "../services/uploads.ts";
import { autocomplete, COMMANDS, type CommandEnv, runAction, runCommand } from "./commands.ts";
import { discordAdapter } from "./discord.ts";
import { discordUserAdapter } from "./discord-user.ts";
import { fromPlatformMentions, type ParsedCommand, parseTextCommand } from "./render.ts";
import { slackAdapter } from "./slack.ts";
import {
	agentBots,
	allPostedFor,
	bindingsForChat,
	bindingsForConversation,
	clearStatus,
	deleteBindings,
	findBinding,
	forgetAllPosted,
	getBinding,
	getChannel,
	live,
	publicChannel,
	type Running,
	recordPlatformMessage,
	running,
	sealSecrets,
	sekaiMessageId,
	setStatus,
	status,
	updateBindings,
	upsertBinding,
} from "./state.ts";
import { OutboundStream, type StreamTarget } from "./stream.ts";
import type {
	ActionInvocation,
	ActionResult,
	AdapterFactory,
	ApprovalChoice,
	ChannelAdapter,
	ChatRef,
	CommandInvocation,
	InboundMessage,
	Reply,
} from "./types.ts";

const FACTORIES: Record<string, AdapterFactory> = {
	discord: discordAdapter,
	"discord-user": discordUserAdapter,
	slack: slackAdapter,
};

/** Adds or replaces a platform adapter (also how tests plug in a fake platform). */
export function registerAdapter(type: string, factory: AdapterFactory): void {
	FACTORIES[type] = factory;
}

const PAIRING_TTL_MS = 60 * 60_000;
const TYPING_EVERY_MS = 8_000;
const AUTOMATIC = new Set(["routine", "reminder", "handoff", "test", "outreach"]);

const pairings = new Map<string, ChannelPairing & { chatId: string }>();
/** Short approval codes (in buttons, and typed as /approve CODE) → tool call. */
const approvalCodes = new Map<string, { toolCallId: string; expiresAt: number }>();
/** Approval requests posted on platforms, so they can be closed when you answer anywhere. */
const approvalPosts = new Map<string, { channelId: string; chatId: string; messageId: string; text: string }[]>();
const approvalDeciders = new Map<string, string>();
/** Platform messages already taken by one bot, when several bots share a linked chat. */
const claims = new Map<string, number>();

// ---------------------------------------------------------------- helpers

function code(len = 6): string {
	return randomChars("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", len);
}

function pairingsChanged(): void {
	const me = currentActor()?.userId;
	if (me)
		void listPairings().then((mine) => bus.emit({ type: "pairing.changed", pending: mine.length }, { to: [me] }));
}

/**
 * A bot's accounts are its owner's: they set them up, approve who may talk to it, and its replies there run as
 * them. Channels whose bot isn't the acting person's own don't exist for them.
 */
async function ownAgentIds(): Promise<Set<string> | null> {
	if (!currentActor()) return null;
	return new Set((await listOwnAgents()).map((a) => a.id));
}

export async function requireOwnChannel(id: string): Promise<Channel> {
	const channel = await getChannel(id);
	const own = await ownAgentIds();
	if (!channel || (own && !own.has(channel.agentId))) throw notFound("Channel");
	return channel;
}

/** Runs a channel's handler as its bot's owner (nothing happens when their account is off or their role can't). */
async function asOwner<T>(channelId: string, fallback: T, fn: () => Promise<T>): Promise<T> {
	const channel = await getChannel(channelId);
	const ownerId = channel ? await agentOwner(channel.agentId) : null;
	const actor = ownerId ? await actorFor(ownerId).catch(() => null) : null;
	if (!actor || !can("channels", actor)) return fallback;
	return runAs(actor, fn);
}

function chatOf(x: ChatRef): ChatRef {
	return {
		chatId: x.chatId,
		chatName: x.chatName,
		isGroup: x.isGroup,
		serverId: x.serverId,
		senderId: x.senderId,
		senderName: x.senderName,
	};
}

// ---------------------------------------------------------------- CRUD

export { getChannel };

export async function listChannels(filter: { agentId?: string } = {}): Promise<ChannelWithStatus[]> {
	const rows = await db
		.select()
		.from(schema.channels)
		.where(filter.agentId ? eq(schema.channels.agentId, filter.agentId) : undefined);
	const own = await ownAgentIds();
	return rows.filter((r) => !own || own.has(r.agentId)).map(publicChannel);
}

export async function createChannel(input: ChannelCreateInput): Promise<ChannelWithStatus> {
	const data = parse(ChannelCreate, input);
	requirePermission("channels");
	const own = await ownAgentIds();
	if (own && !own.has(data.agentId)) throw notFound("Bot");
	const agent = await requireOwnedAgent(data.agentId);
	const now = Date.now();
	const row: Channel = {
		id: newId("chn"),
		...data,
		name: data.name || `${agent.name} on ${CHANNEL_DEFINITIONS[data.type].title}`,
		allowFrom: [...new Set(data.allowFrom)],
		createdAt: now,
		updatedAt: now,
	};
	row.secrets = sealSecrets(row.secrets);
	await db.insert(schema.channels).values(row);
	if (row.enabled) void startChannel(row.id);
	bus.emit({ type: "channel.changed", channelId: row.id });
	return publicChannel(row);
}

/** A secret as sent back by the app: masked (keep the stored one), empty, or a new one. */
const isNewSecret = (v: string | undefined) => Boolean(v?.trim() && !v.includes("…") && v !== "••••");

/** Whether a request brings new credentials (then it wants a recent sign-in). */
export const newSecrets = (secrets: Record<string, string> | undefined) =>
	Object.values(secrets ?? {}).some(isNewSecret);

export async function updateChannel(id: string, input: ChannelUpdateInput): Promise<ChannelWithStatus> {
	const patch = parse(ChannelUpdate, input);
	const current = await requireOwnChannel(id);
	const moving = patch.agentId !== undefined && patch.agentId !== current.agentId;
	if (moving) {
		const agent = await requireOwnedAgent(patch.agentId ?? "");
		// Its chats were linked to the old agent's conversations: new messages start fresh with the new one.
		await db.delete(schema.channelBindings).where(eq(schema.channelBindings.channelId, id));
		log.info(`channel ${current.name || current.type} moved to ${agent.name}`);
	}
	// Secrets come back masked: keep the stored value unless a real new one was sent.
	const secrets = { ...current.secrets };
	for (const [k, v] of Object.entries(patch.secrets ?? {})) {
		if (isNewSecret(v)) secrets[k] = sealSecrets({ [k]: v })[k] ?? "";
	}
	const next: Channel = {
		...current,
		...patch,
		secrets,
		config: patch.config ? { ...current.config, ...patch.config } : current.config,
		allowFrom: patch.allowFrom ? [...new Set(patch.allowFrom)] : current.allowFrom,
		updatedAt: Date.now(),
	};
	await db.update(schema.channels).set(next).where(eq(schema.channels.id, id));
	const needsRestart =
		moving ||
		patch.enabled !== undefined ||
		JSON.stringify(secrets) !== JSON.stringify(current.secrets) ||
		JSON.stringify(next.config) !== JSON.stringify(current.config);
	const entry = running.get(id);
	if (entry) entry.channel = next;
	if (needsRestart) {
		await stopChannel(id);
		if (next.enabled) void startChannel(id);
	}
	bus.emit({ type: "channel.changed", channelId: id });
	return publicChannel(next);
}

export async function deleteChannel(id: string): Promise<void> {
	await requireOwnChannel(id);
	await stopChannel(id);
	await db.delete(schema.channels).where(eq(schema.channels.id, id));
	clearStatus(id);
	for (const [c, p] of pairings) if (p.channelId === id) pairings.delete(c);
	bus.emit({ type: "channel.changed", channelId: id });
}

export async function listBindings(channelId: string): Promise<ChannelBinding[]> {
	await requireOwnChannel(channelId);
	return db.select().from(schema.channelBindings).where(eq(schema.channelBindings.channelId, channelId));
}

/** Every platform chat linked to one of your conversations (for sorting chats in the sidebar). */
export async function listAllBindings(): Promise<ChannelBinding[]> {
	const me = currentActor()?.userId;
	if (!me) return db.select().from(schema.channelBindings);
	return (
		await db
			.select({ b: schema.channelBindings })
			.from(schema.channelBindings)
			.innerJoin(schema.conversations, eq(schema.conversations.id, schema.channelBindings.conversationId))
			.where(eq(schema.conversations.userId, me))
	).map((r) => r.b);
}

/** A linked chat, if it's one of the acting person's. */
async function requireOwnBinding(id: string): Promise<ChannelBinding> {
	const row = await getBinding(id);
	if (!row || !(await getConversation(row.conversationId))) throw notFound("Linked chat");
	return row;
}

export async function unlinkBinding(id: string): Promise<void> {
	const row = await requireOwnBinding(id);
	await deleteBindings([id]);
	if (row) bus.emit({ type: "channel.changed", channelId: row.channelId });
}

export async function updateBinding(id: string, input: ChannelBindingUpdateInput): Promise<ChannelBinding> {
	const patch = parse(ChannelBindingUpdate, input);
	const row = await requireOwnBinding(id);
	// Listening applies to the whole linked group chat, so every bot in it hears the same messages.
	const conversation = await getConversation(row.conversationId);
	const ids =
		conversation?.kind === "group"
			? (await bindingsForChat(row.externalChatId))
					.filter((b) => b.conversationId === row.conversationId)
					.map((b) => b.id)
			: [id];
	if (patch.listen !== undefined) await updateBindings(ids, { listen: patch.listen });
	bus.emit({ type: "channel.changed", channelId: row.channelId });
	return { ...row, ...patch };
}

// ---------------------------------------------------------------- lifecycle

export async function startChannel(id: string): Promise<void> {
	const channel = await getChannel(id);
	if (!channel?.enabled) return;
	// Failures so far, for the retry backoff (read before stopping drops the entry).
	const attempts = running.get(id)?.attempts ?? 0;
	await stopChannel(id, { keepStatus: true });
	const factory = FACTORIES[channel.type];
	if (!factory) {
		setStatus(id, { state: "error", error: `${channel.type} isn't supported` });
		return;
	}
	const adapter = factory(channel);
	const entry: Running = { adapter, channel, retry: null, attempts };
	/** Replaced (restarted, stopped) while this start was in flight: it must not touch the channel any more. */
	const stale = () => running.get(id) !== entry;
	running.set(id, entry);
	setStatus(id, { state: "starting", error: null });
	try {
		const me = await adapter.start({
			onMessage: (msg) => asOwner(id, undefined, () => handleInbound(id, msg)),
			onCommand: (cmd) =>
				asOwner(id, { text: "This bot isn't available right now." }, () => handleCommand(id, cmd)),
			onAutocomplete: (cmd, option, value) => asOwner(id, [], () => handleAutocomplete(id, cmd, option, value)),
			onAction: (action) =>
				asOwner(id, { whisper: "This bot isn't available right now." }, () => handleAction(id, action)),
			onFatal: (err) => {
				if (stale()) return;
				log.warn(`channel ${channel.name}: ${errorMessage(err)}`);
				setStatus(id, { state: "error", error: errorMessage(err), connectedAt: null });
				void adapter.stop();
				running.delete(id);
			},
			log: (level, message) => log[level](`channel ${channel.name}: ${message}`),
		});
		if (stale()) {
			await adapter.stop().catch(() => {});
			return;
		}
		entry.attempts = 0;
		setStatus(id, {
			state: "connected",
			error: null,
			botId: me.botId,
			botName: me.botName,
			inviteUrl: me.inviteUrl,
			readsAll: me.readsAll,
			workspaceId: me.workspaceId,
			workspaceName: me.workspaceName,
			appId: me.appId,
			connectedAt: Date.now(),
		});
		log.info(`channel ${channel.name} connected as ${me.botName}`);
		await adapter
			.registerCommands(COMMANDS)
			.catch((err: unknown) =>
				log.warn(`channel ${channel.name}: couldn't publish commands: ${errorMessage(err)}`),
			);
	} catch (err) {
		await adapter.stop().catch(() => {});
		if (stale()) return;
		entry.attempts++;
		const delay = Math.min(30_000 * 2 ** (entry.attempts - 1), 15 * 60_000);
		const credential = /token|credential|rejected|unauthor|invalid_auth|not_authed|account_inactive|401/i.test(
			errorMessage(err),
		);
		setStatus(id, {
			state: "error",
			error: credential ? errorMessage(err) : `${errorMessage(err)} (retrying in ${Math.round(delay / 1000)}s)`,
			connectedAt: null,
		});
		log.warn(`channel ${channel.name} failed to start: ${errorMessage(err)}`);
		// Network trouble is retried; bad credentials wait for you to fix them.
		if (!credential) entry.retry = setTimeout(() => void startChannel(id), delay);
		else running.delete(id);
	}
}

export async function stopChannel(id: string, opts: { keepStatus?: boolean } = {}): Promise<void> {
	const entry = running.get(id);
	if (entry) {
		// Its voice calls end with it (they'd otherwise linger until the "nobody left" timer).
		const { leaveVoiceFor } = await import("./voice.ts");
		leaveVoiceFor(id);
		if (entry.retry) clearTimeout(entry.retry);
		running.delete(id);
		await entry.adapter.stop().catch(() => {});
	}
	if (!opts.keepStatus) setStatus(id, { state: "stopped", error: null, connectedAt: null });
}

export async function restartChannel(id: string): Promise<ChannelWithStatus> {
	const channel = await getChannel(id);
	if (!channel) throw notFound("Channel");
	const entry = running.get(id);
	if (entry) entry.attempts = 0;
	await startChannel(id);
	return publicChannel((await getChannel(id)) ?? channel);
}

export async function startAllChannels(): Promise<void> {
	const rows = await db.select().from(schema.channels).where(eq(schema.channels.enabled, true));
	for (const c of rows) void startChannel(c.id);
}

export async function stopAllChannels(): Promise<void> {
	await Promise.all([...running.keys()].map((id) => stopChannel(id, { keepStatus: true })));
}

// ---------------------------------------------------------------- pairing

export async function listPairings(): Promise<ChannelPairing[]> {
	const now = Date.now();
	for (const [c, p] of pairings) if (p.expiresAt < now) pairings.delete(c);
	const own = await ownAgentIds();
	return [...pairings.values()].filter((p) => !own || own.has(p.agentId)).map(({ chatId: _chatId, ...p }) => p);
}

export async function decidePairing(pairingCode: string, approve: boolean): Promise<boolean> {
	const p = pairings.get(pairingCode.toUpperCase());
	if (!p) return false;
	const own = await ownAgentIds();
	if (own && !own.has(p.agentId)) return false;
	pairings.delete(p.code);
	// Codes last an hour (the sweep only runs every 10 minutes).
	if (p.expiresAt < Date.now()) {
		pairingsChanged();
		return false;
	}
	pairingsChanged();
	const channel = await getChannel(p.channelId);
	if (!channel) return false;
	if (approve) {
		await updateChannel(channel.id, { allowFrom: [...channel.allowFrom, p.senderId] });
		const agent = await getAgent(channel.agentId);
		await running
			.get(channel.id)
			?.adapter.send(
				p.chatId,
				`You're connected to ${agent?.name ?? "your bot"}. Say hi! Type / to see what I can do here.`,
			)
			.catch(() => {});
	}
	return true;
}

/** Unknown people get a one-time code to approve in Sekai. Returns the text to show them. */
async function pairingText(channel: Channel, who: ChatRef): Promise<string> {
	let pending = [...pairings.values()].find(
		(p) => p.channelId === channel.id && p.senderId === who.senderId && p.expiresAt > Date.now(),
	);
	if (!pending) {
		pending = {
			code: code(),
			channelId: channel.id,
			agentId: channel.agentId,
			type: channel.type,
			senderId: who.senderId,
			senderName: who.senderName,
			chatId: who.chatId,
			createdAt: Date.now(),
			expiresAt: Date.now() + PAIRING_TTL_MS,
		};
		pairings.set(pending.code, pending);
		pairingsChanged();
		bus.emit({
			type: "notification",
			title: `Pairing request on ${CHANNEL_DEFINITIONS[channel.type].title}`,
			body: `${who.senderName} wants to talk to your bot. Code ${pending.code}.`,
			agentId: channel.agentId,
			conversationId: null,
		});
	}
	const agent = await getAgent(channel.agentId);
	return `Hi! I'm ${agent?.name ?? "a Sekai bot"}, and I only talk to my owner.\n\nPairing code: **${pending.code}**\n\nIf that's you, approve this code in Sekai (Needs you, or the bot's Channels tab), then message me again. The code expires in an hour.`;
}

/** Whether this person may use the bot here; DMs from strangers start pairing. */
function mayUse(channel: Channel, who: ChatRef): boolean {
	if (who.isGroup && channel.groupPolicy === "disabled") return false;
	if (!who.isGroup && channel.dmPolicy === "disabled") return false;
	if (channel.allowFrom.includes(who.senderId)) return true;
	return !who.isGroup && channel.dmPolicy === "open";
}

/** The bot's owner: the first person it answers (message_user, call_user and trust follow them). */
const isOwner = (channel: Channel, who: { senderId: string }) =>
	Boolean(channel.allowFrom[0]) && who.senderId === channel.allowFrom[0];

/**
 * What people the owner trusts (or anyone, with open DMs) may do besides chatting. Everything else (approvals,
 * mode, model, trust, memory, notes, routines, group links, new chats…) is the owner's alone, so new commands
 * start owner-only too.
 */
const GUEST_COMMANDS = new Set([
	"help",
	"start",
	"status",
	"stop",
	"join",
	"leave",
	"retry",
	"Retry",
	"Erase and retry",
	"Retry with another model",
	"team",
]);
const GUEST_ACTIONS = new Set(["rm"]);
const OWNER_ONLY = "Only my owner can do that.";

/**
 * The owner saying "trust @fern", "trust everyone in this GC", or "untrust @fern" (also in their DM). Returns the
 * reply to send, or null when the message isn't a trust command. Trust lets someone talk to the account anywhere.
 */
async function tryTrust(channel: Channel, entry: Running, msg: InboundMessage): Promise<Reply | null> {
	// Only the explicit phrases, as the whole message: "trust @fern", "trust everyone in here", "untrust @fern".
	// Anything else ("add oat milk to my list", "should we add @fern?") is a normal message for the bot.
	const me = status(channel.id).botId;
	const others = msg.mentions.filter((m) => m.id !== me);
	let t = msg.text;
	for (const m of msg.mentions) for (const tok of m.tokens) t = t.split(tok).join(m.id === me ? " " : " @@ ");
	t = t
		.replace(/\s+/g, " ")
		.trim()
		.toLowerCase()
		.replace(/[.!]+$/, "");
	const said = t.match(/^(?:please |pls )?(untrust|stop trusting|trust)\s+(.+)$/);
	if (!said?.[1] || !said[2]) return null;
	const remove = said[1] !== "trust";
	const add = !remove;
	const rest = said[2].trim();
	const everyone =
		/^(?:everyone|everybody)(?: (?:in )?(?:here|this (?:gc|group(?: chat)?|chat|server|channel)))?$/.test(rest);
	const onlyMentions = others.length > 0 && /^@@(?:\s*(?:(?:,|and|&)\s*)?@@)*$/.test(rest);
	if (!everyone && !onlyMentions) return null;

	const save = async (allowFrom: string[]) => {
		await updateChannel(channel.id, { allowFrom });
		channel.allowFrom = allowFrom;
		entry.channel = { ...entry.channel, allowFrom };
	};
	const addIds = async (ids: string[]) => {
		const next = [...new Set([...channel.allowFrom, ...ids])];
		if (next.length === channel.allowFrom.length) return false;
		await save(next);
		return true;
	};
	const nameOf = (id: string) => msg.mentions.find((m) => m.id === id)?.name ?? id;

	if (everyone) {
		if (!msg.isGroup) return { text: "There's no one here but us. Say trust @someone, in a group." };
		if (remove) return { text: "Say untrust @someone to remove one person." };
		// Everyone in this chat (the account too): people mentioned now, plus the people in a group DM.
		let ids = msg.mentions.map((m) => m.id);
		if (channel.type === "discord-user" && entry.adapter.groupMembers) {
			ids = [...ids, ...(await entry.adapter.groupMembers(msg.chatId).catch(() => [] as string[]))];
		}
		ids = ids.filter((id) => id && id !== status(channel.id).botId);
		if (!ids.length) return { text: "I couldn't see who's in here. Try trust @someone." };
		const changed = await addIds(ids);
		return { text: changed ? "I'll answer everyone in here now." : "I already answer everyone in here." };
	}

	// Never the owner, and never the account itself.
	const targets = others.map((m) => m.id).filter((id) => id !== channel.allowFrom[0]);
	if (!targets.length) return { text: remove ? "I always answer my owner." : "That's me." };
	if (add) {
		const changed = await addIds(targets);
		const names = targets.map(nameOf).join(", ");
		return {
			text: changed ? `I'll answer ${names} now, anywhere I can see them.` : `I already answer ${names}.`,
		};
	}
	const kept = channel.allowFrom.filter((id) => !targets.includes(id));
	if (kept.length === channel.allowFrom.length) return { text: "They weren't trusted." };
	await save(kept);
	return { text: `Okay, I'll ignore ${targets.map(nameOf).join(", ")}.` };
}

// ---------------------------------------------------------------- chats and conversations

/** The Sekai conversation a platform chat feeds: every DM and channel gets its own (listed under it in the sidebar). */
/** One binding being made per platform chat at a time (two quick first messages must share one chat). */
const bindingsInFlight = new Map<string, Promise<ChannelBinding>>();
const threadsInFlight = new Map<string, Promise<void>>();

async function inheritThread(
	channel: Channel,
	msg: InboundMessage,
	parent: ChannelBinding,
	dmThreads: boolean,
): Promise<ChannelBinding> {
	const key = `${currentActor()?.userId}:${msg.chatId}`;
	const busy = threadsInFlight.get(key);
	if (busy) {
		await busy;
		return (await findBinding(channel.id, msg.chatId)) ?? bindingFor(channel, msg);
	}
	const work = (async () => {
		if (await findBinding(channel.id, msg.chatId)) return;
		const previous = await getConversation(parent.conversationId);
		if (previous?.kind !== "group") {
			// A proactive DM began at the top level. Its first threaded reply continues that conversation, unless
			// the DM is one ongoing chat: then the top level keeps it, and the thread is a chat of its own.
			if (
				dmThreads &&
				!msg.isGroup &&
				msg.replyToId &&
				(await sekaiMessageId(parent.externalChatId, msg.replyToId))
			) {
				await upsertBinding({
					channelId: channel.id,
					externalChatId: msg.chatId,
					conversationId: parent.conversationId,
					chatName: msg.chatName,
					isGroup: false,
					listen: false,
				});
				await deleteBindings([parent.id]);
				return;
			}
			const b = await bindingFor(channel, msg);
			if (parent.listen) await updateBindings([b.id], { listen: true });
			return;
		}
		const conversation = await createConversation({
			kind: "group",
			memberIds: previous.memberIds,
			title: msg.chatName,
			settings: { purpose: previous.settings.purpose, maxTurns: previous.settings.maxTurns },
		});
		for (const p of await bindingsForChat(parent.externalChatId)) {
			if (p.conversationId !== previous.id) continue;
			await upsertBinding({
				channelId: p.channelId,
				externalChatId: msg.chatId,
				conversationId: conversation.id,
				chatName: msg.chatName,
				isGroup: true,
				listen: p.listen,
			});
		}
	})();
	threadsInFlight.set(key, work);
	try {
		await work;
	} finally {
		if (threadsInFlight.get(key) === work) threadsInFlight.delete(key);
	}
	return (await findBinding(channel.id, msg.chatId)) ?? bindingFor(channel, msg);
}

async function bindingFor(channel: Channel, chat: ChatRef): Promise<ChannelBinding> {
	const key = `${channel.id}:${chat.chatId}`;
	const busy = bindingsInFlight.get(key);
	if (busy) await busy.catch(() => {});
	const p = bindingForNow(channel, chat).finally(() => {
		if (bindingsInFlight.get(key) === p) bindingsInFlight.delete(key);
	});
	bindingsInFlight.set(key, p);
	return p;
}

async function bindingForNow(channel: Channel, chat: ChatRef): Promise<ChannelBinding> {
	const existing = await findBinding(channel.id, chat.chatId);
	const current = existing ? await getConversation(existing.conversationId) : null;
	// DMs used to share the bot's main chat: give them their own from now on.
	const shared = Boolean(existing && current && !chat.isGroup && !isChatFor(current, channel));
	if (existing && current && !shared) return existing;
	const conversation = await createConversation({
		kind: "direct",
		agentId: channel.agentId,
		title: chatTitle(channel, chat.chatName),
	});
	return upsertBinding({
		channelId: channel.id,
		externalChatId: chat.chatId,
		conversationId: conversation.id,
		chatName: chat.chatName,
		isGroup: chat.isGroup,
		listen: existing?.listen ?? false,
	});
}

/**
 * The DM chat between an agent's bot and you (the bot's owner: the first person allowed to use it), opened if
 * needed. Messages posted in its Sekai conversation are sent there.
 */
export async function ownerDm(
	agentId: string,
	platform?: "slack" | "discord",
): Promise<{ conversationId: string; channelId: string; botName: string; type: Channel["type"] } | null> {
	const own = await ownAgentIds();
	if (own && !own.has(agentId)) return null;
	for (const [id, entry] of running) {
		const ch = entry.channel;
		if (platform && ch.type !== platform && !(platform === "discord" && ch.type === "discord-user")) continue;
		if (ch.agentId !== agentId || !ch.enabled || status(id).state !== "connected") continue;
		const owner = ch.allowFrom[0];
		if (!owner || !entry.adapter.openDirect) continue;
		const dm = await entry.adapter.openDirect(owner);
		// Where each thread is its own chat, a message from the bot goes on in your latest DM thread.
		if (entry.adapter.threads) {
			const threads = (await listBindings(ch.id))
				.filter((b) => !b.isGroup && b.externalChatId.startsWith(`${dm.chatId}:`))
				.sort((a, b) => (b.lastInboundAt ?? b.createdAt) - (a.lastInboundAt ?? a.createdAt));
			const recent = threads[0];
			if (recent && (await getConversation(recent.conversationId)))
				return {
					conversationId: recent.conversationId,
					channelId: id,
					botName: status(id).botName ?? ch.type,
					type: ch.type,
				};
		}
		const binding = await bindingFor(ch, {
			chatId: dm.chatId,
			chatName: dm.name,
			isGroup: false,
			serverId: null,
			senderId: owner,
			senderName: dm.name.replace(/^DM with /, ""),
		});
		return {
			conversationId: binding.conversationId,
			channelId: id,
			botName: status(id).botName ?? ch.type,
			type: ch.type,
		};
	}
	return null;
}

/** An agent's running channels. */
export function channelsOf(agentId: string): { id: string; channel: Channel; adapter: ChannelAdapter }[] {
	return [...running]
		.filter(([, e]) => e.channel.agentId === agentId && e.channel.enabled)
		.map(([id, e]) => ({ id, channel: e.channel, adapter: e.adapter }));
}

/** The messaging-app accounts an agent speaks through (for its prompt and its teammates'). */
export async function accountsOf(
	agentId: string,
): Promise<{ type: Channel["type"]; name: string; connected: boolean }[]> {
	const own = await ownAgentIds();
	if (own && !own.has(agentId)) return [];
	const out: { type: Channel["type"]; name: string; connected: boolean }[] = [];
	for (const [id, entry] of running) {
		if (entry.channel.agentId !== agentId || !entry.channel.enabled) continue;
		const st = status(id);
		out.push({
			type: entry.channel.type,
			name: st.botName ?? CHANNEL_DEFINITIONS[entry.channel.type].title,
			connected: st.state === "connected",
		});
	}
	return out;
}

const chatTitle = (channel: Channel, chatName: string) => `${CHANNEL_DEFINITIONS[channel.type].title}: ${chatName}`;

/** A chat made for this platform chat (not the bot's main chat). */
function isChatFor(conversation: { title: string }, channel: Channel): boolean {
	return conversation.title.startsWith(`${CHANNEL_DEFINITIONS[channel.type].title}: `);
}

async function agentNames(): Promise<{ all: Agent[]; byBot: Map<string, string> }> {
	const all = await listAgents();
	const byBot = new Map<string, string>();
	for (const [botId, v] of agentBots()) {
		const a = all.find((x) => x.id === v.agentId);
		if (a) byBot.set(botId, a.name);
	}
	return { all, byBot };
}

/** Posts your words into a chat's conversation and has the right agents answer. */
async function postInbound(
	channel: Channel,
	binding: ChannelBinding,
	input: { text: string; attachmentIds?: string[]; replyToId?: string | null; origin: ChannelOrigin },
): Promise<Message> {
	const runtime = await import("../agent/runtime.ts");
	const conversation = await getConversation(binding.conversationId);
	let message: Message;
	if (conversation?.kind === "group") {
		const result = await runtime.sendUserMessage(
			binding.conversationId,
			{ text: input.text, attachmentIds: input.attachmentIds ?? [], replyToId: input.replyToId ?? null },
			{ channel: input.origin },
		);
		message = result.message;
	} else {
		const { getUploads } = await import("../services/uploads.ts");
		const uploads = await getUploads(input.attachmentIds ?? []);
		message = await createMessage({
			conversationId: binding.conversationId,
			sender: "user",
			parts: input.text.trim() ? [{ type: "text", text: input.text }] : [],
			attachments: uploads.map(toAttachment),
			replyToId: input.replyToId ?? null,
			meta: { trigger: "channel", channel: input.origin },
		});
		await runtime.enqueueRun({
			agentId: channel.agentId,
			conversationId: binding.conversationId,
			trigger: "channel",
			sourceMessageId: message.id,
			rootMessageId: message.id,
		});
	}
	await db
		.update(schema.channelBindings)
		.set({ lastInboundAt: Date.now() })
		.where(eq(schema.channelBindings.id, binding.id));
	return message;
}

/** "join vc", "hop in the call", "join general", "leave vc"… as the join/leave commands. */
export function voicePhrase(text: string): ParsedCommand | null {
	const t = text.trim().replace(/[.!?]+$/, "");
	const join = t.match(
		/^(?:(?:can you|could you|please|pls|plz)\s+)?(?:join|hop (?:in|on|into)|come (?:in|into|to|on)|get (?:in|on)|jump (?:in|on|into))\s+(?:the |my |our |a )?(vc|voice(?: chat| channel)?|call)(?:\s+(.+))?$/i,
	);
	if (join) return { name: "join", sub: null, options: join[2] ? { channel: join[2] } : {} };
	if (
		/^(?:(?:please|pls)\s+)?(?:leave|get out of|hang up|disconnect)(?:\s+(?:the\s+)?(?:vc|voice(?: chat| channel)?|call))?$/i.test(
			t,
		)
	) {
		return { name: "leave", sub: null, options: {} };
	}
	return null;
}

// ---------------------------------------------------------------- inbound messages

async function handleInbound(channelId: string, msg: InboundMessage): Promise<void> {
	const entry = running.get(channelId);
	if (!entry) return;
	const channel = (await getChannel(channelId)) ?? entry.channel;
	const { adapter } = entry;
	const bots = agentBots();
	// Sekai's own bots are already in the conversation; other bots only when you allowlisted them.
	if (bots.has(msg.senderId)) return;
	if (msg.senderIsBot && !channel.allowFrom.includes(msg.senderId)) return;

	let binding = await findBinding(channel.id, msg.chatId);
	const parent = !binding && msg.parentChatId ? await findBinding(channel.id, msg.parentChatId) : null;
	const addressed = msg.addressed || Boolean(msg.threadReply && binding && !msg.mentions.some((m) => bots.has(m.id)));
	// Owner-only trust management, in plain words: "@bot trust @fern", "trust everyone in this GC" (also in the owner's DM).
	if (isOwner(channel, msg) && (addressed || !msg.isGroup)) {
		const trusted = await tryTrust(channel, entry, msg);
		if (trusted) {
			await sendReply(adapter, msg.chatId, trusted, msg.messageId);
			return;
		}
	}
	if (msg.isGroup) {
		// Servers: only allowed people, and only when they mention the bot (or it listens here).
		if (channel.groupPolicy === "disabled" || !channel.allowFrom.includes(msg.senderId)) return;
		if (!addressed && !binding?.listen && !parent?.listen) return;
		// Listening isn't eavesdropping: a message for other bots (and not this one) is theirs.
		if (!addressed && msg.mentions.some((m) => bots.has(m.id))) return;
	} else if (!mayUse(channel, msg)) {
		if (channel.dmPolicy === "pairing" && !msg.senderIsBot)
			await adapter.send(msg.chatId, await pairingText(channel, msg));
		return;
	}

	const agent = await getAgent(channel.agentId);
	if (!agent) return;
	// A channel-wide /listen or group link applies to new Slack threads, but each thread keeps its own history.
	if (!binding && parent && msg.parentChatId) {
		binding = await inheritThread(channel, msg, parent, Boolean(adapter.threads));
	}
	const conversation = binding ? await getConversation(binding.conversationId) : null;
	const linked = conversation?.kind === "group";
	const me = status(channelId).botId;
	const { all, byBot } = await agentNames();
	const text = fromPlatformMentions(msg.text, msg.mentions, byBot, new Set(linked || !me ? [] : [me]));

	// Typed commands, e.g. "/status" or "@Smoke /retry". In a linked chat the mentioned bot answers.
	const names = all.map((a) => a.name).sort((a, b) => b.length - a.length);
	let commandText = text;
	for (let again = true; again; ) {
		again = false;
		for (const n of names) {
			if (commandText.toLowerCase().startsWith(`@${n.toLowerCase()}`)) {
				commandText = commandText.slice(n.length + 1).trimStart();
				again = true;
			}
		}
	}
	const parsed = commandText.startsWith("/") ? parseTextCommand(commandText, COMMANDS) : voicePhrase(commandText);
	if (parsed) {
		// The people a typed /trust mentions (their names in the text are just names by now).
		if (parsed.name === "trust")
			parsed.options.who = [parsed.options.who ?? "", ...msg.mentions.filter((m) => m.id !== me).map((m) => m.id)]
				.join(" ")
				.trim();
		if (linked && me && !msg.mentions.some((m) => m.id === me)) {
			const otherBotMentioned = msg.mentions.some((m) => bots.has(m.id));
			const host = (await bindingsForChat(msg.chatId))[0];
			if (otherBotMentioned || host?.channelId !== channelId) return;
		}
		if (!GUEST_COMMANDS.has(parsed.name) && !isOwner(channel, msg)) {
			await sendReply(adapter, msg.chatId, { text: OWNER_ONLY }, msg.messageId);
			return;
		}
		const env = await commandEnv(channel, entry, agent, msg, null);
		const reply = await runCommand(env, parsed.name, parsed.sub, parsed.options);
		await sendReply(adapter, msg.chatId, reply, msg.messageId);
		return;
	}

	if (!text.trim() && msg.attachments.length === 0) return;
	if (agent.status === "paused" && !linked) {
		await adapter.send(msg.chatId, `${agent.name} is paused right now. Resume it in Sekai to continue.`);
		return;
	}
	if (linked) {
		// Every bot in a linked chat sees the same message; the first one takes it.
		const key = `${binding?.conversationId}:${msg.chatId}:${msg.messageId}`;
		if (claims.has(key)) return;
		claims.set(key, Date.now());
		if (await sekaiMessageId(msg.chatId, msg.messageId)) return;
	}

	const b = binding ?? (await bindingFor(channel, msg));
	const uploads = [];
	let voice: { part: AudioPart; text: string } | null = null;
	for (const a of msg.attachments.slice(0, 10)) {
		const data = await a.load().catch(() => null);
		if (!data) continue;
		// A voice note: written down for the bot, kept to play back.
		if (!voice && /^audio\/(ogg|opus|wav|x-wav)/.test(a.mime)) {
			try {
				const { prepareVoiceMessage } = await import("../voice/voice-messages.ts");
				voice = await prepareVoiceMessage(channel.agentId, data);
				continue;
			} catch (err) {
				log.warn(`couldn't read a voice message: ${errorMessage(err)}`);
			}
		}
		try {
			uploads.push(await saveUpload(data, a.name, a.mime));
		} catch (err) {
			log.warn(`channel attachment rejected: ${errorMessage(err)}`);
		}
	}
	const origin: ChannelOrigin = {
		channelId: channel.id,
		type: channel.type,
		chatId: msg.chatId,
		chatName: msg.chatName,
		isGroup: msg.isGroup,
		senderId: msg.senderId,
		senderName: msg.senderName,
		messageId: msg.messageId,
	};
	const replyToId = msg.replyToId ? await sekaiMessageId(msg.chatId, msg.replyToId) : null;
	const message = await postInbound(channel, b, {
		text: voice ? [text, voice.text].filter((t) => t.trim()).join("\n") || "(voice message)" : text,
		attachmentIds: uploads.map((u) => u.id),
		replyToId,
		origin,
	});
	if (voice) {
		const { updateMessage } = await import("../services/messages.ts");
		await updateMessage(message.id, { parts: [voice.part, ...message.parts] }, { emit: true });
	}
	await recordPlatformMessage({
		channelId: channel.id,
		chatId: msg.chatId,
		externalMessageId: msg.messageId,
		messageId: message.id,
		direction: "in",
	});
}

/** A command reply: just a reaction when that's all it needs, otherwise a message. */
async function sendReply(adapter: ChannelAdapter, chatId: string, reply: Reply, replyTo: string | null) {
	if (reply.react && !reply.select && !reply.buttons?.length && replyTo) {
		const reacted = await adapter
			.react(chatId, replyTo, reply.react)
			.then(() => true)
			.catch(() => false);
		if (reacted) return;
	}
	await adapter
		.send(chatId, reply, { replyTo })
		.catch((err: unknown) => log.warn(`channel reply failed: ${errorMessage(err)}`));
}

// ---------------------------------------------------------------- commands, menus and buttons

async function commandEnv(
	channel: Channel,
	entry: Running,
	agent: Agent,
	chat: ChatRef,
	targetMessageId: string | null,
): Promise<CommandEnv> {
	let existing = await findBinding(channel.id, chat.chatId);
	if (existing && !(await getConversation(existing.conversationId))) existing = null;
	const binding = async () => {
		existing = existing ?? (await bindingFor(channel, chat));
		return existing;
	};
	const ref = chatOf(chat);
	return {
		channel,
		agent,
		adapter: entry.adapter,
		chat: ref,
		get existing() {
			return existing;
		},
		binding,
		targetMessageId,
		readsAll: status(channel.id).readsAll,
		hooks: {
			newChat: (b) => newChat(channel, b),
			linkGroup: (ids) => linkGroup(channel, ref, ids),
			unlinkGroup: () => unlinkGroup(ref),
			setListen: async (on) => setListen(channel, await binding(), on),
			resendApprovals: (b) => resendApprovals(entry, ref.chatId, b),
			decideApproval: (c, choice) => answerApproval(c, choice, chat.senderName),
			trust: async (ids, remove) => {
				const me = status(channel.id).botId;
				const targets = ids.filter((id) => id && id !== me && id !== channel.allowFrom[0]);
				if (!targets.length) return remove ? "I always answer my owner." : "That's me.";
				if (remove) {
					const kept = channel.allowFrom.filter((id) => !targets.includes(id));
					if (kept.length === channel.allowFrom.length) return "They weren't trusted.";
					await updateChannel(channel.id, { allowFrom: kept });
					channel.allowFrom = kept;
					entry.channel = { ...entry.channel, allowFrom: kept };
					return "Okay, I'll ignore them.";
				}
				const next = [...new Set([...channel.allowFrom, ...targets])];
				if (next.length === channel.allowFrom.length) return "I already answer them.";
				await updateChannel(channel.id, { allowFrom: next });
				channel.allowFrom = next;
				entry.channel = { ...entry.channel, allowFrom: next };
				return `I'll answer ${targets.length === 1 ? "them" : `${targets.length} people`} now, anywhere I can see them.`;
			},
			joinVoice: async (where) => {
				const voice = entry.adapter.voice;
				if (!voice) return "I can't join voice channels here.";
				const target = where?.trim()
					? await voice.findChannel(where, { guildId: chat.serverId, chatId: chat.chatId })
					: await voice.userVoice(chat.senderId);
				if (!target) {
					return where?.trim()
						? `I couldn't find a voice channel called ${where.trim()}.`
						: "Join a voice channel first (or tell me which one: /join channel:name), and I'll hop in.";
				}
				const { joinVoice } = await import("./voice.ts");
				const b = await binding();
				const conversation = await getConversation(b.conversationId);
				if (!conversation) return "That chat is gone.";
				await joinVoice({
					channelId: channel.id,
					guildId: target.guildId,
					voiceChannelId: target.channelId,
					voiceName: target.name,
					agent,
					conversation,
				});
				return `Joined 🔊 ${target.name}.`;
			},
			leaveVoice: async () => {
				const { leaveVoice } = await import("./voice.ts");
				const guildId = chat.serverId ?? (await entry.adapter.voice?.guildOf(chat.chatId)) ?? null;
				const where = guildId ? null : await entry.adapter.voice?.userVoice(chat.senderId);
				const g = guildId ?? where?.guildId;
				return g && leaveVoice(channel.id, g)
					? "Left the voice channel. 👋"
					: "I'm not in a voice channel here.";
			},
			say: async (text) => {
				const b = await binding();
				await postInbound(channel, b, {
					text,
					origin: {
						channelId: channel.id,
						type: channel.type,
						chatId: chat.chatId,
						chatName: chat.chatName,
						isGroup: chat.isGroup,
						senderId: chat.senderId,
						senderName: chat.senderName,
					},
				});
			},
		},
	};
}

async function handleCommand(channelId: string, cmd: CommandInvocation): Promise<Reply> {
	const entry = running.get(channelId);
	if (!entry) return { text: "I'm restarting. Try again in a moment." };
	const channel = (await getChannel(channelId)) ?? entry.channel;
	if (!mayUse(channel, cmd)) {
		if (!cmd.isGroup && channel.dmPolicy === "pairing") return { text: await pairingText(channel, cmd) };
		return { text: "I only take commands from my owner." };
	}
	if (!GUEST_COMMANDS.has(cmd.name) && !isOwner(channel, cmd)) return { text: OWNER_ONLY };
	const agent = await getAgent(channel.agentId);
	if (!agent) return { text: "My agent was deleted." };
	const env = await commandEnv(channel, entry, agent, cmd, cmd.targetMessageId);
	return runCommand(env, cmd.name, cmd.sub, cmd.options);
}

async function handleAutocomplete(channelId: string, cmd: CommandInvocation, option: string, value: string) {
	const entry = running.get(channelId);
	if (!entry || !mayUse(entry.channel, cmd)) return [];
	const agent = await getAgent(entry.channel.agentId);
	return agent ? autocomplete({ agent }, option, value) : [];
}

async function handleAction(channelId: string, action: ActionInvocation): Promise<ActionResult> {
	const entry = running.get(channelId);
	if (!entry) return { whisper: "I'm restarting. Try again in a moment." };
	const channel = (await getChannel(channelId)) ?? entry.channel;
	if (!mayUse(channel, action)) return { whisper: "Only my owner can use this." };
	if (!GUEST_ACTIONS.has(action.id.split(":")[0] ?? "") && !isOwner(channel, action)) return { whisper: OWNER_ONLY };
	if (action.id.startsWith("ap:")) {
		const [, token, choice] = action.id.split(":");
		const post = [...approvalPosts.values()].flat().find((p) => p.messageId === action.messageId);
		const result = await answerApproval(token ?? "", (choice ?? "deny") as ApprovalChoice, action.senderName);
		return { update: { text: `${post?.text ?? ""}\n**${result}**`.trim() } };
	}
	const agent = await getAgent(channel.agentId);
	if (!agent) return { whisper: "My agent was deleted." };
	const env = await commandEnv(channel, entry, agent, action, null);
	const update = await runAction(env, action.id, action.values);
	return update ? { update } : {};
}

async function newChat(channel: Channel, binding: ChannelBinding): Promise<void> {
	const current = await getConversation(binding.conversationId);
	if (current?.kind === "group") {
		const fresh = await createConversation({
			kind: "group",
			memberIds: current.memberIds,
			title: current.title,
			settings: { purpose: current.settings.purpose, maxTurns: current.settings.maxTurns },
		});
		const ids = (await bindingsForChat(binding.externalChatId))
			.filter((b) => b.conversationId === current.id)
			.map((b) => b.id);
		await updateBindings(ids, { conversationId: fresh.id });
	} else {
		// Titled for the chat (like bindingFor), so it stays this chat's and isn't mistaken for the bot's main chat.
		const fresh = await createConversation({
			kind: "direct",
			agentId: channel.agentId,
			title: chatTitle(channel, binding.chatName),
		});
		await updateBindings([binding.id], { conversationId: fresh.id });
	}
	bus.emit({ type: "channel.changed", channelId: channel.id });
}

/** Makes a server channel one group chat: every member answers through their own bot, if it's there. */
async function linkGroup(channel: Channel, chat: ChatRef, agentIds: string[]): Promise<string> {
	const all = await listOwnAgents();
	const members = all.filter((a) => agentIds.includes(a.id));
	if (members.length < 2) return "A group chat needs at least two bots.";
	if (members.length > 8) return "A group chat can have up to 8 bots.";
	const chatBindings = await bindingsForChat(chat.chatId);
	const currentIds = [...new Set(chatBindings.map((b) => b.conversationId))];
	const currentGroups = (await Promise.all(currentIds.map((id) => getConversation(id)))).filter(
		(c) => c?.kind === "group",
	);
	const listen = chatBindings.some((b) => b.listen);
	let conversation = currentGroups[0] ?? null;
	if (conversation) {
		conversation = await updateConversation(conversation.id, { memberIds: members.map((m) => m.id) });
	} else {
		conversation = await createConversation({
			kind: "group",
			memberIds: members.map((m) => m.id),
			title: chat.chatName.replace(/\s*\(.*\)$/, ""),
		});
	}
	const notes: string[] = [];
	const linkedIds: string[] = [];
	for (const m of members) {
		const bots = [...running.values()].filter(
			(r) => r.channel.agentId === m.id && r.channel.type === channel.type && live(r.channel.id),
		);
		if (bots.length === 0) {
			if (m.id !== channel.agentId)
				notes.push(`${m.name} has no ${CHANNEL_DEFINITIONS[channel.type].title} bot, so I'll post for them.`);
			continue;
		}
		let joined = false;
		for (const r of bots) {
			if (!(await r.adapter.canPost(chat.chatId).catch(() => false))) continue;
			const b = await upsertBinding({
				channelId: r.channel.id,
				externalChatId: chat.chatId,
				conversationId: conversation.id,
				chatName: chat.chatName,
				isGroup: true,
				listen,
			});
			linkedIds.push(b.id);
			joined = true;
		}
		if (!joined) {
			const invite = bots.map((r) => status(r.channel.id).inviteUrl).find(Boolean);
			notes.push(
				`${m.name}'s bot isn't in this channel yet${invite ? `: [add it](<${invite}>)` : ""}. Until then I'll post for them.`,
			);
		}
	}
	// Bots no longer in the group go back to having no chat here.
	await deleteBindings(
		chatBindings.filter((b) => b.conversationId === conversation.id && !linkedIds.includes(b.id)).map((b) => b.id),
	);
	for (const id of new Set(chatBindings.map((b) => b.channelId)))
		bus.emit({ type: "channel.changed", channelId: id });
	const names = members.map((m) => m.name);
	const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0];
	return [
		`This channel is now a group chat with ${list}. Mention one of us, or use /listen on so we answer every message.`,
		...notes.map((n) => running.get(channel.id)?.adapter.subtext(n) ?? n),
	].join("\n");
}

async function unlinkGroup(chat: ChatRef): Promise<string> {
	const chatBindings = await bindingsForChat(chat.chatId);
	const groups: string[] = [];
	for (const b of chatBindings) {
		const c = await getConversation(b.conversationId);
		if (c?.kind === "group") groups.push(b.id);
	}
	if (groups.length === 0) return "This channel isn't a group chat.";
	const channelIds = new Set(chatBindings.map((b) => b.channelId));
	await deleteBindings(groups);
	for (const id of channelIds) bus.emit({ type: "channel.changed", channelId: id });
	return "Unlinked. Each bot has its own chat here again; the group chat stays in Sekai.";
}

async function setListen(channel: Channel, binding: ChannelBinding, on: boolean): Promise<string> {
	await updateBinding(binding.id, { listen: on });
	if (!on) return "OK, I'll only answer here when mentioned.";
	const linked = (await bindingsForChat(binding.externalChatId)).filter(
		(b) => b.conversationId === binding.conversationId,
	);
	const deaf = linked.filter((b) => !status(b.channelId).readsAll);
	const lines = ["I'll answer every message here from people I know."];
	if (deaf.length) {
		const who = deaf.map((b) => status(b.channelId).botName ?? "a bot").join(", ");
		const note = `Discord only shows a bot the messages that mention it unless its Message Content Intent is on (Developer Portal → Bot → Privileged Gateway Intents). It's off for ${who}: turn it on, then reconnect in Sekai.`;
		lines.push(running.get(channel.id)?.adapter.subtext(note) ?? note);
	}
	return lines.join("\n");
}

// ---------------------------------------------------------------- approvals

/** Decides an approval from a chat (who decided shows on the request, which may be in a group). */
async function answerApproval(token: string, choice: ApprovalChoice, by: string): Promise<string> {
	const entry = approvalCodes.get(token.toUpperCase());
	if (!entry) return "That request was already handled or has expired";
	const pending = listPendingApprovals().find((p) => p.toolCallId === entry.toolCallId);
	if (!pending) return "That request was already handled or has expired";
	approvalCodes.delete(token.toUpperCase());
	approvalDeciders.set(entry.toolCallId, by);
	// Always-ask requests are decided one at a time, whatever was pressed.
	const scoped = choice === "approve_chat" && !pending.alwaysAsk;
	const ok = await decideApproval(entry.toolCallId, {
		approve: choice !== "deny",
		scope: scoped ? "conversation" : "once",
	});
	if (!ok) return "That request was already handled";
	return `${choice === "deny" ? "Denied" : scoped ? "Approved for this chat" : "Approved"} by ${by}`;
}

function approvalReply(token: string, part: ToolPart, subtext: (s: string) => string): Reply {
	// Approval prompts can land in a group chat: keep anything that looks like a secret out of them.
	const shown = JSON.stringify(
		part.args,
		(k, v) => (/pass|secret|token|cookie|session|api[_-]?key|private/i.test(k) && v ? "•••" : v),
		2,
	);
	const details = truncate(`${part.name} ${shown}`, 1200);
	return {
		text: `✋ **${part.title ?? part.name}**\n${part.reason ?? "This action needs your approval."}\n\`\`\`\n${details}\n\`\`\`\n${subtext(`Or type /approve ${token} or /deny ${token}`)}`,
		buttons: [
			{ id: `ap:${token}:approve`, label: "Approve once", style: "success" },
			...(part.alwaysAsk
				? []
				: [{ id: `ap:${token}:approve_chat`, label: "Allow in this chat", style: "secondary" as const }]),
			{ id: `ap:${token}:deny`, label: "Deny", style: "danger" },
		],
	};
}

async function postApproval(target: StreamTarget, part: ToolPart): Promise<void> {
	const entry = live(target.channelId);
	if (!entry) return;
	let token = [...approvalCodes].find(([, a]) => a.toolCallId === part.id)?.[0];
	if (!token) {
		token = code();
		approvalCodes.set(token, { toolCallId: part.id, expiresAt: Date.now() + 24 * 3_600_000 });
	}
	const reply = approvalReply(token, part, (s) => entry.adapter.subtext(s));
	const messageId = await entry.adapter.send(target.chatId, reply);
	const posts = approvalPosts.get(part.id) ?? [];
	posts.push({ channelId: target.channelId, chatId: target.chatId, messageId, text: reply.text });
	approvalPosts.set(part.id, posts);
}

async function promptApproval(conversationId: string, messageId: string, part: ToolPart): Promise<void> {
	const message = snapshots.get(messageId) ?? (await getMessage(messageId));
	if (!message) return;
	let targets = await targetsFor(message);
	if (targets.length === 0) {
		// Started in Sekai: ask in your DMs with the bot when it sends you updates there.
		const bindings = await bindingsForConversation(conversationId);
		targets = bindings
			.filter((b) => !b.isGroup && live(b.channelId)?.channel.delivery === "smart")
			.map((b) => ({
				channelId: b.channelId,
				chatId: b.externalChatId,
				header: null,
				replyTo: null,
				mentions: new Map(),
			}));
	}
	for (const t of targets) {
		await postApproval(t, part).catch((err: unknown) => log.warn(`approval prompt failed: ${errorMessage(err)}`));
	}
}

async function resendApprovals(entry: Running, chatId: string, binding: ChannelBinding): Promise<number> {
	const pending = listPendingApprovals().filter((p) => p.conversationId === binding.conversationId);
	for (const p of pending) {
		const message = await getMessage(p.messageId);
		const part = message?.parts.find((x): x is ToolPart => x.type === "tool" && x.id === p.toolCallId);
		if (!part) continue;
		await postApproval(
			{ channelId: entry.channel.id, chatId, header: null, replyTo: null, mentions: new Map() },
			part,
		).catch(() => {});
	}
	return pending.length;
}

/** You answered somewhere (Sekai, another chat): close the request everywhere it was posted. */
async function closeApproval(part: ToolPart): Promise<void> {
	const posts = approvalPosts.get(part.id);
	if (!posts) return;
	approvalPosts.delete(part.id);
	for (const [c, a] of approvalCodes) if (a.toolCallId === part.id) approvalCodes.delete(c);
	const by = approvalDeciders.get(part.id);
	approvalDeciders.delete(part.id);
	const outcome = `${part.status === "denied" ? "Denied" : "Approved"}${by ? ` by ${by}` : ""}`;
	for (const p of posts) {
		await live(p.channelId)
			?.adapter.edit(p.chatId, p.messageId, { text: `${p.text}\n**${outcome}**` })
			.catch(() => {});
	}
}

// ---------------------------------------------------------------- outbound: replies

/** Live copies of messages being written, kept from the event stream. */
const snapshots = new Map<string, Message>();
interface Delivery {
	streams: OutboundStream[];
	typing: ReturnType<typeof setInterval> | null;
}
const deliveries = new Map<string, Delivery>();
const resolving = new Map<string, Promise<void>>();

/**
 * Where a message goes: for each platform chat linked to its conversation, the bot that speaks for its agent
 * (or the chat's first bot, naming the agent), if the channel's delivery rules say so.
 */
export async function targetsFor(m: Message): Promise<StreamTarget[]> {
	if (m.sender === "system") return [];
	const bindings = await bindingsForConversation(m.conversationId);
	if (bindings.length === 0) return [];
	const conversation = await getConversation(m.conversationId);
	if (!conversation) return [];
	const linked = conversation.kind === "group";
	const origin = m.meta.channel;
	const agents = await listAgents();
	const nameOf = (id: string | null) => agents.find((a) => a.id === id)?.name ?? "Another bot";
	const byChat = new Map<string, ChannelBinding[]>();
	for (const b of bindings) byChat.set(b.externalChatId, [...(byChat.get(b.externalChatId) ?? []), b]);
	const settings = m.sender === "user" ? await getSettings() : null;
	const out: StreamTarget[] = [];
	for (const [chatId, list] of byChat) {
		const usable = list.filter((b) => live(b.channelId));
		const own = usable.find((b) => live(b.channelId)?.channel.agentId === m.agentId);
		const via = own ?? usable[0];
		const entry = via ? live(via.channelId) : null;
		if (!via || !entry) continue;
		const { channel, adapter } = entry;
		let deliver: boolean;
		if (m.sender === "user") deliver = linked && !origin;
		else if (origin) deliver = origin.chatId === chatId;
		else if (linked || channel.delivery === "all") deliver = true;
		// message_user to your DM: you asked to be told, so it goes even when the channel only posts replies.
		else if (m.meta.trigger === "outreach" && !via.isGroup) deliver = true;
		else if (channel.delivery === "replies" || via.isGroup) deliver = false;
		else deliver = AUTOMATIC.has(m.meta.trigger ?? "") || m.agentId !== channel.agentId;
		if (!deliver) continue;
		let header: string | null = null;
		if (m.sender === "user") header = adapter.subtext(`${settings?.userName || "You"}, in Sekai`);
		else if (m.agentId && m.agentId !== channel.agentId) {
			header = linked ? `**${nameOf(m.agentId)}**` : adapter.subtext(`From ${nameOf(m.agentId)}`);
		} else if (m.meta.trigger === "reminder") header = adapter.subtext("⏰ Reminder");
		const mentions = new Map<string, string>();
		if (via.isGroup) {
			for (const b of usable) {
				const e = live(b.channelId);
				const botId = status(b.channelId).botId;
				if (e && botId) mentions.set(nameOf(e.channel.agentId).toLowerCase(), e.adapter.mention(botId));
			}
		}
		out.push({
			channelId: via.channelId,
			chatId,
			header,
			replyTo: origin?.chatId === chatId ? (origin.messageId ?? null) : null,
			mentions,
		});
	}
	return out;
}

function stopTyping(d: Delivery): void {
	if (d.typing) clearInterval(d.typing);
	d.typing = null;
	for (const stream of d.streams)
		void live(stream.target.channelId)
			?.adapter.idle?.(stream.target.chatId)
			.catch(() => {});
}

function finishDelivery(id: string): void {
	const d = deliveries.get(id);
	if (!d) return;
	stopTyping(d);
	deliveries.delete(id);
	snapshots.delete(id);
}

async function resolveDelivery(id: string): Promise<void> {
	const first = snapshots.get(id);
	if (!first) return;
	const targets = await targetsFor(first).catch((err: unknown) => {
		log.warn(`channel routing failed: ${errorMessage(err)}`);
		return [];
	});
	const m = snapshots.get(id) ?? first;
	const d: Delivery = {
		streams: targets.map((t) => new OutboundStream(t, m, () => live(t.channelId)?.adapter ?? null)),
		typing: null,
	};
	deliveries.set(id, d);
	if (d.streams.length === 0) {
		if (m.status !== "streaming") finishDelivery(id);
		return;
	}
	if (m.status === "streaming") {
		// Typing until the reply is posted, except while it waits for your approval (that's asked separately).
		const type = () => {
			const last = snapshots.get(id)?.parts.at(-1);
			if (last?.type === "tool" && last.status === "awaiting_approval") return;
			for (const t of targets)
				void live(t.channelId)
					?.adapter.typing(t.chatId)
					.catch(() => {});
		};
		type();
		d.typing = setInterval(type, TYPING_EVERY_MS);
	}
	for (const s of d.streams) s.update(m);
	if (m.status !== "streaming") void settleAndFinish(id, d);
}

async function settleAndFinish(id: string, d: Delivery): Promise<void> {
	stopTyping(d);
	await Promise.all(d.streams.map((s) => s.settled()));
	if (deliveries.get(id) === d) finishDelivery(id);
}

function onMessage(m: Message): void {
	if (m.sender === "system") return;
	snapshots.set(m.id, m);
	const d = deliveries.get(m.id);
	if (d) {
		for (const s of d.streams) s.update(m);
		if (m.status !== "streaming") void settleAndFinish(m.id, d);
		return;
	}
	if (resolving.has(m.id)) return;
	const p = resolveDelivery(m.id).finally(() => resolving.delete(m.id));
	resolving.set(m.id, p);
}

function onPart(
	messageId: string,
	index: number,
	patch: (part: Message["parts"][number] | undefined) => Message["parts"][number] | null,
) {
	const snap = snapshots.get(messageId);
	if (!snap) return;
	const next = patch(snap.parts[index]);
	if (!next) return;
	const parts = [...snap.parts];
	parts[index] = next;
	const m = { ...snap, parts };
	snapshots.set(messageId, m);
	for (const s of deliveries.get(messageId)?.streams ?? []) s.update(m);
}

/** A message deleted in Sekai disappears from the chats it was posted to. */
async function onDeleted(messageId: string): Promise<void> {
	const d = deliveries.get(messageId);
	if (d) finishDelivery(messageId);
	const posted = await allPostedFor(messageId);
	for (const p of posted)
		await live(p.channelId)
			?.adapter.remove(p.externalChatId, p.externalMessageId)
			.catch(() => {});
	await forgetAllPosted(messageId);
}

const prompted = new Set<string>();

function onEvent(ev: ServerEvent): void {
	switch (ev.type) {
		case "message.created":
		case "message.updated":
			onMessage(ev.message);
			return;
		case "message.delta":
			onPart(ev.messageId, ev.index, (p) =>
				p && (p.type === "text" || p.type === "reasoning") ? { ...p, text: p.text + ev.delta } : null,
			);
			return;
		case "message.part":
			onPart(ev.messageId, ev.index, () => ev.part);
			if (ev.part.type === "tool") {
				if (ev.part.status === "awaiting_approval" && !prompted.has(ev.part.id)) {
					prompted.add(ev.part.id);
					void promptApproval(ev.conversationId, ev.messageId, ev.part);
				} else if (ev.part.status !== "awaiting_approval" && approvalPosts.has(ev.part.id)) {
					void closeApproval(ev.part);
				}
			}
			return;
		case "message.deleted":
			void onDeleted(ev.messageId);
			return;
	}
}

let unsubscribe: (() => void) | null = null;
let sweeper: ReturnType<typeof setInterval> | null = null;

/** Hooks channel delivery into the event bus and connects every enabled channel. */
export async function initChannels(): Promise<void> {
	unsubscribe = bus.subscribe(onEvent);
	sweeper = setInterval(() => {
		const now = Date.now();
		for (const [c, a] of approvalCodes) if (a.expiresAt < now) approvalCodes.delete(c);
		for (const [k, at] of claims) if (at < now - 3_600_000) claims.delete(k);
		if (prompted.size > 5000) prompted.clear();
		void listPairings();
	}, 10 * 60_000);
	await startAllChannels();
}

export async function shutdownChannels(): Promise<void> {
	unsubscribe?.();
	if (sweeper) clearInterval(sweeper);
	for (const id of [...deliveries.keys()]) finishDelivery(id);
	await stopAllChannels();
}
