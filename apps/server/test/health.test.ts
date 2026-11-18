import { describe, expect, test } from "bun:test";
import { diskIssue } from "../src/services/health.ts";

const GB = 1024 ** 3;

describe("health", () => {
	test("disk space: fine, low, almost full", () => {
		expect(diskIssue(200 * GB, 1000 * GB)).toBeNull();
		expect(diskIssue(80 * GB, 1000 * GB)).toBe("warning"); // under 10%
		expect(diskIssue(4 * GB, 20 * GB)).toBe("warning"); // under 5 GB
		expect(diskIssue(20 * GB, 1000 * GB)).toBe("danger"); // under 3%
		expect(diskIssue(0.5 * GB, 8 * GB)).toBe("danger"); // under 1 GB
		expect(diskIssue(0, 0)).toBeNull();
	});
});
