/**
 * Key combos as bots write them (xdotool style, like on their own Linux computers): "ctrl+l", "Return",
 * "alt+F4", "super", "Page_Down", "cmd+shift+t". Parsed once here so each platform only maps names.
 */

export type Modifier = "ctrl" | "alt" | "shift" | "meta";

export interface Combo {
	modifiers: Modifier[];
	/** A named key (see KEY_NAMES), a single character, or null for a modifier on its own ("super"). */
	key: string | null;
}

const MODIFIERS: Record<string, Modifier> = {
	ctrl: "ctrl",
	control: "ctrl",
	ctl: "ctrl",
	alt: "alt",
	option: "alt",
	opt: "alt",
	shift: "shift",
	super: "meta",
	win: "meta",
	windows: "meta",
	cmd: "meta",
	command: "meta",
	meta: "meta",
};

/** Canonical names for keys that aren't characters. */
const ALIASES: Record<string, string> = {
	return: "enter",
	enter: "enter",
	kp_enter: "enter",
	escape: "escape",
	esc: "escape",
	tab: "tab",
	backspace: "backspace",
	back_space: "backspace",
	delete: "delete",
	del: "delete",
	insert: "insert",
	home: "home",
	end: "end",
	page_up: "pageup",
	pageup: "pageup",
	prior: "pageup",
	page_down: "pagedown",
	pagedown: "pagedown",
	next: "pagedown",
	left: "left",
	right: "right",
	up: "up",
	down: "down",
	space: "space",
	spacebar: "space",
	minus: "-",
	plus: "+",
	equal: "=",
	comma: ",",
	period: ".",
	slash: "/",
	backslash: "\\",
	semicolon: ";",
	apostrophe: "'",
	grave: "`",
	bracketleft: "[",
	bracketright: "]",
	capslock: "capslock",
	caps_lock: "capslock",
	print: "printscreen",
	printscreen: "printscreen",
	menu: "menu",
};

export const KEY_NAMES = new Set(Object.values(ALIASES).filter((k) => k.length > 1));

function modifierOf(part: string): Modifier | undefined {
	const lower = part.toLowerCase();
	return MODIFIERS[lower] ?? MODIFIERS[lower.replace(/_[lr]$/, "")];
}

export function parseCombo(input: string): Combo {
	// "ctrl++" means ctrl and the plus key.
	const raw = input.trim();
	const parts = (raw.endsWith("++") ? [...raw.slice(0, -2).split("+"), "+"] : raw.split("+"))
		.map((p) => p.trim())
		.filter(Boolean);
	if (parts.length === 0) throw new Error(`Empty key combo "${input}"`);
	const modifiers: Modifier[] = [];
	// Everything but the last part is a modifier; the last is the key, unless it's a modifier too ("super").
	const last = parts.at(-1) ?? "";
	const allModifiers = parts.every((p) => modifierOf(p));
	for (const part of allModifiers ? parts : parts.slice(0, -1)) {
		const mod = modifierOf(part);
		if (!mod) throw new Error(`"${part}" isn't a modifier in "${input}" (use ctrl, alt, shift or cmd/super)`);
		if (!modifiers.includes(mod)) modifiers.push(mod);
	}
	if (allModifiers) return { modifiers, key: null };
	const lower = last.toLowerCase();
	let key: string;
	if (/^f([1-9]|1\d|2[0-4])$/.test(lower)) key = lower;
	else if (ALIASES[lower]) key = ALIASES[lower] ?? lower;
	else if ([...last].length === 1) key = last;
	else throw new Error(`Unknown key "${last}" in "${input}"`);
	return { modifiers, key };
}
