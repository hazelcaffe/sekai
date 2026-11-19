import type { CodeIndex } from "@sekai/shared";
import { z } from "zod";
import { deleteCodeIndex, indexFolder, listCodeIndexes, searchCode, waitForIndex } from "../../code/indexer.ts";
import { errorMessage } from "../../lib/errors.ts";
import { driverFor } from "../../machines/drivers.ts";
import { machinesForBot } from "../../machines/seats.ts";
import { askOn, machineTarget, onMachine, peek, riskOn } from "./targets.ts";
import { defineTool, ToolError } from "./types.ts";

/** How long code_index waits for a folder before answering (indexing carries on after). */
const WAIT_MS = 120_000;

function summary(ix: CodeIndex): string {
	const where = `${ix.name} (${ix.root} on ${ix.machineName})`;
	if (ix.status === "error") return `${where}: failed: ${ix.error}`;
	if (ix.status === "indexing") {
		const p = ix.progress;
		const step = p?.phase === "embedding" && p.total ? `${p.done}/${p.total} files` : (p?.phase ?? "starting");
		return `${where}: still indexing (${step}); search works on what's done so far`;
	}
	return `${where}: ${ix.files} files, ${ix.chunks} pieces, ready`;
}

/** Indexes matching a name, folder or id (all of the bot's when ref is empty). */
function pickIndexes(all: CodeIndex[], ref?: string): CodeIndex[] {
	const r = ref?.trim().toLowerCase();
	if (!r) return all;
	return all.filter(
		(ix) =>
			ix.id === ref ||
			ix.name.toLowerCase() === r ||
			ix.root.toLowerCase() === r ||
			ix.root.toLowerCase().endsWith(`/${r}`) ||
			ix.name.toLowerCase().includes(r),
	);
}

const hasMachine = async (agent: { id: string }) => (await machinesForBot(agent.id)).length > 0;
const hasIndex = async (agent: { id: string }) => (await listCodeIndexes(agent.id)).length > 0;

export const codeTools = [
	defineTool({
		name: "code_index",
		category: "code",
		description:
			"Index a folder of code on your computer, a devbox or the user's computer, so code_search finds things in it by meaning or by name. Run it once per project; run it again after big changes (only changed files are read). Without path: lists your indexes. remove: true deletes one.",
		parameters: z.object({
			path: z.string().optional().describe("The project folder (absolute, or relative to your home)"),
			machine: onMachine,
			name: z.string().max(60).optional().describe("A short name for it (default: the folder's name)"),
			remove: z.boolean().optional(),
		}),
		risk: "write",
		// On a lent computer whose owner approves every action, indexing asks too.
		askFirst: async (args, ctx) => (args.path ? askOn(await peek(ctx, args.machine, false), "write") : null),
		async riskFor(args, ctx) {
			return args.path ? riskOn(await peek(ctx, args.machine, false), "write") : "read";
		},
		available: hasMachine,
		title: (a) =>
			a.remove ? `Removed the code index of ${a.path}` : a.path ? `Indexed ${a.path}` : "Listed code indexes",
		async execute(args, ctx) {
			const mine = await listCodeIndexes(ctx.agent.id);
			if (!args.path) {
				return mine.length ? { indexes: mine.map(summary) } : { indexes: [], note: "Nothing indexed yet." };
			}
			if (args.remove) {
				const hit = pickIndexes(mine, args.path)[0];
				if (!hit) throw new ToolError(`No index for ${args.path}`);
				await deleteCodeIndex(hit.id);
				return { removed: hit.name };
			}
			const m = await machineTarget(ctx, args.machine);
			let root = args.path.trim();
			// It goes into a shell command below (sh or PowerShell): keep out what either would expand or end on.
			if (/[`$"\n\r]/.test(root))
				throw new ToolError("That folder name has characters Sekai won't pass to a shell.");
			if (!root.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(root)) {
				// Relative to the home folder: the machine knows where that is.
				const driver = await driverFor(m, ctx.agent.id);
				const r = await driver.exec(`cd ${JSON.stringify(root)} && pwd`, {
					timeoutMs: 15_000,
					signal: ctx.signal,
				});
				if (r.code !== 0) throw new ToolError(`There's no folder ${root} on ${m.name}`);
				root = r.stdout.trim().split("\n").pop() ?? root;
			}
			try {
				const started = await indexFolder({ agentId: ctx.agent.id, machine: m, root, name: args.name });
				const ix = await waitForIndex(started.id, WAIT_MS, ctx.signal);
				return { index: summary(ix) };
			} catch (err) {
				throw new ToolError(errorMessage(err));
			}
		},
	}),
	defineTool({
		name: "code_search",
		category: "code",
		description:
			'Search code you indexed (code_index) by what it does ("where are sessions checked") or by name (a function, type, error text). Returns the best matching pieces with file paths and line numbers; read the files for more. Narrow with index (a name or folder) and path (a folder or file inside it).',
		parameters: z.object({
			query: z.string().min(1).max(500),
			index: z.string().optional().describe("Which index (name or folder); default: all of yours"),
			path: z.string().optional().describe("Only under this path inside the project, e.g. src/auth"),
			limit: z.number().int().min(1).max(20).optional(),
		}),
		risk: "read",
		available: hasIndex,
		title: (a) => `Searched code for “${a.query}”`,
		async execute(args, ctx) {
			const mine = await listCodeIndexes(ctx.agent.id);
			const chosen = pickIndexes(mine, args.index);
			if (!chosen.length) {
				throw new ToolError(
					mine.length
						? `No index matches "${args.index}". Yours: ${mine.map((m) => m.name).join(", ")}.`
						: "Nothing is indexed yet: use code_index on the project folder first.",
				);
			}
			const hits = await searchCode(
				chosen.map((c) => c.id),
				args.query,
				{ limit: args.limit ?? 8, pathPrefix: args.path, signal: ctx.signal },
			).catch((err: unknown) => {
				throw new ToolError(errorMessage(err));
			});
			const byId = new Map(chosen.map((c) => [c.id, c]));
			const notes = chosen.filter((c) => c.status !== "ready").map(summary);
			return {
				...(notes.length ? { notes } : {}),
				results: hits.map((h) => {
					const ix = byId.get(h.indexId);
					const lines = h.content.split("\n");
					return {
						file: `${ix && chosen.length > 1 ? `${ix.name}:` : ""}${h.path}:${h.startLine}-${h.endLine}`,
						folder: ix?.root,
						symbol: h.symbol ?? undefined,
						code: lines.length > 45 ? `${lines.slice(0, 45).join("\n")}\n…` : h.content,
					};
				}),
			};
		},
	}),
];
