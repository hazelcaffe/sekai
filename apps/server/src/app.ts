import { existsSync } from "node:fs";
import { join, normalize } from "node:path";
import { isExtensionOrigin } from "@sekai/shared";
import { type Context, Hono, type MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import { requirePermission } from "./auth/actor.ts";
import { adminRoutes } from "./auth/admin-routes.ts";
import { requireAuth } from "./auth/index.ts";
import { isPublicAuthPath } from "./auth/paths.ts";
import { isHttps, markProxy } from "./auth/request.ts";
import { authRoutes, requireRecentAuth } from "./auth/routes.ts";
import { config } from "./config.ts";
import { errorMessage, HttpError } from "./lib/errors.ts";
import { log } from "./lib/log.ts";
import { handleBridgeRequest } from "./providers/index.ts";
import { activityRoutes } from "./routes/activity.ts";
import { agentRoutes, avatarRoutes } from "./routes/agents.ts";
import { apiProviderRoutes } from "./routes/api-providers.ts";
import { backupRoutes } from "./routes/backups.ts";
import { channelRoutes } from "./routes/channels.ts";
import { codeRoutes } from "./routes/code.ts";
import { compareRoutes } from "./routes/compare.ts";
import { conversationRoutes, messageRoutes } from "./routes/conversations.ts";
import { desktopRoutes } from "./routes/desktop.ts";
import { digestRoutes } from "./routes/digest.ts";
import { documentRoutes } from "./routes/documents.ts";
import { extensionRoutes } from "./routes/extension.ts";
import { hookRoutes } from "./routes/hooks.ts";
import { hostRoutes } from "./routes/hosts.ts";
import { mcpRoutes, skillRoutes } from "./routes/library.ts";
import { credentialRoutes, machineRoutes } from "./routes/machines.ts";
import { providerRoutes } from "./routes/providers.ts";
import { pushRoutes } from "./routes/push.ts";
import { sharedBrowserRoutes } from "./routes/shared-browsers.ts";
import { instagramRoutes, tiktokRoutes } from "./routes/social.ts";
import { systemRoutes } from "./routes/system.ts";
import { tailscaleRoutes } from "./routes/tailscale.ts";
import { adminOnly, needs } from "./routes/util.ts";
import { voiceRoutes } from "./routes/voice.ts";
import { webRoutes } from "./routes/web.ts";
import { memoryRoutes, noteRoutes, routineRoutes } from "./routes/workspace.ts";
import { xRoutes } from "./routes/x.ts";

/**
 * Paths reachable without signing in: liveness, sign-in itself, desktop app updates and the tools bridge for
 * external agents (their URLs carry unguessable capability ids).
 */
function isPublic(path: string, method: string): boolean {
	return (
		path === "/api/health" ||
		isPublicAuthPath(path) ||
		// Desktop app updates (installers aren't secret; the app checks before you've signed in).
		(method === "GET" && path.startsWith("/api/desktop/updates/")) ||
		path.startsWith("/api/bridge/") ||
		// Event routines' webhooks: the unguessable token in the address is the key.
		path.startsWith("/api/hooks/")
	);
}

/**
 * Other sites may call the API only with a token (never your sign-in cookie: credentials are never allowed
 * cross-site), and only from the origins in SEKAI_CORS_ORIGINS, plus localhost (dev servers, a local app).
 */
function corsOrigin(origin: string): string | null {
	if (!origin) return null;
	if (config.corsOrigins.includes(origin)) return origin;
	try {
		const host = new URL(origin).hostname;
		return host === "localhost" || host === "127.0.0.1" || host === "[::1]" ? origin : null;
	} catch {
		return null;
	}
}

/** Asks for a recent sign-in (see requireRecentAuth) on the requests `when` picks. */
function recentAuthFor(when: (c: Context) => boolean): MiddlewareHandler {
	return async (c, next) => {
		if (when(c)) requireRecentAuth(c);
		return next();
	};
}

const SECURITY_HEADERS: Record<string, string> = {
	"x-content-type-options": "nosniff",
	"referrer-policy": "same-origin",
	"x-frame-options": "DENY",
	"cross-origin-opener-policy": "same-origin-allow-popups",
	"permissions-policy": "camera=(), geolocation=(), payment=(), usb=(), microphone=(self)",
};

export function createApp(): Hono {
	const app = new Hono();

	app.use("*", async (c, next) => {
		// Forwarded headers only count from proxies you trust (loopback, SEKAI_TRUST_PROXY).
		markProxy(c.req.raw, c.env, config.trustProxy);
		await next();
		const extra = {
			...SECURITY_HEADERS,
			...(isHttps(c.req.raw) ? { "strict-transport-security": "max-age=31536000" } : {}),
		};
		try {
			for (const [k, v] of Object.entries(extra)) if (!c.res.headers.has(k)) c.res.headers.set(k, v);
		} catch {
			// A response passed through from elsewhere has headers that can't change: copy it.
			const res = new Response(c.res.body, c.res);
			for (const [k, v] of Object.entries(extra)) if (!res.headers.has(k)) res.headers.set(k, v);
			c.res = res;
		}
	});

	app.use(
		"/api/*",
		cors({
			origin: (origin, c) =>
				c.req.path.startsWith("/api/extension/") && isExtensionOrigin(origin) ? origin : corsOrigin(origin),
			credentials: false,
			allowHeaders: ["authorization", "content-type"],
			allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
			maxAge: 600,
		}),
	);

	app.use("/api/*", async (c, next) => {
		if (c.req.method === "OPTIONS" || isPublic(c.req.path, c.req.method)) return next();
		return requireAuth(c, next);
	});

	app.all("/api/bridge/:token/mcp", (c) => handleBridgeRequest(c.req.param("token"), c.req.raw));

	const api = new Hono()
		// Server setup is for admins; features of people's own workspaces need their role to include them.
		.use("/api-providers/*", adminOnly)
		.use("/hosts/*", adminOnly)
		.use("/tailscale/*", adminOnly)
		.use("/web/*", adminOnly)
		.use("/backups/*", adminOnly)
		.use("/admin/*", adminOnly)
		.use("/compare/*", needs("compare"))
		.use("/providers/*", async (c, next) => {
			requirePermission(c.req.method === "GET" ? "subscriptions" : "admin");
			return next();
		})
		// The keys to the server: changing them (or downloading a backup, or seeing the master key) asks you to
		// confirm it's you when you last did a while ago.
		.use(
			"/backups/*",
			recentAuthFor((c) => c.req.method !== "GET" || c.req.path.endsWith("/download")),
		)
		.use(
			"/hosts/master-key/*",
			recentAuthFor((c) => c.req.method !== "GET"),
		)
		.use(
			"/api-providers/*",
			recentAuthFor((c) => c.req.method !== "GET"),
		)
		.use(
			"/providers/*",
			recentAuthFor((c) => c.req.method !== "GET"),
		)
		.use(
			"/tailscale/*",
			recentAuthFor((c) => c.req.method !== "GET"),
		)
		.use(
			"/web/*",
			recentAuthFor((c) => c.req.method !== "GET" && !c.req.path.endsWith("/check")),
		)
		.route("/auth", authRoutes)
		.route("/admin", adminRoutes)
		.route("/", systemRoutes)
		.route("/agents", agentRoutes)
		.route("/avatars", avatarRoutes)
		.route("/conversations", conversationRoutes)
		.route("/messages", messageRoutes)
		.route("/memories", memoryRoutes)
		.route("/notes", noteRoutes)
		.route("/routines", routineRoutes)
		.route("/skills", skillRoutes)
		.route("/mcp", mcpRoutes)
		.route("/channels", channelRoutes)
		.route("/providers", providerRoutes)
		.route("/api-providers", apiProviderRoutes)
		.route("/voice", voiceRoutes)
		.route("/web", webRoutes)
		.route("/x", xRoutes)
		.route("/instagram", instagramRoutes)
		.route("/tiktok", tiktokRoutes)
		.route("/hosts", hostRoutes)
		.route("/tailscale", tailscaleRoutes)
		.route("/desktop", desktopRoutes)
		.route("/push", pushRoutes)
		.route("/hooks", hookRoutes)
		.route("/backups", backupRoutes)
		.route("/activity", activityRoutes)
		.route("/digest", digestRoutes)
		.route("/compare", compareRoutes)
		.route("/documents", documentRoutes)
		.route("/extension", extensionRoutes)
		.route("/code", codeRoutes)
		.route("/machines", machineRoutes)
		.route("/shared-browsers", sharedBrowserRoutes)
		.route("/credentials", credentialRoutes);
	app.route("/api", api);

	app.notFound((c) => {
		if (c.req.path.startsWith("/api/")) return c.json({ error: "Not found" }, 404);
		return serveWeb(c.req.path);
	});

	app.onError((err, c) => {
		if (err instanceof HttpError) {
			const code = (err.details as { code?: string } | undefined)?.code;
			return c.json({ error: err.message, ...(code ? { code } : {}), details: err.details }, err.status as 400);
		}
		log.error(`${c.req.method} ${c.req.path} failed`, err);
		// Database errors quote the query and its values (which can include secrets): say less to the client.
		const msg = errorMessage(err);
		const fromDatabase = msg.startsWith("Failed query:") || /params:/i.test(msg);
		return c.json({ error: fromDatabase ? "Something went wrong on the server" : msg }, 500);
	});

	return app;
}

/** Serves the built web app (and the admin app under /admin) with SPA fallbacks, when they've been built. */
async function serveWeb(path: string): Promise<Response> {
	const admin = path === "/admin" || path.startsWith("/admin/");
	const root = admin ? config.adminDir : config.webDir;
	if (!existsSync(join(root, "index.html"))) {
		const app = admin ? "admin" : "web";
		return new Response(
			`Sekai API is running. Build the ${app} app (bun run build:${app}) or use the dev server (bun run dev).`,
			{ status: 404, headers: { "content-type": "text/plain" } },
		);
	}
	const rel = admin ? path.slice("/admin".length) || "/" : path;
	const safe = normalize(decodeURIComponent(rel)).replace(/^(\.\.[/\\])+/, "");
	const file = Bun.file(join(root, safe));
	if (safe !== "/" && !safe.endsWith(".html") && (await file.exists())) {
		const immutable = safe.startsWith("/assets/");
		return new Response(file, {
			headers: { "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache" },
		});
	}
	const html = await Bun.file(join(root, "index.html")).text();
	return new Response(html, {
		headers: {
			"content-type": "text/html; charset=utf-8",
			"cache-control": "no-cache",
			"content-security-policy": await pageCsp(html),
		},
	});
}

const cspCache = new Map<string, string>();

/**
 * What the app's pages may load and run: their own scripts (and the small inline one in index.html, by its hash),
 * styles, pictures from anywhere (chats show linked images), the API and its live connections. No framing.
 */
async function pageCsp(html: string): Promise<string> {
	const hit = cspCache.get(html);
	if (hit) return hit;
	const hashes: string[] = [];
	for (const m of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
		const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(m[1] ?? "")));
		hashes.push(`'sha256-${Buffer.from(digest).toString("base64")}'`);
	}
	const csp = [
		"default-src 'self'",
		`script-src 'self' blob: ${hashes.join(" ")}`.trim(),
		"style-src 'self' 'unsafe-inline'",
		"img-src * data: blob:",
		"media-src 'self' data: blob:",
		"font-src 'self' data:",
		"connect-src 'self' ws: wss:",
		"worker-src 'self' blob:",
		"manifest-src 'self'",
		"object-src 'none'",
		"base-uri 'self'",
		"form-action 'self'",
		"frame-ancestors 'none'",
	].join("; ");
	if (cspCache.size > 20) cspCache.clear();
	cspCache.set(html, csp);
	return csp;
}
