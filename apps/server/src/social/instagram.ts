import { cleanIgHandle, type IgAccount, IgConnect, IgUpdate } from "@sekai/shared";
import { bus } from "../events/bus.ts";
import { badRequest, notFound, parse } from "../lib/errors.ts";
import { log } from "../lib/log.ts";
import { deleteSocial, type SocialStored, saveSocial, setSocialError, socialError, storedSocial } from "./store.ts";

const PLATFORM = "instagram" as const;
const WEB_UA =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";
/** A csrftoken per session: Instagram's web API checks that the cookie and the header match. */
const csrf = new Map<string, string>();

/**
 * Instagram's web API (https://www.instagram.com/api/v1…), which a sessionid from instagram.com belongs to: the app's
 * API (i.instagram.com) answers a web session with "something went wrong". Signed out shows as a 401 or a redirect.
 */
export async function igWeb(sessionId: string, path: string, init: RequestInit = {}): Promise<Response> {
	let token = csrf.get(sessionId);
	if (!token) {
		token = crypto.randomUUID().replaceAll("-", "");
		csrf.set(sessionId, token);
	}
	return fetch(`https://www.instagram.com/api/v1${path}`, {
		...init,
		redirect: "manual",
		headers: {
			cookie: `sessionid=${sessionId}; csrftoken=${token}`,
			"x-csrftoken": token,
			"x-ig-app-id": "936619743392459",
			"x-requested-with": "XMLHttpRequest",
			"user-agent": WEB_UA,
			referer: "https://www.instagram.com/",
			origin: "https://www.instagram.com",
			...(init.headers ?? {}),
		},
	});
}

/** Whether Instagram's answer means the session is signed out (wrong, expired or logged out). */
export function igSignedOut(res: Response, message?: string): boolean {
	return (
		res.status === 401 ||
		res.status === 403 ||
		(res.status >= 300 && res.status < 400) ||
		/login/i.test(message ?? "")
	);
}

function toPublic(agentId: string, s: SocialStored): IgAccount {
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

/** Validate a sessionid and learn the account behind it. */
async function whoami(sessionId: string): Promise<{ userId: string; handle: string; name: string }> {
	// A sessionid starts with its account's id ("123%3A…"): ask for that account, as the session.
	const id = /^(\d+)/.exec(decodeURIComponent(sessionId.trim()))?.[1];
	if (!id) throw badRequest("That isn't an Instagram sessionid: it starts with the account's number.");
	const res = await igWeb(sessionId, `/users/${id}/info/`);
	const data = (await res.json().catch(() => null)) as {
		user?: { pk?: number | string; pk_id?: string; username?: string; full_name?: string };
		message?: string;
	} | null;
	if (igSignedOut(res, data?.message)) {
		throw badRequest("Instagram rejected that sessionid: it's wrong, expired, or the account was logged out.");
	}
	const u = data?.user;
	if (!res.ok || !u?.username) {
		log.warn(`instagram sign-in: ${res.status} ${(data?.message ?? "").slice(0, 120)}`);
		throw badRequest(
			`Couldn't reach Instagram (${data?.message ?? res.statusText ?? res.status}). Try again in a minute.`,
		);
	}
	return {
		userId: String(u.pk ?? u.pk_id ?? id),
		handle: String(u.username),
		name: String(u.full_name || u.username),
	};
}

async function resolveIds(sessionId: string, handles: string[]): Promise<string[]> {
	const ids: string[] = [];
	for (const h of handles) {
		const res = await igWeb(sessionId, `/users/web_profile_info/?username=${encodeURIComponent(h)}`);
		const data = (await res.json().catch(() => null)) as { data?: { user?: { id?: string } } } | null;
		const id = data?.data?.user?.id;
		if (!id) throw badRequest(`There's no Instagram account @${h}.`);
		ids.push(String(id));
	}
	return ids;
}

export async function getIgAccount(agentId: string): Promise<IgAccount | null> {
	const s = await storedSocial(agentId, PLATFORM);
	return s ? toPublic(agentId, s) : null;
}

export async function igAccountOf(agentId: string): Promise<{ handle: string; connected: boolean } | null> {
	const s = await storedSocial(agentId, PLATFORM);
	return s ? { handle: s.handle, connected: !socialError(PLATFORM, agentId) } : null;
}

export async function connectIg(agentId: string, input: unknown): Promise<IgAccount> {
	const data = parse(IgConnect, input);
	const { userId, handle, name } = await whoami(data.sessionId);
	const allowFrom = [...new Set(data.allowFrom.map(cleanIgHandle).filter(Boolean))];
	const allowIds = await resolveIds(data.sessionId, allowFrom);
	const prev = await storedSocial(agentId, PLATFORM);
	const s: SocialStored = {
		sessionId: data.sessionId,
		handle,
		name,
		userId,
		answerMentions: data.answerMentions,
		allowFrom,
		allowIds,
		connectedAt: Date.now(),
	};
	await saveSocial(agentId, PLATFORM, s);
	setSocialError(PLATFORM, agentId, null);
	bus.emit({ type: "settings.changed" });
	log.info(`instagram: ${agentId} signed in as @${handle}${prev ? "" : " (new)"}`);
	return toPublic(agentId, s);
}

export async function updateIg(agentId: string, input: unknown): Promise<IgAccount> {
	const patch = parse(IgUpdate, input);
	const s = await storedSocial(agentId, PLATFORM);
	if (!s) throw notFound("Instagram account");
	if (patch.answerMentions !== undefined) s.answerMentions = patch.answerMentions;
	if (patch.allowFrom !== undefined) {
		const allowFrom = [...new Set(patch.allowFrom.map(cleanIgHandle).filter(Boolean))];
		s.allowIds = await resolveIds(s.sessionId, allowFrom);
		s.allowFrom = allowFrom;
	}
	await saveSocial(agentId, PLATFORM, s);
	bus.emit({ type: "settings.changed" });
	return toPublic(agentId, s);
}

export async function disconnectIg(agentId: string): Promise<void> {
	await deleteSocial(agentId, PLATFORM);
}
