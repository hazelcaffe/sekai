import { describe, expect, test } from "bun:test";
import { THEMES } from "../src/lib/themes.ts";
import { fieldStyles } from "../src/shadcn/field-styles.ts";
import { SWITCH_TRACK, switchTrack } from "../src/shadcn/switch.tsx";
import { contrast, parseRules, resolveColor, rootVars } from "./css-colors.ts";

/**
 * DESIGN.md's contrast targets, computed from the real stylesheet for every group theme (and for a .dark area inside a
 * light page, which gets Nightcord at 25:00's colours).
 */
const css = await Bun.file(new URL("../src/styles/index.css", import.meta.url)).text();
const rules = parseRules(css);

/** [foreground token, background token, minimum ratio, what it is]. */
const PAIRS: [string, string, number, string][] = [];
const on = (fg: string, bgs: string[], min: number, what: string) => {
	for (const bg of bgs) PAIRS.push([fg, bg, min, what]);
};
const grounds = ["--bg", "--surface", "--surface-raised"];
on("--fg", grounds, 12, "text");
on("--fg", ["--surface-2", "--surface-3"], 7, "text on a filled surface");
on("--fg-muted", grounds, 7, "secondary text");
on("--fg-muted", ["--surface-2"], 4.5, "secondary text on a filled surface");
on("--fg-subtle", [...grounds, "--bg-subtle"], 4.5, "hints and timestamps");
on("--fg-subtle", ["--surface-2"], 4.5, "placeholders in inputs");
on("--brand-ink", [...grounds, "--brand-soft", "--surface-2"], 4.5, "brand text, links, selected items");
on("--brand-foreground", ["--brand"], 4.5, "text on the brand fill");
on("--primary-foreground", ["--primary"], 4.5, "primary buttons");
on("--danger-foreground", ["--danger"], 4.5, "danger buttons");
for (const s of ["danger", "warning", "success", "info"]) {
	on(`--${s}-ink`, [...grounds, `--${s}-soft`], 4.5, `${s} text`);
}
on("--ring", ["--bg", "--surface", "--surface-2"], 3, "focus rings");
on("--border-strong", ["--bg", "--surface", "--surface-raised"], 3, "control boundaries");
on("--fg", ["--selected"], 7, "text on the selected item");
on("--fg-muted", ["--selected"], 4.5, "secondary text on the selected item");
on("--brand-ink", ["--selected"], 3, "the selected item's icon");
// Not text: how far the selected item's fill stands out from the sidebar, a rail and a list around it (dark themes'
// surface-2 on bg-subtle, which reads clearly, is about 1.11).
on("--selected", ["--bg-subtle", "--bg", "--surface"], 1.12, "the selected item against what's around it");
for (const s of ["keyword", "string", "number", "title", "variable"]) {
	on(`--syntax-${s}`, ["--surface-2"], 4.5, "code");
}

const states = [
	...THEMES.map((t) => ({ name: t.id, state: { theme: t.id, dark: t.mode === "dark" } })),
	{ name: "dark area in a light page", state: { theme: "vs", dark: true } },
];

describe("contrast", () => {
	for (const { name, state } of states) {
		test(name, () => {
			const vars = rootVars(rules, state);
			const failures: string[] = [];
			for (const [fg, bg, min, what] of PAIRS) {
				const background = resolveColor(`var(${bg})`, vars);
				expect(background.a).toBe(1);
				const ratio = contrast(resolveColor(`var(${fg})`, vars), background);
				if (ratio < min) failures.push(`${fg} on ${bg} is ${ratio.toFixed(2)}:1, needs ${min}:1 (${what})`);
			}
			expect(failures).toEqual([]);
		});
	}
});

/*
 * The controls as they're drawn: the colours their own classes give each state (a field at rest, focused or wrong;
 * a switch that's off; the selected row and section), so a control can't pass on tokens it doesn't use.
 */
const source = (file: string) => Bun.file(new URL(`../src/${file}`, import.meta.url)).text();
const classesOf = (text: string) => text.match(/[\w\-:[\]&_>*./%()=!]+/g) ?? [];

/** The colour token a utility gets in a state: colorOf(classes, "border-b", "") → "--border-strong". */
function colorOf(classes: string[], utility: string, variant: string, vars: Map<string, string>): string | null {
	for (const c of classes) {
		const at = c.lastIndexOf(":");
		const v = at < 0 ? "" : c.slice(0, at);
		const u = at < 0 ? c : c.slice(at + 1);
		if (v !== variant || !u.startsWith(`${utility}-`)) continue;
		const name = u.slice(utility.length + 1);
		if (name === "transparent" || vars.has(`--${name}`)) return name === "transparent" ? name : `--${name}`;
	}
	return null;
}

const grounds3 = ["--bg", "--surface", "--surface-raised"];
const drawn: {
	what: string;
	classes: Promise<string[]>;
	utility: string;
	variant: string;
	on: string[];
	min: number;
}[] = [
	{
		what: "a field's edge at rest",
		classes: Promise.resolve(classesOf(fieldStyles)),
		utility: "border-b",
		variant: "",
		on: grounds3,
		min: 3,
	},
	{
		what: "a focused field's edge",
		classes: Promise.resolve(classesOf(fieldStyles)),
		utility: "border",
		variant: "focus-visible",
		on: grounds3,
		min: 3,
	},
	{
		what: "a field with an error",
		classes: Promise.resolve(classesOf(fieldStyles)),
		utility: "border",
		variant: "aria-invalid",
		on: grounds3,
		min: 3,
	},
	{
		what: "a switch that's off",
		classes: Promise.resolve(classesOf(switchTrack)),
		utility: "bg",
		variant: "data-unchecked",
		on: grounds3,
		min: 3,
	},
	{
		what: "an Android switch's outline when off",
		classes: Promise.resolve(classesOf(SWITCH_TRACK.android)),
		utility: "border",
		variant: "data-unchecked",
		on: grounds3,
		min: 3,
	},
	{
		what: "a checkbox",
		classes: source("shadcn/checkbox.tsx").then(classesOf),
		utility: "border",
		variant: "",
		on: grounds3,
		min: 3,
	},
	{
		what: "the selected row in a list",
		classes: source("components/list.tsx").then((s) =>
			classesOf(s.match(/(?<!!)selected && "([^"]+)"/)?.[1] ?? ""),
		),
		utility: "bg",
		variant: "",
		on: ["--surface", "--bg-subtle"],
		min: 1.12,
	},
	{
		what: "the open section in the rail",
		classes: source("components/section-layout.tsx").then((s) =>
			classesOf(s.match(/active\s*\?\s*"([^"]+)"/)?.[1] ?? ""),
		),
		utility: "bg",
		variant: "",
		on: ["--bg-subtle"],
		min: 1.12,
	},
];

describe("controls as drawn", () => {
	test("fields, OTP cells and selects share the field's edge", async () => {
		expect(await source("shadcn/input-otp.tsx")).toContain("fieldEdge,");
		for (const f of ["shadcn/input.tsx", "shadcn/textarea.tsx", "shadcn/select.tsx"]) {
			expect(await source(f)).toContain("fieldStyles");
		}
	});
	for (const { name, state } of states) {
		test(name, async () => {
			const vars = rootVars(rules, state);
			const failures: string[] = [];
			for (const d of drawn) {
				const token = colorOf(await d.classes, d.utility, d.variant, vars);
				if (!token || token === "transparent") {
					failures.push(`${d.what}: no ${d.variant ? `${d.variant}:` : ""}${d.utility}- colour`);
					continue;
				}
				for (const bg of d.on) {
					const ratio = contrast(resolveColor(`var(${token})`, vars), resolveColor(`var(${bg})`, vars));
					if (ratio < d.min)
						failures.push(`${d.what} (${token}) on ${bg} is ${ratio.toFixed(2)}:1, needs ${d.min}:1`);
				}
			}
			expect(failures).toEqual([]);
		});
	}
});
