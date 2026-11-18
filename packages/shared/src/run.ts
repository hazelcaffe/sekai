import { z } from "zod";
import { Usage } from "./message.ts";

export const RunTrigger = z.enum([
	"user",
	"routine",
	"reminder",
	"handoff",
	"ask",
	"group",
	"test",
	"regenerate",
	"channel",
]);
export type RunTrigger = z.infer<typeof RunTrigger>;

export const RunStatus = z.enum(["queued", "running", "awaiting_approval", "done", "error", "cancelled"]);
export type RunStatus = z.infer<typeof RunStatus>;

/** One unit of agent work: a reply, a routine run, a handoff. Powers the Activity view. */
export const Run = z.object({
	id: z.string(),
	/** Whose chat (and usage) it is. */
	userId: z.string(),
	agentId: z.string(),
	conversationId: z.string(),
	messageId: z.string().nullable(),
	trigger: RunTrigger,
	title: z.string(),
	status: RunStatus,
	model: z.string().nullable(),
	steps: z.number(),
	usage: Usage.nullable(),
	error: z.string().nullable(),
	routineId: z.string().nullable(),
	createdAt: z.number(),
	startedAt: z.number().nullable(),
	finishedAt: z.number().nullable(),
});
export type Run = z.infer<typeof Run>;

/**
 * How far an approval decision reaches:
 * - once: just this call.
 * - conversation: this tool, for the rest of this chat.
 * - agent_tool / agent_category: always, for this agent (this tool / this kind of tool).
 * - global_tool / global_category: always, for every agent.
 */
export const APPROVAL_SCOPES = [
	"once",
	"conversation",
	"agent_tool",
	"agent_category",
	"global_tool",
	"global_category",
] as const;
export const ApprovalScope = z.enum(APPROVAL_SCOPES);
export type ApprovalScope = z.infer<typeof ApprovalScope>;

export const ApprovalDecision = z.object({
	approve: z.boolean(),
	scope: ApprovalScope.default("once"),
});
export type ApprovalDecision = z.input<typeof ApprovalDecision>;

/** A tool call waiting for you. Listed in the "Needs you" inbox. */
export interface PendingApproval {
	toolCallId: string;
	runId: string;
	agentId: string;
	conversationId: string;
	messageId: string;
	toolName: string;
	title: string;
	category: string;
	risk: "read" | "write" | "external" | "destructive";
	args: Record<string, unknown>;
	reason: string;
	/** It always needs you: decided on its own, only "once", never remembered as a rule. */
	alwaysAsk?: boolean;
	createdAt: number;
	expiresAt: number | null;
}
