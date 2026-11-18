import type { ThinkingSetting, Usage } from "@sekai/shared";
import { log } from "../lib/log.ts";
import { readError } from "./openai.ts";
import { type ChatContentPart, type ChatMessage, type ChatRequest, ProviderError, type StreamEvent } from "./types.ts";

/** An Anthropic Messages endpoint (Anthropic itself, or a compatible service). */
export interface AnthropicEndpoint {
	url: string;
	apiKey: string;
	headers?: Record<string, string>;
	label?: string;
	/** Also send the key as a bearer token, for compatible services that expect one. */
	bearer?: boolean;
}

type Block =
	| { type: "text"; text: string }
	| { type: "image"; source: { type: "base64"; media_type: string; data: string } | { type: "url"; url: string } }
	| { type: "document"; source: { type: "base64"; media_type: string; data: string } }
	| { type: "tool_use"; id: string; name: string; input: unknown }
	| { type: "tool_result"; tool_use_id: string; content: string };

interface AnthropicMessage {
	role: "user" | "assistant";
	content: Block[];
}

const BUDGET: Partial<Record<ThinkingSetting, number>> = {
	minimal: 1024,
	low: 2048,
	medium: 8192,
	high: 16_384,
	xhigh: 32_000,
	max: 48_000,
};

function dataUrl(url: string): { mediaType: string; data: string } | null {
	const m = url.match(/^data:([^;,]+);base64,(.*)$/s);
	return m?.[1] && m[2] !== undefined ? { mediaType: m[1], data: m[2] } : null;
}

function parts(content: string | ChatContentPart[]): Block[] {
	if (typeof content === "string") return content ? [{ type: "text", text: content }] : [];
	const out: Block[] = [];
	for (const p of content) {
		if (p.type === "text") {
			if (p.text) out.push({ type: "text", text: p.text });
		} else if (p.type === "image_url") {
			const d = dataUrl(p.image_url.url);
			out.push({
				type: "image",
				source: d
					? { type: "base64", media_type: d.mediaType, data: d.data }
					: { type: "url", url: p.image_url.url },
			});
		} else {
			const d = dataUrl(p.file.file_data);
			if (d?.mediaType === "application/pdf") {
				out.push({ type: "document", source: { type: "base64", media_type: d.mediaType, data: d.data } });
			} else if (d) {
				out.push({
					type: "text",
					text: `[${p.file.filename}]\n${Buffer.from(d.data, "base64").toString("utf8")}`,
				});
			}
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

/** Chat Completions messages → Anthropic's system prompt and alternating user/assistant blocks. */
export function toAnthropic(messages: ChatMessage[]): { system: string; messages: AnthropicMessage[] } {
	const system: string[] = [];
	const out: AnthropicMessage[] = [];
	const push = (role: "user" | "assistant", blocks: Block[]) => {
		if (blocks.length === 0) return;
		const last = out.at(-1);
		if (last?.role === role) last.content.push(...blocks);
		else out.push({ role, content: blocks });
	};
	for (const m of messages) {
		if (m.role === "system") system.push(m.content);
		else if (m.role === "user") push("user", parts(m.content));
		else if (m.role === "assistant") {
			const blocks: Block[] = m.content ? [{ type: "text", text: m.content }] : [];
			for (const c of m.tool_calls ?? []) {
				blocks.push({
					type: "tool_use",
					id: c.id,
					name: c.function.name,
					input: parseArgs(c.function.arguments),
				});
			}
			push("assistant", blocks);
		} else {
			push("user", [{ type: "tool_result", tool_use_id: m.tool_call_id, content: m.content || "(no output)" }]);
		}
	}
	if (out[0]?.role === "assistant") out.unshift({ role: "user", content: [{ type: "text", text: "(continue)" }] });
	return { system: system.join("\n\n"), messages: out };
}

export function anthropicHeaders(endpoint: AnthropicEndpoint): Record<string, string> {
	const h: Record<string, string> = {
		"content-type": "application/json",
		"anthropic-version": "2023-06-01",
		"user-agent": "sekai/0.1",
	};
	if (endpoint.apiKey) {
		h["x-api-key"] = endpoint.apiKey;
		if (endpoint.bearer) h.authorization = `Bearer ${endpoint.apiKey}`;
	}
	return { ...h, ...endpoint.headers };
}

export function anthropicBody(req: ChatRequest, opts: { maxOutputTokens: number; reasoning: boolean }) {
	const { system, messages } = toAnthropic(req.messages);
	const budget = opts.reasoning && req.thinking ? BUDGET[req.thinking] : undefined;
	const maxTokens = Math.max(req.maxTokens ?? opts.maxOutputTokens, budget ? budget + 4096 : 0);
	const body: Record<string, unknown> = { model: req.model, max_tokens: maxTokens, messages, stream: true };
	if (system) body.system = system;
	if (req.tools?.length) {
		body.tools = req.tools.map((t) => ({
			name: t.function.name,
			description: t.function.description,
			input_schema: t.function.parameters,
		}));
	}
	if (budget) body.thinking = { type: "enabled", budget_tokens: budget };
	else if (req.temperature !== null && req.temperature !== undefined) body.temperature = req.temperature;
	return body;
}

const STOP: Record<string, string> = {
	end_turn: "stop",
	stop_sequence: "stop",
	tool_use: "tool_calls",
	max_tokens: "length",
};

interface RawEvent {
	type: string;
	index?: number;
	message?: { usage?: RawUsage };
	content_block?: { type: string; id?: string; name?: string; text?: string };
	delta?: { type?: string; text?: string; thinking?: string; partial_json?: string; stop_reason?: string | null };
	usage?: RawUsage;
	error?: { message?: string; type?: string };
}

interface RawUsage {
	input_tokens?: number;
	output_tokens?: number;
	cache_read_input_tokens?: number;
	cache_creation_input_tokens?: number;
}

export async function* streamAnthropic(
	endpoint: AnthropicEndpoint,
	req: ChatRequest,
	opts: { maxOutputTokens: number; reasoning: boolean },
): AsyncGenerator<StreamEvent> {
	const started = Date.now();
	const res = await fetch(`${endpoint.url}/messages`, {
		method: "POST",
		headers: anthropicHeaders(endpoint),
		body: JSON.stringify(anthropicBody(req, opts)),
		signal: req.signal,
	});
	if (!res.ok || !res.body) throw new ProviderError(res.status, `${req.model}: ${await readError(res)}`);
	log.debug(`${endpoint.label ?? "anthropic"} ${req.model} ttfb ${Date.now() - started}ms`);

	// Anthropic numbers every content block; tool calls get their own running index, like Chat Completions.
	const toolIndex = new Map<number, number>();
	let tools = 0;
	const usage: Usage = { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cachedTokens: 0 };
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
				let ev: RawEvent;
				try {
					ev = JSON.parse(line.slice(5).trim()) as RawEvent;
				} catch {
					continue;
				}
				switch (ev.type) {
					case "message_start": {
						const u = ev.message?.usage;
						usage.inputTokens =
							(u?.input_tokens ?? 0) +
							(u?.cache_read_input_tokens ?? 0) +
							(u?.cache_creation_input_tokens ?? 0);
						usage.cachedTokens = u?.cache_read_input_tokens ?? 0;
						break;
					}
					case "content_block_start": {
						const b = ev.content_block;
						if (b?.type === "tool_use") {
							const i = tools++;
							toolIndex.set(ev.index ?? 0, i);
							yield { type: "tool_call", index: i, id: b.id, name: b.name, argsDelta: "" };
						} else if (b?.type === "text" && b.text) {
							yield { type: "text", delta: b.text };
						}
						break;
					}
					case "content_block_delta": {
						const d = ev.delta;
						if (d?.type === "text_delta" && d.text) yield { type: "text", delta: d.text };
						else if (d?.type === "thinking_delta" && d.thinking)
							yield { type: "reasoning", delta: d.thinking };
						else if (d?.type === "input_json_delta") {
							const i = toolIndex.get(ev.index ?? 0);
							if (i !== undefined) yield { type: "tool_call", index: i, argsDelta: d.partial_json ?? "" };
						}
						break;
					}
					case "message_delta": {
						if (ev.usage?.output_tokens !== undefined) usage.outputTokens = ev.usage.output_tokens;
						const stop = ev.delta?.stop_reason;
						if (stop) yield { type: "finish", reason: STOP[stop] ?? stop };
						break;
					}
					case "message_stop":
						yield { type: "usage", usage };
						return;
					case "error":
						throw new ProviderError(
							502,
							`${req.model}: ${ev.error?.message ?? ev.error?.type ?? "stream error"}`,
						);
				}
			}
		}
		yield { type: "usage", usage };
	} finally {
		reader.releaseLock();
	}
}

export interface AnthropicModel {
	id: string;
	display_name?: string;
	max_input_tokens?: number;
	max_tokens?: number;
}

export async function listAnthropicModels(endpoint: AnthropicEndpoint): Promise<AnthropicModel[]> {
	const res = await fetch(`${endpoint.url}/models?limit=1000`, {
		headers: anthropicHeaders(endpoint),
		signal: AbortSignal.timeout(15_000),
	});
	if (!res.ok) throw new ProviderError(res.status, await readError(res));
	const body = (await res.json()) as { data?: AnthropicModel[] };
	return body.data ?? [];
}
