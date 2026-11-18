import { cleanIgHandle, type IgAccount, IgConnect, IgUpdate } from "@sekai/shared";
import { bus } from "../events/bus.ts";
import { badRequest, notFound, parse } from "../lib/errors.ts";
import { log } from "../lib/log.ts";
import { deleteSocial, type SocialStored, saveSocial, setSocialError, socialError, storedSocial } from "./store.ts";

const PLATFORM = "instagram" as const;

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
	const res = await fetch("https://i.instagram.com/api/v1/accounts/current_user/", {
		headers: {
			cookie: `sessionid=${sessionId}`,
			"x-ig-app-id": "936619743392459",
			"user-agent": "Instagram 219.0.0.12.117 Android",
		},
	});
	const data = (await res.json().catch(() => null)) as {
		user?: { pk?: number | string; username?: string; full_name?: string };
		message?: string;
	} | null;
	if (!res.ok || !data?.user?.pk) {
		throw badRequest(
			/401|login/i.test(data?.message ?? "") || res.status === 403
				? "Instagram rejected that sessionid: it's wrong, expired, or the account was logged out."
				: `Couldn't reach Instagram (${data?.message ?? res.statusText}).`,
		);
	}
	const u = data.user;
	return { userId: String(u.pk), handle: String(u.username), name: String(u.full_name ?? u.username) };
}

async function resolveIds(sessionId: string, handles: string[]): Promise<string[]> {
	const ids: string[] = [];
	for (const h of handles) {
		const res = await fetch(
			`https://i.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(h)}`,
			{ headers: { cookie: `sessionid=${sessionId}`, "x-ig-app-id": "936619743392459" } },
		);
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
