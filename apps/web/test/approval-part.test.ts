import { expect, test } from "bun:test";
import { APPROVAL_MODE_INFO, followRuleLabel, toolKindLabel } from "@sekai/shared";
import { approvalPart, approvalScopeLabels } from "../src/components/chat/approval-part.ts";

test("Needs you keeps one-time-only approvals one-time", () => {
	const part = approvalPart({
		toolCallId: "call_1",
		toolName: "example",
		agentId: "agt_1",
		conversationId: "cnv_1",
		runId: "run_1",
		messageId: "msg_1",
		title: "Confirm an action",
		category: "external",
		createdAt: 1,
		expiresAt: null,
		args: {},
		risk: "external",
		reason: "Asks each time",
		alwaysAsk: true,
	});
	expect(part.alwaysAsk).toBe(true);
	expect(part.id).toBe("call_1");
	expect(part.status).toBe("awaiting_approval");
});

test("approval choices name what they cover in plain words", () => {
	const kind = (category: string, apps: Record<string, string> = {}) => toolKindLabel(category, (name) => apps[name]);
	expect(kind("machines")).toBe("Files, commands & devices");
	expect(kind("agents")).toBe("Team");
	expect(kind("mcp:trail-catalog", { "trail-catalog": "Trail catalog" })).toBe("Trail catalog");
	// An app you can't see the title of still reads as words.
	expect(kind("mcp:trail-catalog")).toBe("Trail catalog");
	expect(toolKindLabel(undefined)).toBeNull();
	const scopes = approvalScopeLabels({ kind: kind("machines"), bot: "Nori" });
	expect(scopes.botKind).toBe("Always allow Files, commands & devices for Nori");
	expect(scopes.everyKind).toBe("Always allow Files, commands & devices for every bot");
	expect(scopes.botTool).toBe("Always allow this tool for Nori");
	expect(scopes.blockBotTool).toBe("Always block this tool for Nori");
	for (const line of Object.values(scopes)) expect(line ?? "").not.toMatch(/machines|mcp:|all .* tools/);
	expect(approvalScopeLabels({ kind: null, bot: null }).botKind).toBeNull();
});

test("the approvals rule is worded one way everywhere", () => {
	expect(followRuleLabel("manual")).toBe("Follow your default (Ask)");
	expect(followRuleLabel("auto", "Nori")).toBe("Follow Nori's rule (Reviewer)");
	expect(APPROVAL_MODE_INFO.readonly.title).toBe("Read-only");
});
