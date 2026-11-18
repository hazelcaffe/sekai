import type {
	Agent,
	ApprovalMode,
	ApprovalModeSetting,
	Conversation,
	Settings,
	ToolPermission,
	ToolRisk,
	ToolRules,
} from "@sekai/shared";

/**
 * Approval policy, in order of precedence:
 *   1. Explicit rules: chat → agent → global; within each, a tool name beats its kind ("category:<kind>").
 *      "off" hides the tool; "allow" runs it (except in read-only mode); "ask" always asks, even in YOLO.
 *   2. The approval mode (chat → agent → global), by the tool's risk level.
 */

export interface RuleSets {
	conversation: ToolRules;
	agent: ToolRules;
	global: ToolRules;
}

export interface MatchedRule {
	permission: ToolPermission;
	source: "conversation" | "agent" | "global";
	key: string;
}

export type Gate =
	| { action: "run"; by: "rule" | "mode"; note?: string }
	| { action: "ask"; by: "rule" | "mode"; reason: string; alwaysAsk?: boolean }
	| { action: "review"; reason: string }
	| { action: "deny"; by: "rule" | "mode"; reason: string };

export function ruleSets(agent: Agent, conversation: Conversation | null, settings: Settings): RuleSets {
	return {
		conversation: conversation?.settings.toolRules ?? {},
		agent: agent.capabilities.tools,
		global: settings.toolRules,
	};
}

export function matchRule(rules: RuleSets, toolName: string, category: string): MatchedRule | null {
	for (const source of ["conversation", "agent", "global"] as const) {
		const set = rules[source];
		const byName = set[toolName];
		if (byName) return { permission: byName, source, key: toolName };
		const byCategory = set[`category:${category}`];
		if (byCategory) return { permission: byCategory, source, key: `category:${category}` };
	}
	return null;
}

export function resolveApprovalMode(settings: Settings, agent: Agent, conversation: Conversation | null): ApprovalMode {
	const pick = (s: ApprovalModeSetting | undefined): ApprovalMode | null => (s && s !== "inherit" ? s : null);
	return pick(conversation?.settings.approvalMode) ?? pick(agent.capabilities.approvalMode) ?? settings.approvalMode;
}

const RISK_WORDS: Record<ToolRisk, string> = {
	read: "looks something up",
	write: "changes the agent's workspace",
	external: "reaches beyond this agent",
	destructive: "deletes or overwrites something",
};

export function gateFor(
	tool: { name: string; category: string; risk: ToolRisk; askFirst?: string | null },
	mode: ApprovalMode,
	rules: RuleSets,
): Gate {
	const rule = matchRule(rules, tool.name, tool.category);
	const where = rule
		? rule.source === "conversation"
			? "this chat"
			: rule.source === "agent"
				? "this agent"
				: "all agents"
		: "";
	if (rule?.permission === "off") return { action: "deny", by: "rule", reason: `Blocked by a rule for ${where}.` };
	if (mode === "readonly" && tool.risk !== "read") {
		return {
			action: "deny",
			by: "mode",
			reason: "Read-only mode is on, so this action is blocked. Describe what you would do instead.",
		};
	}
	// Some requests always go to you (root on a device, a new computer), whatever the mode or an allow rule.
	if (tool.askFirst) return { action: "ask", by: "rule", reason: tool.askFirst, alwaysAsk: true };
	if (rule?.permission === "allow") return { action: "run", by: "rule", note: `Allowed by a rule for ${where}` };
	if (rule?.permission === "ask") {
		return { action: "ask", by: "rule", reason: `A rule for ${where} says to ask before this.` };
	}
	switch (mode) {
		case "yolo":
			return { action: "run", by: "mode" };
		case "readonly":
			return { action: "run", by: "mode" };
		case "manual":
			return tool.risk === "read"
				? { action: "run", by: "mode" }
				: { action: "ask", by: "mode", reason: `Ask-every-time mode: this ${RISK_WORDS[tool.risk]}.` };
		case "auto":
		case "primary":
			return tool.risk === "read" || tool.risk === "write"
				? { action: "run", by: "mode" }
				: { action: "review", reason: `This ${RISK_WORDS[tool.risk]}.` };
	}
}
