import type { ActivityEntry, ActivityQuery, Message, ToolPart } from "@sekai/shared";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import { currentActor } from "../auth/actor.ts";
import { db, schema } from "../db/index.ts";
import { conversationOwner } from "../events/scope.ts";
import { errorMessage } from "../lib/errors.ts";
import { newId } from "../lib/ids.ts";
import { log } from "../lib/log.ts";
import { csvCell } from "../lib/text.ts";
import { ownWhere } from "./visibility.ts";

const TERMINAL = new Set(["done", "error", "denied"]);

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

function where(q: ActivityQuery) {
	const t = schema.activityLog;
	const conds = [];
	// Your own bots' activity (in your chats).
	const me = currentActor()?.userId;
	if (me) conds.push(eq(t.userId, me));
	if (q.agentId) conds.push(eq(t.agentId, q.agentId));
	if (q.status) conds.push(eq(t.status, q.status));
	if (q.risk) conds.push(eq(t.risk, q.risk));
	if (q.decidedBy) conds.push(eq(t.decidedBy, q.decidedBy));
	if (q.before) conds.push(lt(t.at, q.before));
	const words = (q.q ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 6);
	for (const w of words) {
		const like = `%${w.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
		conds.push(
			sql`(${t.title} ilike ${like} or ${t.tool} ilike ${like} or ${t.args}::text ilike ${like} or coalesce(${t.result}, '') ilike ${like} or coalesce(${t.error}, '') ilike ${like})`,
		);
	}
	return conds.length ? and(...conds) : undefined;
}

function toEntry(row: typeof schema.activityLog.$inferSelect): ActivityEntry {
	const { runId: _run, toolCallId: _call, userId: _user, ...rest } = row;
	return rest;
}

/** Newest first, filtered; `before` pages back. */
export async function listActivity(q: ActivityQuery): Promise<ActivityEntry[]> {
	const rows = await db
		.select()
		.from(schema.activityLog)
		.where(where(q))
		.orderBy(desc(schema.activityLog.at))
		.limit(Math.min(Math.max(q.limit ?? 50, 1), 200));
	return rows.map(toEntry);
}

const CSV_COLUMNS = [
	"at",
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
export async function exportActivity(q: ActivityQuery, format: "csv" | "jsonl", names: Map<string, string>) {
	const rows = await db
		.select()
		.from(schema.activityLog)
		.where(where({ ...q, before: undefined }))
		.orderBy(desc(schema.activityLog.at))
		.limit(50_000);
	const records = rows.map((r) => ({
		...toEntry(r),
		at: new Date(r.at).toISOString(),
		bot: r.agentId ? (names.get(r.agentId) ?? "A deleted bot") : "",
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
	return rows.map(toEntry);
}
