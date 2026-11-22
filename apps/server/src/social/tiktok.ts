import { cleanTtHandle, type TtAccount, TtConnect, TtUpdate } from "@sekai/shared";
import { bus } from "../events/bus.ts";
import { badRequest, notFound, parse } from "../lib/errors.ts";
import { log } from "../lib/log.ts";
import { deleteSocial, type SocialStored, saveSocial, setSocialError, socialError, storedSocial } from "./store.ts";

const PLATFORM = "tiktok" as const;

function toPublic(agentId: string, s: SocialStored): TtAccount {
	return {
		agentId,
		handle: s.handle,
		name: s.name,
		userId: s.userId,
		connected: !socialError(PLATFORM, agentId),
		error: socialError(PLATFORM, agentId),
		answerMentions: s.answerMentions,
		allowFrom: s.allowFrom,
		connectedAt: s.connectedAt,
	};
}

/**
 * Validate a sessionid and learn the account: TikTok's sign-in service answers who a session is, with a plain
 * session cookie (its web API signs most other reads).
 */
async function whoami(sessionId: string): Promise<{ userId: string; handle: string; name: string }> {
	const res = await fetch("https://www.tiktok.com/passport/web/account/info/?aid=1459", {
		headers: {
			cookie: `sessionid=${sessionId.trim()}`,
			"user-agent":
				"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
			referer: "https://www.tiktok.com/",
		},
	});
	const body = (await res.json().catch(() => null)) as {
		message?: string;
		data?: {
			user_id?: number | string;
			user_id_str?: string;
			username?: string;
			screen_name?: string;
			name?: string;
		};
	} | null;
	const d = body?.data;
	const id = d?.user_id_str ?? d?.user_id;
	if (body?.message === "success" && id && d?.username) {
		return { userId: String(id), handle: String(d.username), name: String(d.screen_name || d.username) };
	}
	if (res.ok && body?.message === "error") {
		throw badRequest("TikTok rejected that sessionid: it's wrong, expired, or the account was logged out.");
	}
	log.warn(`tiktok sign-in: ${res.status} ${(body?.message ?? "").slice(0, 80)}`);
	throw badRequest("Couldn't reach TikTok just now. Try again in a minute.");
}

export async function getTtAccount(agentId: string): Promise<TtAccount | null> {
	const s = await storedSocial(agentId, PLATFORM);
	return s ? toPublic(agentId, s) : null;
}

export async function ttAccountOf(agentId: string): Promise<{ handle: string; connected: boolean } | null> {
	const s = await storedSocial(agentId, PLATFORM);
	return s ? { handle: s.handle, connected: !socialError(PLATFORM, agentId) } : null;
}

export async function connectTt(agentId: string, input: unknown): Promise<TtAccount> {
	const data = parse(TtConnect, input);
	const { userId, handle, name } = await whoami(data.sessionId);
	const allowFrom = [...new Set(data.allowFrom.map(cleanTtHandle).filter(Boolean))];
	const s: SocialStored = {
		sessionId: data.sessionId,
		handle,
		name,
		userId,
		answerMentions: data.answerMentions,
		allowFrom,
		// TikTok resolves ids lazily (its user lookup is signed); DMs are matched by username.
		allowIds: [],
		connectedAt: Date.now(),
	};
	await saveSocial(agentId, PLATFORM, s);
	setSocialError(PLATFORM, agentId, null);
	bus.emit({ type: "settings.changed" });
	log.info(`tiktok: ${agentId} signed in as @${handle}`);
	return toPublic(agentId, s);
}

export async function updateTt(agentId: string, input: unknown): Promise<TtAccount> {
	const patch = parse(TtUpdate, input);
	const s = await storedSocial(agentId, PLATFORM);
	if (!s) throw notFound("TikTok account");
	if (patch.answerMentions !== undefined) s.answerMentions = patch.answerMentions;
	if (patch.allowFrom !== undefined) s.allowFrom = [...new Set(patch.allowFrom.map(cleanTtHandle).filter(Boolean))];
	await saveSocial(agentId, PLATFORM, s);
	bus.emit({ type: "settings.changed" });
	return toPublic(agentId, s);
}

export async function disconnectTt(agentId: string): Promise<void> {
	await deleteSocial(agentId, PLATFORM);
}
