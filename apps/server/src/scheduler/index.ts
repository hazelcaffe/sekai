import { runAsUser } from "../auth/actor.ts";
import { errorMessage } from "../lib/errors.ts";
import { log } from "../lib/log.ts";
import {
	dueRoutines,
	earliestNextRun,
	listRoutines,
	markRoutineFired,
	setRoutineChangeHook,
} from "../services/routines.ts";
import { effectiveTimezone } from "../services/settings.ts";
import { dispatchRoutine } from "./runner.ts";
import { computeNextRun } from "./schedule.ts";

/**
 * A single timer that sleeps until the next due routine (re-checking at least every 30s). Schedules are
 * persisted, so restarts don't lose them; runs missed while the server was down are caught up once, if
 * they're less than CATCH_UP_MS late.
 */

const MAX_SLEEP_MS = 30_000;
const CATCH_UP_MS = 12 * 3_600_000;

let timer: ReturnType<typeof setTimeout> | null = null;
let ticking = false;
let stopped = true;

async function tick(): Promise<void> {
	if (ticking || stopped) return;
	ticking = true;
	try {
		const now = Date.now();
		for (const routine of await dueRoutines(now)) {
			// "auto" is the owner's time zone.
			const tz = await runAsUser(routine.userId, () => effectiveTimezone(routine.timezone)).catch(() =>
				effectiveTimezone(routine.timezone),
			);
			const late = now - (routine.nextRunAt ?? now);
			const next =
				routine.schedule.type === "once" ? null : computeNextRun(routine.schedule, tz, now + 1000, now);
			const fired = await markRoutineFired(routine, next);
			if (late > CATCH_UP_MS) {
				log.info(`routine "${routine.name}" skipped a run missed by ${Math.round(late / 60_000)} min`);
				continue;
			}
			log.info(`routine "${routine.name}" firing`);
			void dispatchRoutine(fired).catch((err: unknown) =>
				log.error(`routine dispatch failed: ${errorMessage(err)}`),
			);
		}
	} catch (err) {
		log.error(`scheduler tick failed: ${errorMessage(err)}`);
	} finally {
		ticking = false;
		await schedule();
	}
}

async function schedule(): Promise<void> {
	if (stopped) return;
	if (timer) clearTimeout(timer);
	let delay = MAX_SLEEP_MS;
	try {
		const next = await earliestNextRun();
		if (next !== null) delay = Math.max(250, Math.min(MAX_SLEEP_MS, next - Date.now()));
	} catch {
		// Database hiccup: retry on the default cadence.
	}
	timer = setTimeout(() => void tick(), delay);
}

export async function startScheduler(): Promise<void> {
	stopped = false;
	setRoutineChangeHook(() => {
		if (!stopped) void schedule();
	});
	const routines = await listRoutines();
	log.info(`scheduler started (${routines.filter((r) => r.enabled).length} active routines)`);
	await tick();
}

export function stopScheduler(): void {
	stopped = true;
	if (timer) clearTimeout(timer);
	timer = null;
}
