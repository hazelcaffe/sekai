import type { ApiModel, VoiceInfo } from "@sekai/shared";
import { pcmToWav } from "../pcm.ts";
import { pcmFrom, type VoiceEndpoint, voiceError, wavBlob } from "./common.ts";

/** ElevenLabs: text to speech (streamed as 24 kHz PCM) and Scribe speech to text, batch and live. */

const headers = (e: VoiceEndpoint, json = true): Record<string, string> => ({
	"xi-api-key": e.apiKey,
	...(json ? { "content-type": "application/json" } : {}),
	...e.headers,
});

const base = { contextWindow: 128_000, maxOutputTokens: 16_000, vision: false, reasoning: false, dimensions: null };

/** Speech to text isn't in /v1/models. Live models stream words as you talk. */
const STT_MODELS: ApiModel[] = [
	{ ...base, id: "scribe_v3_live", name: "Scribe v3 Live", type: "stt" },
	{ ...base, id: "scribe_v3", name: "Scribe v3", type: "stt" },
	{ ...base, id: "scribe_v2_realtime", name: "Scribe v2 Realtime", type: "stt" },
	{ ...base, id: "scribe_v2", name: "Scribe v2", type: "stt" },
];

export const isLiveScribe = (model: string) => /_live$|_realtime$/.test(model);

export async function listElevenLabsModels(e: VoiceEndpoint): Promise<ApiModel[]> {
	const res = await fetch(`${e.url}/v1/models`, { headers: headers(e, false) });
	if (!res.ok) throw await voiceError(res, e.label);
	const list = (await res.json()) as { model_id: string; name?: string; can_do_text_to_speech?: boolean }[];
	const tts = list
		.filter((m) => m.can_do_text_to_speech)
		.map((m): ApiModel => ({ ...base, id: m.model_id, name: m.name ?? "", type: "tts" }));
	// Fastest first: what calls want.
	const rank = (id: string) => (/flash/.test(id) ? 0 : /turbo/.test(id) ? 1 : /v4|v3/.test(id) ? 2 : 3);
	tts.sort((a, b) => rank(a.id) - rank(b.id));
	return [...tts, ...STT_MODELS];
}

interface RawVoice {
	voice_id: string;
	name: string;
	category?: string;
	description?: string | null;
	labels?: Record<string, string>;
	preview_url?: string | null;
}

const previews = new Map<string, string>();

export async function listElevenLabsVoices(e: VoiceEndpoint, query = ""): Promise<VoiceInfo[]> {
	const out: VoiceInfo[] = [];
	let token: string | null = null;
	for (let page = 0; page < 10; page++) {
		const q = new URLSearchParams({ page_size: "100", include_total_count: "false" });
		if (query) q.set("search", query);
		if (token) q.set("next_page_token", token);
		const res = await fetch(`${e.url}/v2/voices?${q}`, { headers: headers(e, false) });
		if (!res.ok) throw await voiceError(res, e.label);
		const body = (await res.json()) as { voices: RawVoice[]; has_more?: boolean; next_page_token?: string | null };
		for (const v of body.voices) {
			if (v.preview_url) previews.set(v.voice_id, v.preview_url);
			const [name, ...rest] = v.name.split(" - ");
			const l = v.labels ?? {};
			out.push({
				id: v.voice_id,
				name: name?.trim() || v.name,
				description:
					rest.join(" - ").trim() ||
					v.description?.slice(0, 120) ||
					[l.accent, l.descriptive, l.use_case?.replace(/_/g, " ")].filter(Boolean).join(", "),
				language: l.language,
				gender: l.gender,
			});
		}
		if (!body.has_more || !body.next_page_token) break;
		token = body.next_page_token;
	}
	return out;
}

/** ElevenLabs' own sample of a voice (an MP3 on their CDN), when it has one. */
export async function elevenLabsPreviewUrl(e: VoiceEndpoint, voice: string): Promise<string | null> {
	if (!previews.has(voice)) {
		const res = await fetch(`${e.url}/v1/voices/${encodeURIComponent(voice)}`, { headers: headers(e, false) });
		if (res.ok) {
			const v = (await res.json()) as RawVoice;
			if (v.preview_url) previews.set(voice, v.preview_url);
		}
	}
	return previews.get(voice) ?? null;
}

export async function* elevenLabsSpeech(
	e: VoiceEndpoint,
	opts: {
		model: string;
		voice: string;
		text: string;
		language?: string;
		previousText?: string;
		signal?: AbortSignal;
	},
): AsyncGenerator<Uint8Array> {
	if (!opts.voice) throw new Error("Pick an ElevenLabs voice first");
	const res = await fetch(
		`${e.url}/v1/text-to-speech/${encodeURIComponent(opts.voice)}/stream?output_format=pcm_24000`,
		{
			method: "POST",
			headers: headers(e),
			body: JSON.stringify({
				text: opts.text,
				model_id: opts.model,
				...(opts.language && !/v3|v4/.test(opts.model) ? { language_code: opts.language.slice(0, 2) } : {}),
				...(opts.previousText ? { previous_text: opts.previousText.slice(-1000) } : {}),
			}),
			signal: opts.signal,
		},
	);
	if (!res.ok) throw await voiceError(res, e.label);
	yield* pcmFrom(res, { rate: 24_000, signal: opts.signal });
}

export async function elevenLabsTranscribe(
	e: VoiceEndpoint,
	opts: { model: string; pcm: Uint8Array; language?: string; signal?: AbortSignal },
): Promise<string> {
	const form = new FormData();
	// Live models have a batch twin.
	form.set("model_id", opts.model.replace(/_live$/, "").replace(/_realtime$/, ""));
	form.set("file", wavBlob(pcmToWav(opts.pcm)), "speech.wav");
	form.set("tag_audio_events", "false");
	if (opts.language) form.set("language_code", opts.language);
	const res = await fetch(`${e.url}/v1/speech-to-text`, {
		method: "POST",
		headers: { "xi-api-key": e.apiKey, ...e.headers },
		body: form,
		signal: opts.signal,
	});
	if (!res.ok) throw await voiceError(res, e.label);
	return ((await res.json()) as { text?: string }).text?.trim() ?? "";
}

/** Live speech to text: send 24 kHz PCM, get partial and committed (after a pause) transcripts. */
export function elevenLabsLiveUrl(e: VoiceEndpoint, opts: { model: string; language?: string; silenceSecs?: number }) {
	const q = new URLSearchParams({
		model_id: opts.model,
		audio_format: "pcm_24000",
		commit_strategy: "vad",
		vad_silence_threshold_secs: String(opts.silenceSecs ?? 0.8),
	});
	if (opts.language) q.set("language_code", opts.language);
	return `${e.url.replace(/^http/, "ws")}/v1/speech-to-text/realtime?${q}`;
}
