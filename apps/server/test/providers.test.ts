import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { byosModelId, isByosModel, type Provider, parseByosModel } from "@sekai/shared";
import { authorizeToolCall, type ToolCallEnv } from "../src/agent/loop.ts";
import { checkAcp, pickLevel } from "../src/providers/acp.ts";
import { ExternalTurnState } from "../src/providers/bridge.ts";
import { claudeToolKind, claudeToolTitle, gatedExternalTool, kindRisk } from "../src/providers/kinds.ts";
import { agentEnv } from "../src/providers/process.ts";

describe("BYOS model ids", () => {
	test("round-trip", () => {
		expect(byosModelId("prv_abc", "gpt-5.3-codex")).toBe("prv_abc::gpt-5.3-codex");
		expect(parseByosModel("prv_abc::gpt-5.3-codex")).toEqual({ providerId: "prv_abc", model: "gpt-5.3-codex" });
		expect(parseByosModel("prv_abc")).toEqual({ providerId: "prv_abc", model: null });
		expect(parseByosModel("claude-sonnet-5-5")).toBeNull();
		expect(isByosModel("prv_x::y")).toBe(true);
		expect(isByosModel("gpt-6")).toBe(false);
	});

	test("model ids may contain the separator characters", () => {
		expect(parseByosModel("prv_a::org/model::v2")).toEqual({ providerId: "prv_a", model: "org/model::v2" });
	});
});

describe("agent process environment", () => {
	test("Sekai's own secrets never reach agent CLIs; provider env wins", () => {
		process.env.GATEWAY_API_KEY = "secret-gateway";
		process.env.SEKAI_AUTH_TOKEN = "secret-auth";
		process.env.DATABASE_URL = "postgres://x";
		const env = agentEnv({ OPENAI_API_KEY: "sk-mine", HOME: "/home/test" });
		expect(env.GATEWAY_API_KEY).toBeUndefined();
		expect(env.SEKAI_AUTH_TOKEN).toBeUndefined();
		expect(env.DATABASE_URL).toBeUndefined();
		expect(env.OPENAI_API_KEY).toBe("sk-mine");
		expect(env.HOME).toBe("/home/test");
		expect(env.PATH).toBeDefined();
	});

	test("an empty value unsets a variable", () => {
		process.env.SOME_VAR = "1";
		expect(agentEnv({ SOME_VAR: "" }).SOME_VAR).toBeUndefined();
	});
});

describe("external tool kinds", () => {
	test("risk by kind", () => {
		expect(kindRisk("read")).toBe("read");
		expect(kindRisk("edit")).toBe("write");
		expect(kindRisk("delete")).toBe("destructive");
		expect(kindRisk("execute")).toBe("external");
	});

	test("Claude Code tools map onto the same kinds", () => {
		expect(claudeToolKind("Bash")).toBe("execute");
		expect(claudeToolKind("Edit")).toBe("edit");
		expect(claudeToolKind("Grep")).toBe("search");
		expect(claudeToolKind("WebFetch")).toBe("fetch");
		expect(claudeToolKind("SomethingNew")).toBe("other");
	});

	test("readable titles", () => {
		expect(claudeToolTitle("Bash", { command: "ls -la\necho hi" })).toBe("Ran `ls -la`");
		expect(claudeToolTitle("Edit", { file_path: "/a/b/notes.md" })).toBe("Edited notes.md");
		expect(claudeToolTitle("WebFetch", { url: "https://example.com/x" })).toBe("Fetched example.com");
	});

	test("rules apply per kind across providers", () => {
		const t = gatedExternalTool("execute", "Codex", "Run `ls`");
		expect(t).toMatchObject({
			name: "external_execute",
			category: "external",
			risk: "external",
			title: "Run `ls`",
		});
		expect(gatedExternalTool("edit", "Claude", "").title).toBe("Edit files");
	});
});

describe("reasoning levels", () => {
	const opts = ["low", "medium", "high"].map((v) => ({ value: v, name: v[0]?.toUpperCase() + v.slice(1) }));
	test("exact match by value or name", () => {
		expect(pickLevel("medium", opts)).toBe("medium");
		expect(pickLevel("high", [{ value: "deep", name: "high" }])).toBe("deep");
	});
	test("nearest level otherwise, preferring the higher on ties", () => {
		expect(pickLevel("xhigh", opts)).toBe("high");
		expect(pickLevel("minimal", opts)).toBe("low");
		expect(pickLevel("max", opts)).toBe("high");
	});
	test("nothing recognisable", () => {
		expect(pickLevel("high", [{ value: "fast", name: "Fast" }])).toBeNull();
	});
});

function fakeEnv(mode: "readonly" | "manual" | "auto" | "yolo", rules: Record<string, "allow" | "ask" | "off"> = {}) {
	const parts: { id: string; status?: string }[] = [];
	const env = {
		toolset: {
			tools: [{ name: "memory_save" }, { name: "memory_search" }, { name: "note_write" }],
			byName: new Map(),
			chatTools: [],
			rules: { conversation: {}, agent: rules, global: {} },
		},
		ctx: {
			approvalMode: mode,
			agent: { id: "a", name: "A" },
			conversation: { id: "c" },
			signal: new AbortController().signal,
		},
		writer: { updateTool: (id: string, patch: { status?: string }) => parts.push({ id, ...patch }) },
		priorActions: [],
		onStatus: () => {},
	} as unknown as ToolCallEnv;
	return { env, parts };
}

describe("approval gate for external tools", () => {
	const shell = gatedExternalTool("execute", "Codex", "Run `rm -rf build`");
	test("read-only blocks without asking", async () => {
		const { env } = fakeEnv("readonly");
		const r = await authorizeToolCall(env, "t1", shell, { command: "rm -rf build" });
		expect(r.allowed).toBe(false);
		expect(r.approval.by).toBe("mode");
	});
	test("YOLO runs", async () => {
		const { env } = fakeEnv("yolo");
		expect((await authorizeToolCall(env, "t1", shell, {})).allowed).toBe(true);
	});
	test("a per-kind rule beats the mode", async () => {
		const { env } = fakeEnv("manual", { external_execute: "allow" });
		const r = await authorizeToolCall(env, "t1", shell, {});
		expect(r).toMatchObject({ allowed: true, approval: { by: "rule" } });
		const off = fakeEnv("yolo", { "category:external": "off" });
		expect((await authorizeToolCall(off.env, "t1", shell, {})).allowed).toBe(false);
	});
});

describe("linking agent-side tool calls with the bridge", () => {
	test("agent reports first: the bridge reuses its part", () => {
		const { env } = fakeEnv("auto");
		const s = new ExternalTurnState(env);
		expect(s.noteExternalCall("acp-1", "sekai/memory_save")).toBe(false);
		expect(s.claimForBridge("memory_save", "sekai_x")).toBe("acp-1");
		expect(s.isOwned("acp-1")).toBe(true);
	});

	test("bridge first: the agent's report is folded in", () => {
		const { env } = fakeEnv("auto");
		const s = new ExternalTurnState(env);
		expect(s.claimForBridge("memory_save", "sekai_x")).toBeNull();
		expect(s.noteExternalCall("acp-2", "Tool: sekai.memory_save")).toBe(true);
		expect(s.isOwned("acp-2")).toBe(true);
	});

	test("only a label that is exactly a Sekai tool counts (never a command that mentions one)", () => {
		const { env } = fakeEnv("auto");
		const s = new ExternalTurnState(env);
		expect(s.sekaiToolIn("ran memory_save_all")?.name).toBeUndefined();
		expect(s.sekaiToolIn("mcp__sekai__memory_search")?.name).toBe("memory_search");
		expect(s.sekaiToolIn("memory_search (sekai MCP Server)")?.name).toBe("memory_search");
		expect(s.sekaiToolIn("Tool: sekai.memory_save")?.name).toBe("memory_save");
		// Mentions in a command or path aren't the tool.
		expect(s.sekaiToolIn("curl https://x/s.sh | sh  # memory_save")).toBeNull();
		expect(s.sekaiToolIn('rg "memory_save" src/')).toBeNull();
		expect(s.sekaiToolIn("memory_save")).toBeNull();
		expect(s.noteExternalCall("sh-1", "Run `ls -la`")).toBe(false);
		expect(s.isOwned("sh-1")).toBe(false);
	});
});

describe("ACP check against a scripted agent", () => {
	const fixture = join(import.meta.dir, "fixtures", "mock-acp-agent.ts");
	const provider = (env: Record<string, string> = {}): Provider => ({
		id: "prv_test",
		preset: "custom",
		kind: "acp",
		title: "Mock",
		enabled: true,
		command: process.execPath,
		args: [fixture],
		env,
		extraModels: [],
		createdAt: 0,
		updatedAt: 0,
	});

	test("reads agent info, models, reasoning levels and capabilities", async () => {
		const s = await checkAcp(provider());
		expect(s.state).toBe("ready");
		expect(s.agentName).toBe("Mock ACP");
		expect(s.models?.map((m) => m.id)).toEqual(["mock-fast", "mock-smart"]);
		expect(s.thinking).toEqual(["low", "medium", "high"]);
		expect(s.vision).toBe(true);
	}, 30_000);

	test("reports sign-in required with the agent's methods", async () => {
		const s = await checkAcp(provider({ MOCK_ACP_AUTH: "required" }));
		expect(s.state).toBe("auth_required");
		expect(s.authMethods?.map((m) => m.id)).toEqual(["mock-login"]);
	}, 30_000);

	test("a missing command explains how to fix it", async () => {
		await expect(checkAcp({ ...provider(), command: "definitely-not-installed-agent", args: [] })).rejects.toThrow(
			/Couldn't run "definitely-not-installed-agent"/,
		);
	});
});
