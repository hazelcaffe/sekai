import { errorMessage } from "../lib/errors.ts";
import { newId } from "../lib/ids.ts";
import { log } from "../lib/log.ts";
import { backendOf, type VoiceBackend } from "./catalog.ts";
import { SpeechDetector } from "./pcm.ts";
import { elevenLabsLiveUrl, elevenLabsTranscribe, isLiveScribe } from "./providers/elevenlabs.ts";
import { fishTranscribe } from "./providers/fish.ts";

/** What the ears hear: someone started or stopped talking, words so far, and the final words of a turn. */
export type ListenEvent =
	| { type: "speech"; on: boolean }
	| { type: "partial"; itemId: string; text: string }
	| { type: "final"; itemId: string; text: string }
	| { type: "error"; message: string };

export interface ListenOptions {
	/** Speech-to-text model id. */
	model: string;
	language?: string;
	/** Pause that ends a turn. Calls want it short, dictation a bit longer. */
	silenceMs?: number;
}

export interface Listener {
	start(): Promise<void>;
	audio(pcm: Uint8Array): void;
	/** Finish the turn in progress; resolves when its words are in (or after a while). */
	flush(): Promise<void>;
	close(): void;
}

const NO_MODEL = "No speech-to-text model picked yet (Settings → Voice, or the bot's Model & voice)";

/** Speech to text of a finished clip (24 kHz PCM). Live models use their batch twin. */
export async function transcribe(opts: {
	model: string;
	pcm: Uint8Array;
	language?: string;
	signal?: AbortSignal;
}): Promise<string> {
	if (!opts.model) throw new Error(NO_MODEL);
	const b = await backendOf(opts.model);
	switch (b.kind) {
		case "elevenlabs":
			return elevenLabsTranscribe(b.endpoint, { ...opts, model: b.model });
		case "fishaudio":
			return fishTranscribe(b.endpoint, opts);
		default:
			throw new Error(`${b.endpoint.label} can't transcribe`);
	}
}

// ---------------------------------------------------------------- ElevenLabs Scribe live

class ElevenLabsListener implements Listener {
	private ws: WebSocket | null = null;
	private item = newId("itm", 8);
	private hearing = false;
	private closed = false;
	private drained: (() => void) | null = null;
	private pending: Uint8Array[] = [];

	constructor(
		private readonly emit: (ev: ListenEvent) => void,
		private readonly b: VoiceBackend,
		private readonly opts: ListenOptions,
	) {}

	start(): Promise<void> {
		const url = elevenLabsLiveUrl(this.b.endpoint, {
			model: this.b.model,
			language: this.opts.language,
			silenceSecs: (this.opts.silenceMs ?? 700) / 1000,
		});
		const ws = new WebSocket(url, { headers: { "xi-api-key": this.b.endpoint.apiKey } } as never);
		this.ws = ws;
		return new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error("ElevenLabs didn't answer within 15 seconds")), 15_000);
			ws.onmessage = (e) => {
				let m: { message_type?: string; text?: string; error?: string; message?: string };
				try {
					m = JSON.parse(String(e.data));
				} catch {
					return;
				}
				if (m.message_type === "session_started") {
					clearTimeout(timer);
					for (const p of this.pending.splice(0)) this.audio(p);
					resolve();
				} else if (m.message_type === "partial_transcript") {
					const text = m.text?.trim() ?? "";
					if (!text) return;
					if (!this.hearing) {
						this.hearing = true;
						this.emit({ type: "speech", on: true });
					}
					this.emit({ type: "partial", itemId: this.item, text });
				} else if (m.message_type === "committed_transcript") {
					const text = m.text?.trim() ?? "";
					if (this.hearing) this.emit({ type: "speech", on: false });
					this.hearing = false;
					if (text) this.emit({ type: "final", itemId: this.item, text });
					this.item = newId("itm", 8);
					this.drained?.();
					this.drained = null;
				} else if (m.message_type && /error/i.test(m.message_type)) {
					clearTimeout(timer);
					const message = m.error ?? m.message ?? m.message_type;
					this.emit({ type: "error", message: `ElevenLabs: ${message}` });
					reject(new Error(`ElevenLabs: ${message}`));
				}
			};
			ws.onclose = (e) => {
				clearTimeout(timer);
				if (!this.closed) {
					const message = `ElevenLabs hung up${e.reason ? `: ${e.reason}` : ` (${e.code})`}`;
					this.emit({ type: "error", message });
					reject(new Error(message));
				}
				this.drained?.();
			};
		});
	}

	audio(pcm: Uint8Array): void {
		const ws = this.ws;
		if (!ws || ws.readyState !== WebSocket.OPEN) {
			if (this.pending.length < 400) this.pending.push(pcm);
			return;
		}
		ws.send(
			JSON.stringify({
				message_type: "input_audio_chunk",
				audio_base_64: Buffer.from(pcm).toString("base64"),
				sample_rate: 24_000,
			}),
		);
	}

	flush(): Promise<void> {
		if (!this.hearing) return Promise.resolve();
		this.ws?.send(
			JSON.stringify({ message_type: "input_audio_chunk", audio_base_64: "", commit: true, sample_rate: 24_000 }),
		);
		return new Promise<void>((resolve) => {
			this.drained = resolve;
			setTimeout(resolve, 8000);
		});
	}

	close(): void {
		this.closed = true;
		try {
			this.ws?.close(1000);
		} catch {}
	}
}

// ---------------------------------------------------------------- any batch service

/** Finds the pauses itself and sends each finished clip to a speech-to-text API. */
class BatchListener implements Listener {
	private detector: SpeechDetector;
	private queue: Promise<void> = Promise.resolve();
	private closed = false;

	constructor(
		private readonly emit: (ev: ListenEvent) => void,
		private readonly opts: ListenOptions,
	) {
		this.detector = new SpeechDetector(
			{
				start: () => this.emit({ type: "speech", on: true }),
				end: (clip) => {
					this.emit({ type: "speech", on: false });
					const itemId = newId("itm", 8);
					this.emit({ type: "partial", itemId, text: "…" });
					this.queue = this.queue.then(() => this.run(itemId, clip));
				},
			},
			{ silenceMs: opts.silenceMs ?? 700, minSpeechMs: 160, maxClipMs: 28_000 },
		);
	}

	private async run(itemId: string, clip: Uint8Array): Promise<void> {
		if (this.closed) return;
		try {
			const text = await transcribe({ model: this.opts.model, pcm: clip, language: this.opts.language });
			this.emit({ type: "final", itemId, text });
		} catch (err) {
			this.emit({ type: "final", itemId, text: "" });
			this.emit({ type: "error", message: errorMessage(err) });
		}
	}

	async start(): Promise<void> {
		// Fails early with a clear message when the model or its service is gone.
		await backendOf(this.opts.model);
	}

	audio(pcm: Uint8Array): void {
		if (!this.closed) this.detector.push(pcm);
	}

	async flush(): Promise<void> {
		this.detector.flush();
		await Promise.race([this.queue, Bun.sleep(20_000)]);
	}

	close(): void {
		this.closed = true;
	}
}

/** Ears for a speech-to-text model: streaming where the service can, clip by clip where it can't. */
export async function createListener(emit: (ev: ListenEvent) => void, opts: ListenOptions): Promise<Listener> {
	if (!opts.model) throw new Error(NO_MODEL);
	const b = await backendOf(opts.model);
	if (b.kind === "elevenlabs" && isLiveScribe(b.model)) return new ElevenLabsListener(emit, b, opts);
	log.debug(`listening clip by clip with ${opts.model}`);
	return new BatchListener(emit, opts);
}
