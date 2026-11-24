import { type Channel, signalConfig } from "@sekai/shared";
import { errorMessage } from "../lib/errors.ts";
import { sniffImageMime } from "../lib/mime.ts";
import { releaseSignalDaemon, useSignalDaemon } from "../signal/engine.ts";
import { callRpc, readSse, type SseEvent } from "../signal/rpc.ts";
import { fromSignalText, mentionToken, signalChunks, toSignalText } from "./signal-format.ts";
import {
	type ChannelAdapter,
	type ChannelHandlers,
	type InboundAttachment,
	type InboundMessage,
	MAX_INBOUND_BYTES,
	type Reply,
} from "./types.ts";

// ---------------------------------------------------------------- what signal-cli sends (its JSON, trimmed)

export interface SignalMention {
	start: number;
	length: number;
	uuid?: string | null;
	number?: string | null;
}
export interface SignalAttachment {
	contentType?: string | null;
	filename?: string | null;
	id?: string | null;
	size?: number | null;
	isVoiceNote?: boolean;
}
interface SignalStyleRange {
	style: string;
	start: number;
	length: number;
}
interface SignalDataMessage {
	timestamp: number;
	message?: string | null;
	mentions?: SignalMention[] | null;
	attachments?: SignalAttachment[] | null;
	textStyles?: SignalStyleRange[] | null;
	quote?: { id: number; authorUuid?: string | null; text?: string | null } | null;
	reaction?: {
		emoji?: string | null;
		targetAuthorUuid?: string | null;
		targetSentTimestamp: number;
		isRemove: boolean;
	} | null;
	groupInfo?: { groupId?: string | null; groupName?: string | null; type?: string | null } | null;
	remoteDelete?: unknown;
	sticker?: unknown;
	storyContext?: unknown;
	isExpirationUpdate?: boolean;
	isProfileKeyUpdate?: boolean;
	isEndSession?: boolean;
	groupCallUpdate?: unknown;
	pollCreate?: unknown;
	pollVote?: unknown;
	pollTerminate?: unknown;
	payment?: unknown;
	adminDelete?: unknown;
	pinMessage?: unknown;
	unpinMessage?: unknown;
}
export interface SignalEnvelope {
	sourceNumber?: string | null;
	sourceUuid?: string | null;
	sourceName?: string | null;
	timestamp: number;
	dataMessage?: SignalDataMessage;
	editMessage?: unknown;
	syncMessage?: unknown;
	typingMessage?: unknown;
	receiptMessage?: unknown;
	callMessage?: unknown;
	storyMessage?: unknown;
}
/** One event from /api/v1/events (event: receive). */
export interface SignalFrame {
	account?: string;
	envelope?: SignalEnvelope;
	exception?: { message?: string | null; type?: string | null };
}

// ---------------------------------------------------------------- chats and messages, as Sekai addresses them

/**
 * Sekai's id for a Signal chat: a group by its id (the same for every bot in it, so several bots can share one
 * group chat), a DM by the bot's account and the other person (so two bots' DMs with someone never collide).
 */
export const signalGroupChat = (groupId: string) => `signal:group:${groupId}`;
export const signalDmChat = (self: string, peer: string) => `signal:dm:${self}:${peer}`;

export type SignalChat = { kind: "group"; groupId: string } | { kind: "dm"; self: string; peer: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Unpacks Sekai's own Signal chat ids only (a group id is base64; people are account ids). */
export function parseSignalChat(chatId: string): SignalChat {
	const group = /^signal:group:([A-Za-z0-9+/=_-]{8,})$/.exec(chatId);
	if (group?.[1]) return { kind: "group", groupId: group[1] };
	const dm = /^signal:dm:([^:]+):([^:]+)$/.exec(chatId);
	if (dm?.[1] && dm[2] && UUID.test(dm[1]) && UUID.test(dm[2])) return { kind: "dm", self: dm[1], peer: dm[2] };
	throw new Error("That Signal chat address isn't valid.");
}

/** A message's id on Signal is when it was sent and who sent it (that's how reactions, quotes and edits find it). */
export const signalMessageId = (timestamp: number, author: string) => `${timestamp}:${author}`;

export function parseSignalMessageId(id: string): { timestamp: number; author: string } | null {
	const m = /^(\d{10,16}):(.+)$/.exec(id);
	return m?.[1] && m[2] ? { timestamp: Number(m[1]), author: m[2] } : null;
}

export type SignalEvent =
	| {
			kind: "message";
			chatId: string;
			groupId: string | null;
			groupName: string | null;
			senderId: string;
			senderName: string;
			timestamp: number;
			/** The text as Markdown, mentions as tokens (<@account id>). */
			text: string;
			mentionIds: string[];
			quote: { timestamp: number; author: string } | null;
			attachments: SignalAttachment[];
	  }
	| {
			kind: "reaction";
			chatId: string;
			groupId: string | null;
			groupName: string | null;
			senderId: string;
			senderName: string;
			emoji: string;
			target: string;
			remove: boolean;
	  }
	| { kind: "group-update"; groupId: string; groupName: string | null; senderId: string; senderName: string }
	| { kind: "identity"; senderId: string; senderName: string }
	| { kind: "ignored"; why: string };

/** What happened, from one frame of signal-cli's event stream, for the account `self`. */
export function parseSignalEvent(frame: SignalFrame, self: string): SignalEvent {
	const env = frame.envelope;
	if (!env) return { kind: "ignored", why: "no envelope" };
	// Who sent it is their account id, never a number or a name (anyone can claim those).
	const senderId = env.sourceUuid?.toLowerCase();
	const senderName = env.sourceName?.trim() || "Someone";
	if (frame.exception?.type === "UntrustedIdentityException") {
		return senderId ? { kind: "identity", senderId, senderName } : { kind: "ignored", why: "unknown sender" };
	}
	if (frame.exception) return { kind: "ignored", why: `couldn't read it: ${frame.exception.type ?? "error"}` };
	if (!senderId) return { kind: "ignored", why: "no sender" };
	// Its own messages (sent from the linked phone, or synced back) aren't anyone talking to it.
	if (senderId === self.toLowerCase()) return { kind: "ignored", why: "own message" };
	if (env.syncMessage) return { kind: "ignored", why: "sync" };
	if (env.editMessage) return { kind: "ignored", why: "edit" };
	const data = env.dataMessage;
	if (!data) return { kind: "ignored", why: "not a message" };
	const groupId = data.groupInfo?.groupId ?? null;
	const groupName = data.groupInfo?.groupName?.trim() || null;
	const chatId = groupId ? signalGroupChat(groupId) : signalDmChat(self.toLowerCase(), senderId);
	if (data.reaction) {
		const target = data.reaction.targetAuthorUuid?.toLowerCase();
		if (!target || !data.reaction.emoji) return { kind: "ignored", why: "reaction without a target" };
		return {
			kind: "reaction",
			chatId,
			groupId,
			groupName,
			senderId,
			senderName,
			emoji: data.reaction.emoji,
			target: signalMessageId(data.reaction.targetSentTimestamp, target),
			remove: data.reaction.isRemove,
		};
	}
	if (groupId && data.groupInfo?.type === "UPDATE")
		return { kind: "group-update", groupId, groupName, senderId, senderName };
	if (
		data.remoteDelete ||
		data.isExpirationUpdate ||
		data.isProfileKeyUpdate ||
		data.isEndSession ||
		data.groupCallUpdate ||
		data.storyContext ||
		data.pollCreate ||
		data.pollVote ||
		data.pollTerminate ||
		data.payment ||
		data.adminDelete ||
		data.pinMessage ||
		data.unpinMessage
	)
		return { kind: "ignored", why: "not something to answer" };
	const raw = data.message ?? "";
	const mentions = (data.mentions ?? [])
		.filter((m) => m.uuid)
		.map((m) => ({ start: m.start, length: m.length, id: (m.uuid ?? "").toLowerCase() }));
	const text = fromSignalText(raw, mentions, data.textStyles ?? []);
	const attachments = (data.attachments ?? []).filter((a) => a.id && a.contentType !== "text/x-signal-plain");
	if (!text.trim() && attachments.length === 0) return { kind: "ignored", why: "empty" };
	const quoteAuthor = data.quote?.authorUuid?.toLowerCase();
	return {
		kind: "message",
		chatId,
		groupId,
		groupName,
		senderId,
		senderName,
		timestamp: data.timestamp || env.timestamp,
		text,
		mentionIds: [...new Set(mentions.map((m) => m.id))],
		quote: data.quote && quoteAuthor ? { timestamp: data.quote.id, author: quoteAuthor } : null,
		attachments,
	};
}

const EXT: Record<string, string> = {
	"image/jpeg": "jpg",
	"image/png": "png",
	"image/gif": "gif",
	"image/webp": "webp",
	"image/heic": "heic",
	"video/mp4": "mp4",
	"audio/aac": "aac",
	"audio/mp4": "m4a",
	"audio/mpeg": "mp3",
	"audio/ogg": "ogg",
	"application/pdf": "pdf",
};

/** A name for a file that came without one (Signal's photos and voice notes don't have any). */
export function attachmentName(a: SignalAttachment, mime = a.contentType ?? ""): string {
	if (a.filename?.trim()) return a.filename.trim();
	const ext = EXT[mime.toLowerCase()] ?? "bin";
	if (a.isVoiceNote) return `voice-note.${ext}`;
	const kind = mime.startsWith("image/") ? "photo" : mime.startsWith("video/") ? "video" : "file";
	return `signal-${kind}.${ext}`;
}

/** Strips skin tones and variation selectors, so 👍🏽 counts as 👍. */
export const baseEmoji = (emoji: string) => emoji.replace(/[\u{1F3FB}-\u{1F3FF}\uFE0E\uFE0F]/gu, "");

// ---------------------------------------------------------------- the adapter

/** Where the adapter finds signal-cli: the daemon Sekai runs (swappable so tests use a fake one). */
export interface SignalTransport {
	/** Starts (or finds) the daemon for this account and gives its address. */
	connect(holder: string): Promise<string>;
	release(holder: string): void;
	fetch?: typeof fetch;
	/** First wait before reconnecting the event stream (doubles each time, up to a minute). */
	reconnectMs?: number;
	/** How often the account is checked (is it still known to signal-cli?). */
	healthMs?: number;
	/** No data for this long (signal-cli sends keep-alives every 15 s) and the stream is replaced. */
	quietMs?: number;
}

const DAEMON: SignalTransport = { connect: useSignalDaemon, release: releaseSignalDaemon };

/** Signal allows editing a message 10 times, within a day of sending it. */
const MAX_EDITS = 10;
const EDIT_WINDOW_MS = 24 * 3_600_000;

const fatal = (message: string) => Object.assign(new Error(message), { fatal: true });
const SIGNED_OUT =
	"Signal signed this account out: its link was removed on the phone, or the number was registered somewhere else. Connect it again.";

interface GroupInfo {
	id: string;
	name?: string | null;
	isMember?: boolean;
	members?: { uuid?: string | null }[];
	pendingMembers?: { uuid?: string | null }[];
}

/**
 * A bot's Signal account, through the signal-cli daemon: DMs and groups arrive as events, replies go out as JSON-RPC
 * calls. No buttons or slash commands exist on Signal, so approvals and commands are text (and reactions).
 */
export function signalAdapter(channel: Channel, transport: SignalTransport = DAEMON): ChannelAdapter {
	const cfg = signalConfig(channel);
	const self = cfg.account.toLowerCase();
	const request = transport.fetch ?? fetch;
	let base = "";
	let h: ChannelHandlers;
	let stopped = true;
	let controller = new AbortController();
	let lastEventId: string | null = null;
	let health: ReturnType<typeof setInterval> | undefined;
	let botName = "";
	/** Account id → their name on Signal, as seen in messages and contacts. */
	const names = new Map<string, string>();
	/** Groups it's in (or invited to): an update for one it didn't know is someone adding it. */
	const groups = new Map<string, { name: string; member: boolean }>();
	/** Recent texts by message id, so a reply can quote them. */
	const texts = new Map<string, string>();
	const edits = new Map<string, number>();
	const seen = new Map<string, number>();
	const lanes = new Map<string, Promise<void>>();

	const keep = <V>(map: Map<string, V>, key: string, value: V, max = 2000) => {
		map.delete(key);
		map.set(key, value);
		if (map.size > max) map.delete(map.keys().next().value as string);
	};

	function rpc<T>(method: string, params: Record<string, unknown> = {}, timeoutMs?: number): Promise<T> {
		return callRpc<T>(
			base,
			method,
			{ account: cfg.account, ...params },
			{
				timeoutMs,
				fetch: transport.fetch,
				signal: controller.signal,
			},
		);
	}

	function target(chatId: string): Record<string, unknown> {
		const c = parseSignalChat(chatId);
		if (c.kind === "group") return { groupId: c.groupId };
		if (c.self !== self) throw new Error("That Signal chat belongs to another account.");
		return { recipient: [c.peer] };
	}

	const nameOf = (id: string) => (id === self ? botName : names.get(id)) ?? "someone";

	async function refreshGroups(): Promise<GroupInfo[]> {
		const list = await rpc<GroupInfo[]>("listGroups").catch(() => [] as GroupInfo[]);
		for (const g of list) {
			const invited = (g.pendingMembers ?? []).some((m) => m.uuid?.toLowerCase() === self);
			if (g.isMember || invited) groups.set(g.id, { name: g.name ?? "", member: Boolean(g.isMember) });
		}
		return list;
	}

	async function refreshNames(): Promise<void> {
		const list = await rpc<
			{
				uuid?: string | null;
				name?: string | null;
				profile?: { givenName?: string | null; familyName?: string | null };
			}[]
		>("listContacts", { allRecipients: true }).catch(() => []);
		for (const c of list) {
			const id = c.uuid?.toLowerCase();
			const profile = [c.profile?.givenName, c.profile?.familyName].filter(Boolean).join(" ").trim();
			const name = c.name?.trim() || profile;
			if (id && name) keep(names, id, name);
		}
	}

	function attachment(a: SignalAttachment, from: { groupId: string | null; senderId: string }): InboundAttachment {
		const att: InboundAttachment = {
			name: attachmentName(a),
			mime: a.contentType || "application/octet-stream",
			// Fetched from signal-cli only once the manager knows the sender may use the bot.
			load: async () => {
				const r = await rpc<{ data?: string }>(
					"getAttachment",
					{ id: a.id, ...(from.groupId ? { groupId: from.groupId } : { recipient: from.senderId }) },
					120_000,
				);
				if (!r.data) return null;
				const bytes = new Uint8Array(Buffer.from(r.data, "base64"));
				if (bytes.byteLength > MAX_INBOUND_BYTES) return null;
				// Images get their real type (labels can be wrong), and their name follows it.
				const real = sniffImageMime(bytes);
				if (real && real !== att.mime) {
					att.mime = real;
					if (!a.filename) att.name = attachmentName(a, real);
				}
				return bytes;
			},
		};
		return att;
	}

	/** Someone added the bot to a group: it stays (or accepts) only when they may use it, else it leaves. */
	async function groupUpdate(ev: Extract<SignalEvent, { kind: "group-update" }>): Promise<void> {
		const known = groups.get(ev.groupId);
		const [g] = await rpc<GroupInfo[]>("listGroups", { groupId: [ev.groupId] }).catch(() => [] as GroupInfo[]);
		if (!g) return;
		const invited = !g.isMember && (g.pendingMembers ?? []).some((m) => m.uuid?.toLowerCase() === self);
		const name = g.name?.trim() || ev.groupName || "a Signal group";
		if (!g.isMember && !invited) {
			groups.delete(ev.groupId);
			return;
		}
		groups.set(ev.groupId, { name, member: Boolean(g.isMember) });
		// An update to a group it was already in (a name change, someone joining) isn't an invitation.
		if (known?.member) return;
		const ok = await h.onInvite?.({
			chatId: signalGroupChat(ev.groupId),
			chatName: name,
			inviterId: ev.senderId,
			inviterName: ev.senderName,
		});
		// An invitation it already had (from before Sekai was listening): whoever this update is from didn't
		// necessarily send it, so only someone it answers decides; others leave it waiting.
		if (known && !ok) return;
		if (ok) {
			if (invited) {
				await rpc("updateGroup", { groupId: ev.groupId });
				groups.set(ev.groupId, { name, member: true });
				h.log("info", `joined the Signal group "${name}" (added by someone it answers)`);
			}
			return;
		}
		// Declines the invitation, or leaves a group it was put in directly.
		await rpc("quitGroup", { groupId: ev.groupId }).catch((err: unknown) =>
			h.log("warn", `couldn't leave the Signal group "${name}": ${errorMessage(err)}`),
		);
		groups.delete(ev.groupId);
		h.log("info", `left the Signal group "${name}": it was added by someone it doesn't answer`);
	}

	function inbound(ev: Extract<SignalEvent, { kind: "message" }>): InboundMessage {
		const isGroup = Boolean(ev.groupId);
		const messageId = signalMessageId(ev.timestamp, ev.senderId);
		const quote = ev.quote ? signalMessageId(ev.quote.timestamp, ev.quote.author) : null;
		return {
			chatId: ev.chatId,
			chatName: isGroup
				? ev.groupName || groups.get(ev.groupId ?? "")?.name || "Signal group"
				: `DM with ${ev.senderName}`,
			isGroup,
			serverId: null,
			senderId: ev.senderId,
			senderName: ev.senderName,
			senderIsBot: false,
			text: ev.text,
			messageId,
			replyToId: quote,
			// In groups: when it's mentioned, or someone replies to one of its messages. In DMs: always.
			addressed: !isGroup || ev.mentionIds.includes(self) || ev.quote?.author === self,
			mentions: ev.mentionIds.map((id) => ({ id, name: nameOf(id), bot: false, tokens: [mentionToken(id)] })),
			attachments: ev.attachments
				.filter((a) => (a.size ?? 0) <= MAX_INBOUND_BYTES)
				.map((a) => attachment(a, { groupId: ev.groupId, senderId: ev.senderId })),
		};
	}

	async function handle(frame: SignalFrame): Promise<void> {
		const ev = parseSignalEvent(frame, self);
		if (ev.kind === "ignored") return;
		if (ev.senderName !== "Someone") keep(names, ev.senderId, ev.senderName);
		if (ev.kind === "identity") {
			// Trust on first use: their messages stay unreadable until someone trusts the new safety number, and
			// a new safety number never makes anyone allowed.
			h.log(
				"warn",
				`${ev.senderName}'s Signal safety number changed. Their messages won't arrive until it's trusted again (the account's page in Sekai).`,
			);
			return;
		}
		if (ev.kind === "group-update") return groupUpdate(ev);
		if (ev.kind === "reaction") {
			await h.onReaction?.({
				chatId: ev.chatId,
				chatName: ev.groupId
					? ev.groupName || groups.get(ev.groupId)?.name || "Signal group"
					: `DM with ${ev.senderName}`,
				isGroup: Boolean(ev.groupId),
				serverId: null,
				senderId: ev.senderId,
				senderName: ev.senderName,
				messageId: ev.target,
				emoji: baseEmoji(ev.emoji),
				remove: ev.remove,
			});
			return;
		}
		const msg = inbound(ev);
		// What a reply quoting it shows where Signal can't find the original (mentions as names).
		keep(
			texts,
			msg.messageId,
			ev.text.replace(/<@([0-9a-f-]{36})>/g, (_all, id: string) => `@${nameOf(id)}`),
		);
		await h.onMessage(msg);
	}

	/** Each chat's events in order, while other chats go on. */
	function inLane(key: string, fn: () => Promise<void>): void {
		const task = (lanes.get(key) ?? Promise.resolve()).then(() => (stopped ? undefined : fn()));
		const tail = task.catch((err: unknown) =>
			h.log("warn", `A Signal message couldn't be handled: ${errorMessage(err)}`),
		);
		lanes.set(key, tail);
		void tail.then(() => {
			if (lanes.get(key) === tail) lanes.delete(key);
		});
	}

	function onSse(e: SseEvent): void {
		if (e.id) lastEventId = e.id;
		if (e.event !== "receive") return;
		let frame: SignalFrame;
		try {
			frame = JSON.parse(e.data) as SignalFrame;
		} catch {
			return;
		}
		const env = frame.envelope;
		if (!env) return;
		// The same envelope can come again after a reconnect.
		const key = `${env.sourceUuid}:${env.timestamp}:${env.dataMessage ? "d" : "x"}:${frame.exception?.type ?? ""}`;
		if (seen.has(key)) return;
		keep(seen, key, Date.now(), 5000);
		const group = env.dataMessage?.groupInfo?.groupId;
		inLane(group ? `g:${group}` : `u:${env.sourceUuid ?? ""}`, () => handle(frame));
	}

	/** The event stream, kept open: reconnects (picking up where it left off) until the adapter stops. */
	async function listen(): Promise<void> {
		let attempt = 0;
		while (!stopped) {
			const stream = new AbortController();
			let lastHeard = Date.now();
			const quiet = setInterval(() => {
				if (Date.now() - lastHeard > (transport.quietMs ?? 60_000)) stream.abort();
			}, 5_000);
			try {
				base = await transport.connect(channel.id);
				const res = await request(`${base}/api/v1/events?account=${encodeURIComponent(cfg.account)}`, {
					headers: { accept: "text/event-stream", ...(lastEventId ? { "last-event-id": lastEventId } : {}) },
					signal: AbortSignal.any([controller.signal, stream.signal]),
				});
				// signal-cli answers 400 for an account it no longer has.
				if (res.status === 400) {
					await res.body?.cancel().catch(() => {});
					if (!stopped) h.onFatal(fatal(SIGNED_OUT));
					return;
				}
				if (!res.ok || !res.body) throw new Error(`the event stream answered ${res.status}`);
				attempt = 0;
				await readSse(res.body, onSse, () => {
					lastHeard = Date.now();
				});
			} catch (err) {
				if (stopped) return;
				if (!stream.signal.aborted)
					h.log("warn", `Signal connection interrupted (${errorMessage(err)}); reconnecting.`);
			} finally {
				clearInterval(quiet);
			}
			if (stopped) return;
			const wait = Math.min((transport.reconnectMs ?? 1000) * 2 ** attempt++, 60_000);
			await Bun.sleep(wait);
		}
	}

	async function checkAccount(): Promise<boolean> {
		const accounts = await callRpc<{ number?: string | null; aci?: string | null }[]>(
			base,
			"listAccounts",
			{},
			{
				fetch: transport.fetch,
				signal: controller.signal,
				timeoutMs: 30_000,
			},
		);
		return accounts.some((a) => a.aci?.toLowerCase() === self);
	}

	function body(content: string | Reply): Record<string, unknown> {
		const reply = typeof content === "string" ? { text: content } : content;
		const t = toSignalText(reply.text);
		return {
			message: t.text,
			...(t.styles.length ? { textStyle: t.styles } : {}),
			...(t.mentions.length ? { mention: t.mentions } : {}),
		};
	}

	return {
		// What chunk() aims for; Signal's real limit is 2,000 bytes of UTF-8.
		maxText: 2000,
		reactionApprovals: true,
		help: {
			intro: "**Talk to me** right here in our chat, or mention me in a group I'm in (replying to one of my messages works too).",
			tips: "Approvals: react 👍 to approve or 👎 to deny, or type /approve CODE.",
		},
		chunk: (text) => signalChunks(text),
		mention: (id) => mentionToken(id),
		// Signal has no small print.
		subtext: (text) => text,

		async start(handlers) {
			h = handlers;
			if (!self) throw fatal("This Signal account has no account id. Remove it and connect it again.");
			stopped = false;
			controller = new AbortController();
			try {
				base = await transport.connect(channel.id);
			} catch (err) {
				// Waiting for signal-cli (being installed, or restarting): the manager tries again later.
				throw new Error(errorMessage(err));
			}
			if (stopped) throw new Error("Stopped");
			const accounts = await callRpc<{ number?: string | null; aci?: string | null }[]>(
				base,
				"listAccounts",
				{},
				{ fetch: transport.fetch, signal: controller.signal, timeoutMs: 30_000 },
			);
			const me = accounts.find((a) => a.aci?.toLowerCase() === self);
			if (!me) throw fatal(SIGNED_OUT);
			botName = cfg.profileName || me.number || cfg.number || "Signal account";
			await Promise.all([refreshGroups(), refreshNames()]);
			void listen();
			health = setInterval(() => {
				void checkAccount()
					.then((ok) => {
						if (!ok && !stopped) h.onFatal(fatal(SIGNED_OUT));
					})
					// Signal's helper restarting: the stream reconnects by itself.
					.catch(() => {});
			}, transport.healthMs ?? 60_000);
			health.unref?.();
			return { botId: self, botName, inviteUrl: null, readsAll: true };
		},

		async stop() {
			if (stopped) return;
			stopped = true;
			clearInterval(health);
			controller.abort();
			transport.release(channel.id);
		},

		// Signal has no command menus: commands are typed.
		registerCommands: async () => {},

		async send(chatId, content, opts) {
			const reply = typeof content === "string" ? { text: content } : content;
			const params: Record<string, unknown> = { ...target(chatId), ...body(reply) };
			// In groups, an answer quotes the message it answers (in a DM that's plain to see).
			const quoted = opts?.replyTo ? parseSignalMessageId(opts.replyTo) : null;
			if (quoted && parseSignalChat(chatId).kind === "group") {
				params.quoteTimestamp = quoted.timestamp;
				params.quoteAuthor = quoted.author;
				params.quoteMessage = texts.get(opts?.replyTo ?? "") ?? "";
			}
			if (reply.files?.length) {
				params.attachment = reply.files.map(
					(f) =>
						`data:${f.mime || "application/octet-stream"};filename=${encodeURIComponent(f.name)};base64,${Buffer.from(f.data).toString("base64")}`,
				);
			}
			if (!params.message && !params.attachment) return "";
			const sent = await rpc<{ timestamp: number }>("send", params, 180_000);
			const id = signalMessageId(sent.timestamp, self);
			keep(texts, id, String(params.message ?? ""));
			return id;
		},

		async edit(chatId, messageId, content) {
			const ref = parseSignalMessageId(messageId);
			if (!ref || ref.author !== self) return;
			const reply = typeof content === "string" ? { text: content } : content;
			const count = edits.get(messageId) ?? 0;
			const editable = !reply.files?.length && count < MAX_EDITS && Date.now() - ref.timestamp < EDIT_WINDOW_MS;
			if (editable) {
				try {
					await rpc("send", { ...target(chatId), ...body(reply), editTimestamp: ref.timestamp }, 60_000);
					keep(edits, messageId, count + 1);
					keep(texts, messageId, toSignalText(reply.text).text);
					return;
				} catch (err) {
					h.log("warn", `couldn't edit a Signal message, sending it again: ${errorMessage(err)}`);
				}
			}
			// Too old, edited too often, or with files: the new version goes out as a message of its own.
			await this.send(chatId, reply);
		},

		async remove(chatId, messageId) {
			const ref = parseSignalMessageId(messageId);
			if (!ref || ref.author !== self) return;
			await rpc("remoteDelete", { ...target(chatId), targetTimestamp: ref.timestamp });
		},

		async react(chatId, messageId, emoji) {
			const ref = parseSignalMessageId(messageId);
			if (!ref) throw new Error("That isn't a Signal message.");
			await rpc("sendReaction", {
				...target(chatId),
				emoji,
				targetAuthor: ref.author,
				targetTimestamp: ref.timestamp,
			});
		},

		async typing(chatId) {
			await rpc("sendTyping", target(chatId), 15_000).catch(() => {});
		},

		async idle(chatId) {
			await rpc("sendTyping", { ...target(chatId), stop: true }, 15_000).catch(() => {});
		},

		async canPost(chatId) {
			const c = parseSignalChat(chatId);
			if (c.kind === "dm") return c.self === self;
			if (groups.get(c.groupId)?.member) return true;
			await refreshGroups();
			return Boolean(groups.get(c.groupId)?.member);
		},

		async openDirect(userId) {
			const peer = userId.toLowerCase();
			return { chatId: signalDmChat(self, peer), name: `DM with ${names.get(peer) ?? "you"}` };
		},

		async groupMembers(chatId) {
			const c = parseSignalChat(chatId);
			if (c.kind !== "group") return [];
			const [g] = await rpc<GroupInfo[]>("listGroups", { groupId: [c.groupId] });
			return (g?.members ?? []).map((m) => m.uuid?.toLowerCase() ?? "").filter((id) => id && id !== self);
		},
	};
}
