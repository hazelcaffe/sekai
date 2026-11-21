import { describe, expect, test } from "bun:test";
import { TOOL_LABELS, toolLabel, toolOutcome } from "@sekai/shared";
import { BUILTIN_TOOLS } from "../src/agent/tools/index.ts";
import { plainTitle } from "../src/services/activity.ts";

describe("tools in plain words", () => {
	test("every built-in tool has a plain name, and only those do", () => {
		const names = BUILTIN_TOOLS.map((t) => t.name).sort();
		expect(Object.keys(TOOL_LABELS).sort()).toEqual(names);
	});

	test("every plain name can say it failed or was denied", () => {
		for (const label of Object.values(TOOL_LABELS)) {
			expect(toolOutcome(label, "error")).toStartWith("Couldn't ");
			expect(toolOutcome(label, "denied")).toEndWith(" was denied");
		}
	});

	test("a call's line says how it ended", () => {
		const note = BUILTIN_TOOLS.find((t) => t.name === "note_write");
		const title = note?.title({ title: "Printer handoff", content: "x" } as never) ?? "";
		expect(title).toBe("Wrote note “Printer handoff”");
		expect(toolOutcome(title, "done")).toBe(title);
		expect(toolOutcome(title, "error")).toBe("Couldn't write note “Printer handoff”");
		expect(toolOutcome(title, "denied")).toBe("Writing note “Printer handoff” was denied");
		expect(toolOutcome("Saved to memory", "error")).toBe("Couldn't save to memory");
		expect(toolOutcome("Ran `ls -la`", "denied")).toBe("Running `ls -la` was denied");
		expect(toolOutcome("Went back", "error")).toBe("Couldn't go back");
		expect(toolOutcome("Signed in", "denied")).toBe("Signing in was denied");
		// Titles without a known verb (an app's tool) still say it.
		expect(toolOutcome("Trail catalog: Search trails", "error")).toBe("Didn't work: Trail catalog: Search trails");
		expect(toolOutcome("Trail catalog: Search trails", "denied")).toBe("Denied: Trail catalog: Search trails");
	});

	test("names that aren't tools never break a line", () => {
		// Models and outside agents can call a tool anything, including what an object already has.
		for (const name of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
			expect(toolLabel(name)).toBe("Used a tool");
			expect(toolOutcome(`${name} something`, "error")).toBe(`Didn't work: ${name} something`);
			expect(toolOutcome(name, "denied")).toBe(`Denied: ${name}`);
		}
	});

	test("someone else's entry shows only what anyone may see", () => {
		expect(plainTitle({ tool: "note_write", title: "Wrote note “Diary”", source: "builtin" })).toBe("Wrote a note");
		expect(plainTitle({ tool: "gone_tool", title: "Did a private thing", source: "builtin" })).toBe("Used a tool");
		expect(toolLabel("run_command")).toBe("Ran a command");
		// An app's tool title is made from the app and tool alone.
		expect(plainTitle({ tool: "mcp__trail__search", title: "Trail catalog: Search trails", source: "mcp" })).toBe(
			"Trail catalog: Search trails",
		);
		expect(plainTitle({ tool: "Bash", title: "Ran `cat ~/diary.txt`", source: "external" })).toBe("Ran a command");
		expect(plainTitle({ tool: "external_other", title: "Something private", source: "external" })).toBe(
			"Used one of its own tools",
		);
	});
});
