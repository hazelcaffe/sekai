import { z } from "zod";
import { ApprovalModeSetting, ToolRules } from "./agent.ts";
import { ModelRef } from "./models.ts";

export const ConversationKind = z.enum(["direct", "group"]);
export type ConversationKind = z.infer<typeof ConversationKind>;

export const ConversationSettings = z.object({
	/** Picks who answers in a group when nobody is @mentioned. Defaults to the first member's fast model. */
	routerModel: ModelRef.nullable().default(null),
	/** Maximum agent replies (including agent-to-agent handoffs) per message you send. */
	maxTurns: z.number().int().min(1).max(30).default(6),
	/** What the group is for; shown to every member. */
	purpose: z.string().max(4000).default(""),
	/** Approval mode for this chat only (the composer's mode switch). */
	approvalMode: ApprovalModeSetting.default("inherit"),
	/** "Allow for this chat" decisions. */
	toolRules: ToolRules.default({}),
	/** An agent-to-agent thread (agent_ask): agents talk here; you can read along and join in. */
	team: z.boolean().default(false),
	/** The agent that started this chat, when an agent created it. */
	createdByAgentId: z.string().nullable().default(null),
});
export type ConversationSettings = z.infer<typeof ConversationSettings>;

/** A partial settings update. Explicit, because ConversationSettings.partial() would fill in defaults. */
export const ConversationSettingsPatch = z
	.object({
		routerModel: ModelRef.nullable(),
		maxTurns: z.number().int().min(1).max(30),
		purpose: z.string().max(4000),
		approvalMode: ApprovalModeSetting,
		toolRules: ToolRules,
		team: z.boolean(),
		createdByAgentId: z.string().nullable(),
	})
	.partial();
export type ConversationSettingsPatch = z.input<typeof ConversationSettingsPatch>;

export const Conversation = z.object({
	id: z.string(),
	/** Whose chat it is. */
	userId: z.string(),
	kind: ConversationKind,
	title: z.string(),
	/** Owner agent for direct chats; null for groups. */
	agentId: z.string().nullable(),
	memberIds: z.array(z.string()),
	settings: ConversationSettings,
	/** Rolling summary of older messages that no longer fit in context. */
	summary: z.string().nullable(),
	/** Messages created at or before this time are covered by the summary. */
	summaryUntil: z.number().nullable(),
	pinned: z.boolean(),
	archived: z.boolean(),
	lastMessageAt: z.number().nullable(),
	lastMessagePreview: z.string().nullable(),
	createdAt: z.number(),
	updatedAt: z.number(),
});
export type Conversation = z.infer<typeof Conversation>;

export const ConversationCreate = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("direct"), agentId: z.string().min(1), title: z.string().max(200).optional() }),
	z.object({
		kind: z.literal("group"),
		memberIds: z.array(z.string().min(1)).min(2).max(8),
		title: z.string().max(200).optional(),
		settings: ConversationSettings.partial().optional(),
	}),
]);
export type ConversationCreate = z.input<typeof ConversationCreate>;

export const ConversationUpdate = z
	.object({
		title: z.string().max(200),
		memberIds: z.array(z.string().min(1)).min(2).max(8),
		settings: ConversationSettingsPatch,
		pinned: z.boolean(),
		archived: z.boolean(),
	})
	.partial();
export type ConversationUpdate = z.input<typeof ConversationUpdate>;

/** A message found by search: where it is, and the words around the match (marked with \u0001 … \u0002). */
export interface MessageSearchHit {
	messageId: string;
	conversationId: string;
	conversationTitle: string;
	conversationKind: "direct" | "group";
	sender: "user" | "agent" | "system";
	agentId: string | null;
	createdAt: number;
	snippet: string;
}
