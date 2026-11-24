import { z } from "zod";
import { Avatar } from "./avatar.ts";
import { AgentModels } from "./models.ts";

/** Explicit rule for a tool or a kind of tool. "off" also hides the tool from the agent. */
export const ToolPermission = z.enum(["allow", "ask", "off"]);
export type ToolPermission = z.infer<typeof ToolPermission>;

/**
 * - read: looks things up, changes nothing.
 * - write: changes the agent's own workspace (memory, notes, routines, skills).
 * - external: reaches beyond the agent (other agents, notifications, connected apps).
 * - destructive: deletes or overwrites things.
 */
export const TOOL_RISKS = ["read", "write", "external", "destructive"] as const;
export const ToolRisk = z.enum(TOOL_RISKS);
export type ToolRisk = z.infer<typeof ToolRisk>;

/**
 * How tool calls are approved when no explicit rule matches.
 * - readonly: only read tools run; everything else is blocked.
 * - manual: read tools run; every other call waits for you.
 * - auto: read and write tools run; external and destructive calls go to a reviewer model, which approves
 *   clearly-requested actions and escalates the rest to you.
 * - yolo: everything runs without asking. Explicit "ask" rules still apply.
 */
export const APPROVAL_MODES = ["readonly", "manual", "auto", "primary", "yolo"] as const;
export const ApprovalMode = z.enum(APPROVAL_MODES);
export type ApprovalMode = z.infer<typeof ApprovalMode>;
export const ApprovalModeSetting = z.union([ApprovalMode, z.literal("inherit")]);
export type ApprovalModeSetting = z.infer<typeof ApprovalModeSetting>;

export const APPROVAL_MODE_INFO: Record<ApprovalMode, { title: string; short: string; description: string }> = {
	readonly: {
		title: "Read-only",
		short: "Read-only",
		description: "Bots can look things up but can't change anything.",
	},
	manual: {
		title: "Ask every time",
		short: "Ask",
		description: "Look-ups run on their own. Every action that changes something waits for your approval.",
	},
	auto: {
		title: "Reviewer checks risky actions",
		short: "Reviewer",
		description:
			"Routine actions run on their own. Risky ones are checked by a reviewer model, which asks you when an action isn't clearly what you wanted.",
	},
	primary: {
		title: "Primary bot decides",
		short: "Primary",
		description:
			"Routine actions run on their own. Risky ones go to your primary bot, which approves what it's sure you'd want and asks you otherwise.",
	},
	yolo: {
		title: "Don't ask",
		short: "Don't ask",
		description: "Everything runs without asking, except tools set to Ask and actions that always need you.",
	},
};

/**
 * The one way to say a bot or chat follows another rule: "Follow Nori's rule (Ask)" or, with no bot,
 * "Follow your default (Ask)".
 */
export function followRuleLabel(mode: ApprovalMode, bot?: string | null): string {
	return `Follow ${bot ? `${bot}'s rule` : "your default"} (${APPROVAL_MODE_INFO[mode].short})`;
}

/** Rules keyed by tool name ("memory_save") or kind ("category:memory", "category:mcp:github"). */
export const ToolRules = z.record(z.string(), ToolPermission);
export type ToolRules = z.infer<typeof ToolRules>;

/** The kinds of built-in tools, in plain words (a rule for a whole kind is keyed "category:<kind>"). */
export const TOOL_CATEGORIES = {
	memory: "Memory",
	notes: "Notes",
	routines: "Routines & reminders",
	jobs: "Coding jobs",
	skills: "Skills",
	agents: "Team",
	web: "Web",
	browser: "Browser",
	computer: "Computer",
	machines: "Files, commands & devices",
	code: "Code search",
	library: "Library",
	media: "Images",
	contact: "Messages & calls",
	email: "Email",
	x: "X (Twitter)",
	system: "System",
} as const;
export type ToolCategory = keyof typeof TOOL_CATEGORIES;

export const AgentCapabilities = z.object({
	/** Lets the agent search the web (run by the gateway). */
	webSearch: z.boolean().default(true),
	/** After each reply, the fast model reviews the exchange and saves lasting memories. */
	autoLearn: z.boolean().default(true),
	/** Overrides the global approval mode for this agent. */
	approvalMode: ApprovalModeSetting.default("inherit"),
	/** This agent's tool rules. A tool name beats its category. */
	tools: ToolRules.default({}),
});
export type AgentCapabilities = z.infer<typeof AgentCapabilities>;

export const AgentMcpBinding = z.object({
	serverId: z.string().min(1),
	/** null exposes every tool the server offers. */
	tools: z.array(z.string()).nullable().default(null),
});
export type AgentMcpBinding = z.infer<typeof AgentMcpBinding>;

export const AgentStatus = z.enum(["active", "paused"]);
export type AgentStatus = z.infer<typeof AgentStatus>;

export const Agent = z.object({
	id: z.string(),
	/** Whose bot it is. */
	userId: z.string(),
	/** Shared with you by someone else: their name (you chat with it, but can't change it). */
	sharedBy: z.string().nullable().optional(),
	name: z.string().min(1).max(60),
	/** Short title shown under the name, e.g. "Research lead". */
	label: z.string().max(80),
	/** The agent's responsibility: what it owns and what "done" looks like. */
	job: z.string().max(8000),
	/** Voice and character: tone, quirks, how it talks to you. */
	personality: z.string().max(8000),
	/** Lasting rules and boundaries that should always hold. */
	instructions: z.string().max(20000),
	avatar: Avatar,
	models: AgentModels,
	capabilities: AgentCapabilities,
	skillIds: z.array(z.string()),
	mcp: z.array(AgentMcpBinding),
	isPrimary: z.boolean(),
	pinned: z.boolean(),
	hidden: z.boolean(),
	section: z.string().nullable(),
	status: AgentStatus,
	sortOrder: z.number(),
	createdAt: z.number(),
	updatedAt: z.number(),
});
export type Agent = z.infer<typeof Agent>;

export const AgentCreate = z.object({
	name: z.string().trim().min(1).max(60),
	label: z.string().max(80).default(""),
	job: z.string().max(8000).default(""),
	personality: z.string().max(8000).default(""),
	instructions: z.string().max(20000).default(""),
	avatar: Avatar.optional(),
	models: AgentModels.optional(),
	capabilities: AgentCapabilities.optional(),
	skillIds: z.array(z.string()).optional(),
	mcp: z.array(AgentMcpBinding).optional(),
	isPrimary: z.boolean().optional(),
	section: z.string().nullable().optional(),
});
export type AgentCreate = z.input<typeof AgentCreate>;

export const AgentUpdate = z
	.object({
		name: z.string().trim().min(1).max(60),
		label: z.string().max(80),
		job: z.string().max(8000),
		personality: z.string().max(8000),
		instructions: z.string().max(20000),
		avatar: Avatar,
		models: AgentModels,
		capabilities: AgentCapabilities,
		skillIds: z.array(z.string()),
		mcp: z.array(AgentMcpBinding),
		isPrimary: z.boolean(),
		pinned: z.boolean(),
		hidden: z.boolean(),
		section: z.string().nullable(),
		status: AgentStatus,
		sortOrder: z.number(),
	})
	.partial();
export type AgentUpdate = z.input<typeof AgentUpdate>;

/** What the agent actually sees on its next turn, for the chat details' Context. */
export interface AgentContextSection {
	id: string;
	title: string;
	content: string;
	tokens: number;
}

export interface AgentContextTool {
	name: string;
	description: string;
	source: "builtin" | "mcp";
	category: string;
	risk: ToolRisk;
	/** The explicit rule that applies, if any (otherwise the approval mode decides). */
	rule: ToolPermission | null;
	ruleSource: "conversation" | "agent" | "global" | null;
}

export interface AgentContext {
	agentId: string;
	conversationId: string | null;
	model: string;
	approvalMode: ApprovalMode;
	contextWindow: number;
	systemPrompt: string;
	sections: AgentContextSection[];
	tools: AgentContextTool[];
	history: {
		messages: number;
		tokens: number;
		summary: string | null;
		summarizedMessages: number;
	};
	totalTokens: number;
}
