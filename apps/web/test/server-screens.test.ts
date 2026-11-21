import { describe, expect, test } from "bun:test";
import type { ProviderWithStatus } from "@sekai/shared";
import { change, guessVendor, money, moneyTick, tokensTick } from "../src/settings/bots/usage/format.ts";
import { seriesColor } from "../src/settings/bots/usage/series.ts";
import { friendlyAttentionDetail, subscriptionAttention } from "../src/settings/server/attention.ts";
import { grantedByWords } from "../src/settings/server/grants.ts";

describe("Status attention wording", () => {
	test("turns raw network and DNS exception strings into plain sentences", () => {
		expect(friendlyAttentionDetail("getaddrinfo ENOTFOUND trail-catalog.invalid", "Fallback")).toBe(
			"Couldn't reach trail-catalog.invalid. Check its address.",
		);
		expect(friendlyAttentionDetail("connect ECONNREFUSED 127.0.0.1:3002", "Fallback")).toBe(
			"Connection refused. Check that the service is running.",
		);
		expect(friendlyAttentionDetail("Request timed out", "Fallback")).toBe("Timed out waiting for a response.");
		// The server couldn't reach a service: not the person's own connection to Sekai.
		expect(friendlyAttentionDetail("fetch failed", "Fallback")).toBe(
			"Couldn't connect. Check the address and that it's running.",
		);
		expect(friendlyAttentionDetail("", "Its tools are unavailable.")).toBe("Its tools are unavailable.");
		expect(friendlyAttentionDetail(null, "Its tools are unavailable.")).toBe("Its tools are unavailable.");
	});

	test("keeps readable messages, even with words like null, and hides machine output", () => {
		expect(friendlyAttentionDetail("The server returned null for the token.", "Fallback")).toBe(
			"The server returned null for the token.",
		);
		expect(friendlyAttentionDetail('{"error":"invalid_grant"}', "Sign in again.")).toBe("Sign in again.");
		expect(friendlyAttentionDetail("<html><body>502</body></html>", "Check it.")).toBe("Check it.");
		expect(friendlyAttentionDetail("TypeError: x is not a function\n    at f (a.js:1)", "Fallback")).toBe(
			"Fallback",
		);
		expect(friendlyAttentionDetail("x".repeat(400), "Fallback")).toHaveLength(160);
	});
});

describe("Usage formatting and series tokens", () => {
	test("uses the design system's --series-1…8 tokens for chart bands", () => {
		expect(seriesColor(0, "claude-haiku-4-5")).toBe("var(--series-1)");
		expect(seriesColor(7, "gpt-5")).toBe("var(--series-8)");
		expect(seriesColor(8, "gemini")).toBe("var(--series-1)");
		expect(seriesColor(2, "other")).toBe("var(--usage-other)");
	});

	test("formats token, dollar and delta values", () => {
		expect(money(0.004)).toBe("<$0.01");
		expect(money(5.6)).toBe("$5.60");
		expect(money(42.4)).toBe("$42");
		expect(moneyTick(1500)).toBe("$1.5k");
		expect(tokensTick(750_000)).toBe("750k");
		expect(tokensTick(1_500_000)).toBe("1.5M");
		expect(change(120, 100)).toBeCloseTo(0.2);
		expect(change(100, 0)).toBeNull();
	});

	test("guesses model vendors for brand glyphs", () => {
		expect(guessVendor("claude-haiku-4-5")).toBe("anthropic");
		expect(guessVendor("gpt-5.4-mini")).toBe("openai");
		expect(guessVendor("gemini-3.5-flash")).toBe("google");
		expect(guessVendor("unknown-local")).toBeNull();
	});
});

describe("Status links", () => {
	test("Fix for a subscription opens that subscription's own page, and its dot stays on Subscriptions", () => {
		const provider = (id: string, state: string, title: string) =>
			({ id, title, status: { state, error: null } }) as unknown as ProviderWithStatus;
		const items = subscriptionAttention([
			provider("prv_codex", "auth_required", "Codex"),
			provider("prv_claude", "ready", "Claude Code"),
			provider("prv_pi", "error", "Pi"),
		]);
		expect(items.map((i) => [i.title, i.href, i.section])).toEqual([
			["Sign in to Codex again", "/settings/subscriptions/prv_codex", "subscriptions"],
			["Pi isn't working", "/settings/subscriptions/prv_pi", "subscriptions"],
		]);
	});
});

describe("Device access", () => {
	test("says who let a bot in, in people's words", () => {
		expect(grantedByWords("user")).toBe("you");
		expect(grantedByWords("the user")).toBe("you");
		expect(grantedByWords("the Don't ask rule")).toBe("the Don't ask rule");
		expect(grantedByWords("YOLO mode")).toBe("the Don't ask rule");
		expect(grantedByWords("approved (auto mode)")).toBe("the reviewer");
		expect(grantedByWords("the reviewer")).toBe("the reviewer");
		expect(grantedByWords("the primary bot")).toBe("the primary bot");
		expect(grantedByWords("Nori (primary bot)")).toBe("Nori, the primary bot");
	});
});
