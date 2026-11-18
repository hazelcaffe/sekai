import { existsSync, mkdirSync } from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { GALLERY_SOURCE, galleryIcon } from "@sekai/shared";
import { config } from "../config.ts";
import { log } from "../lib/log.ts";

/**
 * Colorful Stage icons ship with Sekai (apps/server/assets/gallery, byte for byte as published). One that isn't
 * there (a new character added to the list) is fetched from colorfulstage.com once and kept in the data folder.
 */
const BUNDLED = join(import.meta.dir, "..", "..", "assets", "gallery");
const DIR = join(config.dataDir, "gallery");
const pending = new Map<string, Promise<string | null>>();

async function download(id: string, file: string): Promise<string | null> {
	const path = join(DIR, file);
	if (existsSync(path)) return path;
	mkdirSync(DIR, { recursive: true });
	try {
		const res = await fetch(GALLERY_SOURCE + file, {
			signal: AbortSignal.timeout(20_000),
			headers: { "user-agent": "Sekai (personal avatar cache)" },
		});
		const type = res.headers.get("content-type") ?? "";
		if (!res.ok || !type.startsWith("image/")) throw new Error(`${res.status} ${type}`);
		const bytes = new Uint8Array(await res.arrayBuffer());
		if (bytes.length > 2 * 1024 * 1024) throw new Error("too large");
		const tmp = `${path}.${process.pid}.tmp`;
		await writeFile(tmp, bytes);
		await rename(tmp, path);
		return path;
	} catch (err) {
		log.warn(`couldn't fetch the ${id} icon from colorfulstage.com: ${String(err)}`);
		return null;
	}
}

/** The cached file for a gallery icon, downloading it if needed. Null when it's unknown or unavailable. */
export async function galleryFile(id: string): Promise<string | null> {
	const icon = galleryIcon(id);
	if (!icon) return null;
	const bundled = join(BUNDLED, icon.file);
	if (existsSync(bundled)) return bundled;
	let p = pending.get(icon.file);
	if (!p) {
		p = download(icon.id, icon.file).finally(() => pending.delete(icon.file));
		pending.set(icon.file, p);
	}
	return p;
}
