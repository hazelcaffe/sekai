import { describe, expect, test } from "bun:test";
import { strToU8, zipSync } from "fflate";
import { chunkSections } from "../src/library/chunk.ts";
import { docxToText, htmlToText, kindOf } from "../src/library/extract.ts";

describe("library", () => {
	test("knows what it can read", () => {
		expect(kindOf("manual.pdf", "")).toBe("pdf");
		expect(kindOf("notes.docx", "")).toBe("docx");
		expect(kindOf("page.html", "text/html")).toBe("html");
		expect(kindOf("README.md", "")).toBe("text");
		expect(kindOf("data.bin", "application/octet-stream")).toBeNull();
		expect(kindOf("photo.png", "image/png")).toBeNull();
	});

	test("passages keep their page and nearest heading, and stay near the target size", () => {
		const long = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} about fish and servers.`).join(" ");
		const passages = chunkSections([
			{ page: 1, text: `# Setup\n\nInstall it.\n\n${long}` },
			{ page: 2, text: "## Usage\n\nRun it daily." },
		]);
		expect(passages[0]?.heading).toBe("Setup");
		expect(passages[0]?.page).toBe(1);
		expect(passages.every((p) => p.content.length <= 1800)).toBe(true);
		const last = passages.at(-1);
		expect(last?.page).toBe(2);
		expect(last?.heading).toBe("Usage");
		expect(passages.map((p) => p.ord)).toEqual(passages.map((_, i) => i));
	});

	test("HTML and Word become plain text with headings", () => {
		expect(
			htmlToText("<style>x{}</style><h2>Title &amp; more</h2><p>Hello<br>world</p><script>bad()</script>"),
		).toBe("## Title & more\n\nHello\nworld");
		const xml = `<w:document><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Intro</w:t></w:r></w:p><w:p><w:r><w:t>Fish &amp; chips</w:t></w:r></w:p></w:body></w:document>`;
		const docx = zipSync({ "word/document.xml": strToU8(xml) });
		expect(docxToText(docx)).toBe("# Intro\n\nFish & chips");
	});
});
