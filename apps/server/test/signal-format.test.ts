import { describe, expect, test } from "bun:test";
import {
	fromSignalText,
	mentionToken,
	SIGNAL_MAX_BYTES,
	signalChunks,
	toSignalText,
} from "../src/channels/signal-format.ts";

/** Each style range as [style, the text it covers]. */
function styled(md: string): { text: string; spans: [string, string][]; mentions: string[] } {
	const r = toSignalText(md);
	return {
		text: r.text,
		spans: r.styles.map((s) => {
			const [start, length, style] = s.split(":");
			return [style ?? "", r.text.slice(Number(start), Number(start) + Number(length))];
		}),
		mentions: r.mentions,
	};
}

describe("Markdown → Signal text styles", () => {
	test("bold, italic, strikethrough, monospace and spoilers become ranges over plain text", () => {
		expect(styled("Hello **world**, *you* and ~~them~~, `x = 1` and ||a secret||")).toEqual({
			text: "Hello world, you and them, x = 1 and a secret",
			spans: [
				["BOLD", "world"],
				["ITALIC", "you"],
				["STRIKETHROUGH", "them"],
				["MONOSPACE", "x = 1"],
				["SPOILER", "a secret"],
			],
			mentions: [],
		});
		expect(styled("__bold__ and _italic_ and ***both***").spans).toEqual([
			["BOLD", "bold"],
			["ITALIC", "italic"],
			["ITALIC", "both"],
			["BOLD", "both"],
		]);
		expect(styled("**bold _and italic_ inside**").spans).toEqual([
			["BOLD", "bold and italic inside"],
			["ITALIC", "and italic"],
		]);
	});

	test("ranges count UTF-16 code units, like Signal's", () => {
		const r = styled("🎉 **yay** é");
		expect(r.text).toBe("🎉 yay é");
		expect(toSignalText("🎉 **yay** é").styles).toEqual(["3:3:BOLD"]);
		expect(r.spans).toEqual([["BOLD", "yay"]]);
	});

	test("words with underscores, sums and stars on their own stay as they are", () => {
		expect(styled("snake_case_name, 2*3*4 and a * b").text).toBe("snake_case_name, 2*3*4 and a * b");
		expect(styled("snake_case_name, 2*3*4 and a * b").spans).toEqual([]);
		expect(styled("unclosed **bold").text).toBe("unclosed **bold");
		expect(styled("escaped \\*stars\\*").text).toBe("escaped *stars*");
	});

	test("links keep their address (Signal makes it tappable), and bare ones aren't styled", () => {
		expect(styled("See [the docs](https://example.com/a_b_c) or <https://example.org>").text).toBe(
			"See the docs (https://example.com/a_b_c) or https://example.org",
		);
		expect(styled("[https://example.net](https://example.net)").text).toBe("https://example.net");
		const bare = styled("Read https://example.com/some_path_here, then _go_.");
		expect(bare.text).toBe("Read https://example.com/some_path_here, then go.");
		expect(bare.spans).toEqual([["ITALIC", "go"]]);
		expect(styled("![a cat](https://img.example/cat.png)").text).toBe("a cat (https://img.example/cat.png)");
	});

	test("headings are bold lines, lists get bullets, rules a line, code blocks and tables monospace", () => {
		const r = styled("# Plan\n\n- one\n- **two**\n1. three\n> quoted\n---\n```ts\nconst x = 1;\n```\nafter");
		expect(r.text).toBe("Plan\n\n• one\n• two\n1. three\n> quoted\n———\nconst x = 1;\nafter");
		expect(r.spans).toEqual([
			["BOLD", "Plan"],
			["BOLD", "two"],
			["MONOSPACE", "const x = 1;"],
		]);
		const table = styled("| a | b |\n|---|---|\n| 1 | 2 |\n\nend");
		expect(table.text).toBe("| a | b |\n|---|---|\n| 1 | 2 |\n\nend");
		expect(table.spans).toEqual([["MONOSPACE", "| a | b |\n|---|---|\n| 1 | 2 |"]]);
	});

	test("mentions become Signal mentions (one placeholder character each)", () => {
		const aci = "3f9a1c2e-0000-4000-8000-00000000abcd";
		const r = toSignalText(`Hey ${mentionToken(aci)}, **look**`);
		expect(r.text).toBe("Hey \uFFFC, look");
		expect(r.mentions).toEqual([`4:1:${aci}`]);
		expect(r.styles).toEqual(["7:4:BOLD"]);
		// A stray placeholder in the Markdown never fakes a mention.
		expect(toSignalText("a \uFFFC b").text).toBe("a  b");
	});

	test("Sekai's small print (-#) is plain text", () => {
		expect(toSignalText("-# ⚠️ Stopped").text).toBe("⚠️ Stopped");
	});
});

describe("splitting long replies", () => {
	const bytes = (s: string) => Buffer.byteLength(toSignalText(s).text, "utf8");

	test("short replies stay one message", () => {
		expect(signalChunks("Just a short answer.")).toEqual(["Just a short answer."]);
	});

	test("every part fits Signal's 2,000 bytes, even when characters take several bytes", () => {
		const md = `${"Grüße aus Köln, ".repeat(120)}\n\n${"日本語の文章です。".repeat(150)}\n\n${"🎉".repeat(700)}`;
		const parts = signalChunks(md);
		expect(parts.length).toBeGreaterThan(3);
		for (const p of parts) expect(bytes(p)).toBeLessThanOrEqual(SIGNAL_MAX_BYTES);
		// Nothing is lost (parts are cut at spaces and paragraphs).
		expect(parts.join(" ").replace(/\s+/g, "")).toBe(md.replace(/\s+/g, ""));
	});

	test("parts break at paragraphs, and code blocks are closed and reopened", () => {
		const md = `Intro paragraph.\n\n\`\`\`\n${"line of code\n".repeat(300)}\`\`\`\n\nOutro.`;
		const parts = signalChunks(md);
		expect(parts.length).toBeGreaterThan(1);
		for (const p of parts) {
			expect(bytes(p)).toBeLessThanOrEqual(SIGNAL_MAX_BYTES);
			expect((p.match(/^```/gm) ?? []).length % 2).toBe(0);
		}
		expect(parts[0]?.startsWith("Intro paragraph.")).toBe(true);
		expect(parts.at(-1)?.endsWith("Outro.")).toBe(true);
	});
});

describe("Signal text → Markdown for the bot", () => {
	test("mentions become tokens and styles become marks", () => {
		expect(
			fromSignalText(
				"Hi \uFFFC, this is bold and code",
				[{ start: 3, length: 1, id: "abc" }],
				[
					{ style: "BOLD", start: 14, length: 4 },
					{ style: "MONOSPACE", start: 23, length: 4 },
				],
			),
		).toBe("Hi <@abc>, this is **bold** and `code`");
	});

	test("ranges outside the text are ignored", () => {
		expect(
			fromSignalText("short", [{ start: 9, length: 1, id: "x" }], [{ style: "BOLD", start: 2, length: 99 }]),
		).toBe("short");
	});
});
