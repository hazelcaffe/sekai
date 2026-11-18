import { z } from "zod";

/**
 * - about_user: facts about you (name, time zone). Shared by every agent when agentId is null.
 * - preference: how you like things done.
 * - rule: lasting boundaries ("always ask before sending email").
 * - fact: things the agent learned about the world or its job.
 * - work_log: a dated record of what the agent did.
 */
export const MEMORY_KINDS = ["about_user", "preference", "rule", "fact", "work_log"] as const;
export const MemoryKind = z.enum(MEMORY_KINDS);
export type MemoryKind = z.infer<typeof MemoryKind>;

export const MEMORY_KIND_LABELS: Record<MemoryKind, string> = {
	about_user: "About you",
	preference: "Preferences",
	rule: "Rules",
	fact: "Facts",
	work_log: "Work log",
};

export const Memory = z.object({
	id: z.string(),
	/** null means shared with every agent. */
	agentId: z.string().nullable(),
	kind: MemoryKind,
	content: z.string(),
	source: z.enum(["user", "agent", "auto"]),
	pinned: z.boolean(),
	createdAt: z.number(),
	updatedAt: z.number(),
});
export type Memory = z.infer<typeof Memory>;

export const MemoryCreate = z.object({
	agentId: z.string().nullable(),
	kind: MemoryKind,
	content: z.string().trim().min(1).max(4000),
	pinned: z.boolean().default(false),
});
export type MemoryCreate = z.input<typeof MemoryCreate>;

export const MemoryUpdate = z
	.object({
		kind: MemoryKind,
		content: z.string().trim().min(1).max(4000),
		pinned: z.boolean(),
		agentId: z.string().nullable(),
	})
	.partial();
export type MemoryUpdate = z.input<typeof MemoryUpdate>;

export const Note = z.object({
	id: z.string(),
	agentId: z.string(),
	title: z.string(),
	content: z.string(),
	pinned: z.boolean(),
	createdBy: z.enum(["user", "agent"]),
	createdAt: z.number(),
	updatedAt: z.number(),
});
export type Note = z.infer<typeof Note>;

export const NoteCreate = z.object({
	agentId: z.string().min(1),
	title: z.string().trim().min(1).max(200),
	content: z.string().max(100_000).default(""),
	pinned: z.boolean().default(false),
});
export type NoteCreate = z.input<typeof NoteCreate>;

export const NoteUpdate = z
	.object({
		title: z.string().trim().min(1).max(200),
		content: z.string().max(100_000),
		pinned: z.boolean(),
	})
	.partial();
export type NoteUpdate = z.input<typeof NoteUpdate>;

/** What a memory check-up did for one bot. */
export interface MemoryCheckupResult {
	agentId: string;
	merged: number;
	removed: number;
	questions: string[];
	/** It posted in the bot's chat (it changed something or has questions). */
	posted: boolean;
}
