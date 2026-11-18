import { applyThemeChoice, parseThemeChoice, resolveTheme, THEME_KEY, type ThemeChoice, toggledTheme } from "@sekai/ui";
import { useSyncExternalStore } from "react";

/** The theme shared with the main app (same origin, same saved choice): Settings → Appearance picks it. */
export type Theme = ThemeChoice;
const listeners = new Set<() => void>();

function read(): Theme {
	try {
		return parseThemeChoice(localStorage.getItem(THEME_KEY));
	} catch {
		return "auto";
	}
}

function notify(): void {
	applyThemeChoice(read());
	for (const l of listeners) l();
}

matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
	if (read() === "auto") notify();
});
// The main app (another tab) changed it.
window.addEventListener("storage", (e) => {
	if (e.key === THEME_KEY) notify();
});

export function useTheme() {
	const theme = useSyncExternalStore(
		(cb) => {
			listeners.add(cb);
			return () => listeners.delete(cb);
		},
		read,
		() => "auto" as Theme,
	);
	const setTheme = (next: Theme) => {
		applyThemeChoice(next);
		for (const l of listeners) l();
	};
	return {
		theme,
		setTheme,
		mode: resolveTheme(theme).mode,
		/** Light theme → Nightcord at 25:00, dark theme → Virtual Singers. */
		toggle: () => setTheme(toggledTheme(theme)),
	};
}
