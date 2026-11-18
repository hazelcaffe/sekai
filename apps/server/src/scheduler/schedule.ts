import type { RoutineEvent, Schedule, SchedulePreview } from "@sekai/shared";
import { Cron } from "croner";
import cronstrue from "cronstrue";
import { formatShort } from "../lib/time.ts";

/** Runs closer together than this are rejected so a typo can't burn through the gateway quota. */
export const MIN_GAP_MS = 60_000;

function cron(expr: string, timezone: string): Cron {
	return new Cron(expr.trim(), { timezone, mode: "5-or-6-parts", paused: true });
}

/** Returns an error message, or null when the schedule is usable. */
export function validateSchedule(schedule: Schedule, timezone: string, now = Date.now()): string | null {
	switch (schedule.type) {
		case "cron": {
			try {
				const runs = cron(schedule.expr, timezone).nextRuns(3, new Date(now));
				if (runs.length === 0) return "This cron expression never runs";
				for (let i = 1; i < runs.length; i++) {
					const a = runs[i - 1];
					const b = runs[i];
					if (a && b && b.getTime() - a.getTime() < MIN_GAP_MS) return "Runs must be at least a minute apart";
				}
				return null;
			} catch (err) {
				return `Invalid cron expression: ${err instanceof Error ? err.message : String(err)}`;
			}
		}
		case "interval":
			return schedule.minutes >= 1 ? null : "Interval must be at least 1 minute";
		case "once":
			return schedule.at > now - 60_000 ? null : "That time is in the past";
		case "event":
			return null;
	}
}

/**
 * Next fire time strictly after `from`.
 * Intervals are anchored to the last run so they don't drift, or to `from` for a fresh routine.
 */
export function computeNextRun(
	schedule: Schedule,
	timezone: string,
	from = Date.now(),
	lastRunAt: number | null = null,
): number | null {
	switch (schedule.type) {
		case "cron":
			try {
				return cron(schedule.expr, timezone).nextRun(new Date(from))?.getTime() ?? null;
			} catch {
				return null;
			}
		case "interval": {
			const step = schedule.minutes * 60_000;
			let next = (lastRunAt ?? from) + step;
			if (next <= from) next = from + step - ((from - (lastRunAt ?? from)) % step);
			return next;
		}
		case "once":
			return schedule.at > from - 60_000 ? schedule.at : null;
		// Event routines run when their event happens, never on the clock.
		case "event":
			return null;
	}
}

export function describeSchedule(schedule: Schedule, timezone: string): string {
	switch (schedule.type) {
		case "cron":
			try {
				return cronstrue.toString(schedule.expr, { verbose: false, use24HourTimeFormat: false });
			} catch {
				return schedule.expr;
			}
		case "interval": {
			const m = schedule.minutes;
			if (m % 1440 === 0) return m === 1440 ? "Every day" : `Every ${m / 1440} days`;
			if (m % 60 === 0) return m === 60 ? "Every hour" : `Every ${m / 60} hours`;
			return m === 1 ? "Every minute" : `Every ${m} minutes`;
		}
		case "once":
			return `Once, ${formatShort(schedule.at, timezone)}`;
		case "event":
			return describeEvent(schedule.event);
	}
}

export function describeEvent(e: RoutineEvent): string {
	if (e.kind === "webhook") return "When its webhook is called";
	const who = e.deviceId ? e.deviceName || "the device" : "a device bots can use";
	return e.change === "offline"
		? `When ${who} goes offline`
		: e.change === "online"
			? `When ${who} comes back online`
			: `When ${who} goes offline or comes back`;
}

export function previewSchedule(schedule: Schedule, timezone: string, count = 5, now = Date.now()): SchedulePreview {
	const error = validateSchedule(schedule, timezone, now);
	const nextRuns: number[] = [];
	if (!error) {
		let from = now;
		let last: number | null = null;
		for (let i = 0; i < count; i++) {
			const next = computeNextRun(schedule, timezone, from, last);
			if (next === null) break;
			nextRuns.push(next);
			if (schedule.type === "once") break;
			from = next;
			last = next;
		}
	}
	return { valid: !error, error, description: describeSchedule(schedule, timezone), nextRuns };
}
