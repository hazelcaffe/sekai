import { z } from "zod";

/** A bot's X (Twitter) account, signed in with the account's auth_token cookie. */
export interface XAccount {
	agentId: string;
	handle: string;
	name: string;
	userId: string;
	connected: boolean;
	error: string | null;
	/** Answer posts that mention the account, from the people below only. */
	answerMentions: boolean;
	/** Handles (without @) whose mentions it answers. Checked by account id, in code. */
	allowFrom: string[];
	connectedAt: number;
}

export const XConnect = z.object({
	/** The auth_token cookie from x.com (keep it secret: it's the whole login). */
	authToken: z.string().trim().min(20).max(80),
	answerMentions: z.boolean().default(true),
	allowFrom: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
});
export type XConnect = z.input<typeof XConnect>;

export const XUpdate = z
	.object({ answerMentions: z.boolean(), allowFrom: z.array(z.string().trim().min(1).max(40)).max(20) })
	.partial();
export type XUpdate = z.input<typeof XUpdate>;

/** "@Name", "x.com/Name" or "Name" → "name". */
export function cleanHandle(h: string): string {
	return h
		.trim()
		.replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, "")
		.replace(/^@/, "")
		.replace(/[/?#][\s\S]*/, "")
		.toLowerCase();
}
