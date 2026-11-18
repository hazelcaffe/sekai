import {
	type Agent,
	type Conversation,
	type MessagePart,
	type ServerEvent,
	speakableText,
	type VoiceSettings,
} from "@sekai/shared";
import { fastModelFor } from "../agent/models.ts";
import { identity } from "../agent/prompt.ts";
import { enqueueRun } from "../agent/runtime.ts";
import { bus } from "../events/bus.ts";
import { errorMessage } from "../lib/errors.ts";
import { newId } from "../lib/ids.ts";
import { log } from "../lib/log.ts";
import { chat } from "../llm/gateway.ts";
import { createMessage } from "../services/messages.ts";
import { getSettings } from "../services/settings.ts";
import { createListener, type ListenEvent, type Listener } from "./listen.ts";
import { BYTES_PER_SECOND } from "./pcm.ts";
import { voiceFor } from "./settings.ts";
import { speak } from "./tts.ts";

/** What the app hears during a call (audio goes as binary frames: 24 kHz mono 16-bit PCM). */
export type CallEvent =
	| { type: "ready"; callId: string }
	| { type: "state"; state: "listening" | "thinking" | "speaking" | "working"; label?: string }
	| { type: "you"; itemId: string; text: string; final: boolean }
	| { type: "bot"; itemId: string; text: string; final: boolean }
	/** The next audio frames belong to this reply. */
	| { type: "audio"; itemId: string }
	/** You started talking: stop playing the bot right away. */
	| { type: "interrupt" }
	| { type: "error"; message: string }
	| { type: "ended"; reason: string };

/** A call as the app's socket (or a Discord voice channel) sees it. */
export interface CallSession {
	readonly id: string;
	/** reason: the bot is calling you about this (it opens with it). */
	start(opts?: { greet?: boolean; reason?: string }): Promise<void>;
	audio(pcm: Uint8Array): void;
	mute(on: boolean): void;
	/** How much of a reply the app played before you interrupted it. */
	played(itemId: string, ms: number): void;
	/** You typed instead of talking. */
	say(text: string): void;
	end(reason?: string): void;
}

interface Reply {
	runId: string;
	messageId: string | null;
	parts: MessagePart[];
	/** How much of the speakable text has been sent to the voice. */
	spoken: number;
	done: boolean;
	/** You interrupted: the rest of it isn't read out. */
	silenced: boolean;
	abort: AbortController;
	/** Sentences waiting for the voice, in order. */
	chain: Promise<void>;
	audioStarted: boolean;
	/** The last caption sent to the app. */
	caption: string;
}

/** What the bot says it's doing while a tool runs, by the tool's name. */
const TOOL_LABELS: [(name: string) => boolean, string][] = [
	[(n) => n.startsWith("web") || n.includes("search") || n.includes("fetch"), "Looking it up…"],
	[(n) => n.startsWith("memory"), "Checking memory…"],
	[(n) => n.startsWith("note"), "Writing a note…"],
	[(n) => n.startsWith("routine") || n.includes("reminder"), "Setting it up…"],
	[(n) => n.startsWith("computer") || n.includes("browser") || n.includes("screenshot"), "Using the computer…"],
	[(n) => n.startsWith("run_command") || n.includes("file"), "Working on it…"],
	[(n) => n.startsWith("agent_") || n.includes("team_"), "Asking a teammate…"],
];

function textOf(parts: MessagePart[]): string {
	return parts
		.filter((p): p is Extract<MessagePart, { type: "text" }> => p.type === "text")
		.map((p) => p.text)
		.join("\n\n");
}

/** Up to the last finished sentence (or everything, once the reply is done). */
function ready(text: string, done: boolean): number {
	if (done) return text.length;
	let cut = -1;
	const re = /[.!?。！？…]["')\]]*(\s|$)|\n/g;
	for (let m = re.exec(text); m; m = re.exec(text)) {
		if (m.index + m[0].length < text.length || /\s/.test(m[0])) cut = m.index + m[0].length;
	}
	return cut;
}

/**
 * A voice call with a bot: you're heard with its speech-to-text model, its own model answers (with all its tools,
 * as in the chat), and its speaking voice reads the reply out while it's written. What you both say is in the chat.
 */
export class VoiceCall implements CallSession {
	readonly id = newId("call", 10);
	private ears: Listener | null = null;
	private v: VoiceSettings | null = null;
	private muted = false;
	private ended = false;
	private reply: Reply | null = null;
	private unsubscribe: (() => void) | null = null;
	/** When the audio sent so far will have finished playing in the app. */
	private playsUntil = 0;
	private idleTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(
		private readonly conversation: Conversation,
		private readonly agent: Agent,
		private readonly emit: (ev: CallEvent) => void,
		private readonly sendAudio: (pcm: Uint8Array) => void,
		private readonly via: "app" | "discord" = "app",
	) {}

	async start(opts: { greet?: boolean; reason?: string } = {}): Promise<void> {
		try {
			this.v = await voiceFor(this.agent);
			if (!this.v.ttsModel || !this.v.sttModel) {
				throw new Error(
					"Calls need a speaking voice and a speech-to-text model. Pick them in the bot's Voice tab, or ask an admin to set the defaults in Admin → Voice.",
				);
			}
			const ears = await createListener((ev) => this.heard(ev), {
				model: this.v.sttModel,
				language: this.v.language,
				silenceMs: 600,
			});
			this.ears = ears;
			if (this.ended) return void ears.close();
			await ears.start();
		} catch (err) {
			this.emit({ type: "error", message: errorMessage(err) });
			this.end("couldn't connect");
			return;
		}
		// Hung up while it was connecting: end() already closed the listener; don't start listening to the bus.
		if (this.ended) return void this.ears?.close();
		this.unsubscribe = bus.subscribe((ev) => this.onEvent(ev));
		this.emit({ type: "ready", callId: this.id });
		this.emit({ type: "state", state: "listening" });
		if (opts.greet !== false)
			void this.greet(opts.reason).catch((err: unknown) => log.warn(`call greeting: ${errorMessage(err)}`));
	}

	/** A quick hello in character from the bot's fast model (or why it called, when it did). */
	private async greet(reason?: string): Promise<void> {
		const settings = await getSettings();
		const who = settings.userName || "the user";
		const result = await chat({
			meter: { agentId: this.agent.id, purpose: "background" },
			model: (await fastModelFor(this.agent, settings)).model,
			thinking: "default",
			maxTokens: reason ? 160 : 60,
			messages: [
				{ role: "system", content: identity(this.agent, settings.userName) },
				{
					role: "user",
					content: reason
						? `You called ${who} and they just picked up. Say hi and tell them why you're calling, in one or two short spoken sentences in your own style, no emoji or Markdown: ${reason}`
						: `${who} is calling you. Pick up with a short, natural hello in your own voice and style: a few words, at most one short sentence, no question list, no emoji or Markdown. Reply with just what you say.`,
				},
			],
		});
		const text = result.text.trim().replace(/^"|"$/g, "");
		if (!text || this.ended || this.reply) return;
		const reply = this.newReply(`greet_${this.id}`);
		reply.done = true;
		const message = await createMessage({
			conversationId: this.conversation.id,
			sender: "agent",
			agentId: this.agent.id,
			parts: [{ type: "text", text }],
			meta: { call: { id: this.id, kind: "speech", via: this.via } },
		});
		reply.messageId = message.id;
		reply.parts = message.parts;
		this.progress(reply);
	}

	private heard(ev: ListenEvent): void {
		if (this.ended) return;
		switch (ev.type) {
			case "speech":
				if (ev.on) {
					this.interrupt();
					this.emit({ type: "state", state: "listening" });
				}
				return;
			case "partial":
				this.emit({ type: "you", itemId: ev.itemId, text: ev.text, final: false });
				return;
			case "final":
				this.emit({ type: "you", itemId: ev.itemId, text: ev.text, final: true });
				if (ev.text.trim()) void this.ask(ev.text.trim(), false);
				return;
			case "error":
				this.emit({ type: "error", message: ev.message });
		}
	}

	private newReply(runId: string): Reply {
		const reply: Reply = {
			runId,
			messageId: null,
			parts: [],
			spoken: 0,
			done: false,
			silenced: false,
			abort: new AbortController(),
			chain: Promise.resolve(),
			audioStarted: false,
			caption: "",
		};
		this.reply = reply;
		return reply;
	}

	/** What you said (or typed) goes into the chat, and the bot answers it like any message. */
	private async ask(text: string, typed: boolean): Promise<void> {
		this.interrupt();
		try {
			const message = await createMessage({
				conversationId: this.conversation.id,
				sender: "user",
				parts: [{ type: "text", text }],
				meta: {
					trigger: "user",
					call: { id: this.id, kind: "speech", via: this.via, ...(typed ? { typed: true } : {}) },
				},
			});
			const run = await enqueueRun({
				agentId: this.agent.id,
				conversationId: this.conversation.id,
				trigger: "user",
				sourceMessageId: message.id,
				rootMessageId: message.id,
			});
			this.newReply(run.id);
			this.emit({ type: "state", state: "thinking" });
		} catch (err) {
			this.emit({ type: "error", message: errorMessage(err) });
		}
	}

	private onEvent(ev: ServerEvent): void {
		const r = this.reply;
		if (!r || this.ended) return;
		switch (ev.type) {
			case "message.created":
			case "message.updated": {
				const m = ev.message;
				if (m.runId !== r.runId || m.sender !== "agent") return;
				r.messageId = m.id;
				r.parts = structuredClone(m.parts);
				if (m.status !== "streaming") r.done = true;
				this.progress(r);
				return;
			}
			case "message.part":
				if (ev.messageId !== r.messageId) return;
				// A copy: the writer keeps appending to its own part object.
				r.parts[ev.index] = structuredClone(ev.part);
				if (ev.part.type === "tool") {
					const label = TOOL_LABELS.find(([is]) => is(ev.part.type === "tool" ? ev.part.name : ""))?.[1];
					if (ev.part.status === "running" || ev.part.status === "pending") {
						this.emit({ type: "state", state: "working", label: label ?? "Working on it…" });
					}
				}
				this.progress(r);
				return;
			case "message.delta": {
				if (ev.messageId !== r.messageId) return;
				const p = r.parts[ev.index];
				if (p && "text" in p) (p as { text: string }).text += ev.delta;
				this.progress(r);
				return;
			}
			case "run.updated": {
				if (ev.run.id !== r.runId) return;
				if (ev.run.status === "awaiting_approval") {
					this.emit({ type: "state", state: "working", label: "Waiting for your OK on screen" });
				} else if (ev.run.status === "error" || ev.run.status === "cancelled") {
					r.done = true;
					if (!r.audioStarted && ev.run.status === "error")
						this.queue(r, "Sorry, something went wrong there.");
					this.progress(r);
				} else if (ev.run.status === "done") {
					r.done = true;
					this.progress(r);
				}
			}
		}
	}

	/** Sends finished sentences to the voice. */
	private progress(r: Reply): void {
		if (r.silenced || r !== this.reply) return;
		const text = speakableText(textOf(r.parts));
		// Captions on the call card follow the reply as it's written.
		if (r.messageId && text && text !== r.caption) {
			r.caption = text;
			this.emit({ type: "bot", itemId: r.messageId, text, final: r.done });
		}
		const upTo = ready(text, r.done);
		if (upTo > r.spoken) {
			const piece = text
				.slice(r.spoken, upTo)
				.replace(/[*#_`~]/g, "")
				.trim();
			r.spoken = upTo;
			if (piece) this.queue(r, piece);
		}
		if (r.done) r.chain = r.chain.then(() => this.settle(r));
	}

	private queue(r: Reply, piece: string): void {
		r.chain = r.chain.then(async () => {
			if (r.silenced || this.ended) return;
			try {
				for await (const pcm of speak({
					model: this.v?.ttsModel ?? "",
					voice: this.v?.ttsVoice ?? "",
					text: piece,
					language: this.v?.language,
					signal: r.abort.signal,
				})) {
					if (r.silenced || this.ended) return;
					if (!r.audioStarted) {
						r.audioStarted = true;
						this.emit({ type: "audio", itemId: r.messageId ?? r.runId });
						this.emit({ type: "state", state: "speaking" });
					}
					this.sendAudio(pcm);
					const now = Date.now();
					this.playsUntil = Math.max(this.playsUntil, now) + (pcm.length / BYTES_PER_SECOND) * 1000;
				}
			} catch (err) {
				if (!r.abort.signal.aborted)
					this.emit({ type: "error", message: `The voice failed: ${errorMessage(err)}` });
			}
		});
	}

	/** After the last words have played, back to listening. */
	private settle(r: Reply): void {
		if (r !== this.reply || this.ended) return;
		if (this.idleTimer) clearTimeout(this.idleTimer);
		this.idleTimer = setTimeout(
			() => {
				if (r === this.reply && !this.ended) this.emit({ type: "state", state: "listening" });
			},
			Math.max(0, this.playsUntil - Date.now()) + 200,
		);
	}

	/** Stops reading out the current reply (it stays in the chat). */
	private interrupt(): void {
		const r = this.reply;
		if (!r || r.silenced) return;
		const playing = r.audioStarted && Date.now() < this.playsUntil;
		r.silenced = true;
		r.abort.abort();
		this.playsUntil = 0;
		if (playing) this.emit({ type: "interrupt" });
	}

	audio(pcm: Uint8Array): void {
		if (!this.muted && !this.ended) this.ears?.audio(pcm);
	}

	mute(on: boolean): void {
		this.muted = on;
	}

	played(): void {}

	say(text: string): void {
		const line = text.trim();
		if (!line || this.ended) return;
		const itemId = newId("typed", 8);
		this.emit({ type: "you", itemId, text: line, final: true });
		void this.ask(line, true);
	}

	end(reason = "hung up"): void {
		if (this.ended) return;
		this.ended = true;
		this.interrupt();
		if (this.idleTimer) clearTimeout(this.idleTimer);
		this.unsubscribe?.();
		this.ears?.close();
		this.emit({ type: "ended", reason });
	}
}
