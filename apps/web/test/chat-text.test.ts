import { expect, test } from "bun:test";
import { chatPreview } from "../src/components/chat/chat-text.ts";

test("chat previews keep the words without Markdown or raw display math", () => {
	expect(chatPreview("## **Sheet area**\n$$ 148 \\text{ mm}…")).toBe("Sheet area [formula]");
	expect(chatPreview("- [x] [Proof](https://example.test/proof) with `print_pdf` and $x^2$")).toBe(
		"Proof with print_pdf and x^2",
	);
	expect(chatPreview("This costs $5 to $10")).toBe("This costs $5 to $10");
});
