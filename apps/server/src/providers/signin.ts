import { randomBytes } from "node:crypto";
import {
	type Provider,
	SIGN_IN_MAX_MS,
	type SignInClientMessage,
	type SignInServerMessage,
	type SignInTicket,
} from "@sekai/shared";
import type { Server, ServerWebSocket } from "bun";
import type { Actor } from "../auth/actor.ts";
import { type Principal, socketAuth } from "../auth/index.ts";
import { REAUTH_MS } from "../auth/routes.ts";
import { bus } from "../events/bus.ts";
import { badRequest, HttpError } from "../lib/errors.ts";
import { checkDir, providerEnv } from "./process.ts";
import { findSignInExecutable, resolveSignInCommand } from "./setup.ts";
import { SignInDetector } from "./signin-detect.ts";
import { requireProvider } from "./store.ts";

/**
 * Browser sign-in terminal: runs a subscription's exact sign-in command (never a general shell) inside a real
 * Bun PTY over a WebSocket, so interactive CLI logins work from the browser or phone.
 *
 * Security invariants:
 *   - Admin only, after recent auth ("Confirm it's you"), verified on ticket creation AND WebSocket upgrade.
 *   - Cookie WebSockets must come from Sekai's own origin (checked in `socketAuth`).
 *   - Tickets are single-use, bound to the user/session, and expire in 60 seconds.
 *   - Only one active sign-in session per subscription at a time.
 *   - Session ends after 15 minutes (`SIGN_IN_MAX_MS`) or when the WebSocket closes.
 *   - Nothing printed or typed in the terminal is ever logged or persisted.
 */

const TICKET_TTL_MS = 60_000;
const PATH = /^\/api\/providers\/signin\/([A-Za-z0-9_-]+)$/;

interface Ticket {
	provider: Provider;
	userId: string;
	sessionId: string | null;
	argv: string[];
	extraEnv: Record<string, string>;
	command: string;
	expiresAt: number;
}

export interface SignInSocket {
	kind: "signin";
	provider: Provider;
	providerId: string;
	argv: string[];
	extraEnv: Record<string, string>;
	command: string;
	proc: Bun.Subprocess | null;
	timer: ReturnType<typeof setTimeout> | null;
	detector: SignInDetector;
	ended: boolean;
}

const tickets = new Map<string, Ticket>();
const activeSessions = new Map<string, ServerWebSocket<SignInSocket>>();

let afterSignIn: (providerId: string) => void = () => {};

/** Registers the callback run after a sign-in session finishes (normally `startCheck`). */
export function setAfterSignIn(fn: (providerId: string) => void): void {
	afterSignIn = fn;
}

export function isSigningIn(providerId: string): boolean {
	return activeSessions.has(providerId);
}

/** Removes expired tickets so the map stays small. */
function pruneTickets(): void {
	const now = Date.now();
	for (const [key, t] of tickets) {
		if (t.expiresAt <= now) tickets.delete(key);
	}
}

export function hasRecentAuth(principal: Principal): boolean {
	if (principal.kind !== "session") return true;
	return Boolean(principal.verifiedAt && Date.now() - principal.verifiedAt < REAUTH_MS);
}

/**
 * Creates a single-use ticket for opening the sign-in terminal WebSocket for a subscription.
 * Resolves and validates the sign-in command before issuing the ticket.
 */
export function issueSignInTicket(opts: {
	providerId: string;
	provider?: Provider;
	userId: string;
	sessionId: string | null;
	methodId?: string;
	target?: string;
}): SignInTicket {
	pruneTickets();
	const provider = opts.provider ?? requireProvider(opts.providerId);
	if (activeSessions.has(provider.id)) {
		throw new HttpError(409, "A sign-in is already open for this subscription.");
	}
	const resolved = resolveSignInCommand(provider, {
		methodId: opts.methodId,
		target: opts.target,
		requireTarget: true,
	});
	if (!resolved) {
		throw badRequest("This subscription doesn't have a sign-in command set.");
	}
	const prog = resolved.argv[0] ?? "";
	if (!findSignInExecutable(provider, prog)) {
		throw badRequest(`"${prog}" isn't installed on this server yet. Install it first, then try signing in.`);
	}

	const ticket = randomBytes(32).toString("base64url");
	const expiresAt = Date.now() + TICKET_TTL_MS;
	tickets.set(ticket, {
		provider,
		userId: opts.userId,
		sessionId: opts.sessionId,
		argv: resolved.argv,
		extraEnv: resolved.extraEnv,
		command: resolved.display,
		expiresAt,
	});
	return { ticket, command: resolved.display, expiresAt };
}

/**
 * Upgrades `/api/providers/signin/:ticket` to a WebSocket.
 * Returns `null` when the path doesn't match, a `Response` when refused, or `undefined` once upgraded.
 */
export async function upgradeSignIn(
	req: Request,
	server: Server<SignInSocket>,
	authFn: (req: Request) => Promise<{ actor: Actor; principal: Principal } | Response> = socketAuth,
): Promise<Response | undefined | null> {
	const url = new URL(req.url);
	const match = url.pathname.match(PATH);
	if (!match?.[1]) return null;

	const auth = await authFn(req);
	if (auth instanceof Response) return auth;
	const { actor, principal } = auth;

	if (!actor.can.has("admin")) {
		return Response.json({ error: "Only admins can sign in subscriptions." }, { status: 403 });
	}
	if (!hasRecentAuth(principal)) {
		return Response.json({ error: "Confirm it's you to continue", code: "reauth_required" }, { status: 403 });
	}

	pruneTickets();
	const token = match[1];
	const ticket = tickets.get(token);
	if (!ticket || ticket.expiresAt <= Date.now()) {
		tickets.delete(token);
		return Response.json({ error: "This sign-in ticket expired. Try again." }, { status: 404 });
	}
	if (ticket.userId !== actor.userId) {
		return Response.json({ error: "This sign-in belongs to another account." }, { status: 403 });
	}
	if (ticket.sessionId && principal.kind === "session" && ticket.sessionId !== principal.sessionId) {
		return Response.json({ error: "This sign-in belongs to another session." }, { status: 403 });
	}
	if (activeSessions.has(ticket.provider.id)) {
		return Response.json({ error: "A sign-in is already open for this subscription." }, { status: 409 });
	}

	// Single-use: consume the ticket only once all checks pass.
	tickets.delete(token);

	const ok = server.upgrade(req, {
		data: {
			kind: "signin",
			provider: ticket.provider,
			providerId: ticket.provider.id,
			argv: ticket.argv,
			extraEnv: ticket.extraEnv,
			command: ticket.command,
			proc: null,
			timer: null,
			detector: new SignInDetector(),
			ended: false,
		},
	});
	return ok ? undefined : Response.json({ error: "Expected a WebSocket" }, { status: 400 });
}

function sendJson(ws: ServerWebSocket<SignInSocket>, msg: SignInServerMessage): void {
	try {
		ws.send(JSON.stringify(msg));
	} catch {}
}

function finishSession(
	ws: ServerWebSocket<SignInSocket>,
	exit?: { code: number | null; reason: "exited" | "timeout" | "error" | "closed"; message?: string },
): void {
	if (ws.data.ended) return;
	ws.data.ended = true;

	if (ws.data.timer) {
		clearTimeout(ws.data.timer);
		ws.data.timer = null;
	}
	const proc = ws.data.proc;
	ws.data.proc = null;
	if (proc) {
		try {
			proc.terminal?.close();
		} catch {}
		try {
			proc.kill();
		} catch {}
	}
	if (activeSessions.get(ws.data.providerId) === ws) {
		activeSessions.delete(ws.data.providerId);
		bus.emit({ type: "provider.changed", providerId: ws.data.providerId });
	}
	if (exit) {
		sendJson(ws, { type: "exit", ...exit });
		try {
			ws.close(1000, exit.reason);
		} catch {}
	}
	afterSignIn(ws.data.providerId);
}

export const signInWebSocket = {
	open(ws: ServerWebSocket<SignInSocket>): void {
		if (activeSessions.has(ws.data.providerId)) {
			sendJson(ws, {
				type: "exit",
				code: null,
				reason: "error",
				message: "A sign-in is already open for this subscription.",
			});
			ws.close(1008, "already open");
			return;
		}
		activeSessions.set(ws.data.providerId, ws);
		bus.emit({ type: "provider.changed", providerId: ws.data.providerId });

		const env: Record<string, string> = {
			...providerEnv(ws.data.provider),
			...ws.data.extraEnv,
			TERM: "xterm-256color",
			COLORTERM: "truecolor",
			// Prevent CLIs from trying to launch a local desktop browser on the server.
			BROWSER: "/bin/false",
		};

		const decoder = new TextDecoder();
		let proc: Bun.Subprocess;
		try {
			proc = Bun.spawn(ws.data.argv, {
				cwd: checkDir(),
				env,
				terminal: {
					cols: 80,
					rows: 24,
					data(_term, data) {
						if (ws.data.ended) return;
						try {
							ws.send(data);
						} catch {}
						const text = decoder.decode(data, { stream: true });
						for (const ev of ws.data.detector.push(text)) {
							sendJson(ws, ev);
						}
					},
				},
			});
		} catch (err) {
			const msg = err instanceof Error ? err.message : "Couldn't start the sign-in command.";
			finishSession(ws, { code: null, reason: "error", message: msg });
			return;
		}

		ws.data.proc = proc;
		sendJson(ws, { type: "started", command: ws.data.command });

		ws.data.timer = setTimeout(() => {
			finishSession(ws, {
				code: null,
				reason: "timeout",
				message: "Sign-in timed out after 15 minutes.",
			});
		}, SIGN_IN_MAX_MS);

		void proc.exited.then(
			(code) => {
				if (ws.data.ended) return;
				// Flush any remaining decoder state so trailing links/codes aren't missed.
				const tail = decoder.decode();
				if (tail) {
					for (const ev of ws.data.detector.push(tail)) sendJson(ws, ev);
				}
				finishSession(ws, { code, reason: "exited" });
			},
			() => {
				if (!ws.data.ended)
					finishSession(ws, {
						code: null,
						reason: "error",
						message: "The sign-in command stopped unexpectedly.",
					});
			},
		);
	},

	message(ws: ServerWebSocket<SignInSocket>, message: string | Buffer): void {
		if (ws.data.ended || !ws.data.proc?.terminal) return;
		if (typeof message !== "string") {
			try {
				ws.data.proc.terminal.write(message);
			} catch {}
			return;
		}
		let parsed: SignInClientMessage;
		try {
			parsed = JSON.parse(message) as SignInClientMessage;
		} catch {
			return;
		}
		if (parsed.type === "resize") {
			const cols = Math.max(20, Math.min(300, Math.floor(Number(parsed.cols) || 80)));
			const rows = Math.max(5, Math.min(100, Math.floor(Number(parsed.rows) || 24)));
			try {
				ws.data.proc.terminal.resize(cols, rows);
			} catch {}
		} else if (parsed.type === "input" && typeof parsed.data === "string") {
			try {
				ws.data.proc.terminal.write(parsed.data);
			} catch {}
		}
	},

	close(ws: ServerWebSocket<SignInSocket>): void {
		finishSession(ws);
	},
};

/** Kills every open sign-in terminal when the server shuts down. */
export function shutdownSignInSessions(): void {
	tickets.clear();
	for (const ws of [...activeSessions.values()]) {
		finishSession(ws, { code: null, reason: "closed", message: "Sekai is shutting down." });
	}
}

/** Resets tickets/sessions (used in tests). */
export function resetSignInState(): void {
	shutdownSignInSessions();
}
