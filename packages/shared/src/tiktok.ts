import { z } from "zod";

/** A bot's TikTok account, signed in with the account's sessionid cookie. */
export interface TtAccount {
	agentId: string;
	handle: string;
	name: string;
	userId: string;
	connected: boolean;
	error: string | null;
	/** Answer DMs from the people below only. */
	answerMentions: boolean;
	allowFrom: string[];
	connectedAt: number;
}

export const TtConnect = z.object({
	/** The sessionid cookie from tiktok.com (keep it secret: it's the whole login). */
	sessionId: z.string().trim().min(10).max(200),
	answerMentions: z.boolean().default(true),
	allowFrom: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
});
export type TtConnect = z.input<typeof TtConnect>;

export const TtUpdate = z
	.object({ answerMentions: z.boolean(), allowFrom: z.array(z.string().trim().min(1).max(40)).max(20) })
	.partial();
export type TtUpdate = z.input<typeof TtUpdate>;

/** "@Name", "tiktok.com/@Name" or "Name" → "name". */
export function cleanTtHandle(h: string): string {
	return h
		.trim()
		.replace(/^https?:\/\/(www\.)?tiktok\.com\//i, "")
		.replace(/^@/, "")
		.replace(/[/?#][\s\S]*/, "")
		.toLowerCase();
}
