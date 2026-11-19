import type { Message } from "@sekai/shared";
import { errorMessage } from "../lib/errors.ts";
import { log } from "../lib/log.ts";
import { getUploadRow } from "../services/uploads.ts";
import { chunkText } from "./format.ts";
import { renderMessage } from "./render.ts";
import { forgetPosted, postedFor, recordPlatformMessage } from "./state.ts";
import type { ChannelAdapter } from "./types.ts";

export interface StreamTarget {
	/** The channel (bot) that posts. */
	channelId: string;
	chatId: string;
	/** Who's speaking, when the bot posts for another agent or for you. */
	header: string | null;
	/** The platform message this reply answers. */
	replyTo: string | null;
	/** Agent names (lowercase) → mention of their bot in this chat. */
	mentions: Map<string, string>;
}

/** Where the platform ids of posted messages are kept (the database; tests use memory). */
export interface PostedStore {
	load(messageId: string, channelId: string, chatId: string): Promise<string[]>;
	add(row: {
		messageId: string;
		channelId: string;
		chatId: string;
		externalMessageId: string;
		seq: number;
	}): Promise<void>;
	trim(messageId: string, channelId: string, chatId: string, fromSeq: number): Promise<void>;
}

const dbStore: PostedStore = {
	load: postedFor,
	add: (row) => recordPlatformMessage({ ...row, direction: "out" }),
	trim: forgetPosted,
};

/** A voice message: posted as audio only (its words are for Sekai and the bots). */
const isVoice = (m: Message) => m.parts.some((p) => p.type === "audio");

/**
 * What each posted reply last showed (by message, bot and chat: the text of each platform message), so a later
 * change to the Sekai message that doesn't change what's shown (a memory note, a title) doesn't edit it again.
 */
const lastShown = new Map<string, (string | null)[]>();
const SHOWN_KEEP = 500;
/** Images and voice notes already posted for a reply in a chat (by url), so a later update doesn't post them again. */
const sentMedia = new Map<string, Set<string>>();

function remember<T>(map: Map<string, T>, key: string, value: T): void {
	map.delete(key);
	map.set(key, value);
	if (map.size > SHOWN_KEEP) map.delete(map.keys().next().value as string);
}

/**
 * Mirrors one Sekai message into one platform chat. A reply is posted once it's finished (the typing indicator
 * shows until then), so it arrives whole rather than being edited as it's written; long replies continue in more
 * messages. A retry reuses the same platform messages (their ids are stored with the Sekai message) and trims
 * what's no longer needed.
 */
export class OutboundStream {
	private posted: string[] = [];
	private shown: (string | null)[] = [];
	private loaded = false;
	private chain: Promise<void> = Promise.resolve();

	constructor(
		readonly target: StreamTarget,
		private message: Message,
		private readonly adapter: () => ChannelAdapter | null,
		private readonly store: PostedStore = dbStore,
	) {}

	get messageId(): string {
		return this.message.id;
	}

	get final(): boolean {
		return this.message.status !== "streaming";
	}

	/** A new snapshot of the message (created, updated, or after a part or delta). Posted once it's finished. */
	update(message: Message): void {
		this.message = message;
		if (this.final) this.enqueue();
	}

	/** Resolves once everything up to now has reached the platform. */
	settled(): Promise<void> {
		return this.chain;
	}

	private enqueue(): void {
		this.chain = this.chain
			.then(() => this.sync())
			.catch((err: unknown) => log.warn(`channel delivery failed: ${errorMessage(err)}`));
	}

	private get media(): Set<string> {
		const key = `${this.message.id}:${this.target.channelId}:${this.target.chatId}`;
		let set = sentMedia.get(key);
		if (!set) {
			set = new Set();
			remember(sentMedia, key, set);
		}
		return set;
	}

	/** The voice message, once (Discord shows it as a playable voice note). */
	private async sendVoice(adapter: ChannelAdapter, chatId: string): Promise<void> {
		const part = this.message.parts.find((p) => p.type === "audio");
		// Posted already (this run, or before a restart: its platform id is stored with the message).
		if (part?.type !== "audio" || this.media.has(part.url) || this.posted.length > 0) return;
		this.media.add(part.url);
		const id = part.url.match(/\/api\/uploads\/([\w-]+)/)?.[1];
		const row = id ? await getUploadRow(id).catch(() => null) : null;
		if (!row) return;
		const data = new Uint8Array(await Bun.file(row.path).arrayBuffer());
		const file = { name: "voice-message.ogg", data, mime: part.mime };
		const opts = { replyTo: this.target.replyTo };
		const sent = await adapter
			.send(
				chatId,
				{
					text: "",
					files: [{ ...file, voice: { durationMs: part.durationMs, waveform: part.waveform ?? "" } }],
				},
				opts,
			)
			// Where voice messages aren't allowed (a server without that permission), as a playable audio file.
			.catch((err: unknown) => {
				log.warn(`couldn't post a voice message, sending it as a file: ${errorMessage(err)}`);
				return adapter.send(chatId, { text: "", files: [file] }, opts);
			})
			.catch((err: unknown) => {
				log.warn(`couldn't post a voice message: ${errorMessage(err)}`);
				return null;
			});
		if (sent) {
			this.posted.push(sent);
			this.shown.push(null);
			await this.store.add({
				channelId: this.target.channelId,
				chatId,
				externalMessageId: sent,
				messageId: this.message.id,
				seq: 0,
			});
		}
	}

	/** The bot's attached images, once the reply is complete (as files, after the text). */
	private async sendImages(adapter: ChannelAdapter, chatId: string): Promise<void> {
		const media = [
			...this.message.parts.filter((p) => p.type === "image"),
			...this.message.attachments.map((a) => ({ url: a.url, alt: a.name })),
		];
		for (const part of media) {
			if (this.media.has(part.url)) continue;
			this.media.add(part.url);
			const id = part.url.match(/\/api\/uploads\/([\w-]+)/)?.[1];
			const row = id ? await getUploadRow(id).catch(() => null) : null;
			if (!row) continue;
			const data = new Uint8Array(await Bun.file(row.path).arrayBuffer());
			await adapter
				.send(chatId, {
					text: part.alt ? adapter.subtext(part.alt) : "",
					files: [{ name: row.name, data, mime: row.mime }],
				})
				.catch((err: unknown) => log.warn(`couldn't post an image: ${errorMessage(err)}`));
		}
	}

	private async sync(): Promise<void> {
		const adapter = this.adapter();
		if (!adapter) return;
		const { channelId, chatId } = this.target;
		const m = this.message;
		const key = `${m.id}:${channelId}:${chatId}`;
		if (!this.loaded) {
			this.posted = await this.store.load(m.id, channelId, chatId);
			const before = lastShown.get(key);
			this.shown = this.posted.map((_, i) => before?.[i] ?? null);
			this.loaded = true;
		}
		if (!this.final) return;
		if (isVoice(m)) {
			if (this.final) await this.sendVoice(adapter, chatId);
			return;
		}
		const text = renderMessage(m, {
			subtext: (s) => adapter.subtext(s),
			header: this.target.header,
			mentions: this.target.mentions,
		});
		const chunks = text ? chunkText(text, adapter.maxText) : [];
		for (const [i, chunk] of chunks.entries()) {
			const id = this.posted[i];
			if (id) {
				if (this.shown[i] === chunk) continue;
				await adapter.edit(chatId, id, chunk);
				this.shown[i] = chunk;
				continue;
			}
			const sent = await adapter.send(chatId, chunk, { replyTo: i === 0 ? this.target.replyTo : null });
			this.posted.push(sent);
			this.shown.push(chunk);
			await this.store.add({ channelId, chatId, externalMessageId: sent, messageId: m.id, seq: i });
		}
		await this.sendImages(adapter, chatId);
		if (this.posted.length > chunks.length) {
			const extra = this.posted.splice(chunks.length);
			this.shown.splice(chunks.length);
			for (const id of extra) await adapter.remove(chatId, id).catch(() => {});
			await this.store.trim(m.id, channelId, chatId, chunks.length);
		}
		remember(lastShown, key, [...this.shown]);
	}
}
