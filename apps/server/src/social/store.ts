import { like } from "drizzle-orm";
import { db, schema } from "../db/index.ts";
import { bus } from "../events/bus.ts";
import { errorMessage } from "../lib/errors.ts";
import { log } from "../lib/log.ts";
import { seal, unseal } from "../lib/secrets.ts";
import { deleteKey, readKey, writeKey } from "../services/kv.ts";

export type SocialPlatform = "instagram" | "tiktok";

export interface SocialStored {
	/** The session cookie value (sessionid). Sealed at rest. */
	sessionId: string;
	handle: string;
	name: string;
	userId: string;
	answerMentions: boolean;
	allowFrom: string[];
	/** User ids of allowFrom, resolved when saved (DMs are checked against these). */
	allowIds: string[];
	connectedAt: number;
}

const key = (platform: SocialPlatform, agentId: string) => `social.${platform}.${agentId}`;

const errors = new Map<string, string>();
const errKey = (platform: SocialPlatform, agentId: string) => `${platform}:${agentId}`;

export function socialError(platform: SocialPlatform, agentId: string): string | null {
	return errors.get(errKey(platform, agentId)) ?? null;
}
export function setSocialError(platform: SocialPlatform, agentId: string, error: string | null): void {
	const k = errKey(platform, agentId);
	if (error) errors.set(k, error);
	else errors.delete(k);
}

export async function storedSocial(agentId: string, platform: SocialPlatform): Promise<SocialStored | null> {
	const raw = (await readKey(key(platform, agentId))) as
		| (Omit<SocialStored, "sessionId"> & { sessionId: string })
		| undefined;
	if (!raw) return null;
	try {
		return { ...raw, sessionId: unseal(raw.sessionId) };
	} catch (err) {
		log.warn(`couldn't read a ${platform} sign-in: ${errorMessage(err)}`);
		return null;
	}
}

export async function saveSocial(agentId: string, platform: SocialPlatform, s: SocialStored): Promise<void> {
	await writeKey(key(platform, agentId), { ...s, sessionId: seal(s.sessionId) });
}

export async function deleteSocial(agentId: string, platform: SocialPlatform): Promise<void> {
	setSocialError(platform, agentId, null);
	await deleteKey(key(platform, agentId));
	bus.emit({ type: "settings.changed" });
}

/** Every bot with this platform's account. */
export async function socialAgents(platform: SocialPlatform): Promise<string[]> {
	const prefix = `social.${platform}.`;
	const rows = await db
		.select({ key: schema.settings.key })
		.from(schema.settings)
		.where(like(schema.settings.key, `${prefix}%`));
	return rows.map((r) => r.key.slice(prefix.length));
}

/** The session cookie value a bot's browser should hold (for injection), if it has this account. */
export async function socialSessionCookie(agentId: string, platform: SocialPlatform): Promise<string | null> {
	const s = await storedSocial(agentId, platform);
	return s?.sessionId ?? null;
}
