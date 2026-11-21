import type { Usage } from "@sekai/shared";
import { parseApiModel } from "@sekai/shared";
import { checkUsageLimits, requireModelAllowed } from "../services/limits.ts";
import { getSettings } from "../services/settings.ts";
import { recordUsage } from "../services/usage.ts";
import { streamApiProvider } from "./api-providers.ts";
import { listOpenAIModels, type OpenAIEndpoint, type RawModel, streamOpenAI } from "./openai.ts";
import { type ChatRequest, type ChatResult, type ChatToolCall, EMPTY_USAGE, type StreamEvent } from "./types.ts";

/**
 * Model calls. The model gateway (any OpenAI-compatible endpoint: LiteLLM, OpenRouter, Ollama, vLLM…) speaks OpenAI
 * Chat Completions; models from API providers you added ("api_…::model") go to that provider in its own format.
 */

export { buildBody, type RawModel } from "./openai.ts";
export { ProviderError as GatewayError } from "./types.ts";

export type GatewayEndpoint = OpenAIEndpoint;

export async function gatewayEndpoint(): Promise<GatewayEndpoint> {
	const s = await getSettings();
	return { url: s.gatewayUrl.replace(/\/+$/, ""), apiKey: s.gatewayApiKey, label: "gateway" };
}

/** The gateway to call, or a plain-words error when none is set up yet. */
async function requireGateway(): Promise<GatewayEndpoint> {
	const ep = await gatewayEndpoint();
	if (!ep.url) throw new Error("No model gateway is set up yet. An admin adds one in Settings → Models.");
	return ep;
}

export async function* streamChat(req: ChatRequest): AsyncGenerator<StreamEvent> {
	// Every call counts against the role's limits of the person it's for (replies, titles, memory, comparing…).
	await checkUsageLimits();
	requireModelAllowed(req.model);
	// Whatever happens (finished, stopped, failed), the tokens it reported count in the usage stats.
	let usage: Usage | null = null;
	try {
		const api = parseApiModel(req.model);
		const inner = api
			? streamApiProvider(api.providerId, { ...req, model: api.model })
			: streamOpenAI(await requireGateway(), req);
		for await (const event of inner) {
			if (event.type === "usage") usage = event.usage;
			yield event;
		}
	} finally {
		if (usage) {
			recordUsage({
				model: req.model,
				usage,
				agentId: req.meter?.agentId ?? null,
				purpose: req.meter?.purpose ?? "background",
				runId: req.meter?.runId ?? null,
			});
		}
	}
}

/** Runs a request to completion, optionally observing events as they stream. */
export async function chat(req: ChatRequest, onEvent?: (event: StreamEvent) => void): Promise<ChatResult> {
	let text = "";
	let reasoning = "";
	let usage: Usage = EMPTY_USAGE;
	let finishReason: string | null = null;
	const calls = new Map<number, ChatToolCall>();
	for await (const event of streamChat(req)) {
		onEvent?.(event);
		switch (event.type) {
			case "text":
				text += event.delta;
				break;
			case "reasoning":
				reasoning += event.delta;
				break;
			case "tool_call": {
				const existing = calls.get(event.index);
				if (existing) {
					if (event.id) existing.id = event.id;
					if (event.name) existing.function.name += event.name;
					existing.function.arguments += event.argsDelta;
				} else {
					calls.set(event.index, {
						id: event.id ?? `call_${event.index}_${Date.now()}`,
						type: "function",
						function: { name: event.name ?? "", arguments: event.argsDelta },
					});
				}
				break;
			}
			case "finish":
				finishReason = event.reason;
				break;
			case "usage":
				usage = event.usage;
				break;
		}
	}
	const toolCalls = [...calls.entries()].sort((a, b) => a[0] - b[0]).map(([, c]) => c);
	return { text, reasoning, toolCalls, usage, finishReason };
}

/** Lists the gateway's raw model catalog. Used by the catalog cache and the settings "Test connection" button. */
export async function fetchModels(endpoint?: GatewayEndpoint): Promise<RawModel[]> {
	return listOpenAIModels(endpoint ?? (await requireGateway()));
}
