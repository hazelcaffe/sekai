import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The app's own screens. Only they may switch servers or install updates. */
export const BUNDLED_PAGES = ["connect.html", "about.html"] as const;

/**
 * Whether a URL is one of the bundled screens in `distDir`, not just any file:// page (an HTML file dropped on a
 * window, say), which gets none of their powers.
 */
export function isBundledUrl(url: string | undefined, distDir: string, platform = process.platform): boolean {
	if (!url?.startsWith("file:")) return false;
	try {
		const path = resolve(fileURLToPath(url.replace(/[?#].*$/, "")));
		const same = (a: string, b: string) => (platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b);
		return BUNDLED_PAGES.some((name) => same(path, resolve(join(distDir, name))));
	} catch {
		return false;
	}
}
