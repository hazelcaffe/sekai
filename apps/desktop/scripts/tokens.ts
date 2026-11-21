/**
 * Extracts the real @sekai/ui design tokens (colours, derived color-mix surfaces, type scale, radii, motion, and
 * reduced-motion rules) from packages/ui/src/styles/index.css into a standalone CSS sheet for Electron's own pages.
 * Keeps connect.html, about.html and the activity overlay strictly in sync with @sekai/ui without hand-copied hex.
 */

interface Block {
	selector: string;
	body: string;
}

/** Pulls top-level selector { ... } blocks out of a CSS string (ignoring comments and nested braces). */
function topLevelBlocks(css: string): Block[] {
	const cleaned = css.replace(/\/\*[\s\S]*?\*\//g, "");
	const blocks: Block[] = [];
	let i = 0;
	while (i < cleaned.length) {
		while (i < cleaned.length && /\s/.test(cleaned[i] ?? "")) i++;
		if (i >= cleaned.length) break;
		const start = i;
		while (i < cleaned.length && cleaned[i] !== "{" && cleaned[i] !== ";") i++;
		if (cleaned[i] === ";") {
			i++;
			continue;
		}
		if (i >= cleaned.length) break;
		const selector = cleaned.slice(start, i).trim();
		i++; // skip '{'
		const bodyStart = i;
		let depth = 1;
		while (i < cleaned.length && depth > 0) {
			if (cleaned[i] === "{") depth++;
			else if (cleaned[i] === "}") depth--;
			i++;
		}
		const body = cleaned.slice(bodyStart, i - 1).trim();
		blocks.push({ selector, body });
	}
	return blocks;
}

/** Extracts `--name: value;` declarations from a block body, skipping Tailwind `@theme` wildcards (`--radius-*`). */
function customProps(body: string): string[] {
	const out: string[] = [];
	for (const line of body.split(";")) {
		const trimmed = line.trim();
		if (!trimmed.startsWith("--")) continue;
		if (/^--[\w-]+\*\s*:/.test(trimmed)) continue;
		out.push(`${trimmed};`);
	}
	return out;
}

export function extractDesktopTokensCss(uiStylesCss: string, fontFaceCss = ""): string {
	const blocks = topLevelBlocks(uiStylesCss);

	const rootProps: string[] = [];
	const lightDerivedProps: string[] = [];
	const darkProps: string[] = [];
	const darkDerivedProps: string[] = [];
	const radiusProps: string[] = [];
	let reducedMotionBody = "";

	for (const b of blocks) {
		const sel = b.selector.replace(/\s+/g, " ");
		if (sel === ":root") {
			rootProps.push(...customProps(b.body));
		} else if (sel === ".dark") {
			darkProps.push(...customProps(b.body));
		} else if (sel === ":root:not(.dark)") {
			lightDerivedProps.push(...customProps(b.body));
		} else if (sel === ":root.dark, .dark") {
			darkDerivedProps.push(...customProps(b.body));
		} else if (sel === "@theme") {
			radiusProps.push(...customProps(b.body).filter((p) => p.startsWith("--radius-")));
		} else if (sel === "@media (prefers-reduced-motion: reduce)") {
			reducedMotionBody = b.body;
		}
	}

	if (!rootProps.length || !darkProps.length) {
		throw new Error("Could not extract :root and .dark tokens from packages/ui/src/styles/index.css");
	}

	const indent = (lines: string[], tabs = "\t") => lines.map((l) => `${tabs}${l}`).join("\n");

	return [
		"/* Generated from packages/ui/src/styles/index.css by apps/desktop/scripts/build.ts — do not edit by hand. */",
		fontFaceCss.trim(),
		":root {",
		"\tcolor-scheme: light dark;",
		indent(rootProps),
		indent(radiusProps),
		"\t--ring: var(--brand-ink);",
		'\t--font-mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;',
		indent(lightDerivedProps),
		"}",
		"",
		"@media (prefers-color-scheme: dark) {",
		"\t:root:not(.light) {",
		indent(darkProps, "\t\t"),
		indent(darkDerivedProps, "\t\t"),
		"\t\t--ring: var(--brand-ink);",
		"\t}",
		"}",
		"",
		":root.dark,",
		".dark {",
		indent(darkProps),
		indent(darkDerivedProps),
		"\t--ring: var(--brand-ink);",
		"}",
		"",
		"*, *::before, *::after { box-sizing: border-box; }",
		":focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }",
		reducedMotionBody ? `@media (prefers-reduced-motion: reduce) {\n${reducedMotionBody}\n}` : "",
		"",
	]
		.filter(Boolean)
		.join("\n");
}

/** Pulls the light and dark `--bg` values directly from @sekai/ui for BrowserWindow's initial background colour. */
export function extractWindowBackgrounds(uiStylesCss: string): { light: string; dark: string } {
	const blocks = topLevelBlocks(uiStylesCss);
	const findBg = (sel: string) => {
		for (const b of blocks) {
			if (b.selector.replace(/\s+/g, " ") !== sel) continue;
			const m = b.body.match(/--bg:\s*([^;]+);/);
			if (m?.[1]) return m[1].trim();
		}
		return null;
	};
	const light = findBg(":root");
	const dark = findBg(".dark");
	if (!light || !dark) throw new Error("Could not extract --bg values from packages/ui/src/styles/index.css");
	return { light, dark };
}
