import { describe, expect, test } from "bun:test";
import { plainPreview } from "../src/services/conversations.ts";

describe("chat previews", () => {
	test("markdown marks are dropped, words kept", () => {
		expect(
			plainPreview(
				"**Good morning, Sam.** Here's what happened.\n\n**What your bots did**\n- **test**: 11 replies",
			),
		).toBe("Good morning, Sam. Here's what happened. What your bots did test: 11 replies");
		expect(plainPreview("## Plan\n1. Run `bun test`\n> quoted [the docs](https://x.y)")).toBe(
			"Plan 1. Run bun test quoted the docs",
		);
		expect(plainPreview("Here:\n```ts\nconst x = 1;\n```\nDone")).toBe("Here: Done");
		expect(plainPreview("note_write and a*b stay")).toBe("note_write and a*b stay");
	});
});
