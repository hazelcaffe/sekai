import type { ThinkingSetting, Usage } from "@sekai/shared";
import { log } from "../lib/log.ts";
import { imageMimeBase64 } from "../lib/mime.ts";
import { readError } from "./openai.ts";
import { type ChatContentPart, type ChatMessage, type ChatRequest, ProviderError, type StreamEvent } from "./types.ts";

/** Google's Gemini API (generateContent). */
export interface GoogleEndpoint {
	url: string;
	apiKey: string;
	headers?: Record<string, string>;
	label?: string;
}

type Part =
	| { text: string; thought?: boolean }
	| { inlineData: { mimeType: string; data: string } }
	| { fileData: { mimeType: string; fileUri: string } }
	| { functionCall: { name: string; args: unknown; id?: string }; thoughtSignature?: string }
	| { functionResponse: { name: string; response: Record<string, unknown>; id?: string } };

interface Content {
	role: "user" | "model";
	parts: Part[];
}

/**
 * Gemini 3 wants the "thought signature" of a function call echoed back. Sekai doesn't keep them between turns,
 * so replayed calls carry Google's documented placeholder that skips the check.
 */
const SKIP_SIGNATURE = "skip_thought_signature_validator";

const BUDGET: Partial<Record<ThinkingSetting, number>> = {
	none: 0,
	minimal: 512,
	low: 2048,
	medium: 8192,
	high: 16_384,
	xhigh: 24_576,
	max: 32_768,
};

function dataUrl(url: string): { mimeType: string; data: string } | null {
	const m = url.match(/^data:([^;,]+);base64,(.*)$/s);
	if (!m?.[1] || m[2] === undefined) return null;
	return { mimeType: m[1].startsWith("image/") ? imageMimeBase64(m[2], m[1]) : m[1], data: m[2] };
}

function userParts(content: string | ChatContentPart[]): Part[] {
	if (typeof content === "string") return content ? [{ text: content }] : [];
	const out: Part[] = [];
	for (const p of content) {
		if (p.type === "text") {
			if (p.text) out.push({ text: p.text });
		} else {
			const url = p.type === "image_url" ? p.image_url.url : p.file.file_data;
			const d = dataUrl(url);
			if (d) out.push({ inlineData: d });
			else if (p.type === "image_url") out.push({ fileData: { mimeType: "image/*", fileUri: url } });
		}
	}
	return out;
}

function parseArgs(raw: string): unknown {
	try {
		return raw ? JSON.parse(raw) : {};
	} catch {
		return {};
	}
}

export function toGemini(messages: ChatMessage[]): { system: string; contents: Content[] } {
	const system: string[] = [];
	const contents: Content[] = [];
	const names = new Map<string, string>();
	const push = (role: Content["role"], parts: Part[]) => {
		if (parts.length === 0) return;
		const last = contents.at(-1);
		if (last?.role === role) last.parts.push(...parts);
		else contents.push({ role, parts });
	};
	for (const m of messages) {
		if (m.role === "system") system.push(m.content);
		else if (m.role === "user") push("user", userParts(m.content));
		else if (m.role === "assistant") {
			const parts: Part[] = m.content ? [{ text: m.content }] : [];
			for (const c of m.tool_calls ?? []) {
				names.set(c.id, c.function.name);
				parts.push({
					functionCall: { name: c.function.name, args: parseArgs(c.function.arguments) },
					thoughtSignature: SKIP_SIGNATURE,
				});
			}
			push("model", parts);
		} else {
			push("user", [
				{
					functionResponse: {
						name: names.get(m.tool_call_id) ?? "tool",
						response: { result: m.content || "(no output)" },
					},
				},
			]);
		}
	}
	return { system: system.join("\n\n"), contents };
}

export function geminiBody(req: ChatRequest, opts: { maxOutputTokens: number; reasoning: boolean }) {
	const { system, contents } = toGemini(req.messages);
	const generationConfig: Record<string, unknown> = { maxOutputTokens: req.maxTokens ?? opts.maxOutputTokens };
	if (req.temperature !== null && req.temperature !== undefined) generationConfig.temperature = req.temperature;
	if (opts.reasoning) {
		const budget = req.thinking && req.thinking !== "default" ? BUDGET[req.thinking] : undefined;
		generationConfig.thinkingConfig = {
			includeThoughts: true,
			...(budget !== undefined ? { thinkingBudget: budget } : {}),
		};
	}
	const body: Record<string, unknown> = { contents, generationConfig };
	if (system) body.systemInstruction = { parts: [{ text: system }] };
	const tools: Record<string, unknown>[] = [];
	if (req.tools?.length) {
		tools.push({
			functionDeclarations: req.tools.map((t) => ({
				name: t.function.name,
				description: t.function.description,
				parametersJsonSchema: t.function.parameters,
			})),
		});
	}
	if (req.webSearch) tools.push({ googleSearch: {} });
	if (tools.length) body.tools = tools;
	return body;
}

export function googleHeaders(endpoint: GoogleEndpoint): Record<string, string> {
	const h: Record<string, string> = { "content-type": "application/json", "user-agent": "sekai/0.1" };
	if (endpoint.apiKey) h["x-goog-api-key"] = endpoint.apiKey;
	return { ...h, ...endpoint.headers };
}

const modelPath = (model: string) => (model.startsWith("models/") ? model : `models/${model}`);

const FINISH: Record<string, string> = { STOP: "stop", MAX_TOKENS: "length" };

interface RawChunk {
	candidates?: {
		content?: { parts?: (Part & { thought?: boolean })[] };
		finishReason?: string;
	}[];
	usageMetadata?: {
		promptTokenCount?: number;
		candidatesTokenCount?: number;
		thoughtsTokenCount?: number;
		cachedContentTokenCount?: number;
	};
	promptFeedback?: { blockReason?: string };
	error?: { message?: string };
}

export async function* streamGemini(
	endpoint: GoogleEndpoint,
	req: ChatRequest,
	opts: { maxOutputTokens: number; reasoning: boolean },
): AsyncGenerator<StreamEvent> {
	const started = Date.now();
	const res = await fetch(`${endpoint.url}/${modelPath(req.model)}:streamGenerateContent?alt=sse`, {
		method: "POST",
		headers: googleHeaders(endpoint),
		body: JSON.stringify(geminiBody(req, opts)),
		signal: req.signal,
	});
	if (!res.ok || !res.body) throw new ProviderError(res.status, `${req.model}: ${await readError(res)}`);
	log.debug(`${endpoint.label ?? "gemini"} ${req.model} ttfb ${Date.now() - started}ms`);

	let calls = 0;
	let sawCall = false;
	let usage: Usage | null = null;
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
				let chunk: RawChunk;
				try {
					chunk = JSON.parse(line.slice(5).trim()) as RawChunk;
				} catch {
					continue;
				}
				if (chunk.error) throw new ProviderError(502, `${req.model}: ${chunk.error.message ?? "stream error"}`);
				if (chunk.promptFeedback?.blockReason) {
					yield { type: "finish", reason: chunk.promptFeedback.blockReason.toLowerCase() };
				}
				for (const cand of chunk.candidates ?? []) {
					for (const p of cand.content?.parts ?? []) {
						if ("text" in p && p.text)
							yield p.thought ? { type: "reasoning", delta: p.text } : { type: "text", delta: p.text };
						else if ("functionCall" in p) {
							sawCall = true;
							yield {
								type: "tool_call",
								index: calls++,
								id: `call_${Date.now().toString(36)}_${calls}`,
								name: p.functionCall.name,
								argsDelta: JSON.stringify(p.functionCall.args ?? {}),
							};
						}
					}
					if (cand.finishReason) {
						const r =
							sawCall && cand.finishReason === "STOP"
								? "tool_calls"
								: (FINISH[cand.finishReason] ?? cand.finishReason.toLowerCase());
						yield { type: "finish", reason: r };
					}
				}
				const u = chunk.usageMetadata;
				if (u) {
					usage = {
						inputTokens: u.promptTokenCount ?? 0,
						outputTokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),
						reasoningTokens: u.thoughtsTokenCount ?? 0,
						cachedTokens: u.cachedContentTokenCount ?? 0,
					};
				}
			}
		}
		if (usage) yield { type: "usage", usage };
	} finally {
		reader.releaseLock();
	}
}

export interface GeminiModel {
	name: string;
	displayName?: string;
	inputTokenLimit?: number;
	outputTokenLimit?: number;
	supportedGenerationMethods?: string[];
	thinking?: boolean;
}

export async function listGeminiModels(endpoint: GoogleEndpoint): Promise<GeminiModel[]> {
	const out: GeminiModel[] = [];
	let page: string | undefined;
	for (let i = 0; i < 10; i++) {
		const res = await fetch(`${endpoint.url}/models?pageSize=1000${page ? `&pageToken=${page}` : ""}`, {
			headers: googleHeaders(endpoint),
			signal: AbortSignal.timeout(15_000),
		});
		if (!res.ok) throw new ProviderError(res.status, await readError(res));
		const body = (await res.json()) as { models?: GeminiModel[]; nextPageToken?: string };
		out.push(...(body.models ?? []));
		page = body.nextPageToken;
		if (!page) break;
	}
	return out;
}

export async function embedGemini(
	endpoint: GoogleEndpoint,
	model: string,
	input: string[],
	signal?: AbortSignal,
): Promise<number[][]> {
	const path = modelPath(model);
	const res = await fetch(`${endpoint.url}/${path}:batchEmbedContents`, {
		method: "POST",
		headers: googleHeaders(endpoint),
		body: JSON.stringify({ requests: input.map((text) => ({ model: path, content: { parts: [{ text }] } })) }),
		signal: signal ?? AbortSignal.timeout(120_000),
	});
	if (!res.ok) throw new ProviderError(res.status, `${model}: ${await readError(res)}`);
	const body = (await res.json()) as { embeddings?: { values: number[] }[] };
	const rows = body.embeddings ?? [];
	if (rows.length !== input.length)
		throw new ProviderError(502, `${model} returned ${rows.length} embeddings for ${input.length} inputs`);
	return rows.map((r) => r.values);
}
