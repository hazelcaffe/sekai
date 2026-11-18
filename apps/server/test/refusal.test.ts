import { describe, expect, test } from "bun:test";
import { isSafetyError, isSafetyFinish, looksLikeRefusal, nextRetryModel } from "../src/agent/refusal.ts";

describe("refusal hints", () => {
	test("typical refusals", () => {
		for (const t of [
			"I'm sorry, but I can't help with that.",
			"I can't assist with creating that.",
			"Sorry, I won't do that.",
			"I must decline this request.",
			"Unfortunately, I am unable to help with this.",
			"I'm not able to provide instructions for that.",
			"As an AI, I cannot do this.",
		]) {
			expect(looksLikeRefusal(t)).toBe(true);
		}
	});

	test("ordinary answers aren't refusals", () => {
		for (const t of [
			"Sure! Here's the summary.",
			"The capital of France is Paris.",
			"Done: saved to memory.",
			"Sorry for the wait, here's what I found: ...",
			"",
		]) {
			expect(looksLikeRefusal(t)).toBe(false);
		}
	});

	test("long replies aren't treated as refusals even if they start with a caveat", () => {
		expect(looksLikeRefusal(`I can't open that link directly, but here's a full guide.\n${"x ".repeat(900)}`)).toBe(
			false,
		);
	});
});

describe("safety signals", () => {
	test("finish reasons", () => {
		expect(isSafetyFinish("content_filter")).toBe(true);
		expect(isSafetyFinish("SAFETY")).toBe(true);
		expect(isSafetyFinish("refusal")).toBe(true);
		expect(isSafetyFinish("stop")).toBe(false);
		expect(isSafetyFinish(null)).toBe(false);
	});

	test("provider errors", () => {
		expect(isSafetyError(new Error("gpt-x: Your request was flagged by our content filter"))).toBe(true);
		expect(
			isSafetyError(
				new Error("Invalid prompt: your prompt was flagged as potentially violating our usage policy"),
			),
		).toBe(true);
		expect(isSafetyError(new Error("Response blocked due to SAFETY"))).toBe(true);
		expect(isSafetyError(new Error("connect ECONNREFUSED 127.0.0.1:8788"))).toBe(false);
		expect(isSafetyError(new Error("Rate limit exceeded"))).toBe(false);
		expect(isSafetyError(new Error("upstream timed out"))).toBe(false);
	});
});

describe("picking the next model", () => {
	const provider = (m: string) => m.split("-")[0] ?? m;
	const ref = (model: string) => ({ model, thinking: "default" as const });
	const candidates = [ref("claude-sonnet"), ref("claude-opus"), ref("gpt-sol"), ref("grok-4")];

	test("prefers a provider that hasn't refused", () => {
		expect(nextRetryModel(candidates, ["claude-haiku"], provider)?.model).toBe("gpt-sol");
	});

	test("never repeats a model, falls back to the same provider last", () => {
		expect(nextRetryModel(candidates, ["claude-haiku", "gpt-sol", "grok-4"], provider)?.model).toBe(
			"claude-sonnet",
		);
		expect(nextRetryModel([ref("a-1")], ["a-1"], provider)).toBeNull();
	});
});
