import { type Channel, slackDmThreads } from "@sekai/shared";
import { errorMessage } from "../lib/errors.ts";
import { guardedFetch } from "../lib/net.ts";
import { truncate } from "../lib/text.ts";
import { COMMANDS } from "./commands.ts";
import { chunkText } from "./format.ts";
import { parseTextCommand } from "./render.ts";
import { fromSlack, slackChat, slackMrkdwn, slackRef } from "./slack-format.ts";
import { channelSecret } from "./state.ts";
import {
	type ChannelAdapter,
	type ChannelHandlers,
	type ChatRef,
	download,
	type InboundMention,
	MAX_INBOUND_BYTES,
	type Reply,
} from "./types.ts";

/** What the adapter talks to, swappable so tests run against a fake Slack. Not channel configuration. */
export interface SlackTransport {
	api?: string;
	fetch?: typeof fetch;
	/** Requests to addresses Slack hands out (response URLs, file uploads), guarded like any outside address. */
	http?: typeof guardedFetch;
	download?: typeof download;
	socket?: (url: string) => WebSocket;
	reconnectMs?: number;
	/** Gap between two posts in one Slack channel (Slack allows about one a second). */
	postMs?: number;
	/** How often the socket is checked; three checks without an answer and it's replaced. */
	pingMs?: number;
}

interface SlackUser {
	id: string;
	name?: string;
	real_name?: string;
	is_bot?: boolean;
	profile?: { display_name?: string; real_name?: string };
}
interface SlackChannel {
	id: string;
	name?: string;
	is_im?: boolean;
	is_mpim?: boolean;
	is_member?: boolean;
	is_archived?: boolean;
}
interface SlackEvent {
	type: string;
	subtype?: string;
	hidden?: boolean;
	user?: string;
	bot_id?: string;
	text?: string;
	ts?: string;
	thread_ts?: string;
	channel?: string;
	channel_type?: string;
	files?: { name?: string; mimetype?: string; size?: number; url_private_download?: string; url_private?: string }[];
}
interface Interactive {
	type?: string;
	team?: { id: string };
	team_id?: string;
	user?: { id: string };
	user_id?: string;
	channel?: { id: string };
	channel_id?: string;
	text?: string;
	response_url?: string;
	message?: { ts?: string; thread_ts?: string };
	container?: { message_ts?: string; thread_ts?: string; is_ephemeral?: boolean };
	actions?: { action_id: string; selected_option?: { value: string }; selected_options?: { value: string }[] }[];
}
interface Envelope {
	type: string;
	envelope_id?: string;
	num_connections?: number;
	connection_info?: { app_id?: string };
	reason?: string;
	payload?: Interactive & { event?: SlackEvent; event_id?: string };
}

/** A Web API call Slack refused, with its error code (never the response body: it can hold credentials). */
export class SlackApiError extends Error {
	constructor(
		readonly method: string,
		readonly code: string,
	) {
		super(`Slack ${method}: ${code}`);
	}
}

/** Errors that mean the tokens won't work until someone changes them. */
const FATAL = new Set([
	"invalid_auth",
	"not_authed",
	"token_revoked",
	"token_expired",
	"account_inactive",
	"not_allowed_token_type",
	"missing_scope",
]);
/** Message kinds that are someone writing (not edits, deletions, joins or the bot's own posts). */
const WRITTEN = new Set(["file_share", "thread_broadcast", "bot_message"]);
/** Where Slack keeps files and response URLs: the bot token only ever goes to these. */
const FILE_HOSTS = new Set(["files.slack.com", "files.slack-gov.com"]);
const HOOK_HOSTS = new Set(["hooks.slack.com", "hooks.slack-gov.com"]);
const EMOJI: Record<string, string> = {
	"👍": "thumbsup",
	"🆕": "new",
	"⏹️": "stop_button",
	"🔁": "repeat",
	"🧽": "sponge",
	"✅": "white_check_mark",
};

const plain = (text: string) => ({ type: "plain_text", text: truncate(text, 75) || "…", emoji: true });

/** Block Kit only for controls; the text is always there too (notifications, screen readers, old clients). */
export function slackReply(content: string | Reply): Record<string, unknown> {
	const reply = typeof content === "string" ? { text: content } : content;
	const text = slackMrkdwn(reply.text || (reply.files?.length ? "File" : "…"));
	const controls: Record<string, unknown>[] = (reply.buttons ?? []).map((b) => ({
		type: "button",
		text: plain(b.label),
		action_id: b.id,
		...(b.url ? { url: b.url } : { value: b.id }),
		...(b.style === "danger"
			? { style: "danger" }
			: b.style === "success" || b.style === "primary"
				? { style: "primary" }
				: {}),
	}));
	if (reply.select?.options.length) {
		const s = reply.select;
		const many = (s.max ?? 1) > 1;
		controls.unshift({
			type: many ? "multi_static_select" : "static_select",
			action_id: s.id,
			placeholder: plain(s.placeholder),
			options: s.options.slice(0, 100).map((o) => ({ text: plain(o.label), value: o.value.slice(0, 150) })),
			...(many ? { min_selected_items: s.min ?? 1, max_selected_items: s.max } : {}),
		});
	}
	return {
		text,
		mrkdwn: true,
		unfurl_links: false,
		unfurl_media: false,
		// An empty list also takes old buttons off when an approval or menu is answered.
		blocks: controls.length
			? [
					...chunkText(text, 2900).map((part) => ({ type: "section", text: { type: "mrkdwn", text: part } })),
					{ type: "actions", elements: controls.slice(0, 25) },
				]
			: [],
	};
}

const pause = (ms: number, signal: AbortSignal) =>
	new Promise<void>((resolve, reject) => {
		if (signal.aborted) return reject(new Error("Slack connection stopped."));
		const timer = setTimeout(() => {
			signal.removeEventListener("abort", stop);
			resolve();
		}, ms);
		const stop = () => {
			clearTimeout(timer);
			reject(new Error("Slack connection stopped."));
		};
		signal.addEventListener("abort", stop, { once: true });
	});

/**
 * One Slack app per Sekai bot: a real bot user, connected out over Socket Mode (no public address needed) and
 * talking through the Web API. Every top-level message starts a thread, and each thread is its own chat; DMs can
 * be one ongoing chat instead (slackDmThreads).
 */
export function slackAdapter(channel: Channel, transport: SlackTransport = {}): ChannelAdapter {
	const botToken = channelSecret(channel, "botToken");
	const appToken = channelSecret(channel, "appToken");
	const dmThreads = slackDmThreads(channel);
	const apiBase = transport.api ?? "https://slack.com/api";
	const request = transport.fetch ?? fetch;
	const http = transport.http ?? guardedFetch;
	const fetchFile = transport.download ?? download;
	const pingMs = transport.pingMs ?? 30_000;
	let h: ChannelHandlers;
	let team = "";
	let botId = "";
	let expectedAppId = "";
	let appId = "";
	/** The socket in use; others are closing, or a replacement still waiting for Slack's hello. */
	let ws: WebSocket | null = null;
	const sockets = new Set<WebSocket>();
	let stopped = true;
	let controller = new AbortController();
	let retry: ReturnType<typeof setTimeout> | undefined;
	let pinger: ReturnType<typeof setInterval> | undefined;
	let lastHeard = 0;
	let attempts = 0;
	let connecting: Promise<void> | null = null;
	const users = new Map<string, SlackUser>();
	const chats = new Map<string, SlackChannel>();
	const seen = new Map<string, number>();
	const progress = new Map<string, { at: number; reaction?: string; native?: boolean }>();
	const latest = new Map<string, string>();
	/** Posts wait their turn per Slack channel; incoming messages per thread (others go on meanwhile). */
	const posting = new Map<string, Promise<unknown>>();
	const postedAt = new Map<string, number>();
	const lanes = new Map<string, Promise<void>>();

	async function api<T>(method: string, body: Record<string, unknown> = {}, token = botToken): Promise<T> {
		for (let attempt = 0; attempt < 5; attempt++) {
			const res = await request(`${apiBase}/${method}`, {
				method: "POST",
				headers: { authorization: `Bearer ${token}`, "content-type": "application/x-www-form-urlencoded" },
				// Some read methods ignore JSON bodies; form encoding works across the Web API.
				body: new URLSearchParams(
					Object.entries(body)
						.filter(([, v]) => v !== undefined)
						.map(([k, v]): [string, string] => [k, typeof v === "object" ? JSON.stringify(v) : String(v)]),
				),
				signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]),
				redirect: "error",
			});
			// Rate limited (Retry-After says how long), or Slack itself is having trouble: wait and try again.
			if (res.status === 429 || res.status >= 500) {
				const wait = res.status === 429 ? Number(res.headers.get("retry-after")) || 1 : attempt + 1;
				await res.body?.cancel();
				await pause(Math.max(1, wait) * 1000, controller.signal);
				continue;
			}
			const data = (await res.json().catch(() => null)) as ({ ok: boolean; error?: string } & T) | null;
			if (!res.ok || !data?.ok) {
				const code = data?.error ?? `http_${res.status}`;
				throw new SlackApiError(method, /^[a-z0-9_]+$/.test(code) ? code : "request_failed");
			}
			return data;
		}
		throw new Error(`Slack ${method} is busy. Try again in a moment.`);
	}

	async function user(id: string): Promise<SlackUser> {
		const hit = users.get(id);
		if (hit) return hit;
		const data = await api<{ user: SlackUser }>("users.info", { user: id }).catch(() => ({ user: { id } }));
		if (users.size > 1000) users.clear();
		users.set(id, data.user);
		return data.user;
	}
	const name = (u: SlackUser) => u.profile?.display_name || u.profile?.real_name || u.real_name || u.name || u.id;
	async function chat(id: string): Promise<SlackChannel> {
		const hit = chats.get(id);
		if (hit) return hit;
		const data = await api<{ channel: SlackChannel }>("conversations.info", { channel: id });
		if (chats.size > 1000) chats.clear();
		chats.set(id, data.channel);
		return data.channel;
	}
	function ref(chatId: string) {
		const r = slackRef(chatId);
		if (r.team !== team) throw new Error("That Slack chat belongs to another workspace.");
		return r;
	}
	/** A chat for a channel or DM, or one thread in it. A new thread is named after its first words. */
	async function chatRef(channelId: string, userId: string, thread?: string, opening?: string): Promise<ChatRef> {
		const [c, u] = await Promise.all([chat(channelId), user(userId)]);
		const where = c.is_im ? `DM with ${name(u)}` : `#${c.name || channelId}`;
		const words = opening?.replace(/\s+/g, " ").trim();
		return {
			chatId: slackChat(team, channelId, thread),
			chatName: thread ? (words ? `${where}: ${truncate(words, 40)}` : `${where} (thread)`) : where,
			isGroup: !c.is_im,
			serverId: c.is_im ? null : team,
			senderId: userId,
			senderName: name(u),
		};
	}
	/** Whether this is the first time we see a key (Slack can deliver the same thing twice). */
	function remember(key: string): boolean {
		if (seen.has(key)) return false;
		seen.set(key, Date.now());
		if (seen.size > 5000) seen.delete(seen.keys().next().value ?? "");
		return true;
	}
	/** The thread a message belongs to: its own for a new one, none for a DM kept as one chat. */
	function threadOf(event: SlackEvent): string | undefined {
		if (event.thread_ts) return event.thread_ts;
		const dm = event.channel_type === "im" || Boolean(event.channel?.startsWith("D"));
		return dm && !dmThreads ? undefined : event.ts;
	}
	/** Runs work for one thread after the work before it there, while other threads go on. */
	function inLane(key: string, fn: () => Promise<void>): Promise<void> {
		const task = (lanes.get(key) ?? Promise.resolve()).then(() => (stopped ? undefined : fn()));
		const tail = task.catch(() => {});
		lanes.set(key, tail);
		void tail.then(() => {
			if (lanes.get(key) === tail) lanes.delete(key);
		});
		return task;
	}

	/** A private Slack file, with the bot token, only from Slack's file host and without following redirects. */
	function file(url: string): Promise<Uint8Array | null> {
		const target = URL.canParse(url) ? new URL(url) : null;
		if (target?.protocol !== "https:" || !FILE_HOSTS.has(target.hostname)) return Promise.resolve(null);
		return fetchFile(target, {
			headers: { authorization: `Bearer ${botToken}` },
			maxRedirects: 0,
			signal: controller.signal,
		});
	}

	async function message(event: SlackEvent) {
		if (!event.channel || !event.ts || !event.user || event.user === botId || event.hidden) return;
		if (event.subtype && !WRITTEN.has(event.subtype)) return;
		// The message and app_mention subscriptions both deliver a message that mentions the bot.
		if (!remember(`message:${event.channel}:${event.ts}`)) return;
		const thread = threadOf(event);
		const text = event.text ?? "";
		const ids = [
			...new Set([...text.matchAll(/<@([A-Z0-9]+)(?:\|[^>]+)?>/g)].flatMap((m) => (m[1] ? [m[1]] : []))),
		];
		const mentions: InboundMention[] = await Promise.all(
			ids.map(async (id) => {
				const u = await user(id);
				return {
					id,
					name: name(u),
					bot: u.is_bot ?? false,
					tokens: [...text.matchAll(new RegExp(`<@${id}(?:\\|[^>]+)?>`, "g"))].map((m) => m[0]),
				};
			}),
		);
		let opening = fromSlack(text);
		for (const m of mentions) for (const t of m.tokens) opening = opening.split(t).join(`@${m.name}`);
		const r = await chatRef(event.channel, event.user, thread, thread === event.ts ? opening : undefined);
		const everyone = /<!(?:here|channel|everyone)>/.test(text);
		latest.set(r.chatId, event.ts);
		if (latest.size > 5000) latest.delete(latest.keys().next().value ?? "");
		await h.onMessage({
			...r,
			parentChatId: slackChat(team, event.channel),
			threadReply: Boolean(event.thread_ts && event.thread_ts !== event.ts),
			senderIsBot: Boolean(event.bot_id || (await user(event.user)).is_bot),
			text: fromSlack(text),
			messageId: event.ts,
			replyToId: event.thread_ts && event.thread_ts !== event.ts ? event.thread_ts : null,
			addressed: !r.isGroup || mentions.some((m) => m.id === botId) || everyone,
			everyone,
			mentions,
			attachments: (event.files ?? [])
				.filter((f) => (f.size ?? 0) <= MAX_INBOUND_BYTES && (f.url_private_download || f.url_private))
				.map((f) => ({
					name: f.name ?? "Slack file",
					mime: f.mimetype ?? "application/octet-stream",
					load: () => file(f.url_private_download ?? f.url_private ?? ""),
				})),
		});
	}

	/** An answer through a response URL (slash commands, ephemeral messages), which only Slack hands out. */
	async function respond(url: string | undefined, content: Record<string, unknown>) {
		const target = url && URL.canParse(url) ? new URL(url) : null;
		if (target?.protocol !== "https:" || !HOOK_HOSTS.has(target.hostname)) return;
		const res = await http(target, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(content),
			maxRedirects: 0,
			signal: controller.signal,
		});
		await res.body?.cancel().catch(() => {});
	}

	async function interaction(p: Interactive, command: boolean) {
		const c = p.channel_id ?? p.channel?.id;
		const u = p.user_id ?? p.user?.id;
		if (!c || !u || (p.team_id ?? p.team?.id) !== team) return;
		const r = await chatRef(c, u, command ? undefined : (p.message?.thread_ts ?? p.container?.thread_ts));
		if (command) {
			// Slack's slash commands arrive as "/sekai-name-abc text": the text is the command.
			const raw = (p.text ?? "").trim().replace(/^reset(?=\s|$)/, "new");
			const parsed = parseTextCommand(`/${raw || "help"}`, COMMANDS);
			const reply = parsed
				? await h.onCommand({ ...r, ...parsed, targetMessageId: null })
				: { text: "I don't know that command. Try help." };
			await respond(p.response_url, { ...slackReply(reply), response_type: "ephemeral" });
			return;
		}
		if (p.type !== "block_actions") return;
		const ts = p.message?.ts ?? p.container?.message_ts;
		if (!ts) return;
		for (const a of p.actions ?? []) {
			const result = await h.onAction({
				...r,
				id: a.action_id,
				values: a.selected_options?.map((o) => o.value) ?? (a.selected_option ? [a.selected_option.value] : []),
				messageId: ts,
			});
			if (result.update) {
				if (p.container?.is_ephemeral)
					await respond(p.response_url, {
						...slackReply(result.update),
						replace_original: true,
						response_type: "ephemeral",
					});
				else await api("chat.update", { channel: c, ts, ...slackReply(result.update) });
			}
			if (result.whisper)
				await api("chat.postEphemeral", {
					channel: c,
					user: u,
					text: slackMrkdwn(result.whisper),
					...(p.message?.thread_ts ? { thread_ts: p.message.thread_ts } : {}),
				});
		}
	}

	function onEnvelope(socket: WebSocket, envelope: Envelope): void {
		const p = envelope.payload;
		if (!p) return;
		if (envelope.envelope_id && !remember(`envelope:${envelope.envelope_id}`)) return;
		// Slack retries an event it thinks went missing under a new envelope, with the same event id.
		if (p.event_id && !remember(`event:${p.event_id}`)) return;
		let task: Promise<void> | undefined;
		if (envelope.type === "events_api" && p.team_id === team && p.event) {
			const event = p.event;
			if (event.type === "tokens_revoked" || event.type === "app_uninstalled") {
				h.onFatal(new Error("Slack took this app's access away. Reinstall it and update its tokens."));
				socket.close();
				return;
			}
			if ((event.type === "message" || event.type === "app_mention") && event.channel) {
				task = inLane(`${event.channel}:${threadOf(event) ?? ""}`, () => message(event));
			}
		} else if (envelope.type === "slash_commands" || envelope.type === "interactive") {
			task = interaction(p, envelope.type === "slash_commands");
		}
		void task?.catch((err: unknown) =>
			h.log("warn", `A Slack message or button couldn't be handled: ${errorMessage(err)}`),
		);
	}

	function reconnect(immediate = false) {
		if (stopped || retry) return;
		const delay = immediate ? 0 : Math.min((transport.reconnectMs ?? 1000) * 2 ** attempts++, 60_000);
		retry = setTimeout(() => {
			retry = undefined;
			void connect().catch((err: unknown) => {
				if (stopped) return;
				if ((err instanceof SlackApiError && FATAL.has(err.code)) || /different apps/.test(errorMessage(err)))
					h.onFatal(err);
				else {
					h.log("warn", `Slack connection interrupted (${errorMessage(err)}); reconnecting.`);
					reconnect();
				}
			});
		}, delay);
	}

	function connect(): Promise<void> {
		connecting ??= connectNow().finally(() => {
			connecting = null;
		});
		return connecting;
	}

	/** A dead connection (no answer to pings) is replaced; Slack's own refreshes come as disconnect messages. */
	function watch(socket: WebSocket) {
		clearInterval(pinger);
		lastHeard = Date.now();
		pinger = setInterval(() => {
			if (ws !== socket) return;
			if (Date.now() - lastHeard > pingMs * 3) {
				h.log("warn", "Slack stopped answering; reconnecting.");
				reconnect(true);
				socket.close();
				return;
			}
			try {
				socket.ping();
			} catch {}
		}, pingMs);
	}

	async function connectNow(): Promise<void> {
		const data = await api<{ url: string }>("apps.connections.open", {}, appToken);
		const url = new URL(data.url);
		if (!transport.socket && (url.protocol !== "wss:" || !url.hostname.endsWith(".slack.com")))
			throw new Error("Slack returned an unexpected socket address.");
		if (stopped) return;
		const socket = transport.socket ? transport.socket(url.toString()) : new WebSocket(url);
		sockets.add(socket);
		await new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => {
				socket.close();
				reject(new Error("Timed out connecting to Slack."));
			}, 30_000);
			const abort = () => {
				clearTimeout(timer);
				socket.close();
				reject(new Error("Slack connection stopped."));
			};
			controller.signal.addEventListener("abort", abort, { once: true });
			const settled = () => {
				clearTimeout(timer);
				controller.signal.removeEventListener("abort", abort);
			};
			socket.addEventListener("pong", () => {
				if (ws === socket) lastHeard = Date.now();
			});
			socket.onmessage = (event) => {
				if (ws === socket) lastHeard = Date.now();
				let envelope: Envelope;
				try {
					envelope = JSON.parse(String(event.data)) as Envelope;
				} catch {
					return;
				}
				// Acknowledge first, before any lookups or database work: Slack retries what isn't acknowledged in time.
				if (envelope.envelope_id) socket.send(JSON.stringify({ envelope_id: envelope.envelope_id }));
				if (envelope.type === "hello") {
					appId = envelope.connection_info?.app_id ?? "";
					settled();
					if (expectedAppId && appId !== expectedAppId) {
						socket.close();
						reject(new Error("Slack's two tokens belong to different apps. Copy both from the same app."));
						return;
					}
					attempts = 0;
					ws = socket;
					watch(socket);
					// Only now is the new connection live: the one it replaces can go.
					for (const previous of sockets) if (previous !== socket) previous.close();
					if ((envelope.num_connections ?? 1) > 1)
						h.log(
							"warn",
							"This Slack app has another Socket Mode connection. Run only one Sekai for it, or events may go to the other one.",
						);
					resolve();
					return;
				}
				if (envelope.type === "disconnect") {
					if (envelope.reason === "link_disabled") {
						settled();
						const err = new Error(
							"Socket Mode is off for this Slack app. Turn it on in the app's settings.",
						);
						reject(err);
						h.onFatal(err);
					} else if (ws === socket) {
						// "warning" or "refresh_requested": connect again now, and drop this one once the new one is up.
						reconnect(true);
					}
					return;
				}
				onEnvelope(socket, envelope);
			};
			socket.onerror = () => {
				settled();
				reject(new Error("Couldn't connect to Slack."));
			};
			socket.onclose = () => {
				sockets.delete(socket);
				settled();
				reject(new Error("Slack closed the connection."));
				if (ws === socket) {
					ws = null;
					reconnect();
				}
			};
		});
	}

	async function idle(chatId: string) {
		const active = progress.get(chatId);
		if (!active) return;
		progress.delete(chatId);
		const r = ref(chatId);
		if (active.native && r.thread)
			await api("assistant.threads.setStatus", { channel_id: r.channel, thread_ts: r.thread, status: "" }).catch(
				() => {},
			);
		if (active.reaction)
			await api("reactions.remove", {
				channel: r.channel,
				timestamp: active.reaction,
				name: "thinking_face",
			}).catch(() => {});
	}

	async function upload(chatId: string, f: NonNullable<Reply["files"]>[number]) {
		const r = ref(chatId);
		const target = await api<{ upload_url: string; file_id: string }>("files.getUploadURLExternal", {
			filename: f.name,
			length: f.data.byteLength,
		});
		const url = new URL(target.upload_url);
		if (!transport.http && (url.protocol !== "https:" || !FILE_HOSTS.has(url.hostname)))
			throw new Error("Slack returned an unexpected upload address.");
		const res = await http(url, {
			method: "POST",
			body: new Blob([f.data]),
			maxRedirects: 0,
			signal: controller.signal,
		});
		await res.body?.cancel().catch(() => {});
		if (!res.ok) throw new Error("Slack couldn't take that file.");
		await api("files.completeUploadExternal", {
			files: [{ id: target.file_id, title: f.name }],
			channel_id: r.channel,
			...(r.thread ? { thread_ts: r.thread } : {}),
		});
		return `file:${target.file_id}`;
	}

	return {
		// Slack advises keeping messages under 4,000 characters (it truncates far longer ones).
		maxText: 3900,
		threads: dmThreads,
		help: {
			intro: dmThreads
				? "**Talk to me** in my Messages tab, or mention me in a channel I'm in. Each thread is its own chat: reply in it to go on."
				: "**Talk to me** in my Messages tab, where we keep one ongoing chat (/new starts fresh), or mention me in a channel I'm in, where each thread is its own chat.",
			tips: "My Slack command (see me in Sekai) takes status, new, stop, model or help. In a thread, mention me and type the command: @me /status.",
		},
		mention: (id) => `<@${id}>`,
		subtext: (text) => text,
		async start(handlers) {
			h = handlers;
			if (!botToken.startsWith("xoxb-") || !appToken.startsWith("xapp-"))
				throw new Error("Add the Slack app's bot token (xoxb-…) and app-level token (xapp-…).");
			stopped = false;
			controller = new AbortController();
			const me = await api<{ team_id: string; team: string; user_id: string; user: string; bot_id: string }>(
				"auth.test",
			);
			team = me.team_id;
			botId = me.user_id;
			expectedAppId = (await api<{ bot: { app_id: string } }>("bots.info", { bot: me.bot_id })).bot.app_id;
			await connect();
			return {
				botId,
				botName: `${me.user} · ${me.team}`,
				workspaceId: team,
				workspaceName: me.team,
				appId,
				inviteUrl: null,
				readsAll: true,
			};
		},
		async stop() {
			stopped = true;
			clearTimeout(retry);
			retry = undefined;
			clearInterval(pinger);
			controller.abort();
			for (const socket of sockets) socket.close();
			sockets.clear();
			ws = null;
			progress.clear();
		},
		// Slack takes commands from the app's manifest, not at runtime.
		registerCommands: async () => {},
		async send(chatId, content) {
			const r = ref(chatId);
			const task = (posting.get(r.channel) ?? Promise.resolve())
				.catch(() => {})
				.then(async () => {
					const wait = (postedAt.get(r.channel) ?? 0) + (transport.postMs ?? 1100) - Date.now();
					if (wait > 0) await pause(wait, controller.signal);
					let id = "";
					if (typeof content === "string" || content.text.trim() || !content.files?.length) {
						const sent = await api<{ ts: string }>("chat.postMessage", {
							channel: r.channel,
							...slackReply(content),
							...(r.thread ? { thread_ts: r.thread } : {}),
						});
						id = sent.ts;
					}
					if (typeof content !== "string")
						for (const f of content.files ?? []) {
							const uploaded = await upload(chatId, f);
							id ||= uploaded;
						}
					postedAt.set(r.channel, Date.now());
					await idle(chatId);
					return id;
				});
			posting.set(r.channel, task);
			try {
				return await task;
			} finally {
				if (posting.get(r.channel) === task) posting.delete(r.channel);
			}
		},
		async edit(chatId, messageId, content) {
			const r = ref(chatId);
			if (!messageId.startsWith("file:"))
				await api("chat.update", { channel: r.channel, ts: messageId, ...slackReply(content) });
		},
		async remove(chatId, messageId) {
			const r = ref(chatId);
			if (messageId.startsWith("file:")) await api("files.delete", { file: messageId.slice(5) });
			else await api("chat.delete", { channel: r.channel, ts: messageId });
		},
		async react(chatId, messageId, emoji) {
			const r = ref(chatId);
			await api("reactions.add", {
				channel: r.channel,
				timestamp: messageId,
				name: EMOJI[emoji] ?? emoji.replace(/^:|:$/g, ""),
			});
		},
		async typing(chatId) {
			const r = ref(chatId);
			const active = progress.get(chatId);
			if (active && Date.now() - active.at < 45_000) return;
			// In a DM thread Slack shows "is thinking…" under the bot's name; elsewhere a reaction stands in for it.
			if (r.thread && r.channel.startsWith("D")) {
				const ok = await api("assistant.threads.setStatus", {
					channel_id: r.channel,
					thread_ts: r.thread,
					status: "is thinking…",
				}).then(
					() => true,
					() => false,
				);
				if (ok) {
					progress.set(chatId, { at: Date.now(), native: true });
					return;
				}
			}
			const ts = r.thread ?? latest.get(chatId);
			if (ts && !active?.reaction)
				await api("reactions.add", { channel: r.channel, timestamp: ts, name: "thinking_face" }).catch(
					() => {},
				);
			progress.set(chatId, { at: Date.now(), reaction: ts });
		},
		idle,
		async canPost(chatId) {
			const r = ref(chatId);
			const c = await api<{ channel: SlackChannel }>("conversations.info", { channel: r.channel }).catch(
				() => null,
			);
			return Boolean(c && !c.channel.is_archived && (c.channel.is_im || c.channel.is_member));
		},
		async openDirect(userId) {
			const data = await api<{ channel: SlackChannel }>("conversations.open", { users: userId });
			chats.set(data.channel.id, { ...data.channel, is_im: true });
			return { chatId: slackChat(team, data.channel.id), name: `DM with ${name(await user(userId))}` };
		},
	};
}
