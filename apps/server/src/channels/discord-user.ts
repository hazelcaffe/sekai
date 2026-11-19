import type { Channel } from "@sekai/shared";
import { errorMessage } from "../lib/errors.ts";
import { truncate } from "../lib/text.ts";
import { channelSecret } from "./state.ts";
import {
	type ChannelAdapter,
	type ChannelHandlers,
	type CommandSpec,
	download,
	type InboundMention,
	MAX_INBOUND_BYTES,
	type Reply,
} from "./types.ts";

/** Overridable for tests. */
export const endpoints = {
	api: "https://discord.com/api/v10",
	gateway: "wss://gateway.discord.gg/?v=10&encoding=json",
};

/**
 * The gateway Discord says to resume on, if it's really Discord's (a secure socket on discord.gg, or the gateway's
 * own host); anything else means a fresh connection to the usual gateway.
 */
function discordGateway(raw: string | undefined): string | null {
	if (!raw) return null;
	try {
		const url = new URL(raw);
		const usual = new URL(endpoints.gateway);
		const isDiscord =
			url.protocol === "wss:" && (url.hostname === "discord.gg" || url.hostname.endsWith(".discord.gg"));
		return isDiscord || url.host === usual.host ? `${url.protocol}//${url.host}` : null;
	} catch {
		return null;
	}
}

// Gateway opcodes and close codes we act on.
const OP = {
	dispatch: 0,
	heartbeat: 1,
	identify: 2,
	resume: 6,
	reconnect: 7,
	invalidSession: 9,
	hello: 10,
	heartbeatAck: 11,
} as const;
const FATAL_CLOSE = new Set([4004, 4010, 4011, 4013, 4014]);
/** The session can't be resumed (bad sequence, timed out): identify afresh next time. */
const FRESH_CLOSE = new Set([4007, 4009]);
/** DMs (1) and group DMs (3): the only chats the account listens in. */
const DIRECT = new Set([1, 3]);

interface ApiUser {
	id: string;
	username: string;
	global_name?: string | null;
	bot?: boolean;
}

interface ApiChannel {
	id: string;
	type: number; // 1 = DM, 3 = group DM
	name?: string | null;
	recipients?: ApiUser[];
}

interface ApiMessage {
	id: string;
	channel_id: string;
	type: number;
	content?: string;
	author?: ApiUser;
	mentions?: ApiUser[];
	mention_everyone?: boolean;
	message_reference?: { message_id?: string };
	referenced_message?: { author?: ApiUser } | null;
	attachments?: { id: string; filename: string; size: number; url: string; content_type?: string }[];
}

/** A REST call as the account (plain token, no Bot prefix). Throws with Discord's own message when it has one. */
async function api<T>(token: string, method: string, path: string, body?: unknown): Promise<T> {
	const res = await fetch(`${endpoints.api}${path}`, {
		method,
		headers: {
			authorization: token,
			...(body !== undefined ? { "content-type": "application/json" } : {}),
		},
		...(body !== undefined ? { body: JSON.stringify(body) } : {}),
	});
	if (res.status === 204) return undefined as T;
	const data = (await res.json().catch(() => null)) as
		| (T & { message?: string; errors?: { _errors?: { message?: string }[] } })
		| null;
	if (!res.ok) {
		const detail =
			data?.errors?._errors?.[0]?.message ??
			(typeof data?.message === "string" ? data.message : null) ??
			res.statusText;
		const err = new Error(detail) as Error & { status?: number };
		err.status = res.status;
		throw err;
	}
	return data as T;
}

/** Multipart POST, for messages with files. */
async function apiUpload<T>(
	token: string,
	path: string,
	payload: unknown,
	files: { name: string; data: Uint8Array }[],
): Promise<T> {
	const form = new FormData();
	form.set("payload_json", JSON.stringify(payload));
	files.forEach((f, i) => {
		form.set(`files[${i}]`, new Blob([f.data.buffer as ArrayBuffer]), f.name);
	});
	const res = await fetch(`${endpoints.api}${path}`, {
		method: "POST",
		headers: { authorization: token },
		body: form,
	});
	const data = (await res.json().catch(() => null)) as (T & { message?: string }) | null;
	if (!res.ok) {
		const err = new Error(data?.message ?? res.statusText) as Error & { status?: number };
		err.status = res.status;
		throw err;
	}
	return data as T;
}

/** Reject a bot-application token up front: it works for reads until Discord notices, then gets both banned. */
async function me(token: string): Promise<ApiUser> {
	const user = await api<ApiUser>(token, "GET", "/users/@me").catch((err: unknown) => {
		const e = err as { status?: number };
		if (e.status === 401)
			throw new Error("Discord rejected that token: it's wrong, expired, or the account was logged out");
		throw new Error(`Couldn't reach Discord: ${errorMessage(err)}`);
	});
	if (user.bot)
		throw new Error(
			"That's a bot application's token. Add it as a Discord bot channel instead; this is for a normal account.",
		);
	return user;
}

function dmName(ch: ApiChannel, selfId: string): string {
	const other = (ch.recipients ?? []).find((r) => r.id !== selfId) ?? ch.recipients?.[0];
	return `DM with ${other?.username ?? "unknown"}`;
}

function groupName(ch: ApiChannel, selfId: string): string {
	if (ch.name) return ch.name;
	const others = (ch.recipients ?? []).filter((r) => r.id !== selfId).map((r) => r.username);
	return `Group with ${others.slice(0, 3).join(", ")}${others.length > 3 ? ` +${others.length - 3}` : ""}`;
}

/**
 * A normal Discord account (no bot application): DMs and group chats arrive over the user gateway and the
 * agent's answers are sent as the account. There are no slash commands or buttons here; approvals arrive as
 * messages. Discord doesn't allow accounts to be used like this, so the account could get limited.
 */
export function discordUserAdapter(channel: Channel): ChannelAdapter {
	const token = channelSecret(channel, "userToken");
	let self: ApiUser | null = null;
	let ws: WebSocket | null = null;
	let stopped = true;
	let hbTimer: ReturnType<typeof setInterval> | null = null;
	let helloTimer: ReturnType<typeof setTimeout> | null = null;
	let resumeTimer: ReturnType<typeof setTimeout> | null = null;
	let seq: number | null = null;
	let sessionId: string | null = null;
	let resumeUrl: string | null = null;
	let acked = true;
	/** Reconnects in a row without a READY/RESUMED: each waits longer (4 s up to 5 min). */
	let retries = 0;
	const dms = new Map<string, ApiChannel>();
	/** Channels known not to be DMs (server channels), so their messages don't cost a lookup each time. */
	const notDirect = new Set<string>();
	const forgetSession = () => {
		sessionId = null;
		resumeUrl = null;
		seq = null;
	};

	const send2 = (op: number, d: unknown) => {
		try {
			ws?.send(JSON.stringify({ op, d }));
		} catch {}
	};

	function clearTimers() {
		if (hbTimer) clearInterval(hbTimer);
		if (helloTimer) clearTimeout(helloTimer);
		if (resumeTimer) clearTimeout(resumeTimer);
		hbTimer = helloTimer = resumeTimer = null;
	}

	async function onDispatch(h: ChannelHandlers, t: string, d: unknown): Promise<void> {
		if (t === "RESUMED") {
			retries = 0;
			return;
		}
		if (t === "READY") {
			const r = d as {
				user: ApiUser;
				session_id: string;
				resume_gateway_url?: string;
				private_channels?: ApiChannel[];
			};
			self = r.user;
			sessionId = r.session_id;
			resumeUrl = discordGateway(r.resume_gateway_url);
			retries = 0;
			dms.clear();
			for (const ch of r.private_channels ?? []) dms.set(ch.id, ch);
			return;
		}
		if (t === "CHANNEL_CREATE" || t === "CHANNEL_UPDATE") {
			const ch = d as ApiChannel;
			if (ch.type === 1 || ch.type === 3) dms.set(ch.id, ch);
			return;
		}
		if (t === "CHANNEL_DELETE") {
			dms.delete((d as { id: string }).id);
			return;
		}
		if (t !== "MESSAGE_CREATE") return;
		const m = d as ApiMessage & { guild_id?: string };
		const meUser = self;
		// Plain messages and replies (type 19); not joins, pins, calls…
		if (!meUser || !m.author || m.author.id === meUser.id || (m.type !== 0 && m.type !== 19)) return;
		// Group chats and DMs only: servers stay browsable by hand, the account doesn't live-listen there.
		if (m.guild_id || notDirect.has(m.channel_id)) return;
		let ch = dms.get(m.channel_id);
		if (!ch) {
			ch = await api<ApiChannel>(token, "GET", `/channels/${m.channel_id}`).catch(() => undefined);
			if (!ch) return;
			if (!DIRECT.has(ch.type)) {
				notDirect.add(ch.id);
				return;
			}
			dms.set(ch.id, ch);
		}
		const isGroup = ch.type === 3;
		const mentions: InboundMention[] = (m.mentions ?? []).map((u) => ({
			id: u.id,
			name: u.global_name ?? u.username,
			bot: u.bot ?? false,
			tokens: [`<@${u.id}>`, `<@!${u.id}>`],
		}));
		// Fetched only after the manager has checked who's asking.
		const files = (m.attachments ?? [])
			.filter((a) => a.size <= MAX_INBOUND_BYTES)
			.map((a) => ({
				name: a.filename,
				mime: a.content_type ?? "application/octet-stream",
				load: () => download(a.url),
			}));
		await h.onMessage({
			chatId: m.channel_id,
			chatName: isGroup ? groupName(ch, meUser.id) : dmName(ch, meUser.id),
			isGroup,
			serverId: null,
			senderId: m.author.id,
			senderName: m.author.global_name ?? m.author.username,
			senderIsBot: m.author.bot ?? false,
			text: m.content ?? "",
			messageId: m.id,
			replyToId: m.message_reference?.message_id ?? null,
			addressed: true,
			everyone: m.mention_everyone ?? false,
			mentions,
			attachments: files,
		});
	}

	function identify(): void {
		send2(OP.identify, {
			token,
			intents: (1 << 0) | (1 << 12), // GUILDS (chat names) + DIRECT_MESSAGES
			properties: { os: "Windows", browser: "Chrome", device: "" },
		});
	}

	function connect(h: ChannelHandlers): void {
		const url = sessionId && resumeUrl ? `${resumeUrl.replace(/\/$/, "")}/?v=10&encoding=json` : endpoints.gateway;
		const socket = new WebSocket(url);
		ws = socket;
		// No HELLO within 20 s: the socket is useless; close it and try again.
		helloTimer = setTimeout(() => socket.close(4000), 20_000);
		socket.onmessage = (ev) => {
			let p: { op: number; t?: string; s?: number; d?: unknown };
			try {
				p = JSON.parse(String(ev.data)) as typeof p;
			} catch {
				return;
			}
			if (typeof p.s === "number") seq = p.s;
			if (p.op === OP.hello) {
				// Discord's own number, kept within sane bounds.
				const asked = Number((p.d as { heartbeat_interval: number }).heartbeat_interval);
				const interval = Math.min(Math.max(Number.isFinite(asked) ? asked : 41_250, 5_000), 120_000);
				if (helloTimer) clearTimeout(helloTimer);
				helloTimer = null;
				acked = true;
				if (hbTimer) clearInterval(hbTimer);
				hbTimer = setInterval(() => {
					if (!acked) {
						// Missed an ack: the connection is dead; reconnect with the session.
						socket.close(4000);
						return;
					}
					acked = false;
					send2(OP.heartbeat, seq);
				}, interval);
				if (sessionId) send2(OP.resume, { token, session_id: sessionId, seq });
				else identify();
				return;
			}
			if (p.op === OP.invalidSession) {
				// The session is gone (resumable: d === true, rare for us): start a new one after a short pause.
				forgetSession();
				resumeTimer = setTimeout(
					() => {
						if (ws === socket && !stopped) identify();
					},
					1000 + Math.random() * 4000,
				);
				return;
			}
			if (p.op === OP.heartbeatAck) {
				acked = true;
				return;
			}
			if (p.op === OP.heartbeat) {
				send2(OP.heartbeat, seq);
				return;
			}
			if (p.op === OP.reconnect) {
				socket.close(4000);
				return;
			}
			if (p.op === OP.dispatch && p.t) {
				onDispatch(h, p.t, p.d).catch((err: unknown) => h.log("warn", `discord account: ${errorMessage(err)}`));
			}
		};
		socket.onclose = (ev) => {
			if (ws !== socket) return;
			ws = null;
			clearTimers();
			if (stopped) return;
			if (FATAL_CLOSE.has(ev.code)) {
				stopped = true;
				h.onFatal(new Error("Discord rejected the account token (log in again with a fresh one)"));
				return;
			}
			if (FRESH_CLOSE.has(ev.code)) forgetSession();
			// Back off while it keeps failing (a long outage, Discord unhappy), so it never storms.
			const wait = Math.min(300_000, 4000 * 2 ** Math.min(retries, 7));
			retries++;
			resumeTimer = setTimeout(() => {
				if (!stopped) connect(h);
			}, wait);
		};
		socket.onerror = () => {
			socket.close();
		};
	}

	function renderBody(
		content: string | Reply,
		replyTo?: string | null,
	): { payload: Record<string, unknown>; files: { name: string; data: Uint8Array }[] } {
		const payload: Record<string, unknown> = { allowed_mentions: { parse: [] } };
		if (replyTo) payload.message_reference = { message_id: replyTo, fail_if_not_exists: false };
		if (typeof content === "string") {
			payload.content = truncate(content, 1900);
			return { payload, files: [] };
		}
		payload.content = truncate(content.text || "\u200b", 1900);
		return { payload, files: (content.files ?? []).map((f) => ({ name: f.name, data: f.data })) };
	}

	return {
		maxText: 1900,
		mention: (userId) => `<@${userId}>`,
		subtext: (text) =>
			text
				.split("\n")
				.map((l) => (l.trim() ? `-# ${l}` : l))
				.join("\n"),

		async start(_h: ChannelHandlers) {
			if (!token) throw new Error("Add the account token first");
			stopped = false;
			const user = await me(token);
			// Stopped while signing in (the channel was changed or turned off): don't open a stray gateway.
			if (stopped) throw new Error("Stopped");
			self = user;
			retries = 0;
			connect(_h);
			return {
				botId: user.id,
				botName: user.global_name ? `${user.global_name} (@${user.username})` : `@${user.username}`,
				inviteUrl: null,
				readsAll: true,
			};
		},

		async stop() {
			stopped = true;
			clearTimers();
			const socket = ws;
			ws = null;
			socket?.close();
			forgetSession();
		},

		// User accounts have no application commands; the manager skips this when it throws.
		async registerCommands(_commands: CommandSpec[]) {
			throw new Error("personal accounts have no commands");
		},

		async send(chatId, content, opts) {
			const { payload, files } = renderBody(content, opts?.replyTo);
			const sent = files.length
				? await apiUpload<ApiMessage>(token, `/channels/${chatId}/messages`, payload, files)
				: await api<ApiMessage>(token, "POST", `/channels/${chatId}/messages`, payload);
			return sent.id;
		},

		async edit(chatId, messageId, content) {
			if (typeof content !== "string" && content.files?.length) {
				// Discord can't attach files on edit; replace the message instead.
				await api(token, "DELETE", `/channels/${chatId}/messages/${messageId}`).catch(() => {});
				await this.send(chatId, content);
				return;
			}
			await api(token, "PATCH", `/channels/${chatId}/messages/${messageId}`, {
				content: truncate(typeof content === "string" ? content : content.text || "\u200b", 1900),
			});
		},

		async remove(chatId, messageId) {
			await api(token, "DELETE", `/channels/${chatId}/messages/${messageId}`);
		},

		async react(chatId, messageId, emoji) {
			await api(
				token,
				"PUT",
				`/channels/${chatId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`,
			);
		},

		async typing(chatId) {
			await api(token, "POST", `/channels/${chatId}/typing`).catch(() => {});
		},

		async canPost(chatId) {
			const ch =
				dms.get(chatId) ?? (await api<ApiChannel>(token, "GET", `/channels/${chatId}`).catch(() => null));
			return ch?.type === 1 || ch?.type === 3;
		},

		async openDirect(userId) {
			const ch = await api<ApiChannel>(token, "POST", "/users/@me/channels", { recipient_id: userId });
			dms.set(ch.id, ch);
			return { chatId: ch.id, name: self ? dmName(ch, self.id) : `DM with ${userId}` };
		},

		async groupMembers(chatId) {
			const ch =
				dms.get(chatId) ?? (await api<ApiChannel>(token, "GET", `/channels/${chatId}`).catch(() => null));
			return (ch?.recipients ?? []).map((r) => r.id).filter(Boolean);
		},
	};
}
