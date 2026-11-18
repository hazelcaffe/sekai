import { z } from "zod";
import { patchOf } from "./patch.ts";

export const DigestConfig = z.object({
	enabled: z.boolean().default(true),
	/** When it arrives, in your time zone (HH:MM, 24-hour). */
	time: z
		.string()
		.regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 08:00")
		.default("08:00"),
	/** plain: the facts as a list. bot: your primary bot writes them up in its own voice (one small model call). */
	style: z.enum(["plain", "bot"]).default("bot"),
	/** Skip days when there's nothing to say. */
	skipQuiet: z.boolean().default(true),
});
export type DigestConfig = z.infer<typeof DigestConfig>;
export const DigestConfigUpdate = patchOf(DigestConfig);
export type DigestConfigUpdate = z.infer<typeof DigestConfigUpdate>;

export interface DigestStatus {
	config: DigestConfig;
	nextAt: number | null;
	lastSentAt: number | null;
	/** The bot that posts it (your primary bot). */
	agentId: string | null;
}
