import { describe, expect, test } from "bun:test";
import type { ModelInfo } from "@sekai/shared";
import { modelVersion, newestFirst } from "../src/llm/order.ts";

const model = (id: string, name: string, provider: string, api?: string): ModelInfo => ({
	id,
	name,
	provider,
	contextWindow: 128_000,
	maxOutputTokens: 16_000,
	thinkingLevels: [],
	vision: false,
	...(api ? { api: { providerId: api, providerName: api } } : {}),
});

describe("model order", () => {
	test("reads the version from a model's name, not its size", () => {
		expect(modelVersion("GPT-6.2 Astra")).toEqual([6, 2]);
		expect(modelVersion("GPT-6 Astra")).toEqual([6]);
		expect(modelVersion("Qwen3 32B")).toEqual([3]);
		expect(modelVersion("Abliterated Qwen 3.8 27B")).toEqual([3, 8]);
		expect(modelVersion("Schematic 7B")).toEqual([]);
		expect(modelVersion("Grok 420 Reasoning Latest")).toEqual([]);
		expect(modelVersion("GPT-5.10")).toEqual([5, 10]);
		expect(modelVersion("codex-auto-review")).toEqual([]);
	});

	test("lists each provider's newest models first, where a gateway added them last", () => {
		const listed = [
			model("claude-sonnet-4-5", "Claude Sonnet 4.5", "anthropic"),
			model("gpt-6-astra", "GPT-6 Astra", "openai"),
			model("gpt-6.1-sol", "GPT-6.1 Sol", "openai"),
			model("claude-opus-5-5", "Claude Opus 5.5", "anthropic"),
			model("gpt-5.10", "GPT-5.10", "openai"),
			model("gpt-5.9", "GPT-5.9", "openai"),
			model("codex-auto-review", "codex-auto-review", "openai"),
			model("o3", "o3", "openai"),
			model("gpt-6.2-astra", "GPT-6.2 Astra", "openai"),
			model("gpt-6.2-sol", "GPT-6.2 Sol", "openai"),
			model("or-old", "Old 1", "openrouter", "prv_or"),
			model("or-new", "New 2", "openrouter", "prv_or"),
		];
		expect(newestFirst(listed).map((m) => m.id)).toEqual([
			"claude-opus-5-5",
			"claude-sonnet-4-5",
			"gpt-6.2-astra",
			"gpt-6.2-sol",
			"gpt-6.1-sol",
			"gpt-6-astra",
			"gpt-5.10",
			"gpt-5.9",
			"o3",
			"codex-auto-review",
			"or-new",
			"or-old",
		]);
	});
});
