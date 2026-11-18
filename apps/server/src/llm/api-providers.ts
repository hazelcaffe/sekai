import {
	type ApiModel,
	type ApiProvider,
	ApiProviderCreate,
	type ApiProviderStatus,
	ApiProviderUpdate,
	type ApiProviderWithStatus,
	apiModelId,
	CHAT_KINDS,
	type EmbeddingModelInfo,
	type ModelInfo,
	parseApiModel,
	VOICE_KINDS,
} from "@sekai/shared";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.ts";
import { bus } from "../events/bus.ts";
import { badRequest, errorMessage, notFound, parse } from "../lib/errors.ts";
import { newId } from "../lib/ids.ts";
import { log } from "../lib/log.ts";
import { seal, unseal } from "../lib/secrets.ts";
import type { VoiceEndpoint } from "../voice/providers/common.ts";
import { listElevenLabsModels } from "../voice/providers/elevenlabs.ts";
import { FISH_MODELS, testFish } from "../voice/providers/fish.ts";
import { type AnthropicEndpoint, listAnthropicModels, streamAnthropic } from "./anthropic.ts";
import { embedGemini, type GoogleEndpoint, listGeminiModels, streamGemini } from "./google.ts";
import { embedOpenAI, listOpenAIModels, type OpenAIEndpoint, streamOpenAI } from "./openai.ts";
import type { ChatRequest, StreamEvent } from "./types.ts";

type Row = typeof schema.apiProviders.$inferSelect;

interface Loaded {
	row: Row;
	apiKey: string;
}

const MASK = "••••";
const TTL_MS = 5 * 60_000;

let rows: Map<string, Loaded> | null = null;
const discovered = new Map<string, { at: number; models: ApiModel[]; status: ApiProviderStatus }>();

async function load(): Promise<Map<string, Loaded>> {
	if (rows) return rows;
	const all = await db.select().from(schema.apiProviders).orderBy(schema.apiProviders.createdAt);
	rows = new Map(
		all.map((r) => {
			let apiKey = "";
			try {
				apiKey = r.apiKey ? unseal(r.apiKey) : "";
			} catch (err) {
				log.warn(`couldn't decrypt the key for ${r.name}: ${errorMessage(err)}`);
			}
			return [r.id, { row: r, apiKey }];
		}),
	);
	return rows;
}

function mask(key: string): string {
	if (!key) return "";
	return key.length <= 8 ? MASK : `${key.slice(0, 3)}…${key.slice(-4)}`;
}

/** Headers that carry credentials (Authorization, api-key, x-api-key…) are masked for the app. */
const SECRET_HEADER = /auth|key|token|secret|cookie|session/i;

function maskHeaders(headers: Record<string, string>): Record<string, string> {
	return Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, SECRET_HEADER.test(k) ? mask(v) : v]));
}

/** Headers from the form, with masked values replaced by the stored ones. */
function unmaskHeaders(next: Record<string, string>, old: Record<string, string>): Record<string, string> {
	return Object.fromEntries(
		Object.entries(next).map(([k, v]) => [k, old[k] !== undefined && v === mask(old[k]) ? old[k] : v]),
	);
}

function toPublic(p: Loaded): ApiProvider {
	const r = p.row;
	return {
		id: r.id,
		name: r.name,
		preset: r.preset,
		kind: r.kind,
		baseUrl: r.baseUrl,
		apiKey: mask(p.apiKey),
		headers: maskHeaders(r.headers),
		discover: r.discover,
		models: r.models,
		enabled: r.enabled,
		createdAt: r.createdAt,
		updatedAt: r.updatedAt,
	};
}

const EMPTY_STATUS: ApiProviderStatus = {
	ok: false,
	error: null,
	chatModels: 0,
	embeddingModels: 0,
	voiceModels: 0,
	checkedAt: null,
};

function withStatus(p: Loaded): ApiProviderWithStatus {
	return { ...toPublic(p), status: discovered.get(p.row.id)?.status ?? EMPTY_STATUS };
}

const cleanUrl = (url: string) => url.trim().replace(/\/+$/, "");

function voiceEndpoint(p: Loaded): VoiceEndpoint {
	return { url: p.row.baseUrl, apiKey: p.apiKey, headers: p.row.headers, label: p.row.name };
}

function endpoint(p: Loaded): OpenAIEndpoint & AnthropicEndpoint & GoogleEndpoint {
	return {
		url: p.row.baseUrl,
		apiKey: p.apiKey,
		headers: p.row.headers,
		label: p.row.name,
		bearer: p.row.preset !== "anthropic",
	};
}

// ---------------------------------------------------------------- discovery

const NOT_CHAT =
	/whisper|tts|dall-e|gpt-image|image-gen|imagen|veo|moderation|realtime|transcribe|audio|sora|davinci|babbage|-live\b|native-audio/i;

/** A model id that names something other than a chat model (speech, images, video, moderation…). */
export const notChatModel = (id: string) => NOT_CHAT.test(id);

async function discover(p: Loaded): Promise<ApiModel[]> {
	const e = endpoint(p);
	const base = {
		name: "",
		contextWindow: 128_000,
		maxOutputTokens: 16_000,
		vision: false,
		reasoning: false,
		dimensions: null,
	};
	if (p.row.kind === "elevenlabs") return listElevenLabsModels(voiceEndpoint(p));
	if (p.row.kind === "fishaudio") {
		await testFish(voiceEndpoint(p));
		return FISH_MODELS;
	}
	if (p.row.kind === "openai") {
		const list = await listOpenAIModels(e);
		return list.flatMap((m): ApiModel[] => {
			const embedding = m.type === "embedding" || /embed/i.test(m.id);
			if (!embedding && (notChatModel(m.id) || (m.type && m.type !== "chat"))) return [];
			return [
				{
					...base,
					id: m.id,
					name: m.name && m.name !== m.id ? m.name : "",
					type: embedding ? "embedding" : "chat",
					contextWindow: m.context_window ?? base.contextWindow,
					maxOutputTokens: m.max_output_tokens ?? base.maxOutputTokens,
					vision:
						m.vision ??
						/gpt-4o|gpt-4\.1|gpt-5|vision|vl\b|llava|gemma-3|claude|gemini|grok-4|pixtral/i.test(m.id),
					reasoning:
						(m.reasoning_efforts?.length ?? 0) > 0 ||
						/\bo[134]\b|o[134]-|gpt-5|reason|think|r1\b|grok-[34]/i.test(m.id),
				},
			];
		});
	}
	if (p.row.kind === "anthropic") {
		const list = await listAnthropicModels(e);
		return list.map((m) => ({
			...base,
			id: m.id,
			name: m.display_name ?? "",
			type: "chat" as const,
			contextWindow: m.max_input_tokens ?? 200_000,
			maxOutputTokens: m.max_tokens ?? 32_000,
			vision: true,
			reasoning: !/claude-(2|instant|3-(haiku|sonnet|opus|5))/i.test(m.id),
		}));
	}
	const list = await listGeminiModels(e);
	return list.flatMap((m): ApiModel[] => {
		const id = m.name.replace(/^models\//, "");
		const methods = m.supportedGenerationMethods ?? [];
		if (methods.includes("embedContent")) {
			return [
				{ ...base, id, name: m.displayName ?? "", type: "embedding", contextWindow: m.inputTokenLimit ?? 2048 },
			];
		}
		if (!methods.includes("generateContent") || NOT_CHAT.test(id) || /tts|image/i.test(id)) return [];
		return [
			{
				...base,
				id,
				name: m.displayName ?? "",
				type: "chat",
				contextWindow: m.inputTokenLimit ?? 1_000_000,
				maxOutputTokens: m.outputTokenLimit ?? 65_536,
				vision: true,
				reasoning: m.thinking ?? /2\.5|-3/.test(id),
			},
		];
	});
}

/** The provider's models: the ones it lists (when discovery is on) with the ones you added on top. */
async function modelsOf(p: Loaded, refresh = false): Promise<ApiModel[]> {
	const cached = discovered.get(p.row.id);
	if (!refresh && cached && Date.now() - cached.at < TTL_MS) return cached.models;
	let found: ApiModel[] = [];
	let error: string | null = null;
	if (p.row.discover) {
		try {
			found = await discover(p);
		} catch (err) {
			error = errorMessage(err);
			if (cached) found = cached.models.filter((m) => !p.row.models.some((x) => x.id === m.id));
		}
	}
	const manual = new Map(p.row.models.map((m) => [m.id, m]));
	const models = [...found.filter((m) => !manual.has(m.id)), ...manual.values()];
	const status: ApiProviderStatus = {
		ok: !error && (models.length > 0 || !p.row.discover),
		error: error ?? (models.length === 0 ? "No models: add one by hand, or check the URL and key." : null),
		chatModels: models.filter((m) => m.type === "chat").length,
		embeddingModels: models.filter((m) => m.type === "embedding").length,
		voiceModels: models.filter((m) => m.type === "tts" || m.type === "stt").length,
		checkedAt: Date.now(),
	};
	discovered.set(p.row.id, { at: Date.now(), models, status });
	return models;
}

// ---------------------------------------------------------------- public

export async function listApiProviders(): Promise<ApiProviderWithStatus[]> {
	const all = [...(await load()).values()];
	await Promise.all(all.filter((p) => !discovered.has(p.row.id)).map((p) => modelsOf(p).catch(() => [])));
	return all.map(withStatus);
}

export async function getApiProvider(id: string): Promise<ApiProviderWithStatus> {
	const p = (await load()).get(id);
	if (!p) throw notFound("API provider");
	return withStatus(p);
}

function changed(): void {
	bus.emit({ type: "settings.changed" });
}

export async function createApiProvider(input: unknown): Promise<ApiProviderWithStatus> {
	const data = parse(ApiProviderCreate, input);
	const now = Date.now();
	const row: Row = {
		id: newId("api", 12),
		name: data.name,
		preset: data.preset,
		kind: data.kind,
		baseUrl: cleanUrl(data.baseUrl),
		apiKey: data.apiKey ? seal(data.apiKey.trim()) : "",
		headers: data.headers,
		discover: data.discover,
		models: data.models,
		enabled: data.enabled,
		createdAt: now,
		updatedAt: now,
	};
	await db.insert(schema.apiProviders).values(row);
	const loaded = { row, apiKey: data.apiKey.trim() };
	(await load()).set(row.id, loaded);
	await modelsOf(loaded, true);
	changed();
	return withStatus(loaded);
}

export async function updateApiProvider(id: string, input: unknown): Promise<ApiProviderWithStatus> {
	const p = (await load()).get(id);
	if (!p) throw notFound("API provider");
	const patch = parse(ApiProviderUpdate, input);
	const set: Partial<Row> = { updatedAt: Date.now() };
	if (patch.name !== undefined) set.name = patch.name;
	if (patch.kind !== undefined) set.kind = patch.kind;
	if (patch.preset !== undefined) set.preset = patch.preset;
	if (patch.baseUrl !== undefined) set.baseUrl = cleanUrl(patch.baseUrl);
	// Masked values come back unchanged from the form: keep the real ones.
	if (patch.headers !== undefined) set.headers = unmaskHeaders(patch.headers, p.row.headers);
	if (patch.discover !== undefined) set.discover = patch.discover;
	if (patch.models !== undefined) set.models = patch.models;
	if (patch.enabled !== undefined) set.enabled = patch.enabled;
	let apiKey = p.apiKey;
	// The masked key comes back unchanged from the form: keep the real one.
	if (
		patch.apiKey !== undefined &&
		patch.apiKey !== mask(p.apiKey) &&
		!patch.apiKey.includes("…") &&
		patch.apiKey !== MASK
	) {
		apiKey = patch.apiKey.trim();
		set.apiKey = apiKey ? seal(apiKey) : "";
	}
	const [row] = await db.update(schema.apiProviders).set(set).where(eq(schema.apiProviders.id, id)).returning();
	if (!row) throw notFound("API provider");
	const loaded = { row, apiKey };
	(await load()).set(id, loaded);
	await modelsOf(loaded, true);
	changed();
	return withStatus(loaded);
}

export async function deleteApiProvider(id: string): Promise<void> {
	await db.delete(schema.apiProviders).where(eq(schema.apiProviders.id, id));
	(await load()).delete(id);
	discovered.delete(id);
	changed();
}

export async function checkApiProvider(id: string): Promise<ApiProviderWithStatus> {
	const p = (await load()).get(id);
	if (!p) throw notFound("API provider");
	await modelsOf(p, true);
	return withStatus(p);
}

/** Tries a provider's settings before saving: lists its models. */
export async function testApiProvider(
	input: unknown,
): Promise<{ ok: boolean; error: string | null; models: ApiModel[] }> {
	const data = parse(ApiProviderCreate, input);
	// Testing a saved provider: its key comes back masked, so use the stored one unless a new key was typed.
	const id = (input as { id?: unknown } | null)?.id;
	const stored = typeof id === "string" ? (await load()).get(id) : undefined;
	const masked = !data.apiKey.trim() || /…|••/.test(data.apiKey);
	const saved = masked ? stored : undefined;
	const headers = stored ? unmaskHeaders(data.headers, stored.row.headers) : data.headers;
	const probe: Loaded = {
		row: {
			id: "api_test",
			name: data.name,
			preset: data.preset,
			kind: data.kind,
			baseUrl: cleanUrl(data.baseUrl),
			apiKey: "",
			headers,
			discover: true,
			models: [],
			enabled: true,
			createdAt: 0,
			updatedAt: 0,
		},
		apiKey: saved ? saved.apiKey : data.apiKey.trim(),
	};
	try {
		const models = await discover(probe);
		return { ok: true, error: null, models };
	} catch (err) {
		return { ok: false, error: errorMessage(err), models: [] };
	}
}

/** Chat models from every enabled API provider, for the model catalog. */
export async function apiModelInfos(refresh = false): Promise<ModelInfo[]> {
	const out: ModelInfo[] = [];
	for (const p of (await load()).values()) {
		if (!p.row.enabled) continue;
		const models = await modelsOf(p, refresh).catch(() => [] as ApiModel[]);
		for (const m of models) {
			if (m.type !== "chat") continue;
			out.push({
				id: apiModelId(p.row.id, m.id),
				name: m.name || m.id,
				provider: p.row.name,
				contextWindow: m.contextWindow,
				maxOutputTokens: m.maxOutputTokens,
				thinkingLevels: m.reasoning ? ["low", "medium", "high"] : [],
				vision: m.vision,
				api: { providerId: p.row.id, providerName: p.row.name },
			});
		}
	}
	return out;
}

export async function apiEmbeddingModels(): Promise<EmbeddingModelInfo[]> {
	const out: EmbeddingModelInfo[] = [];
	for (const p of (await load()).values()) {
		if (!p.row.enabled || p.row.kind === "anthropic" || VOICE_KINDS.includes(p.row.kind)) continue;
		for (const m of await modelsOf(p).catch(() => [] as ApiModel[])) {
			if (m.type === "embedding") {
				out.push({
					id: apiModelId(p.row.id, m.id),
					name: m.name || m.id,
					source: p.row.name,
					dimensions: m.dimensions,
				});
			}
		}
	}
	return out;
}

async function provider(id: string): Promise<{ p: Loaded }> {
	const p = (await load()).get(id);
	if (!p) throw badRequest("That API provider was removed. Pick another model.");
	if (!p.row.enabled) throw badRequest(`${p.row.name} is turned off in Admin → Models.`);
	return { p };
}

export async function* streamApiProvider(providerId: string, req: ChatRequest): AsyncGenerator<StreamEvent> {
	const { p } = await provider(providerId);
	if (!CHAT_KINDS.includes(p.row.kind)) throw badRequest(`${p.row.name} only does voice. Pick a chat model.`);
	const info = (await modelsOf(p).catch(() => [] as ApiModel[])).find((m) => m.id === req.model);
	const opts = { maxOutputTokens: info?.maxOutputTokens ?? 8192, reasoning: info?.reasoning ?? false };
	const e = endpoint(p);
	if (p.row.kind === "anthropic") yield* streamAnthropic(e, req, opts);
	else if (p.row.kind === "google") yield* streamGemini(e, req, opts);
	else yield* streamOpenAI(e, opts.reasoning ? req : { ...req, thinking: "default" });
}

/** Embeds with an API provider's model ("api_…::model"). */
export async function embedWithApiProvider(
	modelId: string,
	input: string[],
	signal?: AbortSignal,
): Promise<number[][]> {
	const parsed = parseApiModel(modelId);
	if (!parsed) throw badRequest(`Not an API provider model: ${modelId}`);
	const { p } = await provider(parsed.providerId);
	if (p.row.kind === "google") return embedGemini(endpoint(p), parsed.model, input, signal);
	if (p.row.kind === "anthropic") throw badRequest(`${p.row.name} has no embedding models.`);
	return embedOpenAI(endpoint(p), parsed.model, input, signal);
}

// ---------------------------------------------------------------- voice

export interface VoiceProviderModel {
	providerId: string;
	providerName: string;
	kind: ApiProvider["kind"];
	model: ApiModel;
}

/** Text-to-speech and speech-to-text models from ElevenLabs and Fish Audio. */
export async function apiVoiceModels(): Promise<VoiceProviderModel[]> {
	const out: VoiceProviderModel[] = [];
	for (const p of (await load()).values()) {
		if (!p.row.enabled || !VOICE_KINDS.includes(p.row.kind)) continue;
		for (const m of await modelsOf(p).catch(() => [] as ApiModel[])) {
			if (m.type === "tts" || m.type === "stt") {
				out.push({ providerId: p.row.id, providerName: p.row.name, kind: p.row.kind, model: m });
			}
		}
	}
	return out;
}

/** Where to reach a provider's voice APIs, with its key (server only). */
export async function voiceProvider(id: string): Promise<{ kind: ApiProvider["kind"]; endpoint: VoiceEndpoint }> {
	const { p } = await provider(id);
	if (!VOICE_KINDS.includes(p.row.kind)) throw badRequest(`${p.row.name} isn't a voice service`);
	return { kind: p.row.kind, endpoint: voiceEndpoint(p) };
}

/** For tests. */
export function resetApiProviders(): void {
	rows = null;
	discovered.clear();
}
