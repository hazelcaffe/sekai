import { z } from "zod";
import { createNote, deleteNote, getNote, listNotes, updateNote } from "../../services/memories.ts";
import { defineTool, type ToolContext, ToolError } from "./types.ts";

async function ownNote(id: string, ctx: ToolContext) {
	const n = await getNote(id);
	if (!n || n.agentId !== ctx.agent.id) throw new ToolError(`No note with id ${id}`);
	return n;
}

export const noteTools = [
	defineTool({
		name: "note_list",
		category: "notes",
		description: "List your notes (id, title, size, last update).",
		parameters: z.object({}),
		risk: "read",
		title: () => "Checked notes",
		async execute(_args, ctx) {
			return (await listNotes(ctx.agent.id)).map((n) => ({
				id: n.id,
				title: n.title,
				pinned: n.pinned,
				chars: n.content.length,
				updated: new Date(n.updatedAt).toISOString(),
			}));
		},
	}),
	defineTool({
		name: "note_read",
		category: "notes",
		description: "Read a note's full content.",
		parameters: z.object({ id: z.string() }),
		risk: "read",
		title: () => "Read a note",
		async execute(args, ctx) {
			const n = await ownNote(args.id, ctx);
			return { id: n.id, title: n.title, content: n.content };
		},
	}),
	defineTool({
		name: "note_write",
		category: "notes",
		description:
			"Create a note (omit id) or update one. mode 'replace' rewrites the content, 'append' adds to the end. Markdown supported. Pinned notes are shown to you every turn.",
		parameters: z.object({
			id: z.string().optional(),
			title: z.string().min(1).max(200).optional(),
			content: z.string().max(100_000),
			mode: z.enum(["replace", "append"]).optional(),
			pinned: z.boolean().optional(),
		}),
		risk: "write",
		title: (a) => (a.id ? "Updated a note" : `Wrote note “${a.title ?? "Untitled"}”`),
		async execute(args, ctx) {
			if (!args.id) {
				const n = await createNote(
					{
						agentId: ctx.agent.id,
						title: args.title ?? "Untitled",
						content: args.content,
						pinned: args.pinned ?? false,
					},
					"agent",
				);
				return { created: true, id: n.id, title: n.title };
			}
			const current = await ownNote(args.id, ctx);
			const content =
				args.mode === "append" ? `${current.content.replace(/\s+$/, "")}\n${args.content}` : args.content;
			const n = await updateNote(args.id, { title: args.title, content, pinned: args.pinned });
			return { updated: true, id: n.id, title: n.title, chars: n.content.length };
		},
	}),
	defineTool({
		name: "note_delete",
		category: "notes",
		description: "Delete one of your notes.",
		parameters: z.object({ id: z.string() }),
		risk: "destructive",
		title: () => "Deleted a note",
		async execute(args, ctx) {
			const n = await ownNote(args.id, ctx);
			await deleteNote(n.id);
			return { deleted: n.title };
		},
	}),
];
