import type { Channel } from "@sekai/shared";
import { errorMessage } from "../lib/errors.ts";
import { guardedFetch } from "../lib/net.ts";
import { unseal } from "../lib/secrets.ts";
import { COMMANDS } from "./commands.ts";
import { chunkText } from "./format.ts";
import { parseTextCommand } from "./render.ts";
import { fromSlack, slackChat, slackMrkdwn, slackRef } from "./slack-format.ts";
import {
	type ChannelAdapter,
	type ChannelHandlers,
	type ChatRef,
	type InboundMention,
	MAX_INBOUND_BYTES,
	type Reply,
} from "./types.ts";

/** Transport dependencies, injectable so protocol tests never contact Slack. Not channel configuration. */
export interface SlackTransport {
	api?: string;
	fetch?: typeof fetch;
	fileFetch?: typeof guardedFetch;
	socket?: (url: string) => WebSocket;
	reconnectMs?: number;
	postMs?: number;
}

interface SlackResult {
	ok: boolean;
	error?: string;
	[key: string]: unknown;
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
	user?: { id: string; username?: string };
	user_id?: string;
	user_name?: string;
	channel?: { id: string; name?: string };
	channel_id?: string;
	channel_name?: string;
	command?: string;
	text?: string;
	response_url?: string;
	message?: { ts?: string; thread_ts?: string };
	container?: { message_ts?: string; thread_ts?: string; is_ephemeral?: boolean };
	actions?: { action_id: string; selected_option?: { value: string }; selected_options?: { value: string }[] }[];
}
const FATAL = /^(invalid_auth|not_authed|token_revoked|token_expired|account_inactive|not_allowed_token_type)$/;
const secret = (value = "") => (value.startsWith("v1:") ? unseal(value) : value.trim());
const plain = (text: string) => ({ type: "plain_text", text: text.slice(0, 75) || "…", emoji: true });

/** Block Kit is for controls, not ordinary answers. Include text for notifications and screen readers. */
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
		controls.unshift({
			type: (s.max ?? 1) > 1 ? "multi_static_select" : "static_select",
			action_id: s.id,
			placeholder: plain(s.placeholder),
			options: s.options.slice(0, 100).map((o) => ({ text: plain(o.label), value: o.value.slice(0, 150) })),
			...((s.max ?? 1) > 1 ? { min_selected_items: s.min ?? 1, max_selected_items: s.max } : {}),
		});
	}
	return {
		text,
		mrkdwn: true,
		unfurl_links: false,
		unfurl_media: false,
		// Sending [] also removes old buttons on an approval or command update.
		blocks: controls.length
			? [
					...chunkText(text, 2900).map((part) => ({ type: "section", text: { type: "mrkdwn", text: part } })),
					{ type: "actions", elements: controls.slice(0, 25) },
				]
			: [],
	};
}

/** One real bot user per Sekai bot, connected out through Slack's Socket Mode protocol. */
export function slackAdapter(channel: Channel, transport: SlackTransport = {}): ChannelAdapter {
	const botToken = secret(channel.secrets.botToken);
	const appToken = secret(channel.secrets.appToken);
	const apiBase = transport.api ?? "https://slack.com/api";
	const request = transport.fetch ?? fetch;
	const fileFetch = transport.fileFetch ?? guardedFetch;
	let h: ChannelHandlers;
	let team = "";
	let botId = "";
	let ws: WebSocket | null = null;
	const sockets = new Set<WebSocket>();
	let stopped = true;
	let controller = new AbortController();
	let retry: ReturnType<typeof setTimeout> | undefined;
	let attempts = 0;
	let connecting: Promise<void> | null = null;
	let appId = "";
	let expectedAppId = "";
	const users = new Map<string, SlackUser>();
	const chats = new Map<string, SlackChannel>();
	const seen = new Map<string, number>();
	const progress = new Map<string, { at: number; reaction?: string; native?: boolean }>();
	const latest = new Map<string, string>();
	const queues = new Map<string, Promise<unknown>>();
	const postedAt = new Map<string, number>();
	let inbound = Promise.resolve();

	async function api<T>(method: string, body: Record<string, unknown> = {}, token = botToken): Promise<T> {
		for (let attempt = 0; attempt < 5; attempt++) {
			const res = await request(`${apiBase}/${method}`, {
				method: "POST",
				headers: {
					authorization: `Bearer ${token}`,
					"content-type": "application/x-www-form-urlencoded",
				},
				// Several read methods silently ignore JSON bodies; form encoding works across the Web API.
				body: new URLSearchParams(
					Object.entries(body)
						.filter(([, v]) => v !== undefined)
						.map(([k, v]): [string, string] => [k, typeof v === "object" ? JSON.stringify(v) : String(v)]),
				),
				signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]),
				redirect: "error",
			});
			if (res.status === 429) {
				const wait = Math.max(1, Number(res.headers.get("retry-after")) || 1) * 1000;
				await res.body?.cancel();
				await pause(wait);
				continue;
			}
			const data = (await res.json()) as SlackResult;
			if (!res.ok || !data.ok) {
				const code = data.error ?? `http_${res.status}`;
				// Never echo response bodies or URLs: they can contain credentials and socket tickets.
				throw new Error(`Slack ${method}: ${/^[a-z0-9_]+$/.test(code) ? code : "request_failed"}`);
			}
			return data as T;
		}
		throw new Error(`Slack ${method} is busy. Try again in a moment.`);
	}

	function pause(ms: number): Promise<void> {
		return new Promise((resolve, reject) => {
			const abort = () => {
				clearTimeout(timer);
				reject(new Error("Slack connection stopped."));
			};
			const timer = setTimeout(() => {
				controller.signal.removeEventListener("abort", abort);
				resolve();
			}, ms);
			if (controller.signal.aborted) abort();
			else controller.signal.addEventListener("abort", abort, { once: true });
		});
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
	async function chatRef(channelId: string, userId: string, thread?: string): Promise<ChatRef> {
		const [c, u] = await Promise.all([chat(channelId), user(userId)]);
		return {
			chatId: slackChat(team, channelId, thread),
			chatName: `${c.is_im ? `DM with ${name(u)}` : `#${c.name || channelId}`}${thread ? " (thread)" : ""}`,
			isGroup: !c.is_im,
			serverId: c.is_im ? null : team,
			senderId: userId,
			senderName: name(u),
		};
	}
	function remember(key: string): boolean {
		if (seen.has(key)) return false;
		seen.set(key, Date.now());
		if (seen.size > 5000) {
			const first = seen.keys().next().value;
			if (first) seen.delete(first);
		}
		return true;
	}

	async function file(url: string): Promise<Uint8Array | null> {
		// Only send the bot credential to Slack's file host, never to an arbitrary attachment URL or redirect.
		const target = new URL(url);
		if (target.protocol !== "https:" || target.hostname !== "files.slack.com") return null;
		const res = await fileFetch(target, {
			headers: { authorization: `Bearer ${botToken}` },
			redirect: "manual",
			maxRedirects: 0,
			signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60_000)]),
		}).catch(() => null);
		if (!res?.ok || Number(res.headers.get("content-length")) > MAX_INBOUND_BYTES) {
			await res?.body?.cancel();
			return null;
		}
		if (!res.body) return null;
		const chunks: Uint8Array[] = [];
		let size = 0;
		for await (const chunk of res.body) {
			size += chunk.length;
			if (size > MAX_INBOUND_BYTES) {
				await res.body.cancel().catch(() => {});
				return null;
			}
			chunks.push(chunk);
		}
		return new Uint8Array(Buffer.concat(chunks));
	}

	async function message(event: SlackEvent) {
		if (
			!event.channel ||
			!event.ts ||
			!event.user ||
			event.user === botId ||
			event.hidden ||
			(event.subtype && !["file_share", "bot_message"].includes(event.subtype))
		)
			return;
		// message and app_mention subscriptions can deliver the very same message twice.
		if (!remember(`message:${event.channel}:${event.ts}`)) return;
		const isDm = event.channel_type === "im" || event.channel.startsWith("D");
		const thread = event.thread_ts ?? event.ts;
		const r = await chatRef(event.channel, event.user, thread);
		const text = event.text ?? "";
		const ids = [
			...new Set(
				[...text.matchAll(/<@([A-Z0-9]+)(?:\|[^>]+)?>/g)]
					.map((m) => m[1])
					.filter((id): id is string => Boolean(id)),
			),
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
		const everyone = /<!(?:here|channel|everyone)>/.test(text);
		latest.set(r.chatId, event.ts);
		if (latest.size > 5000) latest.delete(latest.keys().next().value ?? "");
		await h.onMessage({
			...r,
			parentChatId: thread ? slackChat(team, event.channel) : undefined,
			senderIsBot: Boolean(event.bot_id || (await user(event.user)).is_bot),
			text: fromSlack(text),
			messageId: event.ts,
			replyToId: event.thread_ts && event.thread_ts !== event.ts ? event.thread_ts : null,
			addressed: isDm || mentions.some((m) => m.id === botId) || everyone,
			threadReply: Boolean(event.thread_ts),
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

	async function respond(url: string | undefined, content: Record<string, unknown>) {
		if (!url) return;
		const target = new URL(url);
		if (target.protocol !== "https:" || !["hooks.slack.com", "hooks.slack-gov.com"].includes(target.hostname))
			return;
		await fileFetch(target, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(content),
			maxRedirects: 0,
			signal: controller.signal,
		});
	}
	async function interaction(p: Interactive, command: boolean) {
		const c = p.channel_id ?? p.channel?.id;
		const u = p.user_id ?? p.user?.id;
		if (!c || !u || (p.team_id ?? p.team?.id) !== team) return;
		const r = await chatRef(c, u, command ? undefined : (p.message?.thread_ts ?? p.container?.thread_ts));
		if (command) {
			const raw = (p.text ?? "").trim().replace(/^reset(?=\s|$)/, "new");
			const parsed = parseTextCommand(`/${raw || "help"}`, COMMANDS);
			const reply = parsed
				? await h.onCommand({ ...r, ...parsed, targetMessageId: null })
				: { text: "I don't know that command. Try help." };
			await respond(p.response_url, { ...slackReply(reply), response_type: "ephemeral" });
		} else if (p.type === "block_actions") {
			for (const a of p.actions ?? []) {
				const ts = p.message?.ts ?? p.container?.message_ts;
				if (!ts) continue;
				const result = await h.onAction({
					...r,
					id: a.action_id,
					values:
						a.selected_options?.map((o) => o.value) ?? (a.selected_option ? [a.selected_option.value] : []),
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
	}

	function reconnect(immediate = false) {
		if (stopped || retry) return;
		const delay = immediate ? 0 : Math.min((transport.reconnectMs ?? 1000) * 2 ** attempts++, 60_000);
		retry = setTimeout(() => {
			retry = undefined;
			void connect().catch((err: unknown) => {
				if (stopped) return;
				if (FATAL.test(errorMessage(err).split(": ").at(-1) ?? "") || /different apps/.test(errorMessage(err)))
					h.onFatal(err);
				else {
					h.log("warn", "Slack connection interrupted; reconnecting.");
					reconnect();
				}
			});
		}, delay);
	}
	function connect(): Promise<void> {
		if (connecting) return connecting;
		connecting = connectNow().finally(() => {
			connecting = null;
		});
		return connecting;
	}
	async function connectNow(): Promise<void> {
		const data = await api<{ url: string }>("apps.connections.open", {}, appToken);
		const url = new URL(data.url);
		if (!transport.socket && (url.protocol !== "wss:" || !url.hostname.endsWith(".slack.com")))
			throw new Error("Slack returned an unexpected socket address.");
		if (stopped) return;
		const socket = transport.socket ? transport.socket(url.toString()) : new WebSocket(url);
		sockets.add(socket);
		ws = socket;
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
			const done = () => {
				clearTimeout(timer);
				controller.signal.removeEventListener("abort", abort);
			};
			socket.onmessage = (event) => {
				let envelope: {
					type: string;
					envelope_id?: string;
					num_connections?: number;
					connection_info?: { app_id?: string };
					reason?: string;
					payload?: Interactive & { team_id?: string; event?: SlackEvent; event_id?: string; type?: string };
				};
				try {
					envelope = JSON.parse(String(event.data));
				} catch {
					return;
				}
				// Acknowledge synchronously, before database work, downloads or even user lookups.
				if (envelope.envelope_id) socket.send(JSON.stringify({ envelope_id: envelope.envelope_id }));
				if (envelope.type === "hello") {
					appId = envelope.connection_info?.app_id ?? "";
					if (expectedAppId && appId !== expectedAppId) {
						done();
						socket.close();
						reject(new Error("Slack's two tokens belong to different apps. Copy both from the same app."));
						return;
					}
					attempts = 0;
					if (
						(envelope.num_connections ?? 1) >
						[...sockets].filter((s) => s.readyState === WebSocket.OPEN).length
					)
						h.log(
							"warn",
							"This Slack app has another Socket Mode connection. Run only one Sekai for it or events may reach the other connection.",
						);
					done();
					for (const previous of sockets) if (previous !== socket) previous.close();
					resolve();
					return;
				}
				if (envelope.type === "disconnect") {
					if (envelope.reason === "link_disabled") {
						done();
						reject(new Error("Slack Socket Mode is off. Turn it on in your app settings."));
						h.onFatal(new Error("Slack Socket Mode is off. Turn it on in your app settings."));
					} else reconnect(true);
					return;
				}
				if (envelope.envelope_id && !remember(`envelope:${envelope.envelope_id}`)) return;
				const p = envelope.payload;
				if (!p) return;
				let task: Promise<void> | undefined;
				if (envelope.type === "events_api" && p.team_id === team && p.event) {
					if (p.event.type === "tokens_revoked" || p.event.type === "app_uninstalled")
						h.onFatal(new Error("Slack revoked this app's access. Reinstall it and update its tokens."));
					else if (["message", "app_mention"].includes(p.event.type)) {
						const event = p.event;
						task = inbound.then(() => (stopped ? undefined : message(event)));
						inbound = task.catch(() => {});
					}
				} else if (["slash_commands", "interactive"].includes(envelope.type))
					task = interaction(p, envelope.type === "slash_commands");
				void task?.catch(() => h.log("warn", "A Slack message or interaction couldn't be handled. Try again."));
			};
			socket.onerror = () => {
				done();
				reject(new Error("Couldn't connect to Slack."));
			};
			socket.onclose = () => {
				sockets.delete(socket);
				done();
				reject(new Error("Slack closed the connection."));
				if (ws === socket) reconnect();
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
		if (!transport.fileFetch && (url.protocol !== "https:" || url.hostname !== "files.slack.com"))
			throw new Error("Slack returned an unexpected upload address.");
		const res = await fileFetch(url, {
			method: "POST",
			body: new Blob([f.data]),
			maxRedirects: 0,
			signal: controller.signal,
		});
		if (!res.ok) throw new Error("Slack couldn't upload that file.");
		await api("files.completeUploadExternal", {
			files: [{ id: target.file_id, title: f.name }],
			channel_id: r.channel,
			...(r.thread ? { thread_ts: r.thread } : {}),
		});
		return `file:${target.file_id}`;
	}

	return {
		// Markdown may expand when escaped; leave ample headroom under Slack's 40k text cap.
		maxText: 6000,
		mention: (id) => `<@${id}>`,
		subtext: (text) => text,
		async start(handlers) {
			h = handlers;
			if (!botToken.startsWith("xoxb-") || !appToken.startsWith("xapp-"))
				throw new Error("Add Slack's bot token (xoxb-…) and app-level token (xapp-…).");
			stopped = false;
			controller = new AbortController();
			const me = await api<{ team_id: string; team: string; user_id: string; user: string; bot_id: string }>(
				"auth.test",
			);
			team = me.team_id;
			botId = me.user_id;
			const bot = await api<{ bot: { app_id: string } }>("bots.info", { bot: me.bot_id });
			expectedAppId = bot.bot.app_id;
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
			controller.abort();
			for (const socket of sockets) socket.close();
			sockets.clear();
			ws = null;
			progress.clear();
		},
		registerCommands: async () => {}, // Slack registers them from the app manifest, not at runtime.
		async send(chatId, content) {
			const r = ref(chatId);
			const previous = queues.get(r.channel) ?? Promise.resolve();
			const task = previous
				.catch(() => {})
				.then(async () => {
					const wait = (postedAt.get(r.channel) ?? 0) + (transport.postMs ?? 1100) - Date.now();
					if (wait > 0) await pause(wait);
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
							if (!id) id = uploaded;
						}
					postedAt.set(r.channel, Date.now());
					await idle(chatId);
					return id;
				});
			queues.set(r.channel, task);
			try {
				return await task;
			} finally {
				if (queues.get(r.channel) === task) queues.delete(r.channel);
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
			const names: Record<string, string> = {
				"👍": "thumbsup",
				"🆕": "new",
				"⏹️": "stop_button",
				"🔁": "repeat",
				"🧽": "sponge",
				"✅": "white_check_mark",
			};
			await api("reactions.add", {
				channel: r.channel,
				timestamp: messageId,
				name: names[emoji] ?? emoji.replace(/^:|:$/g, ""),
			});
		},
		async typing(chatId) {
			const r = ref(chatId);
			const active = progress.get(chatId);
			if (active && Date.now() - active.at < 45_000) return;
			progress.set(chatId, { at: Date.now() });
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
