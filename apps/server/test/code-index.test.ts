import { describe, expect, test } from "bun:test";
import { chunkFile, embeddingText } from "../src/code/chunker.ts";

describe("code chunks", () => {
	test("long files break at declarations, with line numbers that match the file", () => {
		const fn = (name: string) =>
			[
				`export function ${name}(a: number): number {`,
				...Array.from({ length: 30 }, (_, i) => `\tconst v${i} = a + ${i};`),
				"\treturn a;",
				"}",
				"",
			].join("\n");
		const text = ['import { x } from "y";', "", fn("alpha"), fn("beta"), fn("gamma"), fn("delta")].join("\n");
		const chunks = chunkFile("src/math.ts", text);
		const lines = text.split("\n");
		expect(chunks.length).toBeGreaterThan(1);
		for (const c of chunks) {
			// Every chunk is exactly the file's lines startLine..endLine.
			expect(c.content).toBe(lines.slice(c.startLine - 1, c.endLine).join("\n"));
			expect(c.endLine - c.startLine).toBeLessThan(100);
		}
		// A later chunk starts right at a function, and knows its name.
		const later = chunks.slice(1).find((c) => c.content.startsWith("export function"));
		expect(later?.symbol).toMatch(/^(alpha|beta|gamma|delta)$/);
		expect(chunks.at(-1)?.endLine).toBe(lines.at(-1) === "" ? lines.length - 1 : lines.length);
	});

	test("Markdown breaks at headings and names chunks after them", () => {
		const section = (h: string) =>
			[`## ${h}`, "", ...Array.from({ length: 40 }, (_, i) => `Line ${i} about ${h}.`), ""].join("\n");
		const chunks = chunkFile(
			"docs/guide.md",
			["# Guide", "", section("Install"), section("Configure"), section("Deploy")].join("\n"),
		);
		expect(chunks.some((c) => c.symbol === "Configure" && c.content.startsWith("## Configure"))).toBe(true);
	});

	test("minified lines don't make giant chunks", () => {
		const text = Array.from({ length: 20 }, () => "x".repeat(1500)).join("\n");
		for (const c of chunkFile("dist/app.min.js", text)) expect(c.content.length).toBeLessThanOrEqual(8000);
	});

	test("blank files have no chunks; what the model reads says where it is", () => {
		expect(chunkFile("empty.ts", "\n\n\n")).toEqual([]);
		const [c] = chunkFile("src/a.ts", "export const answer = 42;\n");
		expect(c && embeddingText("src/a.ts", c)).toStartWith("src/a.ts · answer (lines 1-1)");
	});
});
