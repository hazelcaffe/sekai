import { z } from "zod";
import { patchOf } from "./patch.ts";

/**
 * API providers: any server that speaks a well-known model API, used like the model gateway.
 * - openai: OpenAI Chat Completions (OpenAI, OpenRouter, Groq, Together, DeepSeek, Mistral, xAI, Ollama, LM Studio, vLLM…)
 * - anthropic: Anthropic Messages (Anthropic, and services that offer a Messages-compatible endpoint)
 * - google: Gemini generateContent
 * Voice only:
 * - elevenlabs: ElevenLabs text to speech and Scribe speech to text
 * - fishaudio: Fish Audio text to speech (with its library of community voices) and speech to text
 */
export const API_KINDS = ["openai", "anthropic", "google", "elevenlabs", "fishaudio"] as const;
export type ApiKind = (typeof API_KINDS)[number];

/** Kinds with chat and embedding models. */
export const CHAT_KINDS: readonly ApiKind[] = ["openai", "anthropic", "google"];
/** Kinds that only do voice. */
export const VOICE_KINDS: readonly ApiKind[] = ["elevenlabs", "fishaudio"];

export const API_KIND_LABELS: Record<ApiKind, string> = {
	openai: "OpenAI-compatible",
	anthropic: "Anthropic-compatible",
	google: "Google Gemini",
	elevenlabs: "ElevenLabs",
	fishaudio: "Fish Audio",
};

export interface ApiPreset {
	id: string;
	name: string;
	kind: ApiKind;
	baseUrl: string;
	/** Where to get a key. */
	keyUrl?: string;
	/** Runs on your own machine; usually no key. */
	local?: boolean;
	hint?: string;
	/** Where it's offered: Admin → Models or Admin → Voice. */
	scope: "models" | "voice";
}

export const API_PRESETS: ApiPreset[] = [
	{
		id: "openai",
		name: "OpenAI",
		scope: "models",
		kind: "openai",
		baseUrl: "https://api.openai.com/v1",
		keyUrl: "https://platform.openai.com/api-keys",
	},
	{
		id: "anthropic",
		name: "Anthropic",
		scope: "models",
		kind: "anthropic",
		baseUrl: "https://api.anthropic.com/v1",
		keyUrl: "https://console.anthropic.com/settings/keys",
	},
	{
		id: "google",
		name: "Google Gemini",
		scope: "models",
		kind: "google",
		baseUrl: "https://generativelanguage.googleapis.com/v1beta",
		keyUrl: "https://aistudio.google.com/apikey",
	},
	{
		id: "openrouter",
		name: "OpenRouter",
		scope: "models",
		kind: "openai",
		baseUrl: "https://openrouter.ai/api/v1",
		keyUrl: "https://openrouter.ai/settings/keys",
	},
	{
		id: "xai",
		name: "xAI",
		scope: "models",
		kind: "openai",
		baseUrl: "https://api.x.ai/v1",
		keyUrl: "https://console.x.ai",
	},
	{
		id: "groq",
		name: "Groq",
		scope: "models",
		kind: "openai",
		baseUrl: "https://api.groq.com/openai/v1",
		keyUrl: "https://console.groq.com/keys",
	},
	{
		id: "mistral",
		name: "Mistral",
		scope: "models",
		kind: "openai",
		baseUrl: "https://api.mistral.ai/v1",
		keyUrl: "https://console.mistral.ai/api-keys",
	},
	{
		id: "deepseek",
		name: "DeepSeek",
		scope: "models",
		kind: "openai",
		baseUrl: "https://api.deepseek.com/v1",
		keyUrl: "https://platform.deepseek.com/api_keys",
	},
	{
		id: "together",
		name: "Together AI",
		scope: "models",
		kind: "openai",
		baseUrl: "https://api.together.xyz/v1",
		keyUrl: "https://api.together.ai/settings/api-keys",
	},
	{
		id: "ollama",
		name: "Ollama",
		scope: "models",
		kind: "openai",
		baseUrl: "http://127.0.0.1:11434/v1",
		local: true,
		hint: "Models you've pulled with `ollama pull`.",
	},
	{
		id: "lmstudio",
		name: "LM Studio",
		scope: "models",
		kind: "openai",
		baseUrl: "http://127.0.0.1:1234/v1",
		local: true,
		hint: "Start the local server in LM Studio's Developer tab.",
	},
	{ id: "custom-openai", name: "Other (OpenAI-compatible)", scope: "models", kind: "openai", baseUrl: "" },
	{ id: "custom-anthropic", name: "Other (Anthropic-compatible)", scope: "models", kind: "anthropic", baseUrl: "" },
	{
		id: "elevenlabs",
		name: "ElevenLabs",
		scope: "voice",
		kind: "elevenlabs",
		baseUrl: "https://api.elevenlabs.io",
		keyUrl: "https://elevenlabs.io/app/settings/api-keys",
		hint: "Lifelike voices for reading aloud and calls (Flash v2.5 answers fastest), and Scribe for dictation.",
	},
	{
		id: "fishaudio",
		name: "Fish Audio",
		scope: "voice",
		kind: "fishaudio",
		baseUrl: "https://api.fish.audio",
		keyUrl: "https://fish.audio/app/api-keys",
		hint: "Thousands of community voices, including characters: search them by name when you pick a voice.",
	},
];

/** A model you list by hand (when the provider can't list its own, or to set its limits). */
export const ApiModel = z.object({
	id: z.string().trim().min(1).max(200),
	name: z.string().trim().max(120).default(""),
	/** tts: text to speech, stt: speech to text (ElevenLabs, Fish Audio). */
	type: z.enum(["chat", "embedding", "tts", "stt"]).default("chat"),
	contextWindow: z.number().int().min(1024).max(10_000_000).default(128_000),
	maxOutputTokens: z.number().int().min(256).max(1_000_000).default(16_000),
	vision: z.boolean().default(false),
	reasoning: z.boolean().default(false),
	/** Embedding models: vector size, when known. */
	dimensions: z.number().int().min(1).max(16_000).nullable().default(null),
});
export type ApiModel = z.infer<typeof ApiModel>;

const Header = z.string().trim().min(1).max(200);

export const ApiProviderCreate = z.object({
	name: z.string().trim().min(1).max(60),
	preset: z.string().max(40).default("custom-openai"),
	kind: z.enum(API_KINDS),
	baseUrl: z.string().trim().url("Enter the API's base URL, e.g. https://api.example.com/v1").max(500),
	apiKey: z.string().max(4000).default(""),
	/** Extra request headers (e.g. OpenRouter's HTTP-Referer). */
	headers: z.record(Header, z.string().max(2000)).default({}),
	/** Ask the provider for its model list (GET /models). */
	discover: z.boolean().default(true),
	models: z.array(ApiModel).max(500).default([]),
	enabled: z.boolean().default(true),
});
export type ApiProviderCreate = z.input<typeof ApiProviderCreate>;

export const ApiProviderUpdate = patchOf(ApiProviderCreate);
export type ApiProviderUpdate = z.input<typeof ApiProviderUpdate>;

export interface ApiProvider {
	id: string;
	name: string;
	preset: string;
	kind: ApiKind;
	baseUrl: string;
	/** Masked. */
	apiKey: string;
	headers: Record<string, string>;
	discover: boolean;
	models: ApiModel[];
	enabled: boolean;
	createdAt: number;
	updatedAt: number;
}

export interface ApiProviderStatus {
	ok: boolean;
	error: string | null;
	/** Models found (listed by the provider, plus the ones you added). */
	chatModels: number;
	embeddingModels: number;
	/** Text-to-speech and speech-to-text models. */
	voiceModels: number;
	checkedAt: number | null;
}

export type ApiProviderWithStatus = ApiProvider & { status: ApiProviderStatus };

/** Model ids for API providers look like "api_abc123::gpt-5.5". */
export const API_SEPARATOR = "::";

export function apiModelId(providerId: string, model: string): string {
	return `${providerId}${API_SEPARATOR}${model}`;
}

export function parseApiModel(id: string): { providerId: string; model: string } | null {
	if (!id.startsWith("api_")) return null;
	const at = id.indexOf(API_SEPARATOR);
	if (at < 0) return null;
	return { providerId: id.slice(0, at), model: id.slice(at + API_SEPARATOR.length) };
}

/** An embedding model, from the gateway or an API provider. */
export interface EmbeddingModelInfo {
	id: string;
	name: string;
	/** "Model gateway" or the provider's name. */
	source: string;
	dimensions: number | null;
}
