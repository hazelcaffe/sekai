import { z } from "zod";

export const SKILL_NAME_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
export const SkillName = z.string().regex(SKILL_NAME_RE, "Use lowercase letters, digits and dashes (max 63)");

export const Skill = z.object({
	id: z.string(),
	/** Whose skill it is; null: built in, for everyone. */
	userId: z.string().nullable(),
	/** Slug the agent uses to load it, e.g. "weekly-report". */
	name: z.string(),
	title: z.string(),
	/** When to use this skill. Agents read this to decide whether to load it. */
	description: z.string(),
	/** The full method, in Markdown. Loaded on demand. */
	instructions: z.string(),
	builtin: z.boolean(),
	/** Disabled skills are hidden from every agent. */
	enabled: z.boolean(),
	/** Offered to every agent. Otherwise only agents that have it in skillIds see it. */
	shared: z.boolean(),
	createdBy: z.enum(["system", "user", "agent"]),
	createdAt: z.number(),
	updatedAt: z.number(),
});
export type Skill = z.infer<typeof Skill>;

export const SkillCreate = z.object({
	name: SkillName,
	title: z.string().trim().min(1).max(120),
	description: z.string().trim().min(1).max(1000),
	instructions: z.string().max(100_000).default(""),
	enabled: z.boolean().default(true),
	shared: z.boolean().default(false),
});
export type SkillCreate = z.input<typeof SkillCreate>;

export const SkillUpdate = z
	.object({
		name: SkillName,
		title: z.string().trim().min(1).max(120),
		description: z.string().trim().min(1).max(1000),
		instructions: z.string().max(100_000),
		enabled: z.boolean(),
		shared: z.boolean(),
	})
	.partial();
export type SkillUpdate = z.input<typeof SkillUpdate>;

export const SkillImport = z.object({ markdown: z.string().min(1).max(200_000) });
