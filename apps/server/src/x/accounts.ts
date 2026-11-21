import { cleanHandle, type XAccount, XConnect, XUpdate } from "@sekai/shared";
import { like } from "drizzle-orm";
import { db, schema } from "../db/index.ts";
import { bus } from "../events/bus.ts";
import { badRequest, errorMessage, notFound, parse } from "../lib/errors.ts";
import { log } from "../lib/log.ts";
import { seal, unseal } from "../lib/secrets.ts";
import { deleteKey, readKey, writeKey } from "../services/kv.ts";

/** What's stored per bot (the token encrypted). */
interface Stored {
	authToken: string;
	handle: string;
	name: string;
	userId: string;
	answerMentions: boolean;
	allowFrom: string[];
	/** Account ids of allowFrom, resolved when saved (mentions are checked against these). */
	allowIds: string[];
	/** The newest mention already seen. */
	lastMentionId: string | null;
	connectedAt: number;
}

const key = (agentId: string) => `x.account.${agentId}`;

type Emusks = InstanceType<typeof import("emusks").default>;

interface Live {
	client: Emusks;
	at: number;
}

const clients = new Map<string, Live>();
const errors = new Map<string, string>();

/** emusks starts a helper process when imported, so it's only loaded once a bot has an X account. */
async function library() {
	return (await import("emusks")).default;
}

async function stored(agentId: string): Promise<Stored | null> {
	const raw = (await readKey(key(agentId))) as (Omit<Stored, "authToken"> & { authToken: string }) | undefined;
	if (!raw) return null;
	try {
		return { ...raw, authToken: unseal(raw.authToken) };
	} catch (err) {
		log.warn(`couldn't read an X sign-in: ${errorMessage(err)}`);
		return null;
	}
}

async function save(agentId: string, s: Stored): Promise<void> {
	await writeKey(key(agentId), { ...s, authToken: seal(s.authToken) });
}

function toPublic(agentId: string, s: Stored): XAccount {
	return {
		agentId,
		handle: s.handle,
		name: s.name,
		userId: s.userId,
		connected: clients.has(agentId) && !errors.has(agentId),
		error: errors.get(agentId) ?? null,
		answerMentions: s.answerMentions,
		allowFrom: s.allowFrom,
		connectedAt: s.connectedAt,
	};
}

/** Signs in with a token; throws with a clear reason when it doesn't work. */
async function login(token: string): Promise<{ client: Emusks; id: string; handle: string; name: string }> {
	const Lib = await library();
	const client = new Lib();
	try {
		const me = (await client.login(token)) ?? (await client.account.viewer());
		if (!me?.id) throw new Error("X didn't say who this is");
		return { client, id: String(me.id), handle: String(me.username), name: String(me.name ?? me.username) };
	} catch (err) {
		const m = errorMessage(err);
		if (/failed to log in|bootstrap failed|401|403/i.test(m)) {
			throw badRequest("X didn't accept that auth_token: it's wrong, expired, or the account was logged out.");
		}
		if (/suspend|locked|TwitterUserNotSuspended/i.test(m))
			throw badRequest("That X account is suspended or locked.");
		throw badRequest(`Couldn't sign in to X: ${m}`);
	}
}

async function resolveIds(client: Emusks, handles: string[]): Promise<string[]> {
	const ids: string[] = [];
	for (const h of handles) {
		const u = await client.users.getByUsername(h).catch(() => null);
		if (!u?.id) throw badRequest(`There's no X account @${h}`);
		ids.push(String(u.id));
	}
	return ids;
}

/** A signed-in client for a bot's account (signs in again after a restart or a failure). */
export async function xClient(agentId: string): Promise<{ client: Emusks; account: Stored }> {
	const s = await stored(agentId);
	if (!s) throw badRequest("This bot has no X account. Connect one in the bot's Accounts → X.");
	const live = clients.get(agentId);
	if (live) return { client: live.client, account: s };
	try {
		const { client } = await login(s.authToken);
		clients.set(agentId, { client, at: Date.now() });
		errors.delete(agentId);
		return { client, account: s };
	} catch (err) {
		errors.set(agentId, errorMessage(err));
		bus.emit({ type: "settings.changed" });
		throw err;
	}
}

/** Forget the client after an auth error, so the next use signs in again. */
export function dropClient(agentId: string, error?: string): void {
	clients.delete(agentId);
	if (error) errors.set(agentId, error);
}

export async function getXAccount(agentId: string): Promise<XAccount | null> {
	const s = await stored(agentId);
	return s ? toPublic(agentId, s) : null;
}

/** For prompts: a bot's handle, if it has an account. */
export async function xAccountOf(agentId: string): Promise<{ handle: string; connected: boolean } | null> {
	const s = await stored(agentId);
	return s ? { handle: s.handle, connected: !errors.has(agentId) } : null;
}

export async function connectX(agentId: string, input: unknown): Promise<XAccount> {
	const data = parse(XConnect, input);
	const { client, id, handle, name } = await login(data.authToken);
	const allowFrom = [...new Set(data.allowFrom.map(cleanHandle).filter(Boolean))];
	const allowIds = await resolveIds(client, allowFrom);
	const prev = await stored(agentId);
	const s: Stored = {
		authToken: data.authToken,
		handle,
		name,
		userId: id,
		answerMentions: data.answerMentions,
		allowFrom,
		allowIds,
		// The same account again keeps its place; a new one starts from now (old mentions aren't answered).
		lastMentionId: prev?.userId === id ? prev.lastMentionId : null,
		connectedAt: Date.now(),
	};
	await save(agentId, s);
	clients.set(agentId, { client, at: Date.now() });
	errors.delete(agentId);
	const { clearSignedOut } = await import("./mentions.ts");
	clearSignedOut(agentId);
	bus.emit({ type: "settings.changed" });
	log.info(`x: ${agentId} signed in as @${handle}`);
	return toPublic(agentId, s);
}

export async function updateX(agentId: string, input: unknown): Promise<XAccount> {
	const patch = parse(XUpdate, input);
	const s = await stored(agentId);
	if (!s) throw notFound("X account");
	if (patch.answerMentions !== undefined) {
		// Turned back on: answer from now, not a backlog of mentions from while it was off.
		if (patch.answerMentions && !s.answerMentions) s.lastMentionId = null;
		s.answerMentions = patch.answerMentions;
	}
	if (patch.allowFrom !== undefined) {
		const allowFrom = [...new Set(patch.allowFrom.map(cleanHandle).filter(Boolean))];
		const { client } = await xClient(agentId);
		s.allowIds = await resolveIds(client, allowFrom);
		s.allowFrom = allowFrom;
	}
	await save(agentId, s);
	bus.emit({ type: "settings.changed" });
	return toPublic(agentId, s);
}

export async function disconnectX(agentId: string): Promise<void> {
	clients.delete(agentId);
	errors.delete(agentId);
	await deleteKey(key(agentId));
	bus.emit({ type: "settings.changed" });
}

export async function setLastMention(agentId: string, id: string): Promise<void> {
	const s = await stored(agentId);
	if (!s) return;
	s.lastMentionId = id;
	await save(agentId, s);
}

/** Every bot with an X account. */
export async function xAgents(): Promise<string[]> {
	const rows = await db
		.select({ key: schema.settings.key })
		.from(schema.settings)
		.where(like(schema.settings.key, "x.account.%"));
	return rows.map((r) => r.key.slice("x.account.".length));
}

export function storedAccount(agentId: string): Promise<Stored | null> {
	return stored(agentId);
}
