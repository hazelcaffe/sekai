import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { Hono } from "hono";
import { config } from "../config.ts";

/** Where `bun run --cwd apps/desktop publish:local` puts new desktop builds for the app's auto-update. */
export const RELEASES_DIR = join(config.dataDir, "desktop-releases");

const TYPES: Record<string, string> = {
	".yml": "text/yaml",
	".exe": "application/vnd.microsoft.portable-executable",
	".dmg": "application/x-apple-diskimage",
	".zip": "application/zip",
	".AppImage": "application/octet-stream",
	".deb": "application/vnd.debian.binary-package",
	".blockmap": "application/octet-stream",
};

/** The newest published version per platform (from electron-builder's latest*.yml). */
function published(): { platform: string; version: string; file: string; at: number }[] {
	if (!existsSync(RELEASES_DIR)) return [];
	const out = [];
	for (const name of readdirSync(RELEASES_DIR)) {
		const m = name.match(/^latest(-linux|-mac)?\.yml$/);
		if (!m) continue;
		const text = readFileSync(join(RELEASES_DIR, name), "utf8");
		const version = text.match(/^version:\s*(.+)$/m)?.[1]?.trim() ?? "?";
		const file = text.match(/^path:\s*(.+)$/m)?.[1]?.trim() ?? "";
		out.push({
			platform: m[1] === "-linux" ? "linux" : m[1] === "-mac" ? "mac" : "windows",
			version,
			file,
			at: statSync(join(RELEASES_DIR, name)).mtimeMs,
		});
	}
	return out;
}

/** Desktop app updates, served by your own Sekai. */
export const desktopRoutes = new Hono()
	.get("/releases", (c) => c.json(published()))
	.get("/updates/:file", (c) => {
		const file = basename(c.req.param("file"));
		const path = join(RELEASES_DIR, file);
		if (!existsSync(path) || file.startsWith(".")) return c.json({ error: "No such update file" }, 404);
		const ext = Object.keys(TYPES).find((e) => file.endsWith(e)) ?? "";
		return new Response(Bun.file(path), {
			headers: {
				"content-type": TYPES[ext] ?? "application/octet-stream",
				"cache-control": "no-cache",
				// Updates download only the changed parts (ranges).
				"accept-ranges": "bytes",
			},
		});
	});
