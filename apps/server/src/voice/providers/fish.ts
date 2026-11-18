import { encode } from "@msgpack/msgpack";
import type { ApiModel, VoiceInfo } from "@sekai/shared";
import { CUSTOM_PREFIX, customReference } from "../custom.ts";
import { pcmToWav } from "../pcm.ts";
import { pcmFrom, type VoiceEndpoint, voiceError, wavBlob } from "./common.ts";

/**
 * Fish Audio: text to speech in any voice from its library (a voice is a "model" there; we call its id the
 * voice), and speech to text.
 */

const auth = (e: VoiceEndpoint): Record<string, string> => ({ authorization: `Bearer ${e.apiKey}`, ...e.headers });

const base = { contextWindow: 128_000, maxOutputTokens: 16_000, vision: false, reasoning: false, dimensions: null };

/** Fish lists no models; these are its speech engines (the free one first). */
export const FISH_MODELS: ApiModel[] = [
	{ ...base, id: "s2.1-pro-free", name: "S2.1 Pro (free)", type: "tts" },
	{ ...base, id: "s2.1-pro", name: "S2.1 Pro", type: "tts" },
	{ ...base, id: "s2-pro", name: "S2 Pro", type: "tts" },
	{ ...base, id: "s1", name: "S1", type: "tts" },
	{ ...base, id: "speech-1.6", name: "Speech 1.6", type: "tts" },
	{ ...base, id: "asr", name: "Fish ASR", type: "stt" },
];

interface RawVoice {
	_id: string;
	title: string;
	description?: string;
	languages?: string[];
	tags?: string[];
	cover_image?: string;
	task_count?: number;
	samples?: { audio?: string }[];
}

const COVER = "https://public-platform.r2.fish.audio";
const samples = new Map<string, string>();

function toVoice(v: RawVoice): VoiceInfo {
	if (v.samples?.[0]?.audio) samples.set(v._id, v.samples[0].audio);
	const uses = v.task_count
		? `${v.task_count >= 1000 ? `${Math.round(v.task_count / 1000)}k` : v.task_count} uses`
		: "";
	return {
		id: v._id,
		name: v.title.trim(),
		description: [v.description?.replace(/\s+/g, " ").trim().slice(0, 100), uses].filter(Boolean).join(" · "),
		language: v.languages?.join(", "),
		image: v.cover_image ? `${COVER}/${v.cover_image}` : null,
	};
}

export async function testFish(e: VoiceEndpoint): Promise<void> {
	const res = await fetch(`${e.url}/wallet/self/api-credit`, { headers: auth(e) });
	if (!res.ok) throw await voiceError(res, e.label);
}

/** One voice by id (or a fish.audio link to it). */
export async function fishVoice(e: VoiceEndpoint, idOrUrl: string): Promise<VoiceInfo | null> {
	const id = idOrUrl.match(/[0-9a-f]{32}/)?.[0];
	if (!id) return null;
	const res = await fetch(`${e.url}/model/${id}`, { headers: auth(e) });
	if (res.status === 404) return null;
	if (!res.ok) throw await voiceError(res, e.label);
	return toVoice((await res.json()) as RawVoice);
}

/** Your own voices first, then the library's most used ones matching the search. Paste a link to get that one. */
export async function searchFishVoices(e: VoiceEndpoint, query = ""): Promise<VoiceInfo[]> {
	const q = query.trim();
	if (/[0-9a-f]{32}/.test(q)) {
		const one = await fishVoice(e, q);
		return one ? [one] : [];
	}
	const params = (extra: Record<string, string>) =>
		new URLSearchParams({ page_size: "24", sort_by: "task_count", ...(q ? { title: q } : {}), ...extra });
	const [mine, library] = await Promise.all([
		fetch(`${e.url}/model?${params({ self: "true" })}`, { headers: auth(e) }),
		fetch(`${e.url}/model?${params({})}`, { headers: auth(e) }),
	]);
	if (!library.ok) throw await voiceError(library, e.label);
	const own = mine.ok ? ((await mine.json()) as { items: RawVoice[] }).items : [];
	const found = ((await library.json()) as { items: RawVoice[] }).items;
	const seen = new Set<string>();
	return [...own, ...found].filter((v) => !seen.has(v._id) && seen.add(v._id)).map(toVoice);
}

export const fishSampleUrl = (voice: string) => samples.get(voice) ?? null;

export async function* fishSpeech(
	e: VoiceEndpoint,
	opts: { model: string; voice: string; text: string; signal?: AbortSignal },
): AsyncGenerator<Uint8Array> {
	const body = {
		text: opts.text,
		format: "wav",
		sample_rate: 24_000,
		latency: "balanced",
	};
	// A voice Sekai keeps: its clip goes with the request (Fish only takes the audio bytes as msgpack).
	const own = opts.voice.startsWith(CUSTOM_PREFIX) ? await customReference(opts.voice) : null;
	const res = await fetch(`${e.url}/v1/tts`, {
		method: "POST",
		headers: {
			...auth(e),
			"content-type": own ? "application/msgpack" : "application/json",
			model: opts.model,
		},
		body: own
			? encode({ ...body, references: [{ audio: own.audio, text: own.text }] })
			: JSON.stringify({ ...body, ...(opts.voice ? { reference_id: opts.voice } : {}) }),
		signal: opts.signal,
	});
	if (!res.ok) throw await voiceError(res, e.label);
	yield* pcmFrom(res, { signal: opts.signal });
}

export async function fishTranscribe(
	e: VoiceEndpoint,
	opts: { pcm: Uint8Array; language?: string; signal?: AbortSignal },
): Promise<string> {
	const form = new FormData();
	form.set("audio", wavBlob(pcmToWav(opts.pcm)), "speech.wav");
	form.set("ignore_timestamps", "true");
	if (opts.language) form.set("language", opts.language);
	const res = await fetch(`${e.url}/v1/asr`, { method: "POST", headers: auth(e), body: form, signal: opts.signal });
	if (!res.ok) throw await voiceError(res, e.label);
	return ((await res.json()) as { text?: string }).text?.trim() ?? "";
}
