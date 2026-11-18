import type { Run, RunStatus } from "@sekai/shared";
import { and, desc, eq, inArray, type SQL } from "drizzle-orm";
import { db, schema } from "../db/index.ts";
import { bus } from "../events/bus.ts";
import { ID } from "../lib/ids.ts";
import { ownWhere } from "./visibility.ts";

export async function createRun(
	input: Omit<
		Run,
		"id" | "createdAt" | "startedAt" | "finishedAt" | "steps" | "usage" | "error" | "messageId" | "status" | "model"
	> & { model?: string | null },
): Promise<Run> {
	const run: Run = {
		id: ID.run(),
		messageId: null,
		status: "queued",
		steps: 0,
		usage: null,
		error: null,
		startedAt: null,
		finishedAt: null,
		createdAt: Date.now(),
		...input,
		model: input.model ?? null,
	};
	await db.insert(schema.runs).values(run);
	bus.emit({ type: "run.updated", run });
	return run;
}

export async function updateRun(id: string, patch: Partial<Omit<Run, "id">>): Promise<Run | null> {
	await db.update(schema.runs).set(patch).where(eq(schema.runs.id, id));
	const run = await getRun(id);
	if (run) bus.emit({ type: "run.updated", run });
	return run;
}

export async function getRun(id: string): Promise<Run | null> {
	return (await db.query.runs.findFirst({ where: eq(schema.runs.id, id) })) ?? null;
}

/** Runs in the acting person's chats (everyone's for Sekai itself). */
export async function listRuns(
	filter: { agentId?: string; conversationId?: string; status?: RunStatus[]; limit?: number } = {},
): Promise<Run[]> {
	const where: SQL[] = [];
	const own = ownWhere(schema.runs.userId);
	if (own) where.push(own);
	if (filter.agentId) where.push(eq(schema.runs.agentId, filter.agentId));
	if (filter.conversationId) where.push(eq(schema.runs.conversationId, filter.conversationId));
	if (filter.status?.length) where.push(inArray(schema.runs.status, filter.status));
	return db
		.select()
		.from(schema.runs)
		.where(and(...where))
		.orderBy(desc(schema.runs.createdAt))
		.limit(filter.limit ?? 100);
}

/** Runs left active by a crash or restart can't resume; mark them as interrupted. */
export async function failActiveRuns(): Promise<number> {
	const rows = await db
		.update(schema.runs)
		.set({ status: "error", error: "Interrupted: the server restarted", finishedAt: Date.now() })
		.where(inArray(schema.runs.status, ["queued", "running", "awaiting_approval"]))
		.returning({ id: schema.runs.id });
	return rows.length;
}
