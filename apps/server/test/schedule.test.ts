import { describe, expect, test } from "bun:test";
import { isoInZone, parseWhen } from "../src/lib/time.ts";
import { computeNextRun, describeSchedule, previewSchedule, validateSchedule } from "../src/scheduler/schedule.ts";

const NY = "America/New_York";
// Saturday 2026-11-14 12:00:00 in New York (UTC-5).
const NOON = Date.parse("2026-11-14T17:00:00Z");

describe("cron schedules", () => {
	test("next weekday 08:00 in the routine's zone", () => {
		const next = computeNextRun({ type: "cron", expr: "0 8 * * 1-5" }, NY, NOON);
		expect(next).not.toBeNull();
		expect(isoInZone(next ?? 0, NY)).toBe("2026-11-16T08:00:00-05:00");
	});

	test("rejects runs closer than a minute apart", () => {
		expect(validateSchedule({ type: "cron", expr: "*/10 * * * * *" }, NY, NOON)).toContain("minute");
	});

	test("rejects garbage", () => {
		expect(validateSchedule({ type: "cron", expr: "every day" }, NY, NOON)).toContain("Invalid");
	});

	test("describes in words", () => {
		expect(describeSchedule({ type: "cron", expr: "30 7 * * 1-5" }, NY)).toBe("At 07:30 AM, Monday through Friday");
	});
});

describe("interval schedules", () => {
	test("first run is one interval out", () => {
		expect(computeNextRun({ type: "interval", minutes: 30 }, NY, NOON)).toBe(NOON + 30 * 60_000);
	});

	test("stays anchored to the last run instead of drifting", () => {
		const last = NOON - 10 * 60_000;
		expect(computeNextRun({ type: "interval", minutes: 30 }, NY, NOON, last)).toBe(last + 30 * 60_000);
	});

	test("skips missed slots after downtime", () => {
		const last = NOON - 95 * 60_000;
		expect(computeNextRun({ type: "interval", minutes: 30 }, NY, NOON, last)).toBe(last + 120 * 60_000);
	});

	test("describes hours and days", () => {
		expect(describeSchedule({ type: "interval", minutes: 120 }, NY)).toBe("Every 2 hours");
		expect(describeSchedule({ type: "interval", minutes: 1440 }, NY)).toBe("Every day");
	});
});

describe("one-off schedules", () => {
	test("future time runs once", () => {
		const at = NOON + 3_600_000;
		const p = previewSchedule({ type: "once", at }, NY, 5, NOON);
		expect(p.valid).toBe(true);
		expect(p.nextRuns).toEqual([at]);
	});

	test("past time is invalid", () => {
		expect(validateSchedule({ type: "once", at: NOON - 3_600_000 }, NY, NOON)).toContain("past");
	});
});

describe("parseWhen", () => {
	test("relative phrases", () => {
		expect(parseWhen("in 20 minutes", NY, NOON)).toBe(NOON + 20 * 60_000);
		expect(parseWhen("in 2 hours", NY, NOON)).toBe(NOON + 2 * 3_600_000);
		expect(parseWhen("in 1 day", NY, NOON)).toBe(NOON + 86_400_000);
	});

	test("ISO with offset is absolute", () => {
		expect(parseWhen("2026-11-14T18:30:00Z", NY)).toBe(Date.parse("2026-11-14T18:30:00Z"));
	});

	test("ISO without offset is wall time in the zone", () => {
		expect(parseWhen("2026-11-14T17:00", NY)).toBe(Date.parse("2026-11-14T22:00:00Z"));
	});

	test("handles DST boundaries", () => {
		// July is UTC-4 in New York.
		expect(parseWhen("2026-07-01T09:00", NY)).toBe(Date.parse("2026-07-01T13:00:00Z"));
	});

	test("unreadable input", () => {
		expect(parseWhen("tomorrowish", NY)).toBeNull();
	});
});
