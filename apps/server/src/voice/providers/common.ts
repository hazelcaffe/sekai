import { parseWav, pcm16ToRate, RATE, wavToPcm } from "../pcm.ts";

/** Where a voice API lives and how to sign in to it (an API provider from Admin). */
export interface VoiceEndpoint {
	/** Base URL, no trailing slash. */
	url: string;
	apiKey: string;
	headers: Record<string, string>;
	/** The provider's name, for errors. */
	label: string;
}

/** The useful part of an error reply from ElevenLabs or Fish Audio. */
export async function voiceError(res: Response, label: string): Promise<Error> {
	const text = await res.text().catch(() => "");
	let message = text.slice(0, 400) || res.statusText;
	try {
		const body = JSON.parse(text) as {
			detail?: string | { message?: string; status?: string } | { msg?: string }[];
			// Fish Audio: { message }, ElevenLabs: { detail }
			error?: string | { message?: string };
			message?: string;
		};
		const d = body.detail;
		message =
			(typeof d === "string"
				? d
				: Array.isArray(d)
					? d.map((x) => x.msg).join("; ")
					: (d?.message ?? d?.status)) ??
			(typeof body.error === "string" ? body.error : body.error?.message) ??
			body.message ??
			message;
	} catch {}
	if (res.status === 401 || res.status === 403) {
		return new Error(`${label} didn't accept the API key (${res.status}): ${message}`);
	}
	if (res.status === 402) return new Error(`${label}: out of credits or the plan doesn't include this (${message})`);
	if (res.status === 429) return new Error(`${label} is rate limiting: ${message}`);
	return new Error(`${label} (${res.status}): ${message}`);
}

/** Bytes of a fetch body as they arrive. */
export async function* bodyChunks(res: Response, signal?: AbortSignal): AsyncGenerator<Uint8Array> {
	if (!res.body) return;
	const reader = res.body.getReader();
	try {
		for (;;) {
			if (signal?.aborted) return;
			const { done, value } = await reader.read();
			if (done) return;
			if (value?.length) yield value;
		}
	} finally {
		reader.releaseLock();
		if (signal?.aborted) await res.body.cancel().catch(() => {});
	}
}

/**
 * A streamed audio reply as Sekai's 24 kHz mono 16-bit PCM: raw PCM at a known rate, or a WAV (its header is
 * read from the first bytes, then the samples stream through).
 */
export async function* pcmFrom(
	res: Response,
	opts: { rate?: number; signal?: AbortSignal } = {},
): AsyncGenerator<Uint8Array> {
	const type = res.headers.get("content-type") ?? "";
	let head = new Uint8Array(0);
	let rate = opts.rate ?? RATE;
	let wav: boolean | null = /wav|wave/i.test(type) ? true : null;
	let odd: number | null = null;
	let full: Uint8Array[] | null = null;
	for await (const chunk of bodyChunks(res, opts.signal)) {
		let data = chunk;
		if (wav !== false && head !== null) {
			const merged = new Uint8Array(head.length + data.length);
			merged.set(head);
			merged.set(data, head.length);
			if (wav === null) {
				if (merged.length < 4) {
					head = merged;
					continue;
				}
				wav = Buffer.from(merged.subarray(0, 4)).toString("ascii") === "RIFF";
				if (!wav) {
					data = merged;
					head = new Uint8Array(0);
				}
			}
			if (wav) {
				const info = parseWav(merged);
				if (!info) {
					head = merged;
					if (merged.length > 64 * 1024) throw new Error("Couldn't read the audio the voice service sent");
					continue;
				}
				if (info.format !== 1 || info.bits !== 16 || info.channels !== 1) {
					// Unusual WAVs are converted in one go at the end.
					full = [merged];
					wav = false;
					head = new Uint8Array(0);
					continue;
				}
				rate = info.sampleRate;
				data = merged.subarray(info.dataOffset);
				head = new Uint8Array(0);
				wav = false;
			}
		}
		if (full) {
			full.push(data);
			continue;
		}
		// Keep samples whole across chunk boundaries.
		if (odd !== null) {
			const merged = new Uint8Array(data.length + 1);
			merged[0] = odd;
			merged.set(data, 1);
			data = merged;
			odd = null;
		}
		if (data.length % 2) {
			odd = data[data.length - 1] ?? 0;
			data = data.subarray(0, data.length - 1);
		}
		if (data.length) yield pcm16ToRate(data, rate);
	}
	if (full) yield wavToPcm(new Uint8Array(Buffer.concat(full)));
}

/** A multipart upload of 24 kHz PCM as a WAV file. */
export function wavBlob(wav: Uint8Array): Blob {
	return new Blob([wav], { type: "audio/wav" });
}
