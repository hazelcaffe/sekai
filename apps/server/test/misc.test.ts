import { describe, expect, test } from "bun:test";
import { type Agent, AgentCapabilities, AgentModels, randomAvatar, type Skill } from "@sekai/shared";
import { sanitizeSvg } from "../src/agent/avatar.ts";
import { parseMentions } from "../src/agent/group.ts";
import { mcpRisk, mcpToolName } from "../src/agent/tools/index.ts";
import { extractJson, htmlToText, truncateMiddle } from "../src/lib/text.ts";
import { buildBody } from "../src/llm/gateway.ts";
import { parseSkillMarkdown, skillToMarkdown } from "../src/services/skills.ts";

function agent(id: string, name: string): Agent {
	return {
		id,
		userId: "usr_test",
		name,
		label: "",
		job: "",
		personality: "",
		instructions: "",
		avatar: randomAvatar(name),
		models: AgentModels.parse({ primary: { model: "m" } }),
		capabilities: AgentCapabilities.parse({}),
		skillIds: [],
		mcp: [],
		isPrimary: false,
		pinned: false,
		hidden: false,
		section: null,
		status: "active",
		sortOrder: 0,
		createdAt: 0,
		updatedAt: 0,
	};
}

describe("mentions", () => {
	const members = [agent("a", "Ada"), agent("b", "Ada Lovelace"), agent("c", "Bo")];

	test("in order of appearance, longest name wins", () => {
		expect(parseMentions("@Bo can you check with @Ada Lovelace?", members).ids).toEqual(["c", "b"]);
	});

	test("case-insensitive and needs a word boundary", () => {
		expect(parseMentions("hey @ada", members).ids).toEqual(["a"]);
		expect(parseMentions("email me at bo@example.com or @Bobby", members).ids).toEqual([]);
	});

	test("@everyone", () => {
		expect(parseMentions("@everyone standup", members).everyone).toBe(true);
	});
});

describe("SKILL.md", () => {
	test("parses frontmatter and body", () => {
		const s = parseSkillMarkdown(
			`---\nname: weekly-report\ndescription: "Use when: Fridays"\n---\n\n# Weekly report\n\n1. Do it`,
		);
		expect(s.name).toBe("weekly-report");
		expect(s.description).toBe("Use when: Fridays");
		expect(s.title).toBe("Weekly report");
		expect(s.instructions).toContain("1. Do it");
	});

	test("slugifies a bad name and round-trips", () => {
		const parsed = parseSkillMarkdown(`---\nname: My Skill!\ndescription: Use when testing\n---\nBody`);
		expect(parsed.name).toBe("my-skill");
		const skill: Skill = {
			id: "x",
			userId: null,
			name: parsed.name,
			title: parsed.title,
			description: parsed.description,
			instructions: parsed.instructions ?? "",
			builtin: false,
			enabled: true,
			shared: false,
			createdBy: "user",
			createdAt: 0,
			updatedAt: 0,
		};
		const again = parseSkillMarkdown(skillToMarkdown(skill));
		expect(again.name).toBe(skill.name);
		expect(again.description).toBe(skill.description);
		expect(again.instructions).toBe("Body");
	});
});

describe("MCP tools", () => {
	test("names fit provider limits", () => {
		expect(mcpToolName("github", "create_issue")).toBe("mcp__github__create_issue");
		const long = mcpToolName("a-very-long-server-name", "an_extremely_long_tool_name_that_goes_on_and_on");
		expect(long.length).toBeLessThanOrEqual(64);
		expect(long).toMatch(/^[a-zA-Z0-9_-]+$/);
	});

	test("risk comes from annotations", () => {
		expect(mcpRisk({ annotations: { readOnlyHint: true } })).toBe("read");
		expect(mcpRisk({ annotations: { destructiveHint: true } })).toBe("destructive");
		expect(mcpRisk({ annotations: {} })).toBe("external");
	});
});

describe("SVG sanitizing", () => {
	test("strips scripts, handlers and external references", () => {
		const svg = sanitizeSvg(
			`Here you go: <svg viewBox="0 0 10 10"><script>alert(1)</script><rect onclick="x()" width="10" height="10" fill="url(https://evil/x)"/><image href="https://evil/a.png"/><use href="#ok"/></svg> enjoy`,
		);
		expect(svg.startsWith("<svg")).toBe(true);
		expect(svg).not.toContain("script");
		expect(svg).not.toContain("onclick");
		expect(svg).not.toContain("evil");
		expect(svg).toContain('href="#ok"');
		expect(svg).toContain("xmlns=");
	});
});

describe("text helpers", () => {
	test("extractJson tolerates fences and chatter", () => {
		expect(extractJson('Sure!\n```json\n{"a": [1, 2]}\n```')).toEqual({ a: [1, 2] });
		expect(extractJson('Result: {"responders":["Ada"]} done')).toEqual({ responders: ["Ada"] });
	});

	test("truncateMiddle keeps both ends", () => {
		const out = truncateMiddle(`${"a".repeat(500)}${"b".repeat(500)}`, 200);
		expect(out.startsWith("aaa")).toBe(true);
		expect(out.endsWith("bbb")).toBe(true);
		expect(out).toContain("truncated");
	});

	test("htmlToText drops scripts and keeps structure", () => {
		const t = htmlToText("<h1>Title</h1><script>x</script><p>One &amp; two</p><ul><li>a</li></ul>");
		expect(t).toContain("Title");
		expect(t).toContain("One & two");
		expect(t).toContain("• a");
		expect(t).not.toContain("x\n");
	});
});

describe("gateway request body", () => {
	test("maps thinking, tools and web search", () => {
		const body = buildBody({
			model: "claude-sonnet-5-5",
			messages: [{ role: "user", content: "hi" }],
			thinking: "high",
			webSearch: true,
			tools: [{ type: "function", function: { name: "t", description: "d", parameters: { type: "object" } } }],
		});
		expect(body.reasoning_effort).toBe("high");
		expect(body.web_search_options).toEqual({});
		expect(body.stream).toBe(true);
		expect(Array.isArray(body.tools)).toBe(true);
	});

	test("default thinking sends no effort", () => {
		expect(buildBody({ model: "m", messages: [], thinking: "default" }).reasoning_effort).toBeUndefined();
	});
});

describe("patches", () => {
	test("leaving a field out of an update never resets it to its default", async () => {
		const shared = await import("@sekai/shared");
		for (const [name, schema] of Object.entries(shared)) {
			if (!/Update$|Patch$/.test(name) || typeof (schema as { safeParse?: unknown }).safeParse !== "function")
				continue;
			const r = (schema as { safeParse(v: unknown): { success: boolean; data?: unknown } }).safeParse({});
			const filled = r.success && r.data && typeof r.data === "object" ? Object.keys(r.data) : [];
			expect({ name, filled }).toEqual({ name, filled: [] });
		}
	});
});
