import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const APP_NAME = "Sekai";
export const APP_VERSION = "0.2.0";

/** Repo root when running from source; the executable's folder when compiled. */
function findRoot(): string {
	let dir = import.meta.dir;
	for (let i = 0; i < 6; i++) {
		if (existsSync(join(dir, "biome.json")) && existsSync(join(dir, "apps"))) return dir;
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return process.cwd();
}

export const ROOT_DIR = findRoot();

/** Minimal .env loader: fills only variables that aren't already set. */
function loadEnvFile(path: string): void {
	if (!existsSync(path)) return;
	for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
		const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
		if (!m?.[1]) continue;
		const key = m[1];
		let value = m[2] ?? "";
		if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
		if (process.env[key] === undefined) process.env[key] = value;
	}
}

loadEnvFile(join(process.cwd(), ".env"));
loadEnvFile(join(ROOT_DIR, ".env"));

// Settings named before the rename (Feesh → Sekai): FEESH_PORT and the like still work.
for (const [key, value] of Object.entries(process.env)) {
	if (key.startsWith("FEESH_") && process.env[`SEKAI_${key.slice(6)}`] === undefined) {
		process.env[`SEKAI_${key.slice(6)}`] = value;
	}
}

const env = process.env;

export const config = {
	host: env.SEKAI_HOST ?? "127.0.0.1",
	port: Number(env.SEKAI_PORT ?? 7420),
	databaseUrl: env.DATABASE_URL ?? "postgres://sekai:sekai@127.0.0.1:5433/sekai",
	/** Uploads and other files. */
	dataDir: resolve(env.SEKAI_DATA_DIR ?? join(ROOT_DIR, "data")),
	authToken: env.SEKAI_AUTH_TOKEN?.trim() || null,
	/**
	 * Where people reach Sekai (https://sekai.example.com), for sign-in callbacks and the links in invites and
	 * password resets. Without it, the address each request came in on is used.
	 */
	publicUrl: env.SEKAI_PUBLIC_URL?.trim().replace(/\/+$/, "") || null,
	/**
	 * Proxies in front of Sekai whose X-Forwarded-For is believed (comma-separated addresses or ranges, like
	 * 10.0.0.0/8). Loopback (a proxy on this machine: Caddy, nginx, Tailscale Serve) is always trusted.
	 */
	/** Other sites allowed to call the API with a token (comma-separated origins, like https://app.example.com). */
	corsOrigins: (env.SEKAI_CORS_ORIGINS ?? "")
		.split(",")
		.map((x) => x.trim().replace(/\/+$/, ""))
		.filter(Boolean),
	trustProxy: (env.SEKAI_TRUST_PROXY ?? "")
		.split(",")
		.map((x) => x.trim())
		.filter(Boolean),
	webDir: resolve(env.SEKAI_WEB_DIR ?? join(ROOT_DIR, "apps", "web", "dist")),
	migrationsDir: resolve(env.SEKAI_MIGRATIONS_DIR ?? join(ROOT_DIR, "apps", "server", "drizzle")),
	gateway: {
		// Any OpenAI-compatible endpoint (also settable in Settings → Models).
		url: (env.GATEWAY_URL ?? "").trim().replace(/\/+$/, ""),
		apiKey: env.GATEWAY_API_KEY?.trim() ?? "",
	},
	logLevel: (env.SEKAI_LOG_LEVEL ?? "info") as "debug" | "info" | "warn" | "error",
};

mkdirSync(config.dataDir, { recursive: true });
mkdirSync(join(config.dataDir, "uploads"), { recursive: true });
