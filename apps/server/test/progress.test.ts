import { describe, expect, test } from "bun:test";
import {
	estimateTokens,
	NUDGE_AFTER,
	RepeatWatch,
	STOP_AFTER,
	stepSignature,
	trimOldResults,
} from "../src/agent/progress.ts";
import type { ChatMessage } from "../src/llm/types.ts";

const call = (name: string, args = "{}") => ({ name, args });
const result = (content: string, images: Uint8Array[] = []) => ({ content, images: images.map((data) => ({ data })) });

describe("keeping a long reply going", () => {
	test("the same step with the same result counts up; anything new starts again", () => {
		const watch = new RepeatWatch();
		const same = stepSignature([call("computer_click", '{"x":1}')], [result("ok")]);
		const counts = Array.from({ length: STOP_AFTER }, () => watch.step(same));
		expect(counts).toEqual([1, 2, 3, 4, 5]);
		expect(counts[NUDGE_AFTER - 1]).toBe(NUDGE_AFTER);
		expect(watch.step(stepSignature([call("computer_click", '{"x":2}')], [result("ok")]))).toBe(1);
	});

	test("a step is only the same when its result is too: waiting for a screen that changes isn't going in circles", () => {
		const a = stepSignature([call("computer_screenshot")], [result("Screenshot", [new Uint8Array([1, 2, 3])])]);
		const b = stepSignature([call("computer_screenshot")], [result("Screenshot", [new Uint8Array([1, 2, 4])])]);
		const c = stepSignature([call("computer_screenshot")], [result("Screenshot", [new Uint8Array([1, 2, 3])])]);
		expect(a).not.toBe(b);
		expect(a).toBe(c);
		expect(stepSignature([call("read")], [result("one")])).not.toBe(stepSignature([call("read")], [result("two")]));
	});

	test("older tool results are shortened near the model's window, the newest few stay whole", () => {
		const big = "x".repeat(4000);
		const messages: ChatMessage[] = [{ role: "system", content: "You are a bot." }];
		for (let i = 0; i < 20; i++) {
			messages.push({
				role: "assistant",
				content: null,
				tool_calls: [{ id: `c${i}`, type: "function", function: { name: "read", arguments: "{}" } }],
			});
			messages.push({ role: "tool", tool_call_id: `c${i}`, content: `${i}:${big}` });
		}
		// Plenty of room: nothing changes.
		expect(trimOldResults(messages, 1_000_000)).toBe(0);
		const before = estimateTokens(messages);
		const trimmed = trimOldResults(messages, 30_000);
		expect(trimmed).toBeGreaterThan(0);
		expect(estimateTokens(messages)).toBeLessThan(before);
		const tools = messages.filter((m) => m.role === "tool").map((m) => m.content as string);
		// The newest eight are whole; shortened ones keep their start and say so.
		for (const t of tools.slice(-8)) expect(t.length).toBeGreaterThan(4000);
		expect(tools[0]).toStartWith("0:xxx");
		expect(tools[0]).toEndWith("shortened to save room]");
		// Calls and their results stay paired (nothing removed).
		expect(tools).toHaveLength(20);
	});
});
