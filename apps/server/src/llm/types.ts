import type { ThinkingSetting, Usage } from "@sekai/shared";

export type ChatContentPart =
	| { type: "text"; text: string }
	| { type: "image_url"; image_url: { url: string; detail?: "auto" | "low" | "high" } }
	| { type: "file"; file: { filename: string; file_data: string } };

export interface ChatToolCall {
	id: string;
	type: "function";
	function: { name: string; arguments: string };
}

export type ChatMessage =
	| { role: "system"; content: string }
	| { role: "user"; content: string | ChatContentPart[] }
	| { role: "assistant"; content: string | null; tool_calls?: ChatToolCall[] }
	| { role: "tool"; tool_call_id: string; content: string };

export interface ChatTool {
	type: "function";
	function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface ChatRequest {
	model: string;
	messages: ChatMessage[];
	tools?: ChatTool[];
	thinking?: ThinkingSetting;
	maxTokens?: number | null;
	temperature?: number | null;
	/** Ask the gateway to run web searches for the model. */
	webSearch?: boolean;
	signal?: AbortSignal;
	/** Who the tokens count for in usage stats (default: background work, no bot). */
	meter?: { agentId: string | null; purpose: "reply" | "background"; runId?: string | null };
}

export type StreamEvent =
	| { type: "text"; delta: string }
	| { type: "reasoning"; delta: string }
	| { type: "tool_call"; index: number; id?: string; name?: string; argsDelta: string }
	| { type: "finish"; reason: string | null }
	| { type: "usage"; usage: Usage };

export interface ChatResult {
	text: string;
	reasoning: string;
	toolCalls: ChatToolCall[];
	usage: Usage;
	finishReason: string | null;
}

/** An HTTP error from a model API (the gateway or an API provider). */
export class ProviderError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
		this.name = "GatewayError";
	}
}

export const EMPTY_USAGE: Usage = { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cachedTokens: 0 };

export function addUsage(a: Usage, b: Usage): Usage {
	return {
		inputTokens: a.inputTokens + b.inputTokens,
		outputTokens: a.outputTokens + b.outputTokens,
		reasoningTokens: a.reasoningTokens + b.reasoningTokens,
		cachedTokens: a.cachedTokens + b.cachedTokens,
	};
}
