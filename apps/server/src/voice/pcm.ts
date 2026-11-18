/** Sekai's audio everywhere: 24 kHz, mono, signed 16-bit little-endian PCM. */
export const RATE = 24_000;
/** Bytes per second at RATE. */
export const BYTES_PER_SECOND = RATE * 2;

/** 16-bit mono PCM to a WAV file. */
export function pcmToWav(pcm: Uint8Array, sampleRate = RATE): Uint8Array {
	const header = Buffer.alloc(44);
	header.write("RIFF", 0);
	header.writeUInt32LE(36 + pcm.length, 4);
	header.write("WAVE", 8);
	header.write("fmt ", 12);
	header.writeUInt32LE(16, 16);
	header.writeUInt16LE(1, 20);
	header.writeUInt16LE(1, 22);
	header.writeUInt32LE(sampleRate, 24);
	header.writeUInt32LE(sampleRate * 2, 28);
	header.writeUInt16LE(2, 32);
	header.writeUInt16LE(16, 34);
	header.write("data", 36);
	header.writeUInt32LE(pcm.length, 40);
	return new Uint8Array(Buffer.concat([header, Buffer.from(pcm)]));
}

export interface WavInfo {
	sampleRate: number;
	channels: number;
	bits: number;
	/** 1 = integer PCM, 3 = float. */
	format: number;
	/** Where the samples start. */
	dataOffset: number;
	dataLength: number;
}

/** Reads a WAV header (null when it isn't one, or it's cut off before the data starts). */
export function parseWav(buf: Uint8Array): WavInfo | null {
	const b = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
	if (b.length < 12 || b.toString("ascii", 0, 4) !== "RIFF" || b.toString("ascii", 8, 12) !== "WAVE") return null;
	let at = 12;
	let fmt: Omit<WavInfo, "dataOffset" | "dataLength"> | null = null;
	while (at + 8 <= b.length) {
		const id = b.toString("ascii", at, at + 4);
		const size = b.readUInt32LE(at + 4);
		if (id === "fmt " && at + 24 <= b.length) {
			let format = b.readUInt16LE(at + 8);
			// WAVE_FORMAT_EXTENSIBLE: the real format is in the sub-format GUID.
			if (format === 0xfffe && at + 34 <= b.length) format = b.readUInt16LE(at + 32);
			fmt = {
				format,
				channels: b.readUInt16LE(at + 10),
				sampleRate: b.readUInt32LE(at + 12),
				bits: b.readUInt16LE(at + 22),
			};
		} else if (id === "data") {
			if (!fmt) return null;
			const dataLength = size === 0xffffffff || size === 0 ? b.length - at - 8 : size;
			return { ...fmt, dataOffset: at + 8, dataLength };
		}
		at += 8 + size + (size % 2);
	}
	return null;
}

/** Any PCM (8/16/24/32-bit or float, any channels) to mono float samples. */
function toMonoFloat(data: Uint8Array, info: Pick<WavInfo, "bits" | "channels" | "format">): Float32Array {
	const b = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
	const bytes = info.bits / 8;
	const frame = bytes * info.channels;
	const n = Math.floor(b.length / frame);
	const out = new Float32Array(n);
	for (let i = 0; i < n; i++) {
		let sum = 0;
		for (let c = 0; c < info.channels; c++) {
			const at = i * frame + c * bytes;
			if (info.format === 3) sum += info.bits === 64 ? b.readDoubleLE(at) : b.readFloatLE(at);
			else if (info.bits === 16) sum += b.readInt16LE(at) / 0x8000;
			else if (info.bits === 24) sum += b.readIntLE(at, 3) / 0x800000;
			else if (info.bits === 32) sum += b.readInt32LE(at) / 0x80000000;
			else sum += (b[at] ?? 128) / 128 - 1;
		}
		out[i] = sum / info.channels;
	}
	return out;
}

function floatTo16(samples: Float32Array): Uint8Array {
	const out = Buffer.alloc(samples.length * 2);
	for (let i = 0; i < samples.length; i++) {
		const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
		out.writeInt16LE(Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), i * 2);
	}
	return new Uint8Array(out);
}

/** Linear resampling (good enough for speech). */
export function resample(samples: Float32Array, from: number, to: number): Float32Array {
	if (from === to) return samples;
	const ratio = from / to;
	const n = Math.floor(samples.length / ratio);
	const out = new Float32Array(n);
	for (let i = 0; i < n; i++) {
		const t = i * ratio;
		const j = Math.floor(t);
		const f = t - j;
		out[i] = (samples[j] ?? 0) * (1 - f) + (samples[j + 1] ?? samples[j] ?? 0) * f;
	}
	return out;
}

/** A WAV file (any common PCM format) to Sekai's 24 kHz mono 16-bit PCM. */
export function wavToPcm(wav: Uint8Array): Uint8Array {
	const info = parseWav(wav);
	if (!info) throw new Error("The voice service sent audio Sekai can't read (expected WAV)");
	const data = wav.subarray(info.dataOffset, info.dataOffset + info.dataLength);
	if (info.format === 1 && info.bits === 16 && info.channels === 1 && info.sampleRate === RATE) {
		return data.slice(0, data.length - (data.length % 2));
	}
	return floatTo16(resample(toMonoFloat(data, info), info.sampleRate, RATE));
}

/** 16-bit mono PCM at some rate to 24 kHz. */
export function pcm16ToRate(pcm: Uint8Array, from: number): Uint8Array {
	if (from === RATE) return pcm;
	return floatTo16(resample(toMonoFloat(pcm, { bits: 16, channels: 1, format: 1 }), from, RATE));
}

/** Loudness of a stretch of 16-bit PCM, 0–1. */
export function rms(pcm: Uint8Array): number {
	const b = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
	const n = Math.floor(b.length / 2);
	if (n === 0) return 0;
	let sum = 0;
	for (let i = 0; i < n; i++) {
		const v = b.readInt16LE(i * 2) / 0x8000;
		sum += v * v;
	}
	return Math.sqrt(sum / n);
}

/**
 * Finds where someone starts and stops talking, by loudness against the background noise. For speech-to-text
 * services that take finished clips: each clip ends after a pause.
 */
export class SpeechDetector {
	private frame = new Uint8Array(0);
	private noise = 0.004;
	private loudMs = 0;
	private quietMs = 0;
	private speaking = false;
	private clip: Uint8Array[] = [];
	private clipMs = 0;
	/** The last bit of audio before speech starts, so the first syllable isn't cut. */
	private lead: Uint8Array[] = [];

	constructor(
		private readonly on: {
			start(): void;
			/** A finished clip of speech (with a little lead-in). */
			end(clip: Uint8Array): void;
		},
		private readonly opts = { silenceMs: 700, minSpeechMs: 160, maxClipMs: 28_000 },
	) {}

	push(pcm: Uint8Array): void {
		const merged = new Uint8Array(this.frame.length + pcm.length);
		merged.set(this.frame);
		merged.set(pcm, this.frame.length);
		const step = (RATE / 50) * 2; // 20 ms
		let at = 0;
		for (; at + step <= merged.length; at += step) this.step(merged.slice(at, at + step));
		this.frame = merged.slice(at);
	}

	private step(f: Uint8Array): void {
		const level = rms(f);
		const loud = level > Math.max(0.012, this.noise * 3.2);
		if (!this.speaking) {
			// The background level follows quiet frames slowly.
			if (!loud) this.noise = this.noise * 0.97 + level * 0.03;
			this.lead.push(f);
			if (this.lead.length > 15) this.lead.shift();
			this.loudMs = loud ? this.loudMs + 20 : Math.max(0, this.loudMs - 20);
			if (this.loudMs >= this.opts.minSpeechMs) {
				this.speaking = true;
				this.quietMs = 0;
				this.clip = [...this.lead];
				this.clipMs = this.lead.length * 20;
				this.lead = [];
				this.on.start();
			}
			return;
		}
		this.clip.push(f);
		this.clipMs += 20;
		this.quietMs = loud ? 0 : this.quietMs + 20;
		if (this.quietMs >= this.opts.silenceMs || this.clipMs >= this.opts.maxClipMs) this.cut();
	}

	private cut(): void {
		const clip = Buffer.concat(this.clip);
		this.speaking = false;
		this.loudMs = 0;
		this.clip = [];
		this.clipMs = 0;
		this.on.end(new Uint8Array(clip));
	}

	/** Ends the clip in progress now (you pressed stop). */
	flush(): boolean {
		if (!this.speaking) return false;
		this.cut();
		return true;
	}

	get inSpeech(): boolean {
		return this.speaking;
	}
}
