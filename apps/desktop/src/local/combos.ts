import { parseCombo } from "./keys.ts";

/** Key combos in each platform's terms. Kept free of Electron so they can be tested on their own. */

// ---------------------------------------------------------------- Linux: xdotool key names

const XDOTOOL_KEYS: Record<string, string> = {
	enter: "Return",
	escape: "Escape",
	tab: "Tab",
	backspace: "BackSpace",
	delete: "Delete",
	insert: "Insert",
	home: "Home",
	end: "End",
	pageup: "Prior",
	pagedown: "Next",
	left: "Left",
	right: "Right",
	up: "Up",
	down: "Down",
	space: "space",
	capslock: "Caps_Lock",
	printscreen: "Print",
	menu: "Menu",
	"+": "plus",
	"-": "minus",
	"=": "equal",
	",": "comma",
	".": "period",
	"/": "slash",
	"\\": "backslash",
	";": "semicolon",
	"'": "apostrophe",
	"`": "grave",
	"[": "bracketleft",
	"]": "bracketright",
};
const XDOTOOL_MODS = { ctrl: "ctrl", alt: "alt", shift: "shift", meta: "super" } as const;

export function xdotoolCombo(input: string): string {
	const c = parseCombo(input);
	const mods = c.modifiers.map((m) => XDOTOOL_MODS[m]);
	if (!c.key) return mods.join("+");
	const key = /^f\d+$/.test(c.key) ? c.key.toUpperCase() : (XDOTOOL_KEYS[c.key] ?? c.key);
	return [...mods, key].join("+");
}

// ---------------------------------------------------------------- Windows: virtual-key codes

const MODS = { ctrl: 0x11, alt: 0x12, shift: 0x10, meta: 0x5b } as const;
const NAMED: Record<string, number> = {
	enter: 0x0d,
	escape: 0x1b,
	tab: 0x09,
	backspace: 0x08,
	delete: 0x2e,
	insert: 0x2d,
	home: 0x24,
	end: 0x23,
	pageup: 0x21,
	pagedown: 0x22,
	left: 0x25,
	up: 0x26,
	right: 0x27,
	down: 0x28,
	space: 0x20,
	capslock: 0x14,
	printscreen: 0x2c,
	menu: 0x5d,
};

/** Virtual-key codes for a combo; characters other than letters and digits are resolved on the user's layout. */
export function windowsCombo(input: string): { vks: number[]; char?: string } {
	const c = parseCombo(input);
	const vks: number[] = c.modifiers.map((m) => MODS[m]);
	if (!c.key) return { vks };
	const f = c.key.match(/^f(\d+)$/);
	if (f) return { vks: [...vks, 0x70 + Number(f[1]) - 1] };
	const named = NAMED[c.key];
	if (named !== undefined) return { vks: [...vks, named] };
	const ch = c.key.toUpperCase();
	if (/^[A-Z0-9]$/.test(ch)) return { vks: [...vks, ch.charCodeAt(0)] };
	return { vks, char: c.key };
}

// ---------------------------------------------------------------- macOS: key codes

/** Virtual key codes (ANSI layout positions). */
const KEY_CODES: Record<string, number> = {
	a: 0,
	s: 1,
	d: 2,
	f: 3,
	h: 4,
	g: 5,
	z: 6,
	x: 7,
	c: 8,
	v: 9,
	b: 11,
	q: 12,
	w: 13,
	e: 14,
	r: 15,
	y: 16,
	t: 17,
	"1": 18,
	"2": 19,
	"3": 20,
	"4": 21,
	"6": 22,
	"5": 23,
	"=": 24,
	"9": 25,
	"7": 26,
	"-": 27,
	"8": 28,
	"0": 29,
	"]": 30,
	o: 31,
	u: 32,
	"[": 33,
	i: 34,
	p: 35,
	l: 37,
	j: 38,
	"'": 39,
	k: 40,
	";": 41,
	"\\": 42,
	",": 43,
	"/": 44,
	n: 45,
	m: 46,
	".": 47,
	"`": 50,
	enter: 36,
	tab: 48,
	space: 49,
	backspace: 51,
	escape: 53,
	delete: 117,
	home: 115,
	end: 119,
	pageup: 116,
	pagedown: 121,
	left: 123,
	right: 124,
	down: 125,
	up: 126,
	capslock: 57,
	f1: 122,
	f2: 120,
	f3: 99,
	f4: 118,
	f5: 96,
	f6: 97,
	f7: 98,
	f8: 100,
	f9: 101,
	f10: 109,
	f11: 103,
	f12: 111,
	f13: 105,
	f14: 107,
	f15: 113,
	f16: 106,
	f17: 64,
	f18: 79,
	f19: 80,
	f20: 90,
};
const MODIFIER_CODES = { meta: 55, shift: 56, alt: 58, ctrl: 59 } as const;

export function macCombo(input: string): { mods: string[]; code: number | null; char?: string } {
	const c = parseCombo(input);
	if (!c.key) {
		// A modifier on its own: press it as a key.
		const only = c.modifiers.at(-1) ?? "meta";
		return { mods: c.modifiers.slice(0, -1), code: MODIFIER_CODES[only] };
	}
	const lower = c.key.length === 1 ? c.key.toLowerCase() : c.key;
	const code = KEY_CODES[lower];
	const shifted = c.key.length === 1 && c.key !== lower && !c.modifiers.includes("shift");
	if (code !== undefined) return { mods: shifted ? [...c.modifiers, "shift"] : c.modifiers, code };
	return { mods: c.modifiers, code: null, char: c.key };
}
