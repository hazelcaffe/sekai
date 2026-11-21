import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { extractDesktopTokensCss, extractWindowBackgrounds } from "../scripts/tokens.ts";

const desktopRoot = join(import.meta.dir, "..");
const uiCssPath = join(desktopRoot, "../../packages/ui/src/styles/index.css");
const uiCss = readFileSync(uiCssPath, "utf8");

describe("desktop design tokens", () => {
	test("extracts light, dark, derived surfaces, type roles, radii and reduced motion from @sekai/ui", () => {
		const out = extractDesktopTokensCss(uiCss);
		expect(out).toContain("--bg: #ffffff;");
		expect(out).toContain("--bg: #0d0a10;");
		expect(out).toContain("--primary: #0b1716;");
		expect(out).toContain("--primary: #f3eef7;");
		expect(out).toContain("--brand-ink: #0a7a6f;");
		expect(out).toContain("--surface-2: color-mix(");
		expect(out).toContain("--type-title:");
		expect(out).toContain("--type-body:");
		expect(out).toContain("--type-caption:");
		expect(out).toContain("--radius-md: 8px;");
		expect(out).toContain("--radius-xl: 16px;");
		expect(out).toContain("prefers-color-scheme: dark");
		expect(out).toContain("prefers-reduced-motion: reduce");
	});

	test("extracts light and dark window backgrounds from @sekai/ui", () => {
		const bg = extractWindowBackgrounds(uiCss);
		expect(bg).toEqual({ light: "#ffffff", dark: "#0d0a10" });
	});

	test("desktop HTML screens use tokens.css with no hand-copied hex colours or developer CLI copy", () => {
		for (const file of ["src/connect.html", "src/about.html"]) {
			const html = readFileSync(join(desktopRoot, file), "utf8");
			expect(html).toContain('<link rel="stylesheet" href="tokens.css" />');
			// Strip HTML entities and check there are no raw hex colors in styles.
			const style = html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "";
			expect(style).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
			expect(html).not.toContain("bun run docker:up");
			expect(html).not.toContain("bun run dev");
		}
	});
});
