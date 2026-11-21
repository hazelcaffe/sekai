/**
 * Just enough CSS to work out a theme's colours from styles/index.css: the custom properties set on <html> for a
 * theme (its data-theme, .dark), resolved through var(), and the colour functions the file uses (hex, rgb() with
 * alpha, color-mix() in oklab or srgb, transparent). Used by the contrast test, so it reads the real stylesheet.
 */

export interface Rgba {
	r: number;
	g: number;
	b: number;
	a: number;
}

interface Rule {
	selectors: string[];
	decls: Map<string, string>;
	order: number;
}

/** The top-level and nested rules of a stylesheet that set custom properties, skipping @media and friends. */
export function parseRules(css: string): Rule[] {
	const src = css.replace(/\/\*[\s\S]*?\*\//g, "");
	const rules: Rule[] = [];
	let order = 0;
	const walk = (text: string) => {
		let i = 0;
		while (i < text.length) {
			const open = text.indexOf("{", i);
			if (open < 0) break;
			const prelude = text.slice(i, open).trim();
			// The prelude ends at the last ; or } before the brace (statements like @import come before it).
			const head = prelude.slice(Math.max(prelude.lastIndexOf(";"), prelude.lastIndexOf("}")) + 1).trim();
			let depth = 1;
			let j = open + 1;
			while (j < text.length && depth > 0) {
				if (text[j] === "{") depth++;
				else if (text[j] === "}") depth--;
				j++;
			}
			const body = text.slice(open + 1, j - 1);
			if (head.startsWith("@")) {
				// Media queries (pointer, segments, reduced motion) and @theme don't change a theme's colours.
			} else if (head) {
				const decls = new Map<string, string>();
				// Only this rule's own declarations: drop nested blocks first.
				let flat = "";
				let d = 0;
				for (const ch of body) {
					if (ch === "{") d++;
					if (d === 0) flat += ch;
					if (ch === "}") d--;
				}
				for (const part of flat.split(";")) {
					const m = part.match(/^\s*(--[\w-]+)\s*:\s*([\s\S]+?)\s*$/);
					if (m?.[1] && m[2]) decls.set(m[1], m[2]);
				}
				if (decls.size) {
					rules.push({ selectors: head.split(",").map((s) => s.trim()), decls, order: order++ });
				}
			}
			i = j;
		}
	};
	walk(src);
	return rules;
}

export interface RootState {
	theme: string;
	dark: boolean;
	platform?: string;
}

/** Whether a simple selector (the forms index.css uses) matches <html> in this state; its specificity if so. */
function matchRoot(selector: string, state: RootState): number | null {
	let s = selector;
	let spec = 0;
	const take = (re: RegExp, test: (m: RegExpMatchArray) => boolean, weight: number): boolean | null => {
		const m = s.match(re);
		if (!m) return null;
		if (!test(m)) return false;
		s = s.slice(m[0].length);
		spec += weight;
		return true;
	};
	while (s.length) {
		const steps = [
			take(/^:root/, () => true, 10),
			take(/^html/, () => true, 1),
			take(/^\.dark/, () => state.dark, 10),
			take(/^:not\(\.dark\)/, () => !state.dark, 10),
			take(/^\[data-theme="([\w-]+)"\]/, (m) => m[1] === state.theme, 10),
			take(/^\[data-platform="([\w-]+)"\]/, (m) => m[1] === state.platform, 10),
		];
		if (steps.includes(false)) return null;
		if (!steps.includes(true)) return null; // something this doesn't understand (descendants, other elements)
	}
	return spec;
}

/** The custom properties <html> ends up with, unresolved. */
export function rootVars(rules: Rule[], state: RootState): Map<string, string> {
	const hits: { spec: number; order: number; decls: Map<string, string> }[] = [];
	for (const r of rules) {
		let best: number | null = null;
		for (const sel of r.selectors) {
			const spec = matchRoot(sel, state);
			if (spec !== null && (best === null || spec > best)) best = spec;
		}
		if (best !== null) hits.push({ spec: best, order: r.order, decls: r.decls });
	}
	hits.sort((a, b) => a.spec - b.spec || a.order - b.order);
	const vars = new Map<string, string>();
	for (const h of hits) for (const [k, v] of h.decls) vars.set(k, v);
	return vars;
}

// ---------------------------------------------------------------- colour maths

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function toOklab({ r, g, b }: Rgba): [number, number, number] {
	const lr = toLinear(r);
	const lg = toLinear(g);
	const lb = toLinear(b);
	const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
	const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
	const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
	return [
		0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
		1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
		0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
	];
}

function fromOklab([L, A, B]: [number, number, number], a: number): Rgba {
	const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
	const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
	const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
	return {
		r: clamp01(fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)),
		g: clamp01(fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)),
		b: clamp01(fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)),
		a,
	};
}

/** color-mix(): premultiplied, so mixing with transparent fades a colour rather than darkening it. */
function mix(space: string, c1: Rgba, p1: number, c2: Rgba, p2: number): Rgba {
	const sum = p1 + p2;
	const w1 = p1 / sum;
	const w2 = p2 / sum;
	const scale = Math.min(1, sum);
	const a = c1.a * w1 + c2.a * w2;
	if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
	const conv = space === "oklab" ? toOklab : (c: Rgba): [number, number, number] => [c.r, c.g, c.b];
	const x1 = conv(c1);
	const x2 = conv(c2);
	const out = x1.map((v, i) => (v * c1.a * w1 + (x2[i] ?? 0) * c2.a * w2) / a) as [number, number, number];
	return space === "oklab"
		? { ...fromOklab(out, a * scale) }
		: { r: clamp01(out[0]), g: clamp01(out[1]), b: clamp01(out[2]), a: a * scale };
}

/** Splits a function's arguments at top-level commas. */
function args(inner: string): string[] {
	const out: string[] = [];
	let depth = 0;
	let last = 0;
	for (let i = 0; i < inner.length; i++) {
		const c = inner[i];
		if (c === "(") depth++;
		else if (c === ")") depth--;
		else if (c === "," && depth === 0) {
			out.push(inner.slice(last, i).trim());
			last = i + 1;
		}
	}
	out.push(inner.slice(last).trim());
	return out;
}

/** Resolves a colour value (with var() references) to sRGB with alpha. */
export function resolveColor(value: string, vars: Map<string, string>, seen: string[] = []): Rgba {
	const v = value.trim();
	const ref = v.match(/^var\(\s*(--[\w-]+)\s*(?:,\s*([\s\S]+))?\)$/);
	if (ref?.[1]) {
		const name = ref[1];
		if (seen.includes(name)) throw new Error(`var() loop: ${[...seen, name].join(" → ")}`);
		const next = vars.get(name) ?? ref[2];
		if (next === undefined) throw new Error(`${name} isn't set`);
		return resolveColor(next, vars, [...seen, name]);
	}
	if (v === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
	if (v === "white" || v === "#fff") return { r: 1, g: 1, b: 1, a: 1 };
	if (v === "black" || v === "#000") return { r: 0, g: 0, b: 0, a: 1 };
	const hex = v.match(/^#([0-9a-f]{3,8})$/i);
	if (hex?.[1]) {
		let h = hex[1];
		if (h.length <= 4) h = [...h].map((c) => c + c).join("");
		const n = (i: number) => Number.parseInt(h.slice(i, i + 2), 16) / 255;
		return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) : 1 };
	}
	const rgb = v.match(/^rgba?\(([\s\S]+)\)$/);
	if (rgb?.[1]) {
		const parts = rgb[1].replace(/[,/]/g, " ").trim().split(/\s+/).map(Number);
		const [r = 0, g = 0, b = 0, a = 1] = parts;
		return { r: r / 255, g: g / 255, b: b / 255, a };
	}
	const cm = v.match(/^color-mix\(\s*in\s+(oklab|srgb)\s*,([\s\S]+)\)$/);
	if (cm?.[1] && cm[2]) {
		const [a1 = "", a2 = ""] = args(cm[2]);
		const split = (s: string): [string, number | null] => {
			const m = s.match(/^([\s\S]+?)\s+([\d.]+)%$/) ?? s.match(/^([\d.]+)%\s+([\s\S]+)$/);
			if (!m) return [s, null];
			return /^[\d.]+$/.test(m[1] ?? "") ? [m[2] ?? "", Number(m[1]) / 100] : [m[1] ?? "", Number(m[2]) / 100];
		};
		const [c1, p1] = split(a1);
		const [c2, p2] = split(a2);
		const q1 = p1 ?? (p2 === null ? 0.5 : 1 - p2);
		const q2 = p2 ?? 1 - q1;
		return mix(cm[1], resolveColor(c1, vars, seen), q1, resolveColor(c2, vars, seen), q2);
	}
	throw new Error(`Can't read the colour "${v}"`);
}

/** A colour drawn over another (alpha compositing). */
export function over(top: Rgba, bottom: Rgba): Rgba {
	const a = top.a + bottom.a * (1 - top.a);
	if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
	const ch = (t: number, b: number) => (t * top.a + b * bottom.a * (1 - top.a)) / a;
	return { r: ch(top.r, bottom.r), g: ch(top.g, bottom.g), b: ch(top.b, bottom.b), a };
}

function luminance({ r, g, b }: Rgba): number {
	return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** WCAG contrast ratio of a (possibly translucent) foreground on an opaque background. */
export function contrast(fg: Rgba, bg: Rgba): number {
	const f = over(fg, bg);
	const l1 = luminance(f);
	const l2 = luminance(bg);
	return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

export function toHex({ r, g, b }: Rgba): string {
	const h = (x: number) =>
		Math.round(x * 255)
			.toString(16)
			.padStart(2, "0");
	return `#${h(r)}${h(g)}${h(b)}`;
}
