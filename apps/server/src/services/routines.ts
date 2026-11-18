import {
	type Routine,
	RoutineCreate,
	type RoutineCreate as RoutineCreateInput,
	type RoutineRun,
	RoutineUpdate,
	type RoutineUpdate as RoutineUpdateInput,
	type Schedule,
} from "@sekai/shared";
import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import { requirePermission } from "../auth/actor.ts";
import { db, schema } from "../db/index.ts";
import { bus } from "../events/bus.ts";
import { badRequest, notFound, parse } from "../lib/errors.ts";
import { ID, newId } from "../lib/ids.ts";
import { computeNextRun, validateSchedule } from "../scheduler/schedule.ts";
import { requireAgent } from "./agents.ts";
import { effectiveTimezone } from "./settings.ts";
import { isMine, newOwner, ownWhere } from "./visibility.ts";

export const MAX_ROUTINES_PER_AGENT = 50;
const RUN_HISTORY = 20;

/** Set by the scheduler so changes are picked up immediately instead of on the next tick. */
let onChange: () => void = () => {};
export function setRoutineChangeHook(fn: () => void): void {
	onChange = fn;
}

function emit(routineId: string, routine: Routine | null, userId?: string): void {
	const to = routine?.userId ?? userId;
	bus.emit({ type: "routine.changed", routineId, routine }, to ? { to: [to] } : {});
	onChange();
}

/** The acting person's routines (everyone's for Sekai itself). */
export async function listRoutines(filter: { agentId?: string } = {}): Promise<Routine[]> {
	return db
		.select()
		.from(schema.routines)
		.where(
			and(
				filter.agentId ? eq(schema.routines.agentId, filter.agentId) : undefined,
				ownWhere(schema.routines.userId),
			),
		)
		.orderBy(sql`${schema.routines.nextRunAt} asc nulls last`, asc(schema.routines.createdAt));
}

export async function getRoutine(id: string): Promise<Routine | null> {
	const row = await db.query.routines.findFirst({ where: eq(schema.routines.id, id) });
	return row && isMine(row.userId) ? row : null;
}

export async function requireRoutine(id: string): Promise<Routine> {
	const r = await getRoutine(id);
	if (!r) throw notFound("Routine");
	return r;
}

/** A webhook routine gets its own unguessable token (kept when the routine is edited). */
function withHookToken(schedule: Schedule, current?: Schedule): Schedule {
	if (schedule.type !== "event" || schedule.event.kind !== "webhook" || schedule.event.token) return schedule;
	const kept = current?.type === "event" && current.event.kind === "webhook" ? current.event.token : undefined;
	return { type: "event", event: { kind: "webhook", token: kept ?? newId("hook", 28) } };
}

/** The routine a webhook token belongs to. */
export async function routineForHook(token: string): Promise<Routine | null> {
	if (!/^hook_[A-Za-z0-9]{28}$/.test(token)) return null;
	const rows = await db
		.select()
		.from(schema.routines)
		.where(sql`${schema.routines.schedule}->'event'->>'token' = ${token}`);
	return (rows[0] as Routine | undefined) ?? null;
}

export async function createRoutine(input: RoutineCreateInput, createdBy: Routine["createdBy"] = "user") {
	const parsed = parse(RoutineCreate, input);
	const data = { ...parsed, schedule: withHookToken(parsed.schedule) };
	requirePermission("routines");
	const agent = await requireAgent(data.agentId);
	const userId = newOwner(agent.userId);
	if (data.conversationId) {
		const { requireConversation } = await import("./conversations.ts");
		await requireConversation(data.conversationId);
	}
	const [row] = await db
		.select({ n: count() })
		.from(schema.routines)
		.where(and(eq(schema.routines.agentId, data.agentId), eq(schema.routines.userId, userId)));
	if ((row?.n ?? 0) >= MAX_ROUTINES_PER_AGENT) {
		throw badRequest(`An agent can own at most ${MAX_ROUTINES_PER_AGENT} routines`);
	}
	const tz = await effectiveTimezone(data.timezone);
	const error = validateSchedule(data.schedule, tz);
	if (error) throw badRequest(error);
	const now = Date.now();
	const routine: Routine = {
		id: ID.routine(),
		userId,
		...data,
		createdBy,
		lastRunAt: null,
		lastStatus: null,
		nextRunAt: data.enabled ? computeNextRun(data.schedule, tz, now) : null,
		runCount: 0,
		createdAt: now,
		updatedAt: now,
	};
	await db.insert(schema.routines).values(routine);
	emit(routine.id, routine);
	return routine;
}

export async function updateRoutine(id: string, input: RoutineUpdateInput): Promise<Routine> {
	const parsed = parse(RoutineUpdate, input);
	const current = await requireRoutine(id);
	if (parsed.conversationId) {
		const { requireConversation } = await import("./conversations.ts");
		await requireConversation(parsed.conversationId);
	}
	const patch = parsed.schedule ? { ...parsed, schedule: withHookToken(parsed.schedule, current.schedule) } : parsed;
	const next = { ...current, ...patch };
	const tz = await effectiveTimezone(next.timezone);
	if (patch.schedule || patch.timezone) {
		const error = validateSchedule(next.schedule, tz);
		if (error) throw badRequest(error);
	}
	const nextRunAt = next.enabled ? computeNextRun(next.schedule, tz, Date.now(), current.lastRunAt) : null;
	await db
		.update(schema.routines)
		.set({ ...patch, nextRunAt, updatedAt: Date.now() })
		.where(eq(schema.routines.id, id));
	const routine = await requireRoutine(id);
	emit(id, routine);
	return routine;
}

export async function deleteRoutine(id: string): Promise<void> {
	const r = await requireRoutine(id);
	await db.delete(schema.routines).where(eq(schema.routines.id, id));
	emit(id, null, r.userId);
}

/** Scheduler bookkeeping: advance the schedule before running so a crash can't cause a double fire. */
export async function markRoutineFired(routine: Routine, nextRunAt: number | null): Promise<Routine> {
	const now = Date.now();
	await db
		.update(schema.routines)
		.set({
			lastRunAt: now,
			lastStatus: "running",
			nextRunAt,
			enabled: routine.schedule.type === "once" ? false : routine.enabled,
			runCount: sql`${schema.routines.runCount} + 1`,
			updatedAt: now,
		})
		.where(eq(schema.routines.id, routine.id));
	const updated = await loadRoutine(routine.id);
	if (!updated) throw notFound("Routine");
	emit(routine.id, updated);
	return updated;
}

export async function startRoutineRun(routineId: string, conversationId: string | null): Promise<RoutineRun> {
	const run: RoutineRun = {
		id: ID.routineRun(),
		routineId,
		conversationId,
		messageId: null,
		status: "running",
		error: null,
		startedAt: Date.now(),
		finishedAt: null,
	};
	await db.insert(schema.routineRuns).values(run);
	return run;
}

export async function finishRoutineRun(
	run: RoutineRun,
	result: { status: "succeeded" | "failed"; error?: string | null; messageId?: string | null },
): Promise<void> {
	await db
		.update(schema.routineRuns)
		.set({
			status: result.status,
			error: result.error ?? null,
			messageId: result.messageId ?? null,
			finishedAt: Date.now(),
		})
		.where(eq(schema.routineRuns.id, run.id));
	await db
		.update(schema.routines)
		.set({ lastStatus: result.status, updatedAt: Date.now() })
		.where(eq(schema.routines.id, run.routineId));
	// Keep only the most recent runs per routine.
	const old = await db
		.select({ id: schema.routineRuns.id })
		.from(schema.routineRuns)
		.where(eq(schema.routineRuns.routineId, run.routineId))
		.orderBy(desc(schema.routineRuns.startedAt))
		.offset(RUN_HISTORY);
	for (const o of old) await db.delete(schema.routineRuns).where(eq(schema.routineRuns.id, o.id));
	const routine = await loadRoutine(run.routineId);
	if (routine) emit(routine.id, routine);
}

/** A routine whoever's it is (the scheduler's bookkeeping). */
export async function loadRoutine(id: string): Promise<Routine | null> {
	return (await db.query.routines.findFirst({ where: eq(schema.routines.id, id) })) ?? null;
}

export async function listRoutineRuns(routineId: string): Promise<RoutineRun[]> {
	return db
		.select()
		.from(schema.routineRuns)
		.where(eq(schema.routineRuns.routineId, routineId))
		.orderBy(desc(schema.routineRuns.startedAt))
		.limit(RUN_HISTORY);
}

export async function dueRoutines(now = Date.now()): Promise<Routine[]> {
	return db
		.select()
		.from(schema.routines)
		.where(and(eq(schema.routines.enabled, true), sql`${schema.routines.nextRunAt} <= ${now}`))
		.orderBy(asc(schema.routines.nextRunAt));
}

export async function earliestNextRun(): Promise<number | null> {
	const [row] = await db
		.select({ next: sql<number | null>`min(${schema.routines.nextRunAt})` })
		.from(schema.routines)
		.where(eq(schema.routines.enabled, true));
	return row?.next === null || row?.next === undefined ? null : Number(row.next);
}
