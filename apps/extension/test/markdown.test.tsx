import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ExtensionMarkdown } from "../src/markdown.tsx";
import { browserActionSummary } from "../src/parts.tsx";

const html = (text: string) => renderToStaticMarkup(<ExtensionMarkdown text={text} />);

describe("extension Markdown", () => {
	test("renders the basics", () => {
		const out = html("# Hi\n\n**bold** and *it* and `code`\n\n- one\n- two\n\n1. first\n\n```\nx < y\n```");
		expect(out).toContain("<strong");
		expect(out).toContain("<em>it</em>");
		expect(out).toContain("<code");
		expect(out).toContain("<ul");
		expect(out).toContain("<ol");
		expect(out).toContain("x &lt; y");
	});

	test("never passes raw HTML through", () => {
		for (const text of [
			"<img src=x onerror=alert(1)>",
			"<script>alert(1)</script>",
			"**<b onmouseover=alert(1)>x</b>**",
			"`<svg onload=alert(1)>`",
			"```\n</code></pre><script>alert(1)</script>\n```",
			"- <iframe src=javascript:alert(1)>",
		]) {
			const out = html(text);
			expect(out).not.toMatch(/<(img|script|b |svg|iframe)/i);
		}
	});

	test("links are only http(s), opened safely, with no injected attributes", () => {
		expect(html("[ok](https://example.com/a?b=1)")).toContain(
			'<a href="https://example.com/a?b=1" target="_blank" rel="noreferrer"',
		);
		for (const text of [
			"[x](javascript:alert(1))",
			"[x](JaVaScRiPt:alert(1))",
			"[x](data:text/html;base64,PHNjcmlwdD4=)",
			"[x](vbscript:msgbox(1))",
			"[x](//evil.example/a)",
			"[x]( javascript:alert(1))",
		]) {
			expect(html(text)).not.toContain("<a");
		}
		const quoted = html('[x](https://example.com/"onmouseover="alert(1))');
		const attrs = quoted.match(/<a ([^>]*)>/)?.[1] ?? "";
		expect([...attrs.matchAll(/([\w-]+)="[^"]*"/g)].map((m) => m[1])).toEqual(["href", "target", "rel", "class"]);
	});
});

describe("browser approvals in words", () => {
	const tabName = (id: number) => (id === 7 ? "docs.example.com" : null);

	test("says what will happen and where", () => {
		const args = (input: Record<string, unknown>) => ({ connectionId: "c", input });
		expect(browserActionSummary(args({ action: "type", tabId: 7, text: "hello" }), tabName)).toBe(
			"Type “hello” on docs.example.com",
		);
		expect(browserActionSummary(args({ action: "navigate", tabId: 7, url: "https://x.example/" }), tabName)).toBe(
			"Go from docs.example.com to https://x.example/",
		);
		expect(browserActionSummary(args({ action: "click", tabId: 9 }), tabName)).toBe("Click on a shared tab");
		expect(browserActionSummary({ action: "press", tabId: 7, key: "Enter" }, tabName)).toBe(
			"Press Enter on docs.example.com",
		);
		expect(browserActionSummary({ action: "unknown" }, tabName)).toBeNull();
	});

	test("shortens long text", () => {
		const out = browserActionSummary({ action: "type", tabId: 7, text: "a".repeat(500) }, tabName) ?? "";
		expect(out.length).toBeLessThan(200);
		expect(out).toContain("…");
	});
});
