import {
	CredentialAnswer,
	type CredentialAnswer as CredentialAnswerInput,
	type CredentialRequest,
	type SavedLogin,
} from "@sekai/shared";
import { and, eq } from "drizzle-orm";
import { currentActor } from "../auth/actor.ts";
import { db, schema } from "../db/index.ts";
import { bus } from "../events/bus.ts";
import { notFound, parse } from "../lib/errors.ts";
import { newId } from "../lib/ids.ts";
import { seal, unseal } from "../lib/secrets.ts";
import { getAgent } from "../services/agents.ts";

/**
 * Signing a bot in somewhere: it asks, you type the username and password into Sekai, and Sekai fills them
 * straight into the page. The bot (and its model) never see them. With "remember", the login is kept
 * encrypted and reused for that site without asking again.
 */

export interface Login {
	username: string;
	password: string;
	otp: string;
}

interface Pending {
	request: CredentialRequest;
	/** Whose chat asked: only they see and answer it. */
	userId: string | null;
	resolve: (login: Login | null) => void;
}

const pending = new Map<string, Pending>();

function changed(userId: string | null): void {
	const count = [...pending.values()].filter((p) => p.userId === userId).length;
	bus.emit({ type: "credentials.changed", pending: count }, { to: userId ? [userId] : "admins" });
}

/** "github.com" from a URL (www. dropped, so one login covers both). */
export function siteOf(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, "");
	} catch {
		return url;
	}
}

export function listCredentialRequests(): CredentialRequest[] {
	const me = currentActor()?.userId;
	return [...pending.values()].filter((p) => !me || p.userId === me).map((p) => p.request);
}

export async function savedLogin(agentId: string, site: string): Promise<(Login & { id: string }) | null> {
	const row = await db.query.savedLogins.findFirst({
		where: and(eq(schema.savedLogins.agentId, agentId), eq(schema.savedLogins.site, site)),
	});
	if (!row) return null;
	await db.update(schema.savedLogins).set({ lastUsedAt: Date.now() }).where(eq(schema.savedLogins.id, row.id));
	return { id: row.id, username: row.username, password: unseal(row.secret), otp: "" };
}

/**
 * Gets a login for a site: a saved one, or asks you. Resolves null if you cancel, it times out, or the run
 * is stopped.
 */
export async function requestLogin(opts: {
	agentId: string;
	conversationId: string | null;
	url: string;
	reason: string;
	fields: CredentialRequest["fields"];
	/** Ask even if a login is saved (the saved one didn't work). */
	ask?: boolean;
	timeoutMs: number;
	signal: AbortSignal;
}): Promise<(Login & { saved: boolean }) | null> {
	const site = siteOf(opts.url);
	const saved = await savedLogin(opts.agentId, site);
	if (saved && !opts.ask && !opts.fields.includes("otp")) return { ...saved, saved: true };
	const agent = await getAgent(opts.agentId);
	const now = Date.now();
	const request: CredentialRequest = {
		id: newId("crq"),
		agentId: opts.agentId,
		conversationId: opts.conversationId,
		site,
		url: opts.url,
		reason: opts.reason,
		fields: opts.fields,
		hasSaved: Boolean(saved),
		createdAt: now,
		expiresAt: opts.timeoutMs ? now + opts.timeoutMs : now + 24 * 3_600_000,
	};
	const userId = currentActor()?.userId ?? null;
	return new Promise((resolve) => {
		let timer: ReturnType<typeof setTimeout> | null = null;
		const done = (login: Login | null) => {
			if (!pending.has(request.id)) return;
			pending.delete(request.id);
			if (timer) clearTimeout(timer);
			opts.signal.removeEventListener("abort", onAbort);
			changed(userId);
			resolve(login ? { ...login, saved: false } : null);
		};
		const onAbort = () => done(null);
		pending.set(request.id, { request, userId, resolve: done });
		if (opts.timeoutMs) timer = setTimeout(() => done(null), opts.timeoutMs);
		opts.signal.addEventListener("abort", onAbort, { once: true });
		changed(userId);
		bus.emit({
			type: "notification",
			title: `${agent?.name ?? "A bot"} needs to sign in`,
			body: `${site}: ${opts.reason}`,
			agentId: opts.agentId,
			conversationId: opts.conversationId,
		});
	});
}

export async function answerCredentialRequest(id: string, input: CredentialAnswerInput): Promise<void> {
	const p = pending.get(id);
	const me = currentActor()?.userId;
	if (!p || (me && p.userId !== me)) throw notFound("Sign-in request");
	const answer = parse(CredentialAnswer, input);
	if (answer.cancel) {
		p.resolve(null);
		return;
	}
	if (answer.remember && answer.username && answer.password) {
		await saveLogin(p.request.agentId, p.request.site, answer.username, answer.password);
	}
	p.resolve({ username: answer.username, password: answer.password, otp: answer.otp });
}

export async function saveLogin(agentId: string, site: string, username: string, password: string): Promise<void> {
	await db
		.insert(schema.savedLogins)
		.values({
			id: newId("lgn"),
			agentId,
			site,
			username,
			secret: seal(password),
			lastUsedAt: null,
			createdAt: Date.now(),
		})
		.onConflictDoUpdate({
			target: [schema.savedLogins.agentId, schema.savedLogins.site, schema.savedLogins.username],
			set: { secret: seal(password) },
		});
}

/** Logins kept for your own bots (a bot's sign-ins are its owner's). */
export async function listSavedLogins(agentId?: string): Promise<SavedLogin[]> {
	const me = currentActor()?.userId;
	const rows = await db
		.select({ l: schema.savedLogins })
		.from(schema.savedLogins)
		.innerJoin(schema.agents, eq(schema.agents.id, schema.savedLogins.agentId))
		.where(
			and(
				agentId ? eq(schema.savedLogins.agentId, agentId) : undefined,
				me ? eq(schema.agents.userId, me) : undefined,
			),
		);
	return rows.map(({ l: { secret: _secret, ...r } }) => r);
}

export async function deleteSavedLogin(id: string): Promise<void> {
	const own = await listSavedLogins();
	if (!own.some((l) => l.id === id)) throw notFound("Saved login");
	await db.delete(schema.savedLogins).where(eq(schema.savedLogins.id, id));
}
