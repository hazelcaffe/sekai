import { describe, expect, test } from "bun:test";
import { Glob } from "bun";

/**
 * DESIGN.md's rules for app code that a machine can check: type roles instead of pixel sizes, Sekai's colour names
 * instead of shadcn's or raw ones, the radius scale, named z-index layers, status text in its -ink shade, and
 * tooltips or visible hints instead of title=, and the selected item's own fill. @sekai/ui itself is exempt (its shadcn
 * parts use shadcn's names).
 */
const root = new URL("../../../", import.meta.url).pathname;
const dirs = ["apps/web/src", "packages/client/src", "apps/extension/src"];

const palette =
	"slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const RULES: [RegExp, string][] = [
	[/^text-\[[\d.]+(px|rem)\]$/, "a pixel text size: use a type role (text-caption … text-display)"],
	[/^text-(xs|sm|base|lg|xl|[2-9]xl)$/, "Tailwind's text sizes: use a type role (text-caption … text-display)"],
	[/^rounded(-[a-z]{1,2})?-(\[.+\]|xs|2xl|3xl|4xl)$/, "off the radius scale: rounded-sm, md, lg, xl or full"],
	[/^z-(\[\d+\]|[2-9]\d|\d{3,})$/, "a raw z-index: use a named layer (z-sticky, z-panel, z-dialog…)"],
	[
		/^(bg|text|border|ring|ring-offset|divide|outline|fill|stroke)-(background|foreground|card|popover|muted|accent|secondary|destructive|input|muted-foreground|popover-foreground|card-foreground)(\/.+)?$/,
		"a shadcn colour name: use Sekai's (bg, surface, surface-2, fg, fg-muted…)",
	],
	[
		new RegExp(
			`^(bg|text|border|ring|divide|outline|fill|stroke|from|to|via|shadow)-(white|black|(${palette})-\\d+)(/.+)?$`,
		),
		"a raw colour: use a token",
	],
	[/^(bg|text|border|ring|fill|stroke)-\[(#|rgb|hsl|oklch)/, "a raw colour: use a token"],
	[/^text-(danger|warning|success|info)(\/.+)?$/, "status text uses its -ink shade (text-danger-ink…)"],
	[/^text-brand(\/.+)?$/, "brand text uses brand-ink"],
];

/** Exceptions, each with its reason. */
const ALLOW: { file: RegExp; token: RegExp; why: string }[] = [];

function utility(tok: string): string {
	let depth = 0;
	let last = 0;
	for (let i = 0; i < tok.length; i++) {
		const c = tok[i];
		if (c === "[" || c === "(") depth++;
		else if (c === "]" || c === ")") depth--;
		else if (c === ":" && depth === 0) last = i + 1;
	}
	return tok.slice(last).replace(/^!/, "");
}

const files: { path: string; src: string }[] = [];
for (const d of dirs) {
	for await (const f of new Glob("**/*.{ts,tsx,css,html}").scan(`${root}${d}`)) {
		files.push({ path: `${d}/${f}`, src: await Bun.file(`${root}${d}/${f}`).text() });
	}
}

describe("design rules in app code", () => {
	test("finds the app sources", () => {
		expect(files.length).toBeGreaterThan(50);
	});

	test("classes", () => {
		const problems: string[] = [];
		for (const { path, src } of files) {
			const lines = src.split("\n");
			lines.forEach((line, i) => {
				for (const m of line.matchAll(/[!\w\-:[\]&_>*./%(),#=]+/g)) {
					const base = utility(m[0]);
					for (const [re, why] of RULES) {
						if (!re.test(base)) continue;
						if (ALLOW.some((a) => a.file.test(path) && a.token.test(base))) continue;
						problems.push(`${path}:${i + 1} ${m[0]}: ${why}`);
					}
				}
			});
		}
		expect(problems).toEqual([]);
	});

	test("no title= tooltips (touch screens never show them: IconButton, Tooltip or a visible hint)", () => {
		const problems: string[] = [];
		for (const { path, src } of files) {
			if (!path.endsWith(".tsx")) continue;
			for (const tag of jsxTags(src)) {
				// HTML elements and the controls that hand their props to one; an iframe's title is its accessible name.
				if (
					!/^([a-z]|(Button|IconButton|Input|PasswordInput|Textarea|Link)$)/.test(tag.name) ||
					tag.name === "iframe"
				)
					continue;
				if (/\stitle=/.test(tag.attrs)) problems.push(`${path}:${tag.line} <${tag.name} title=…>`);
			}
		}
		expect(problems).toEqual([]);
	});

	test("selected and active items use bg-selected (surface-2 barely shows on a light sidebar)", () => {
		const problems: string[] = [];
		for (const { path, src } of files) {
			src.split("\n").forEach((line, i) => {
				if (/\b(active|selected|current)\w*\s*(\?|&&)\s*"[^"]*\bbg-surface-2\b/i.test(line))
					problems.push(`${path}:${i + 1}`);
			});
		}
		expect(problems).toEqual([]);
	});
});

/**
 * Every JSX opening tag in a file: its name, line and its own attributes (what's inside `{…}` left out, so an arrow
 * function's `>` doesn't end the tag early and a nested element's props don't count).
 */
function jsxTags(src: string): { name: string; line: number; attrs: string }[] {
	const tags: { name: string; line: number; attrs: string }[] = [];
	for (const m of src.matchAll(/<([A-Za-z][\w.]*)(?=[\s/>])/g)) {
		let depth = 0;
		let quote = "";
		let attrs = "";
		for (let i = (m.index ?? 0) + m[0].length; i < src.length; i++) {
			const c = src[i] as string;
			if (quote) {
				if (c === quote) quote = "";
				if (depth === 0) attrs += c;
				continue;
			}
			if (depth === 0 && c === "/" && src[i + 1] === "/") {
				i = src.indexOf("\n", i);
				if (i < 0) break;
				continue;
			}
			if (depth === 0 && c === "/" && src[i + 1] === "*") {
				i = src.indexOf("*/", i) + 1;
				if (i <= 0) break;
				continue;
			}
			if (c === "{") depth++;
			else if (c === "}") depth--;
			else if (depth === 0 && (c === '"' || c === "'")) quote = c;
			else if (depth === 0 && c === ">") break;
			if (depth === 0) attrs += c;
		}
		tags.push({ name: m[1] as string, line: src.slice(0, m.index).split("\n").length, attrs });
	}
	return tags;
}
