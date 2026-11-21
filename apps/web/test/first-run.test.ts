import { describe, expect, test } from "bun:test";
import { firstRunTarget } from "../src/lib/first-run.ts";

describe("first run", () => {
	test("people who may make bots get the welcome until they have one or skip it", () => {
		expect(firstRunTarget({ bots: 0, canMakeBots: true, skipped: false })).toBe("welcome");
		expect(firstRunTarget({ bots: 0, canMakeBots: true, skipped: true })).toBe("app");
		expect(firstRunTarget({ bots: 1, canMakeBots: true, skipped: false })).toBe("app");
	});

	test("people who can't make bots always land in the app, where shared bots show up", () => {
		expect(firstRunTarget({ bots: 0, canMakeBots: false, skipped: false })).toBe("app");
		expect(firstRunTarget({ bots: 2, canMakeBots: false, skipped: false })).toBe("app");
	});
});
