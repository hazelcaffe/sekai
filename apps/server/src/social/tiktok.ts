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
 * Validate a sessionid and learn the account. TikTok's web API signs most reads, so this uses the
 * session's own user-info endpoint, which still answers to a plain session cookie.
 */
async function whoami(sessionId: string): Promise<{ userId: string; handle: string; name: string }> {
	const res = await fetch("https://www.tiktok.com/api/user/detail/?aid=1988", {
		headers: {
			cookie: `sessionid=${sessionId}`,
			"user-agent":
				"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
			referer: "https://www.tiktok.com/",
		},
	});
	const data = (await res.json().catch(() => null)) as {
		userInfo?: { user?: { id?: string; uniqueId?: string; nickname?: string } };
		statusCode?: number;
		statusMsg?: string;
	} | null;
	const u = data?.userInfo?.user;
	if (!res.ok || !u?.id) {
		throw badRequest(
			/login|expired|permission/i.test(data?.statusMsg ?? "") || res.status === 403
				? "TikTok rejected that sessionid: it's wrong, expired, or the account was logged out."
				: "Couldn't read the account with that sessionid. TikTok may want the browser instead — but the account still works there.",
		);
	}
	return { userId: String(u.id), handle: String(u.uniqueId), name: String(u.nickname ?? u.uniqueId) };
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
