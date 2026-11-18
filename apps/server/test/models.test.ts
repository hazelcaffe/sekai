import { describe, expect, test } from "bun:test";
import type { ModelInfo, ModelRef, Settings } from "@sekai/shared";
import { defaultModels, resolveModel } from "../src/agent/models.ts";
import { defaultRetryModels } from "../src/agent/refusal.ts";

const info = (id: string, provider: string): ModelInfo => ({
	id,
	name: id,
	provider,
	contextWindow: 128_000,
	maxOutputTokens: 16_000,
	thinkingLevels: [],
	vision: false,
});
const ref = (model: string): ModelRef => ({ model, thinking: "default" });
const catalog = [info("llama-4", "meta"), info("qwen-3", "alibaba"), info("llama-4-mini", "meta")];
const settings = (primary: string, fast: string) =>
	({ defaultModel: ref(primary), defaultFastModel: ref(fast) }) as Settings;

describe("default models", () => {
	test("a default the gateway doesn't offer gives way to the first model that is", () => {
		expect(resolveModel(ref("qwen-3"), catalog)).toEqual(ref("qwen-3"));
		expect(resolveModel(ref("some-model-elsewhere"), catalog)).toEqual(ref("llama-4"));
	});

	test("kept as they are when nothing is known, and for subscription models", () => {
		expect(resolveModel(ref("some-model-elsewhere"), null)).toEqual(ref("some-model-elsewhere"));
		expect(resolveModel(ref("some-model-elsewhere"), [])).toEqual(ref("some-model-elsewhere"));
		expect(resolveModel(ref("prv_abc::default"), catalog)).toEqual(ref("prv_abc::default"));
	});

	test("new bots get models on offer; the background model falls back to the default model", async () => {
		expect(await defaultModels(settings("qwen-3", "llama-4-mini"), catalog)).toEqual({
			primary: ref("qwen-3"),
			fast: ref("llama-4-mini"),
		});
		expect(await defaultModels(settings("qwen-3", "gone-mini"), catalog)).toEqual({
			primary: ref("qwen-3"),
			fast: ref("qwen-3"),
		});
		expect(await defaultModels(settings("gone", "gone-mini"), catalog)).toEqual({
			primary: ref("llama-4"),
			fast: ref("llama-4"),
		});
	});

	test("refusals go to the default model, then the first model of each provider", () => {
		expect(defaultRetryModels(catalog, ref("llama-4-mini"))).toEqual([
			ref("llama-4-mini"),
			ref("llama-4"),
			ref("qwen-3"),
		]);
		expect(defaultRetryModels(catalog, ref("gone"))[0]).toEqual(ref("llama-4"));
	});
});
