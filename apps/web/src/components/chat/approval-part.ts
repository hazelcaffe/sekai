import type { PendingApproval, ToolPart } from "@sekai/shared";

/** Use the same approval card in chat and Needs you, including one-time-only decisions. */
export function approvalPart(request: PendingApproval): ToolPart {
	return {
		type: "tool",
		id: request.toolCallId,
		name: request.toolName,
		title: request.title,
		source: request.category.startsWith("mcp:") ? "mcp" : request.category === "external" ? "external" : "builtin",
		category: request.category,
		risk: request.risk,
		args: request.args,
		status: "awaiting_approval",
		reason: request.reason,
		alwaysAsk: request.alwaysAsk,
	};
}

/**
 * What each "always" choice on an approval card covers, in plain words: "Always allow Files, commands & devices
 * for Nori", "Always allow Trail catalog for every bot". `kind` is null when the call has no kind to allow.
 */
export function approvalScopeLabels(p: { kind: string | null; bot: string | null }) {
	const bot = p.bot ?? "this bot";
	return {
		botTool: `Always allow this tool for ${bot}`,
		botKind: p.kind ? `Always allow ${p.kind} for ${bot}` : null,
		everyTool: "Always allow this tool for every bot",
		everyKind: p.kind ? `Always allow ${p.kind} for every bot` : null,
		blockBotTool: `Always block this tool for ${bot}`,
	};
}
