import type { Usage } from "@sekai/shared";
import { log } from "../lib/log.ts";
import { type ChatRequest, ProviderError, type StreamEvent } from "./types.ts";

/** An OpenAI-compatible endpoint: the model gateway, or an API provider you added. */
export interface OpenAIEndpoint {
	url: string;
	apiKey: string;
	headers?: Record<string, string>;
	/** Shown in errors, e.g. the provider's name. */
	label?: string;
}

export function openaiHeaders(endpoint: Pick<OpenAIEndpoint, "apiKey" | "headers">): Record<string, string> {
	const h: Record<string, string> = { "content-type": "application/json", "user-agent": "sekai/0.1" };
	if (endpoint.apiKey) h.authorization = `Bearer ${endpoint.apiKey}`;
	return { ...h, ...endpoint.headers };
}

export async function readError(res: Response): Promise<string> {
	const text = await res.text().catch(() => "");
	try {
		const body = JSON.parse(text) as { error?: { message?: string } | string; message?: string };
		if (typeof body.error === "string") return body.error;
		return body.error?.message ?? body.message ?? (text || res.statusText);
	} catch {
		return text.slice(0, 500) || res.statusText;
	}
}

interface RawUsage {
	prompt_tokens?: number;
	completion_tokens?: number;
	prompt_tokens_details?: { cached_tokens?: number };
	completion_tokens_details?: { reasoning_tokens?: number };
}

function mapUsage(u: RawUsage): Usage {
	return {
		inputTokens: u.prompt_tokens ?? 0,
		outputTokens: u.completion_tokens ?? 0,
		cachedTokens: u.prompt_tokens_details?.cached_tokens ?? 0,
		reasoningTokens: u.completion_tokens_details?.reasoning_tokens ?? 0,
	};
}

interface RawDelta {
	content?: string | null;
	reasoning_content?: string | null;
	reasoning?: string | null;
	tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[];
}

interface RawChunk {
	choices?: { delta?: RawDelta; finish_reason?: string | null }[];
	usage?: RawUsage | null;
	error?: { message?: string; code?: string | number } | string;
}

export function buildBody(req: ChatRequest): Record<string, unknown> {
	const body: Record<string, unknown> = {
		model: req.model,
		messages: req.messages,
		stream: true,
		stream_options: { include_usage: true },
	};
	if (req.tools && req.tools.length > 0) body.tools = req.tools;
	if (req.thinking && req.thinking !== "default") body.reasoning_effort = req.thinking;
	if (req.maxTokens) body.max_tokens = req.maxTokens;
	if (req.temperature !== null && req.temperature !== undefined) body.temperature = req.temperature;
	if (req.webSearch) body.web_search_options = {};
	return body;
}

export async function* streamOpenAI(endpoint: OpenAIEndpoint, req: ChatRequest): AsyncGenerator<StreamEvent> {
	const started = Date.now();
	const res = await fetch(`${endpoint.url}/chat/completions`, {
		method: "POST",
		headers: openaiHeaders(endpoint),
		body: JSON.stringify(buildBody(req)),
		signal: req.signal,
	});
	if (!res.ok || !res.body) {
		const message = await readError(res);
		throw new ProviderError(res.status, `${req.model}: ${message}`);
	}
	log.debug(`${endpoint.label ?? "gateway"} ${req.model} ttfb ${Date.now() - started}ms`);

	const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
	let buffer = "";
	try {
		for (;;) {
			const { value, done } = await reader.read();
			if (done) break;
			buffer += value;
			let nl = buffer.indexOf("\n");
			while (nl >= 0) {
				const line = buffer.slice(0, nl).replace(/\r$/, "");
				buffer = buffer.slice(nl + 1);
				nl = buffer.indexOf("\n");
				if (!line.startsWith("data:")) continue;
				const data = line.slice(5).trim();
				if (!data) continue;
				if (data === "[DONE]") return;
				let chunk: RawChunk;
				try {
					chunk = JSON.parse(data) as RawChunk;
				} catch {
					continue;
				}
				if (chunk.error) {
					const msg = typeof chunk.error === "string" ? chunk.error : (chunk.error.message ?? "stream error");
					throw new ProviderError(502, `${req.model}: ${msg}`);
				}
				for (const choice of chunk.choices ?? []) {
					const d = choice.delta;
					if (d) {
						const reasoning = d.reasoning_content ?? d.reasoning;
						if (reasoning) yield { type: "reasoning", delta: reasoning };
						if (d.content) yield { type: "text", delta: d.content };
						for (const tc of d.tool_calls ?? []) {
							yield {
								type: "tool_call",
								index: tc.index ?? 0,
								id: tc.id,
								name: tc.function?.name,
								argsDelta: tc.function?.arguments ?? "",
							};
						}
					}
					if (choice.finish_reason) yield { type: "finish", reason: choice.finish_reason };
				}
				if (chunk.usage) yield { type: "usage", usage: mapUsage(chunk.usage) };
			}
		}
	} finally {
		reader.releaseLock();
	}
}

/** GET /models, for the model gateway or an OpenAI-compatible provider. */
export async function listOpenAIModels(endpoint: OpenAIEndpoint): Promise<RawModel[]> {
	const res = await fetch(`${endpoint.url}/models`, {
		headers: openaiHeaders(endpoint),
		signal: AbortSignal.timeout(15_000),
	});
	if (!res.ok) throw new ProviderError(res.status, await readError(res));
	const body = (await res.json()) as { data?: RawModel[] };
	return body.data ?? [];
}

/** POST /embeddings. Returns one vector per input, in order. */
export async function embedOpenAI(
	endpoint: OpenAIEndpoint,
	model: string,
	input: string[],
	signal?: AbortSignal,
): Promise<number[][]> {
	const res = await fetch(`${endpoint.url}/embeddings`, {
		method: "POST",
		headers: openaiHeaders(endpoint),
		body: JSON.stringify({ model, input, encoding_format: "float" }),
		signal: signal ?? AbortSignal.timeout(120_000),
	});
	if (!res.ok) throw new ProviderError(res.status, `${model}: ${await readError(res)}`);
	const body = (await res.json()) as { data?: { index?: number; embedding: number[] }[] };
	const rows = [...(body.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
	if (rows.length !== input.length)
		throw new ProviderError(502, `${model} returned ${rows.length} embeddings for ${input.length} inputs`);
	return rows.map((r) => r.embedding);
}

export interface RawModel {
	id: string;
	name?: string;
	owned_by?: string;
	type?: string;
	context_window?: number;
	max_output_tokens?: number;
	reasoning_efforts?: string[];
	vision?: boolean;
}
