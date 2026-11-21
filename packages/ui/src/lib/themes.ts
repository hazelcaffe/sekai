/**
 * Sekai's six themes, one per Project Sekai group, each a fixed look (the colors are in styles/index.css).
 * "auto", the default, follows the device: Virtual Singers when it's light, Nightcord at 25:00 when it's dark.
 * The choice is saved in localStorage ("sekai.theme") and applies to every page of the app (same origin).
 */

export type ThemeId = "vs" | "ln" | "mmj" | "vbs" | "wxs" | "n25";
export type ThemeChoice = "auto" | ThemeId;

export interface ThemeInfo {
	id: ThemeId;
	name: string;
	mode: "light" | "dark";
	/** The group's color, as the theme shows it. */
	brand: string;
	background: string;
	/** A character icon (gallery id) for the picker. */
	icon: string;
}

export const THEMES: ThemeInfo[] = [
	{ id: "vs", name: "Virtual Singers", mode: "light", brand: "#33ccbb", background: "#ffffff", icon: "vs-miku" },
	{ id: "ln", name: "Leo/need", mode: "dark", brand: "#5466ec", background: "#0a0d1c", icon: "ln-ichika" },
	{ id: "mmj", name: "MORE MORE JUMP!", mode: "light", brand: "#88dd44", background: "#ffffff", icon: "mmj-minori" },
	{ id: "vbs", name: "Vivid BAD SQUAD", mode: "dark", brand: "#e0105f", background: "#0c0a0b", icon: "vbs-kohane" },
	{
		id: "wxs",
		name: "Wonderlands×Showtime",
		mode: "light",
		brand: "#ff9900",
		background: "#fffdf9",
		icon: "wxs-tsukasa",
	},
	{
		id: "n25",
		name: "Nightcord at 25:00",
		mode: "dark",
		brand: "#9b54ad",
		background: "#0d0a10",
		icon: "n25-kanade",
	},
];

export const THEME_KEY = "sekai.theme";
export const LIGHT_THEME: ThemeId = "vs";
export const DARK_THEME: ThemeId = "n25";

/** A saved value, including the ones from before the group themes (light, dark, system). */
export function parseThemeChoice(value: unknown): ThemeChoice {
	if (value === "light") return LIGHT_THEME;
	if (value === "dark") return DARK_THEME;
	return THEMES.some((t) => t.id === value) ? (value as ThemeId) : "auto";
}

export function prefersDark(): boolean {
	return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
}

export function themeInfo(id: ThemeId): ThemeInfo {
	return THEMES.find((t) => t.id === id) ?? (THEMES[0] as ThemeInfo);
}

/** The theme a choice shows right now. */
export function resolveTheme(choice: ThemeChoice, dark = prefersDark()): ThemeInfo {
	return themeInfo(choice === "auto" ? (dark ? DARK_THEME : LIGHT_THEME) : choice);
}

/** Shows a theme (and remembers the choice): <html data-theme>, .dark for the dark ones, the browser's bar color. */
export function applyThemeChoice(choice: ThemeChoice): ThemeInfo {
	const t = resolveTheme(choice);
	const html = document.documentElement;
	html.dataset.theme = t.id;
	html.classList.toggle("dark", t.mode === "dark");
	html.style.colorScheme = t.mode;
	for (const meta of document.querySelectorAll('meta[name="theme-color"]'))
		meta.setAttribute("content", t.background);
	try {
		localStorage.setItem(THEME_KEY, choice);
	} catch {}
	return t;
}

/** The sun/moon button: from a light theme to Nightcord at 25:00, from a dark one to Virtual Singers. */
export function toggledTheme(choice: ThemeChoice): ThemeId {
	return resolveTheme(choice).mode === "light" ? DARK_THEME : LIGHT_THEME;
}
