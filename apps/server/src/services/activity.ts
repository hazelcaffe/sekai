import {
	type ActivityEntry,
	type ActivityQuery,
	type Message,
	TOOL_LABELS,
	type ToolPart,
	toolLabel,
	type UsageScope,
} from "@sekai/shared";
import { and, desc, eq, inArray, lt, or, type SQL, sql } from "drizzle-orm";
import { currentActor } from "../auth/actor.ts";
import { db, schema } from "../db/index.ts";
import { conversationOwner } from "../events/scope.ts";
import { errorMessage } from "../lib/errors.ts";
import { newId } from "../lib/ids.ts";
import { log } from "../lib/log.ts";
import { csvCell } from "../lib/text.ts";
import { claudeToolKind, claudeToolTitle } from "../providers/kinds.ts";
import { ownWhere } from "./visibility.ts";

const TERMINAL = new Set(["done", "error", "denied"]);

/**
 * Resolves whose activity log a query may read: non-admins always see only their own ("me"); admins default to
 * "me" and may switch to "all" (everyone) or a specific person's userId, matching Usage.
 */
export function resolveActivityScope(
	actor: { userId: string; admin: boolean } | null,
	scopeIn: UsageScope = "me",
): { kind: "me" | "all" | "user"; userId: string | null } {
	if (!actor || (actor.admin && scopeIn === "all")) return { kind: "all", userId: null };
	if (actor.admin && scopeIn && scopeIn !== "me") return { kind: "user", userId: scopeIn };
	return { kind: "me", userId: actor.userId };
}

/** Long values shortened, so the log stays small (the chat keeps the whole call). */
function shortArgs(args: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(args)) {
		if (typeof v === "string") out[k] = v.length > 500 ? `${v.slice(0, 500)}…` : v;
		else if (v !== null && typeof v === "object") {
			const text = JSON.stringify(v);
			out[k] = text.length > 500 ? `${text.slice(0, 500)}…` : v;
		} else out[k] = v;
	}
	return out;
}

/** Records a finished tool call (done, failed or denied) once. Never throws: the log must not break a reply. */
export function recordActivity(message: Pick<Message, "id" | "agentId" | "conversationId" | "runId">, part: ToolPart) {
	if (!TERMINAL.has(part.status)) return;
	const now = Date.now();
	const actorId = currentActor()?.userId ?? null;
	void (async () => {
		// Whose chat it happened in (a bot shared with them acts in their name there).
		const userId = actorId ?? (await conversationOwner(message.conversationId));
		await db
			.insert(schema.activityLog)
			.values({
				id: newId("act", 20),
				at: part.endedAt ?? now,
				userId,
				agentId: message.agentId,
				conversationId: message.conversationId,
				messageId: message.id,
				runId: message.runId,
				toolCallId: part.id,
				tool: part.name,
				title: part.title || part.name,
				source: part.source ?? "builtin",
				risk: part.risk ?? null,
				status: part.status as ActivityEntry["status"],
				decision: part.approval?.decision ?? null,
				decidedBy: part.approval?.by ?? null,
				note: part.approval?.note ?? null,
				args: shortArgs(part.args ?? {}),
				result: part.result ? part.result.slice(0, 2000) : null,
				error: part.error ? part.error.slice(0, 2000) : null,
				durationMs: part.startedAt ? Math.max(0, (part.endedAt ?? now) - part.startedAt) : null,
			})
			.onConflictDoNothing();
	})().catch((err: unknown) => log.warn(`couldn't record activity: ${errorMessage(err)}`));
}

/**
 * Search words match what everyone may see of an entry (its tool, an app's tool title, a tool's plain name) and, in
 * your own entries only, what it carried (its title, arguments, result and error): a search must never find someone
 * else's entry by its contents.
 */
function matches(word: string, me: string | null): SQL {
	const t = schema.activityLog;
	const like = `%${word.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
	const lower = word.toLowerCase();
	// Only names Sekai knows: a built-in tool by its name or plain name, an app's tool (declared by the app). The name a
	// model or an outside agent gave a call is free text, so other people's entries are never matched by it.
	const named = Object.keys(TOOL_LABELS).filter(
		(name) => name.toLowerCase().includes(lower) || toolLabel(name).toLowerCase().includes(lower),
	);
	const open = or(
		and(eq(t.source, "mcp"), or(sql`${t.tool} ilike ${like}`, sql`${t.title} ilike ${like}`)),
		named.length ? and(eq(t.source, "builtin"), inArray(t.tool, named)) : undefined,
	);
	const contents = sql`(${t.title} ilike ${like} or ${t.args}::text ilike ${like} or coalesce(${t.result}, '') ilike ${like} or coalesce(${t.error}, '') ilike ${like})`;
	return (me === null ? or(open, contents) : or(open, and(eq(t.userId, me), contents))) ?? contents;
}

function where(q: ActivityQuery) {
	const t = schema.activityLog;
	const conds = [];
	const actor = currentActor();
	const scope = resolveActivityScope(actor, q.scope);
	if (scope.userId) conds.push(eq(t.userId, scope.userId));
	if (q.agentId) conds.push(eq(t.agentId, q.agentId));
	if (q.status) conds.push(eq(t.status, q.status));
	if (q.risk) conds.push(eq(t.risk, q.risk));
	if (q.decidedBy) conds.push(eq(t.decidedBy, q.decidedBy));
	if (q.before) conds.push(lt(t.at, q.before));
	const words = (q.q ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 6);
	for (const w of words) conds.push(matches(w, actor?.userId ?? null));
	return conds.length ? and(...conds) : undefined;
}

/**
 * What anyone may see of a tool call, whoever's it is: a built-in tool's plain name, an app's tool title (made from
 * the app and tool alone, never the call), or a subscription agent's own tool by kind.
 */
/**
 * The tool's name as others may see it: a built-in tool Sekai knows, an app's tool, or a known kind of an outside
 * agent's tool; anything else (a name a model or an agent made up, which could carry what the chat said) is hidden.
 */
export function safeToolName(row: { tool: string; source: string }): string {
	if (row.source === "mcp") return row.tool;
	if (row.source === "external") return claudeToolKind(row.tool) === "other" ? "external" : row.tool;
	return Object.hasOwn(TOOL_LABELS, row.tool) ? row.tool : "unknown";
}

export function plainTitle(row: { tool: string; title: string; source: string }): string {
	if (row.source === "mcp") return row.title;
	if (row.source === "external")
		return claudeToolKind(row.tool) === "other" ? "Used one of its own tools" : claudeToolTitle(row.tool, {});
	return toolLabel(row.tool);
}

type ActivityRow = typeof schema.activityLog.$inferSelect;

async function hydrateEntries(rows: ActivityRow[], knownAgentNames?: Map<string, string>): Promise<ActivityEntry[]> {
	if (rows.length === 0) return [];
	const actor = currentActor();
	const agentIds = [...new Set(rows.map((r) => r.agentId).filter((id): id is string => Boolean(id)))];
	const missingAgentIds = knownAgentNames ? agentIds.filter((id) => !knownAgentNames.has(id)) : agentIds;
	const agentNames = new Map(knownAgentNames);
	if (missingAgentIds.length > 0) {
		const found = await db
			.select({ id: schema.agents.id, name: schema.agents.name })
			.from(schema.agents)
			.where(inArray(schema.agents.id, missingAgentIds));
		for (const a of found) agentNames.set(a.id, a.name);
	}

	const userIds = [...new Set(rows.map((r) => r.userId).filter((id): id is string => Boolean(id)))];
	const userNames = new Map<string, string>();
	if (userIds.length > 0) {
		const found = await db
			.select({ id: schema.users.id, name: schema.users.name })
			.from(schema.users)
			.where(inArray(schema.users.id, userIds));
		for (const u of found) userNames.set(u.id, u.name);
	}

	return rows.map((row) => {
		const { runId: _run, toolCallId: _call, ...rest } = row;
		const names = {
			userName: row.userId ? (userNames.get(row.userId) ?? "Someone who left") : null,
			agentName: row.agentId ? (agentNames.get(row.agentId) ?? "A deleted bot") : "Sekai",
		};
		if (!actor || row.userId === actor.userId) return { ...rest, ...names };
		// Someone else's (or one whose owner is gone), for an admin: what happened, never what it carried (its
		// arguments, result, error, the decision's note, a title made from them) nor a way into their chat.
		return {
			...rest,
			...names,
			tool: safeToolName(row),
			title: plainTitle(row),
			args: {},
			result: null,
			error: null,
			note: null,
			conversationId: null,
			messageId: null,
			private: true,
		};
	});
}

/** Newest first, filtered; `before` pages back. */
export async function listActivity(q: ActivityQuery): Promise<ActivityEntry[]> {
	const rows = await db
		.select()
		.from(schema.activityLog)
		.where(where(q))
		.orderBy(desc(schema.activityLog.at))
		.limit(Math.min(Math.max(q.limit ?? 50, 1), 200));
	return hydrateEntries(rows);
}

const CSV_COLUMNS = [
	"at",
	"person",
	"bot",
	"tool",
	"title",
	"risk",
	"status",
	"decision",
	"decidedBy",
	"note",
	"args",
	"result",
	"error",
	"durationMs",
	"conversationId",
	"messageId",
] as const;

/** The filtered log (up to 50,000 entries) as CSV or JSON lines, with bots by name and times in ISO 8601. */
export async function exportActivity(q: ActivityQuery, format: "csv" | "jsonl", names?: Map<string, string>) {
	const rows = await db
		.select()
		.from(schema.activityLog)
		.where(where({ ...q, before: undefined }))
		.orderBy(desc(schema.activityLog.at))
		.limit(50_000);
	const entries = await hydrateEntries(rows, names);
	const records = entries.map((e) => ({
		...e,
		at: new Date(e.at).toISOString(),
		person: e.userName ?? "",
		bot: e.agentId ? (e.agentName ?? "A deleted bot") : "",
	}));
	if (format === "jsonl") return records.map((r) => JSON.stringify(r)).join("\n") + (records.length ? "\n" : "");
	return [
		CSV_COLUMNS.join(","),
		...records.map((r) => CSV_COLUMNS.map((c) => csvCell(r[c as keyof typeof r])).join(",")),
	].join("\r\n");
}

/** What bots did since a time, for the daily digest: counts by bot and outcome, and what failed or was denied. */
export async function activitySince(since: number) {
	const rows = await db
		.select()
		.from(schema.activityLog)
		.where(and(sql`${schema.activityLog.at} >= ${since}`, ownWhere(schema.activityLog.userId)))
		.orderBy(desc(schema.activityLog.at));
	return hydrateEntries(rows);
}
