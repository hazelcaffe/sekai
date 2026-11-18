import { z } from "zod";

/** A bot's Instagram account, signed in with the account's sessionid cookie. */
export interface IgAccount {
	agentId: string;
	handle: string;
	name: string;
	userId: string;
	connected: boolean;
	error: string | null;
	/** Answer DMs from the people below only. */
	answerMentions: boolean;
	/** Handles (without @) whose DMs it answers. Checked by user id, in code. */
	allowFrom: string[];
	connectedAt: number;
}

export const IgConnect = z.object({
	/** The sessionid cookie from instagram.com (keep it secret: it's the whole login). */
	sessionId: z.string().trim().min(10).max(200),
	answerMentions: z.boolean().default(true),
	allowFrom: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
});
export type IgConnect = z.input<typeof IgConnect>;

export const IgUpdate = z
	.object({ answerMentions: z.boolean(), allowFrom: z.array(z.string().trim().min(1).max(40)).max(20) })
	.partial();
export type IgUpdate = z.input<typeof IgUpdate>;

/** "@Name", "instagram.com/Name" or "Name" → "name". */
export function cleanIgHandle(h: string): string {
	return h
		.trim()
		.replace(/^https?:\/\/(www\.)?instagram\.com\//i, "")
		.replace(/^@/, "")
		.replace(/[/?#].*$/, "")
		.toLowerCase();
}
