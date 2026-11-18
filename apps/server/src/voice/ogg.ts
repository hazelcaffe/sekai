import { createRequire } from "node:module";
import { RATE } from "./pcm.ts";

/**
 * 24 kHz mono 16-bit PCM → Ogg Opus, the format of voice messages (Discord's, and what browsers play). Written by
 * hand: Opus packets from opusscript, in Ogg pages per RFC 7845.
 */

const FRAME = RATE / 50; // 20 ms
const GRANULE_PER_FRAME = 960; // Ogg Opus counts 48 kHz samples
const PRE_SKIP = 312;
const FRAMES_PER_PAGE = 50;

type OpusScriptCtor = new (
	rate: number,
	channels: number,
	app: number,
) => {
	encode(pcm: Buffer, frameSize: number): Buffer;
	decode(packet: Buffer): Buffer;
	delete(): void;
	setBitrate(b: number): void;
};

let OpusScript: (OpusScriptCtor & { Application: { VOIP: number; AUDIO: number } }) | null = null;
function opus() {
	if (!OpusScript) OpusScript = createRequire(import.meta.url)("opusscript");
	return OpusScript as NonNullable<typeof OpusScript>;
}

const CRC_TABLE = (() => {
	const t = new Uint32Array(256);
	for (let i = 0; i < 256; i++) {
		let r = i << 24;
		for (let j = 0; j < 8; j++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
		t[i] = r >>> 0;
	}
	return t;
})();

function crc(buf: Uint8Array): number {
	let c = 0;
	for (const b of buf) c = ((c << 8) ^ (CRC_TABLE[((c >>> 24) ^ b) & 0xff] ?? 0)) >>> 0;
	return c >>> 0;
}

function page(
	packets: Uint8Array[],
	opts: { granule: bigint; serial: number; seq: number; first?: boolean; last?: boolean },
): Uint8Array {
	const lacing: number[] = [];
	for (const p of packets) {
		let n = p.length;
		while (n >= 255) {
			lacing.push(255);
			n -= 255;
		}
		lacing.push(n);
	}
	const header = Buffer.alloc(27 + lacing.length);
	header.write("OggS", 0, "ascii");
	header[4] = 0;
	header[5] = (opts.first ? 0x02 : 0) | (opts.last ? 0x04 : 0);
	header.writeBigInt64LE(opts.granule, 6);
	header.writeUInt32LE(opts.serial, 14);
	header.writeUInt32LE(opts.seq, 18);
	header.writeUInt32LE(0, 22);
	header[26] = lacing.length;
	lacing.forEach((v, i) => {
		header[27 + i] = v;
	});
	const out = Buffer.concat([header, ...packets.map((p) => Buffer.from(p))]);
	out.writeUInt32LE(crc(out), 22);
	return new Uint8Array(out);
}

/** 256 loudness samples (0–255), base64: how Discord draws a voice message. */
export function waveform(pcm: Uint8Array, points = 256): string {
	const b = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
	const n = Math.floor(b.length / 2);
	const out = Buffer.alloc(Math.min(points, Math.max(1, n)));
	const per = n / out.length;
	let max = 1;
	const raw = new Float32Array(out.length);
	for (let i = 0; i < out.length; i++) {
		let sum = 0;
		const start = Math.floor(i * per);
		const end = Math.max(start + 1, Math.floor((i + 1) * per));
		for (let j = start; j < end && j < n; j++) sum += Math.abs(b.readInt16LE(j * 2));
		raw[i] = sum / (end - start);
		max = Math.max(max, raw[i] ?? 0);
	}
	for (let i = 0; i < out.length; i++) out[i] = Math.round(((raw[i] ?? 0) / max) * 255);
	return out.toString("base64");
}

/** Encodes PCM as an Ogg Opus voice message. */
export function encodeOggOpus(pcm: Uint8Array): { data: Uint8Array; durationMs: number; waveform: string } {
	const Opus = opus();
	const enc = new Opus(RATE, 1, Opus.Application.VOIP);
	enc.setBitrate(32_000);
	const serial = (Math.random() * 0xffffffff) >>> 0;
	const pages: Uint8Array[] = [];
	let seq = 0;
	const head = Buffer.alloc(19);
	head.write("OpusHead", 0, "ascii");
	head[8] = 1;
	head[9] = 1;
	head.writeUInt16LE(PRE_SKIP, 10);
	head.writeUInt32LE(RATE, 12);
	head.writeInt16LE(0, 16);
	head[18] = 0;
	pages.push(page([head], { granule: 0n, serial, seq: seq++, first: true }));
	const vendor = Buffer.from("sekai");
	const tags = Buffer.alloc(8 + 4 + vendor.length + 4);
	tags.write("OpusTags", 0, "ascii");
	tags.writeUInt32LE(vendor.length, 8);
	vendor.copy(tags, 12);
	tags.writeUInt32LE(0, 12 + vendor.length);
	pages.push(page([tags], { granule: 0n, serial, seq: seq++ }));

	const bytesPerFrame = FRAME * 2;
	const total = Math.ceil(pcm.length / bytesPerFrame);
	let granule = BigInt(PRE_SKIP);
	let batch: Uint8Array[] = [];
	try {
		for (let i = 0; i < total; i++) {
			const frame = Buffer.alloc(bytesPerFrame);
			Buffer.from(pcm.subarray(i * bytesPerFrame, (i + 1) * bytesPerFrame)).copy(frame);
			batch.push(new Uint8Array(enc.encode(frame, FRAME)));
			granule += BigInt(GRANULE_PER_FRAME);
			const last = i === total - 1;
			if (batch.length === FRAMES_PER_PAGE || last) {
				pages.push(page(batch, { granule, serial, seq: seq++, last }));
				batch = [];
			}
		}
	} finally {
		enc.delete();
	}
	return {
		data: new Uint8Array(Buffer.concat(pages.map((p) => Buffer.from(p)))),
		durationMs: Math.round((pcm.length / 2 / RATE) * 1000),
		waveform: waveform(pcm),
	};
}

/** Ogg Opus back to 24 kHz PCM (for transcribing voice messages). Returns null for other formats. */
export function decodeOggOpus(ogg: Uint8Array): Uint8Array | null {
	const b = Buffer.from(ogg.buffer, ogg.byteOffset, ogg.byteLength);
	if (b.toString("ascii", 0, 4) !== "OggS") return null;
	const packets: Buffer[] = [];
	let at = 0;
	let partial: Buffer[] = [];
	while (at + 27 <= b.length && b.toString("ascii", at, at + 4) === "OggS") {
		const segs = b[at + 26] ?? 0;
		const table = b.subarray(at + 27, at + 27 + segs);
		let data = at + 27 + segs;
		for (const len of table) {
			partial.push(b.subarray(data, data + len));
			data += len;
			if (len < 255) {
				packets.push(Buffer.concat(partial));
				partial = [];
			}
		}
		at = data;
	}
	const head = packets[0];
	if (head?.toString("ascii", 0, 8) !== "OpusHead") return null;
	const channels = head[9] ?? 1;
	const Opus = opus();
	const dec = new Opus(48_000, channels, Opus.Application.VOIP);
	const out: Buffer[] = [];
	try {
		for (const p of packets.slice(2)) {
			const pcm = dec.decode(p);
			// 48 kHz → 24 kHz mono: average channels, keep every other sample.
			const frames = pcm.length / 2 / channels;
			const o = Buffer.alloc(Math.floor(frames / 2) * 2);
			for (let i = 0; i + 1 < frames; i += 2) {
				let sum = 0;
				for (let c = 0; c < channels; c++) sum += pcm.readInt16LE((i * channels + c) * 2);
				o.writeInt16LE(Math.round(sum / channels), i);
			}
			out.push(o);
		}
	} finally {
		dec.delete();
	}
	return new Uint8Array(Buffer.concat(out));
}
