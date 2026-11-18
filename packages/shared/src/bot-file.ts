import { z } from "zod";
import { AgentCapabilities } from "./agent.ts";
import { Avatar } from "./avatar.ts";
import { MemoryKind } from "./memory.ts";
import { AgentModels } from "./models.ts";
import { RoutineAction, Schedule } from "./routine.ts";

/**
 * A bot in one file, to copy to another Sekai or share: its profile, models, tools, skills and routines, and
 * (if you choose) its memory and notes. Never chats, secrets, accounts or machines.
 */
export const BotFile = z.object({
	/** "feesh-bot": exported before the rename (Feesh → Sekai). */
	format: z.union([z.literal("sekai-bot"), z.literal("feesh-bot")]),
	version: z.literal(1),
	exportedAt: z.number(),
	app: z.string(),
	bot: z.object({
		name: z.string().trim().min(1).max(60),
		label: z.string().max(80).default(""),
		job: z.string().max(8000).default(""),
		personality: z.string().max(8000).default(""),
		instructions: z.string().max(20000).default(""),
		avatar: Avatar.optional(),
		/** An uploaded picture, carried in the file (the avatar's url is replaced on import). */
		avatarImage: z
			.object({ mime: z.string().regex(/^image\/[\w.+-]+$/), base64: z.string().max(4_000_000) })
			.optional(),
		models: AgentModels.optional(),
		capabilities: AgentCapabilities.optional(),
	}),
	/** Skills it uses. Built-in ones by name only; the others in full. */
	skills: z
		.array(
			z.object({
				name: z.string().min(1).max(80),
				title: z.string().max(120).default(""),
				description: z.string().max(1000).default(""),
				instructions: z.string().max(100_000).default(""),
				builtin: z.boolean().default(false),
			}),
		)
		.max(100)
		.default([]),
	/** Apps (MCP servers) it uses, by name: connected again on import when one with that name is set up. */
	apps: z
		.array(z.object({ name: z.string().max(120), tools: z.array(z.string()).nullable().default(null) }))
		.max(50)
		.default([]),
	routines: z
		.array(
			z.object({
				name: z.string().min(1).max(120),
				instruction: z.string().max(20_000),
				action: RoutineAction,
				schedule: Schedule,
				timezone: z.string().max(80).default("auto"),
			}),
		)
		.max(50)
		.default([]),
	memories: z
		.array(z.object({ kind: MemoryKind, content: z.string().min(1).max(4000), pinned: z.boolean().default(false) }))
		.max(5000)
		.default([]),
	notes: z
		.array(
			z.object({
				title: z.string().min(1).max(200),
				content: z.string().max(100_000).default(""),
				pinned: z.boolean().default(false),
			}),
		)
		.max(2000)
		.default([]),
});
export type BotFile = z.infer<typeof BotFile>;

export interface BotImportResult {
	agentId: string;
	name: string;
	skills: { added: number; reused: number };
	routines: number;
	memories: number;
	notes: number;
	/** Apps it used that aren't set up here (by name). */
	missingApps: string[];
}
