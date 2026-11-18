import { MEMORY_KINDS } from "@sekai/shared";
import { z } from "zod";
import { createMemory, deleteMemory, getMemory, listMemories, updateMemory } from "../../services/memories.ts";
import { defineTool, type ToolContext, ToolError } from "./types.ts";

async function ownMemory(id: string, ctx: ToolContext) {
	const m = await getMemory(id);
	if (!m || (m.agentId !== null && m.agentId !== ctx.agent.id)) throw new ToolError(`No memory with id ${id}`);
	return m;
}

export const memoryTools = [
	defineTool({
		name: "memory_save",
		category: "memory",
		description:
			"Save something worth remembering long-term. kinds: about_user (facts about the user), preference, rule (lasting boundary), fact, work_log ('YYYY-MM-DD: did X → outcome'). Set shared=true for facts about the user that every agent should know (name, time zone). One fact per call; never save secrets.",
		parameters: z.object({
			kind: z.enum(MEMORY_KINDS),
			content: z.string().min(1).max(2000).describe("Self-contained statement"),
			shared: z.boolean().optional().describe("Share with all agents (for about_user facts)"),
		}),
		risk: "write",
		title: () => "Saved to memory",
		async execute(args, ctx) {
			const m = await createMemory(
				{ agentId: args.shared ? null : ctx.agent.id, kind: args.kind, content: args.content },
				"agent",
			);
			return { saved: true, id: m.id, shared: m.agentId === null };
		},
	}),
	defineTool({
		name: "memory_update",
		category: "memory",
		description: "Correct or refresh an existing memory by id (ids are shown in your Memory section).",
		parameters: z.object({
			id: z.string(),
			content: z.string().min(1).max(2000).optional(),
			kind: z.enum(MEMORY_KINDS).optional(),
		}),
		risk: "write",
		title: () => "Updated memory",
		async execute(args, ctx) {
			await ownMemory(args.id, ctx);
			const m = await updateMemory(args.id, { content: args.content, kind: args.kind });
			return { updated: true, id: m.id, content: m.content };
		},
	}),
	defineTool({
		name: "memory_forget",
		category: "memory",
		description: "Delete a memory by id, e.g. when the user asks you to forget something or it is wrong.",
		parameters: z.object({ id: z.string() }),
		risk: "destructive",
		title: () => "Forgot a memory",
		async execute(args, ctx) {
			const m = await ownMemory(args.id, ctx);
			await deleteMemory(args.id);
			return { forgotten: m.content };
		},
	}),
	defineTool({
		name: "memory_search",
		category: "memory",
		description:
			"Search your memories (including shared ones) by keyword and/or kind. Use for older entries not shown in your prompt.",
		parameters: z.object({
			query: z.string().optional(),
			kind: z.enum(MEMORY_KINDS).optional(),
			limit: z.number().int().min(1).max(100).optional(),
		}),
		risk: "read",
		title: (a) => (a.query ? `Searched memory for “${a.query}”` : "Looked through memory"),
		async execute(args, ctx) {
			const rows = await listMemories({
				agentId: ctx.agent.id,
				includeShared: true,
				kind: args.kind,
				query: args.query,
				limit: args.limit ?? 30,
			});
			return rows.map((m) => ({
				id: m.id,
				kind: m.kind,
				content: m.content,
				shared: m.agentId === null,
				updated: new Date(m.updatedAt).toISOString().slice(0, 10),
			}));
		},
	}),
];
