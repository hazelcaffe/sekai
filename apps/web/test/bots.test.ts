import { describe, expect, test } from "bun:test";
import { accountsView, memoryView } from "../src/bots/paths.ts";
import { botPath, botSectionsFor } from "../src/bots/registry.tsx";
import { handlesText, parseHandles } from "../src/components/agent/handles.ts";
import { snippet } from "../src/components/agent/noteText.ts";
import { parentOf } from "../src/lib/back.ts";

describe("a bot's Accounts addresses", () => {
	test("the list, a platform, connecting, and one account", () => {
		expect(accountsView("")).toEqual({ view: "home" });
		expect(accountsView("discord")).toEqual({ view: "platform", platform: "discord" });
		expect(accountsView("slack/new")).toEqual({ view: "connect", platform: "slack" });
		expect(accountsView("discord/chn_abc")).toEqual({ view: "account", platform: "discord", id: "chn_abc" });
		for (const p of ["x", "instagram", "tiktok"] as const)
			expect(accountsView(p)).toEqual({ view: "social", platform: p });
	});

	test("the older addresses open Discord, and nonsense opens the list", () => {
		expect(accountsView("channels")).toEqual({ view: "platform", platform: "discord" });
		expect(accountsView("discord-user")).toEqual({ view: "platform", platform: "discord" });
		expect(accountsView("myspace")).toEqual({ view: "home" });
	});
});

describe("a bot's Memory addresses", () => {
	test("memories by default, then notes, a note, and code", () => {
		expect(memoryView("", true)).toEqual({ tab: "memories" });
		expect(memoryView("notes", true)).toEqual({ tab: "notes" });
		expect(memoryView("notes/note_1", true)).toEqual({ tab: "note", id: "note_1" });
		expect(memoryView("notes/new", false)).toEqual({ tab: "note", id: "new" });
		expect(memoryView("code", true)).toEqual({ tab: "code" });
	});

	test("code is only there where the role has it", () => {
		expect(memoryView("code", false)).toEqual({ tab: "memories" });
	});

	test("back goes up one page, and a note's back is the notes", () => {
		expect(parentOf(botPath("agt_1", "memory", "notes/note_1"))).toBe("/bots/agt_1/memory/notes");
		expect(parentOf(botPath("agt_1", "accounts", "discord/chn_1"))).toBe("/bots/agt_1/accounts/discord");
	});
});

describe("who sees which sections of a bot", () => {
	test("its owner sees all seven, someone it's shared with sees Profile, Memory and Routines", () => {
		expect(botSectionsFor({ sharedBy: null }).map((s) => s.id)).toEqual([
			"profile",
			"model",
			"memory",
			"tools",
			"accounts",
			"routines",
			"computer",
		]);
		expect(botSectionsFor({ sharedBy: "Hazel" }).map((s) => s.id)).toEqual(["profile", "memory", "routines"]);
	});
});

describe("small helpers", () => {
	test("a note's snippet drops Markdown marks and its own title, and keeps hyphens inside words", () => {
		const note = {
			title: "Working board",
			content: "# Working board\n\n- [ ] Walk the step-free route\n**Print** 40 copies",
		};
		expect(snippet(note)).toBe("Walk the step-free route · Print 40 copies");
		expect(snippet({ title: "Empty", content: "" })).toBe("");
	});

	test("handles go in and out of the field", () => {
		const clean = (h: string) => h.trim().replace(/^@/, "").toLowerCase();
		expect(parseHandles("@Ann, bob  @Cy", clean)).toEqual(["ann", "bob", "cy"]);
		expect(handlesText(["ann", "bob"])).toBe("@ann, @bob");
		expect(parseHandles("", clean)).toEqual([]);
	});
});
