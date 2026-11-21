import { describe, expect, test } from "bun:test";
import { botIdFromPath, formatRuleKey, safeHost, safeReturnPath } from "../src/settings/bots/common.tsx";

describe("bot services helpers", () => {
	test("safeReturnPath allows only paths inside the app", () => {
		expect(safeReturnPath("/bots/agt_123/tools")).toBe("/bots/agt_123/tools");
		expect(safeReturnPath(" /bots/agt_123/tools?x=1 ")).toBe("/bots/agt_123/tools?x=1");
		expect(safeReturnPath("/settings/apps#top")).toBe("/settings/apps#top");
		expect(safeReturnPath("")).toBeNull();
		expect(safeReturnPath(null)).toBeNull();
		expect(safeReturnPath("/")).toBeNull();
		expect(safeReturnPath("bots/agt_123")).toBeNull();
		expect(safeReturnPath("https://evil.example")).toBeNull();
		expect(safeReturnPath("//evil.example/path")).toBeNull();
		expect(safeReturnPath("/\\evil.example")).toBeNull();
		expect(safeReturnPath("/bots\\..\\evil")).toBeNull();
		expect(safeReturnPath("javascript:alert(1)")).toBeNull();
		expect(safeReturnPath("/bots/a\nb")).toBeNull();
		expect(safeReturnPath("/\texample.com")).toBeNull();
		expect(safeReturnPath("/bots/a b")).toBeNull();
	});

	test("botIdFromPath extracts the bot id from a bot settings path", () => {
		expect(botIdFromPath("/bots/agt_ZBdejAJutyAdB7Ig/tools")).toBe("agt_ZBdejAJutyAdB7Ig");
		expect(botIdFromPath("/bots/agt_1?tab=apps")).toBe("agt_1");
		expect(botIdFromPath("/settings/apps")).toBeNull();
		expect(botIdFromPath(null)).toBeNull();
	});

	test("safeHost extracts the host without throwing on partial URLs", () => {
		expect(safeHost("https://models.example.com/workspace")).toBe("models.example.com");
		expect(safeHost("http://127.0.0.1:4000/v1")).toBe("127.0.0.1:4000");
		expect(safeHost("not a url")).toBe("not a url");
		expect(safeHost("")).toBe("");
		expect(safeHost(null)).toBe("");
	});

	test("formatRuleKey says what a rule covers, with the server's names for kinds of tools", () => {
		expect(formatRuleKey("category:memory")).toEqual({ label: "Memory", covers: "kind" });
		expect(formatRuleKey("category:machines")).toEqual({ label: "Files, commands & devices", covers: "kind" });
		expect(formatRuleKey("category:something_new")).toEqual({ label: "something new", covers: "kind" });
		expect(formatRuleKey("category:mcp:github")).toEqual({ label: "github", covers: "app" });
		expect(formatRuleKey("mcp__github__create_issue")).toEqual({
			label: "mcp__github__create_issue",
			covers: "tool",
		});
		expect(formatRuleKey("run_command")).toEqual({ label: "run_command", covers: "tool" });
	});
});
