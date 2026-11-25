import { type EmbeddingModelInfo, type ModelInfo, THINKING_LEVELS, type ThinkingLevel } from "@sekai/shared";
import { log } from "../lib/log.ts";
import { providerModelInfo } from "../providers/store.ts";
import { apiEmbeddingModels, apiModelInfos, notChatModel } from "./api-providers.ts";
import { fetchModels, type RawModel } from "./gateway.ts";
import { newestFirst } from "./order.ts";

const TTL_MS = 5 * 60_000;
let cache: { at: number; models: ModelInfo[] } | null = null;
let inflight: Promise<ModelInfo[]> | null = null;

/**
 * What a gateway model is for. Gateways that say (a "type" on each model) are believed; for the others the id
 * tells, so a plain OpenAI-compatible list doesn't offer embedding, speech or image models as chat models.
 */
const isEmbedding = (m: RawModel) => (m.type ? m.type === "embedding" : /embed/i.test(m.id));
const isChat = (m: RawModel) => (m.type ? m.type === "chat" : !isEmbedding(m) && !notChatModel(m.id));

function toInfo(m: RawModel): ModelInfo {
	const levels = (m.reasoning_efforts ?? []).filter((e): e is ThinkingLevel =>
		(THINKING_LEVELS as readonly string[]).includes(e),
	);
	return {
		id: m.id,
		name: m.name ?? m.id,
		provider: m.owned_by ?? "unknown",
		contextWindow: m.context_window ?? 128_000,
		maxOutputTokens: m.max_output_tokens ?? 16_000,
		thinkingLevels: levels,
		vision: m.vision ?? false,
	};
}

export async function listModels(refresh = false): Promise<ModelInfo[]> {
	if (!refresh && cache && Date.now() - cache.at < TTL_MS) return cache.models;
	if (inflight) return inflight;
	inflight = (async () => {
		try {
			const [gateway, api] = await Promise.allSettled([fetchModels(), apiModelInfos(refresh)]);
			const apiModels = api.status === "fulfilled" ? api.value : [];
			if (gateway.status === "rejected") {
				// The gateway is down: keep its last known models, and still offer your API providers' models.
				const last = cache?.models.filter((m) => !m.api) ?? [];
				if (last.length === 0 && apiModels.length === 0) throw gateway.reason;
				log.warn("gateway model list failed; serving what's available", gateway.reason);
				const models = newestFirst([...last, ...apiModels]);
				cache = { at: Date.now(), models };
				return models;
			}
			const models = newestFirst([...gateway.value.filter(isChat).map(toInfo), ...apiModels]);
			cache = { at: Date.now(), models };
			return models;
		} finally {
			inflight = null;
		}
	})();
	return inflight;
}

export async function getModelInfo(id: string): Promise<ModelInfo | undefined> {
	const byos = providerModelInfo(id);
	if (byos) return byos;
	try {
		const models = await listModels();
		return models.find((m) => m.id === id);
	} catch {
		return undefined;
	}
}

export function invalidateModels(): void {
	cache = null;
}

/** Embedding models from the gateway and your API providers. */
export async function listEmbeddingModels(): Promise<EmbeddingModelInfo[]> {
	const [gateway, api] = await Promise.allSettled([fetchModels(), apiEmbeddingModels()]);
	const fromGateway: EmbeddingModelInfo[] =
		gateway.status === "fulfilled"
			? gateway.value.filter(isEmbedding).map((m) => ({
					id: m.id,
					name: m.name ?? m.id,
					source: "Model gateway",
					dimensions: KNOWN_DIMENSIONS[m.id] ?? null,
				}))
			: [];
	return [...fromGateway, ...(api.status === "fulfilled" ? api.value : [])];
}

const KNOWN_DIMENSIONS: Record<string, number> = {
	"text-embedding-3-small": 1536,
	"text-embedding-3-large": 3072,
	"text-embedding-ada-002": 1536,
};
