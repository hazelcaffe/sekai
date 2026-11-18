import { describe, expect, test } from "bun:test";
import { settleChanges } from "../src/scheduler/events.ts";
import { describeEvent } from "../src/scheduler/schedule.ts";

describe("device events", () => {
	test("a change counts once it has held for two checks; blips and the first look don't", () => {
		const settled = new Map<string, boolean>();
		const seen = new Map<string, boolean>();
		const at = (online: boolean) => [{ id: "nas", online }];
		expect(settleChanges(at(true), settled, seen)).toEqual([]); // first look
		expect(settleChanges(at(false), settled, seen)).toEqual([]); // seen once
		expect(settleChanges(at(true), settled, seen)).toEqual([]); // a blip: back to normal
		expect(settleChanges(at(false), settled, seen)).toEqual([]);
		expect(settleChanges(at(false), settled, seen)).toEqual([{ id: "nas", online: false }]); // held: offline
		expect(settleChanges(at(false), settled, seen)).toEqual([]); // no repeat
		expect(settleChanges(at(true), settled, seen)).toEqual([]);
		expect(settleChanges(at(true), settled, seen)).toEqual([{ id: "nas", online: true }]); // back
	});

	test("describes what starts a routine", () => {
		expect(describeEvent({ kind: "webhook" })).toBe("When its webhook is called");
		expect(describeEvent({ kind: "device", deviceId: "d1", deviceName: "yuri", change: "offline" })).toBe(
			"When yuri goes offline",
		);
		expect(describeEvent({ kind: "device", deviceId: null, deviceName: "", change: "any" })).toBe(
			"When a device bots can use goes offline or comes back",
		);
	});
});
