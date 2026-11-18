/**
 * Audio for calls and dictation: your microphone as 24 kHz mono 16-bit PCM (what the voice services take),
 * and a gapless player for the model's replies in the same format.
 */

export const SAMPLE_RATE = 24_000;

/** Runs on the audio thread: resamples the mic to 24 kHz and sends 40 ms chunks of 16-bit PCM. */
const CAPTURE_WORKLET = `
class SekaiCapture extends AudioWorkletProcessor {
	constructor() {
		super();
		this.ratio = sampleRate / ${SAMPLE_RATE};
		this.buf = new Float32Array(0);
		this.t = 0;
		this.out = new Int16Array(960);
		this.n = 0;
		this.level = 0;
	}
	process(inputs) {
		const ch = inputs[0] && inputs[0][0];
		if (!ch) return true;
		const merged = new Float32Array(this.buf.length + ch.length);
		merged.set(this.buf);
		merged.set(ch, this.buf.length);
		let t = this.t;
		while (t + 1 < merged.length) {
			const i = Math.floor(t);
			const f = t - i;
			const s = merged[i] * (1 - f) + merged[i + 1] * f;
			const c = Math.max(-1, Math.min(1, s));
			this.level = Math.max(this.level * 0.995, Math.abs(c));
			this.out[this.n++] = c < 0 ? c * 0x8000 : c * 0x7fff;
			if (this.n === this.out.length) {
				this.port.postMessage({ pcm: this.out.buffer.slice(0), level: this.level });
				this.n = 0;
			}
			t += this.ratio;
		}
		const used = Math.floor(t);
		this.buf = merged.slice(used);
		this.t = t - used;
		return true;
	}
}
registerProcessor("sekai-capture", SekaiCapture);
`;

export interface Mic {
	stop(): void;
	/** 0–1, smoothed. */
	level(): number;
}

export class MicError extends Error {}

/** Starts the microphone. onChunk gets 40 ms of 24 kHz mono 16-bit PCM at a time. */
export async function startMic(onChunk: (pcm: ArrayBuffer) => void): Promise<Mic> {
	if (!navigator.mediaDevices?.getUserMedia) {
		throw new MicError(
			location.protocol === "https:" || location.hostname === "localhost"
				? "This browser can't use the microphone."
				: "Microphones only work on https or localhost. Open Sekai at http://localhost:7420 or over https.",
		);
	}
	let stream: MediaStream;
	try {
		stream = await navigator.mediaDevices.getUserMedia({
			audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
		});
	} catch (err) {
		const name = (err as { name?: string }).name;
		throw new MicError(
			name === "NotAllowedError"
				? "Microphone access is blocked. Allow it in your browser's site settings and try again."
				: name === "NotFoundError"
					? "No microphone found."
					: `Couldn't start the microphone (${(err as Error).message})`,
		);
	}
	const ctx = new AudioContext();
	let source: MediaStreamAudioSourceNode;
	let node: AudioWorkletNode;
	try {
		const url = URL.createObjectURL(new Blob([CAPTURE_WORKLET], { type: "application/javascript" }));
		await ctx.audioWorklet.addModule(url);
		URL.revokeObjectURL(url);
		source = ctx.createMediaStreamSource(stream);
		node = new AudioWorkletNode(ctx, "sekai-capture");
		// Created after awaiting permission, it can start suspended (no user gesture left).
		if (ctx.state === "suspended") await ctx.resume().catch(() => {});
	} catch (err) {
		// The microphone is already on: turn it off again rather than leave it running.
		for (const t of stream.getTracks()) t.stop();
		void ctx.close();
		throw new MicError(`Couldn't start recording (${(err as Error).message})`);
	}
	let level = 0;
	node.port.onmessage = (e: MessageEvent<{ pcm: ArrayBuffer; level: number }>) => {
		level = e.data.level;
		onChunk(e.data.pcm);
	};
	source.connect(node);
	// The worklet must be pulled by the graph to run; a muted gain keeps it out of the speakers.
	const sink = ctx.createGain();
	sink.gain.value = 0;
	node.connect(sink).connect(ctx.destination);
	return {
		stop() {
			node.port.onmessage = null;
			source.disconnect();
			node.disconnect();
			for (const t of stream.getTracks()) t.stop();
			void ctx.close();
		},
		level: () => level,
	};
}

/** Plays 24 kHz PCM chunks back to back and knows how much of each reply you've heard. */
export class Player {
	private ctx = new AudioContext();
	private analyser = this.ctx.createAnalyser();
	private next = 0;
	private sources = new Set<AudioBufferSourceNode>();
	private item: { id: string; startedAt: number; queuedMs: number } | null = null;
	private data = new Uint8Array(256);

	constructor() {
		this.analyser.fftSize = 512;
		this.analyser.connect(this.ctx.destination);
	}

	/** Browsers start audio only after a click: call this from the button that starts the call. */
	async resume(): Promise<void> {
		if (this.ctx.state !== "running") await this.ctx.resume();
	}

	/** The following chunks belong to a new reply. */
	startItem(id: string): void {
		this.item = { id, startedAt: Math.max(this.ctx.currentTime, this.next), queuedMs: 0 };
	}

	play(pcm: ArrayBuffer): void {
		const samples = new Int16Array(pcm);
		if (samples.length === 0) return;
		const buffer = this.ctx.createBuffer(1, samples.length, SAMPLE_RATE);
		const ch = buffer.getChannelData(0);
		for (let i = 0; i < samples.length; i++) ch[i] = (samples[i] ?? 0) / 0x8000;
		const src = this.ctx.createBufferSource();
		src.buffer = buffer;
		src.connect(this.analyser);
		const at = Math.max(this.ctx.currentTime + 0.02, this.next);
		src.start(at);
		this.next = at + buffer.duration;
		if (this.item) this.item.queuedMs += buffer.duration * 1000;
		this.sources.add(src);
		src.onended = () => this.sources.delete(src);
	}

	/** Stops right away (you started talking). Returns how much of the current reply you heard. */
	interrupt(): { itemId: string; ms: number } | null {
		const item = this.item;
		for (const s of this.sources) {
			try {
				s.stop();
			} catch {}
		}
		this.sources.clear();
		this.next = 0;
		this.item = null;
		if (!item) return null;
		const heard = Math.max(0, (this.ctx.currentTime - item.startedAt) * 1000);
		return { itemId: item.id, ms: Math.min(heard, item.queuedMs) };
	}

	get playing(): boolean {
		return this.next > this.ctx.currentTime;
	}

	/** 0–1: how loud the bot is right now (for the avatar). */
	level(): number {
		this.analyser.getByteTimeDomainData(this.data);
		let peak = 0;
		for (const v of this.data) peak = Math.max(peak, Math.abs(v - 128));
		return peak / 128;
	}

	close(): void {
		this.interrupt();
		void this.ctx.close();
	}
}
