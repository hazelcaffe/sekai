import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { MCP_CATALOG } from "@sekai/shared";
import { config } from "../config.ts";
import { listServers } from "./manager.ts";

const DIR = join(config.dataDir, "mcp-icons");
const pending = new Map<string, Promise<{ file: string; type: string } | null>>();

/** Only the store's apps and servers you added (not a proxy for any site). */
async function allowed(domain: string): Promise<boolean> {
	if (MCP_CATALOG.some((e) => e.domain === domain)) return true;
	for (const s of await listServers()) {
		if (s.transport.type !== "stdio" && new URL(s.transport.url).hostname.endsWith(domain)) return true;
	}
	return false;
}

/** An app's icon: its site's favicon, fetched once and kept on disk. */
export async function mcpIcon(domain: string): Promise<{ file: string; type: string } | null> {
	if (!/^[a-z0-9.-]{3,100}$/i.test(domain) || !(await allowed(domain))) return null;
	const file = join(DIR, `${domain}.png`);
	if (existsSync(file)) return { file, type: "image/png" };
	let p = pending.get(domain);
	if (!p) {
		p = (async () => {
			const res = await fetch(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`, {
				signal: AbortSignal.timeout(10_000),
			}).catch(() => null);
			if (!res?.ok) return null;
			const bytes = new Uint8Array(await res.arrayBuffer());
			if (bytes.length < 100) return null;
			mkdirSync(DIR, { recursive: true });
			await Bun.write(file, bytes);
			return { file, type: res.headers.get("content-type") ?? "image/png" };
		})().finally(() => pending.delete(domain));
		pending.set(domain, p);
	}
	return p;
}
