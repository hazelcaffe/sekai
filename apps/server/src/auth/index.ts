import type { Context, MiddlewareHandler } from "hono";
import { type Actor, actorFor, runAs } from "./actor.ts";
import { allowedWhileRestricted } from "./paths.ts";
import { readBearer, readSessionCookie, sameOrigin } from "./request.ts";
import { isSetUp, type Principal, principalFromToken, principalUserId, sessionFromSecret } from "./service.ts";

declare module "hono" {
	interface ContextVariableMap {
		principal: Principal;
		actor: Actor;
	}
}

export type { Principal } from "./service.ts";

/**
 * Who's calling: an API token (header or ?token=), else the session cookie. A stale token saved by an older
 * version of the web app falls through to the cookie.
 */
export async function authenticate(req: Request): Promise<Principal | null> {
	const bearer = readBearer(req);
	if (bearer) {
		const p = await principalFromToken(bearer);
		if (p) return p;
	}
	const cookie = readSessionCookie(req);
	return cookie ? sessionFromSecret(cookie) : null;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Checks a principal may use the API for this request: extension tokens only reach their bridge/chat routes,
 * bridge tokens only open the desktop bridge, and requests
 * that change things with a cookie must come from Sekai's own pages (the browser's Origin matches the host).
 */
export function denyReason(p: Principal, req: Request, opts: { websocket?: boolean } = {}): string | null {
	if (p.kind === "token" && p.scope === "extension") {
		const path = new URL(req.url).pathname;
		return !opts.websocket && path.startsWith("/api/extension/") && path !== "/api/extension/token"
			? null
			: "This token only connects the Sekai browser extension.";
	}
	if (p.kind === "token" && p.scope !== "full") return "This token only lets a desktop app lend its computer";
	if (p.kind === "session" && (opts.websocket || !SAFE_METHODS.has(req.method)) && !sameOrigin(req)) {
		return "Blocked a request from another site";
	}
	return null;
}

export async function unauthorized(c: Context) {
	const setup = !(await isSetUp());
	return c.json(
		{
			error: setup ? "Set up Sekai to continue" : "Sign in to continue",
			code: setup ? "setup_required" : "signed_out",
		},
		401,
	);
}

/** The person a principal acts as, with their role (null when the account is gone). */
export async function actorOf(p: Principal): Promise<Actor | null> {
	const userId = await principalUserId(p);
	if (!userId) return null;
	return actorFor(userId).catch(() => null);
}

/**
 * The person and principal a WebSocket is for: signed in, from Sekai's own pages, owing no step.
 * Returns an error response otherwise.
 */
export async function socketAuth(req: Request): Promise<{ actor: Actor; principal: Principal } | Response> {
	const principal = await authenticate(req);
	if (!principal) return Response.json({ error: "Sign in to continue" }, { status: 401 });
	const deny = denyReason(principal, req, { websocket: true });
	if (deny) return Response.json({ error: deny }, { status: 403 });
	if (principal.kind === "session" && principal.restriction) {
		return Response.json({ error: "Finish signing in first" }, { status: 403 });
	}
	const actor = await actorOf(principal);
	if (!actor) return Response.json({ error: "Sign in to continue" }, { status: 401 });
	return { actor, principal };
}

/**
 * The person a WebSocket is for (VNC, voice, the desktop bridge's own check is separate): signed in, from Sekai's own
 * pages, owing no step. Returns an error response otherwise.
 */
export async function socketActor(req: Request): Promise<Actor | Response> {
	const res = await socketAuth(req);
	return res instanceof Response ? res : res.actor;
}

/**
 * Requires a signed-in session or a full API token. Sets c.get("principal") and c.get("actor"), and runs the rest of
 * the request as that person, so everything it looks up is theirs. A session that owes a step (a temporary
 * password, two-factor sign-in its role requires) only reaches the pages for that step.
 */
export const requireAuth: MiddlewareHandler = async (c, next) => {
	const p = await authenticate(c.req.raw);
	if (!p) return unauthorized(c);
	const deny = denyReason(p, c.req.raw);
	if (deny) return c.json({ error: deny }, 403);
	if (p.kind === "session" && p.restriction && !allowedWhileRestricted(c.req.path, p.restriction)) {
		return c.json(
			{
				error:
					p.restriction === "password"
						? "Choose your own password first"
						: "Set up two-step sign-in first (your role requires it)",
				code: "restricted",
				restriction: p.restriction,
			},
			403,
		);
	}
	const actor = await actorOf(p);
	if (!actor) return unauthorized(c);
	c.set("principal", p);
	c.set("actor", actor);
	return runAs(actor, () => next());
};
