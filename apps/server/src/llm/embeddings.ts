import { parseApiModel } from "@sekai/shared";
import { embedWithApiProvider } from "./api-providers.ts";
import { gatewayEndpoint } from "./gateway.ts";
import { embedOpenAI } from "./openai.ts";

/** Most embedding APIs cap a request around 2048 inputs or ~300k tokens; stay well under both. */
const BATCH = 64;

/**
 * Embeds texts with a gateway model (e.g. "text-embedding-3-small") or an API provider's ("api_…::model"),
 * in batches, retrying rate limits and brief outages.
 */
export async function embed(model: string, texts: string[], signal?: AbortSignal): Promise<number[][]> {
	const out: number[][] = [];
	for (let i = 0; i < texts.length; i += BATCH) {
		const batch = texts.slice(i, i + BATCH);
		out.push(...(await withRetry(() => embedBatch(model, batch, signal), signal)));
	}
	return out;
}

async function embedBatch(model: string, input: string[], signal?: AbortSignal): Promise<number[][]> {
	if (parseApiModel(model)) return embedWithApiProvider(model, input, signal);
	return embedOpenAI(await gatewayEndpoint(), model, input, signal);
}

async function withRetry<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
	let delay = 1000;
	for (let attempt = 0; ; attempt++) {
		try {
			return await fn();
		} catch (err) {
			const status = (err as { status?: number }).status ?? 0;
			const retryable = status === 429 || status >= 500 || status === 0;
			if (!retryable || attempt >= 4 || signal?.aborted) throw err;
			await Bun.sleep(delay);
			delay *= 2;
		}
	}
}
