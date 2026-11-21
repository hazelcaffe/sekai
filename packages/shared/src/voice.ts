import { z } from "zod";
import { type ApiKind, parseApiModel } from "./model-provider.ts";
import { patchOf } from "./patch.ts";

/**
 * What a voice model does (voice models come from ElevenLabs and Fish Audio, added in Settings → Bots → Voice):
 * - tts: text to speech (talking on calls, reading messages aloud, voice messages)
 * - stt: speech to text (hearing you on calls, dictation, your voice messages)
 */
export const VOICE_CAPS = ["tts", "stt"] as const;
export type VoiceCap = (typeof VOICE_CAPS)[number];

export interface VoiceModelInfo {
	/** "api_abc::eleven_flash_v2_5": a model of one of your voice services. */
	id: string;
	name: string;
	cap: VoiceCap;
	/** The service's name. */
	source: string;
	kind: ApiKind;
	/** The voices are a big library you search by name (Fish Audio). */
	searchable: boolean;
	/** Speech to text: words show up while you talk. */
	live: boolean;
}

/** A voice you made in Sekai (from a description or a recording), on Fish Audio or ElevenLabs. */
export interface CustomVoice {
	/** Pick it by this (a bot's speaking voice). */
	voiceId: string;
	providerId: string;
	kind: "fishaudio" | "elevenlabs";
	name: string;
	description: string;
	source: "description" | "recording";
	/** A speech model of the same service to talk with it. */
	model: string;
	createdAt: number;
}

/** One of the voices a description came out as: hear it, then keep the one you like. */
export interface VoiceCandidate {
	id: string;
	/** The sample, as a data: URL. */
	audio: string;
	durationMs: number;
	text: string;
	/** What the service heard in it (Fish Audio: gender, age, accent, tone…). */
	traits?: string;
}

export interface VoiceInfo {
	id: string;
	name: string;
	description?: string;
	language?: string;
	gender?: string;
	/** A picture for the voice (Fish Audio covers). */
	image?: string | null;
}

/**
 * A voice model of one of your voice services ("api_abc::eleven_flash_v2_5"). Anything else (models of services
 * Sekai doesn't have any more, in settings saved long ago) reads as none picked, so old settings still load.
 */
const isVoiceModel = (id: string) => parseApiModel(id) !== null;
const ModelId = z
	.string()
	.trim()
	.max(300)
	.transform((id) => (isVoiceModel(id) ? id : ""));
const OwnModelId = z
	.string()
	.trim()
	.max(300)
	.nullable()
	.transform((id) => (id && isVoiceModel(id) ? id : null));
const VoiceId = z.string().trim().max(200);

/**
 * Defaults for every bot (Settings → Bots → Voice). On calls you're heard with the speech-to-text model, the bot's
 * own model answers (with all its tools), and the speaking voice reads the answer out as it's written.
 */
export const VoiceSettings = z.object({
	/** Talking on calls, reading aloud and voice messages. */
	ttsModel: ModelId.default(""),
	ttsVoice: VoiceId.default(""),
	/** The voice's name, so it shows without asking the provider. */
	ttsVoiceName: z.string().trim().max(200).default(""),
	/** Hearing you on calls, dictation and your voice messages. */
	sttModel: ModelId.default(""),
	/** BCP-47 code (e.g. "en", "ja"); empty to detect. */
	language: z.string().trim().max(20).default(""),
});
export type VoiceSettings = z.infer<typeof VoiceSettings>;

export const VoiceSettingsUpdate = patchOf(VoiceSettings);
export type VoiceSettingsUpdate = z.input<typeof VoiceSettingsUpdate>;

/** A bot's own voice. Anything left null uses the default from Settings → Bots → Voice. */
export const AgentVoice = z.object({
	ttsModel: OwnModelId.default(null),
	ttsVoice: VoiceId.nullable().default(null),
	ttsVoiceName: z.string().trim().max(200).nullable().default(null),
	sttModel: OwnModelId.default(null),
	language: z.string().trim().max(20).nullable().default(null),
});
export type AgentVoice = z.infer<typeof AgentVoice>;

/**
 * A bot's voice with the defaults filled in. A model and its voice go together: a bot that picks its own model
 * also uses its own voice for it (or the model's default voice).
 */
export function resolveVoice(defaults: VoiceSettings, own: Partial<AgentVoice> | null | undefined): VoiceSettings {
	const o = own ?? {};
	const pick = <K extends keyof VoiceSettings>(k: K): VoiceSettings[K] => (o[k] ?? defaults[k]) as VoiceSettings[K];
	const ttsOwn = o.ttsModel != null && o.ttsModel !== defaults.ttsModel;
	const ttsModel = pick("ttsModel");
	return {
		ttsModel,
		// No speaking model, no voice (a voice of another service would only confuse it).
		ttsVoice: !ttsModel ? "" : ttsOwn ? (o.ttsVoice ?? "") : pick("ttsVoice"),
		ttsVoiceName: !ttsModel ? "" : ttsOwn ? (o.ttsVoiceName ?? "") : pick("ttsVoiceName"),
		sttModel: pick("sttModel"),
		language: pick("language"),
	};
}

/** Message text as it should be read out: no Markdown symbols, code or bare links. */
export function speakableText(markdown: string): string {
	return (
		markdown
			// Code blocks aren't read out.
			.replace(/```[\s\S]*?(```|$)/g, "\n(code)\n")
			.replace(/\$\$[\s\S]*?\$\$/g, " (formula) ")
			.replace(/`([^`]+)`/g, "$1")
			// Images go, links keep their words.
			.replace(/!\[[^\]]*\]\([^)]*\)/g, "")
			.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
			.replace(/<?https?:\/\/[^\s>)]+>?/g, "(link)")
			// Headings, quotes, list markers, tables, rules, emphasis.
			.replace(/^\s{0,3}#{1,6}\s+/gm, "")
			.replace(/^\s{0,3}>\s?/gm, "")
			.replace(/^\s*[-*+]\s+\[[ xX]\]\s+/gm, "")
			.replace(/^\s*[-*+]\s+/gm, "")
			.replace(/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/gm, "")
			.replace(/\|/g, ", ")
			.replace(/^\s*([-*_]\s*){3,}$/gm, "")
			.replace(/(\*\*|__)(.+?)\1/g, "$2")
			.replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,!?:;]|$)/g, "$1$2")
			.replace(/~~(.+?)~~/g, "$1")
			.replace(/\$([^$\n]+)\$/g, "$1")
			.replace(/<\/?[a-z][^>]*>/gi, "")
			.replace(/[ \t]+/g, " ")
			.replace(/\n{3,}/g, "\n\n")
			.trim()
	);
}

const SENTENCE_END = new Set([".", "!", "?", "。", "！", "？"]);
const CLOSERS = new Set(['"', "'", ")", "]"]);

/** Sentences (with their end marks and closing quotes), and line breaks as breaks: one pass, no backtracking. */
function splitSentences(text: string): string[] {
	const out: string[] = [];
	let start = 0;
	let i = 0;
	while (i < text.length) {
		const ch = text[i] as string;
		if (ch === "\n") {
			while (i < text.length && text[i] === "\n") i++;
			out.push(text.slice(start, i));
			start = i;
			continue;
		}
		if (SENTENCE_END.has(ch)) {
			while (i < text.length && SENTENCE_END.has(text[i] as string)) i++;
			while (i < text.length && CLOSERS.has(text[i] as string)) i++;
			out.push(text.slice(start, i));
			start = i;
			continue;
		}
		i++;
	}
	if (start < text.length) out.push(text.slice(start));
	return out.length ? out : [text];
}

/**
 * Cuts text into pieces of at most `max` characters, at sentence ends where it can (for text-to-speech
 * services with a length limit, and to start speaking sooner).
 */
export function speechChunks(text: string, max: number): string[] {
	const sentences = splitSentences(text);
	const out: string[] = [];
	let cur = "";
	for (const raw of sentences) {
		const s = raw.trim();
		if (!s) continue;
		if (s.length > max) {
			if (cur) out.push(cur);
			cur = "";
			// Too long for one piece: break between words (or anywhere, for text without spaces).
			let rest = s;
			while (rest.length > max) {
				const space = rest.lastIndexOf(" ", max);
				const at = space > max / 2 ? space : max;
				out.push(rest.slice(0, at).trim());
				rest = rest.slice(at).trim();
			}
			if (rest) cur = rest;
			continue;
		}
		if (cur && cur.length + 1 + s.length > max) {
			out.push(cur);
			cur = s;
		} else cur = cur ? `${cur} ${s}` : s;
	}
	if (cur) out.push(cur);
	return out;
}
