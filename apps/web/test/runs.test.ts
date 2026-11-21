import { expect, test } from "bun:test";
import { doneTitle } from "../src/components/activity/RunRow.tsx";

test("a finished reply says which chat it was for", () => {
	const run = { status: "done", trigger: "user", title: "Nori replying" } as const;
	expect(doneTitle(run, "Field Notes")).toBe("Replied in “Field Notes”");
	// Still going, a routine, or a chat that isn't yours to see: its own title.
	expect(doneTitle({ ...run, status: "running" }, "Field Notes")).toBe("Nori replying");
	expect(doneTitle({ ...run, trigger: "routine", title: "Routine: Friday roundup" }, "x")).toBe(
		"Routine: Friday roundup",
	);
	expect(doneTitle(run, undefined)).toBe("Nori replying");
});
