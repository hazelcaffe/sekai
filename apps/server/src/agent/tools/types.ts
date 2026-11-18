import type { Agent, ApprovalMode, Conversation, RunTrigger, ToolRisk } from "@sekai/shared";
import type { z } from "zod";

export const TOOL_CATEGORIES = {
	memory: "Memory",
	notes: "Notes",
	routines: "Routines & reminders",
	skills: "Skills",
	agents: "Team",
	web: "Web",
	browser: "Browser",
	computer: "Computer",
	machines: "Machines & devboxes",
	code: "Code search",
	library: "Library",
	media: "Images",
	contact: "Messages & calls",
	x: "X (Twitter)",
	system: "System",
} as const;
export type ToolCategory = keyof typeof TOOL_CATEGORIES;

export interface ToolContext {
	agent: Agent;
	conversation: Conversation;
	runId: string;
	messageId: string;
	trigger: RunTrigger;
	/** Handoff depth: 0 for a reply to you, +1 for each agent-to-agent hop. */
	depth: number;
	/** Agents currently waiting (agent_ask) on this run, outermost first. */
	askChain: string[];
	timezone: string;
	approvalMode: ApprovalMode;
	signal: AbortSignal;
	/** Screenshots taken so far in this reply (upload URLs, oldest first), so a bot can attach one. */
	recentImages?: () => string[];
}

export interface ToolDefinition<S extends z.ZodType = z.ZodType> {
	name: string;
	category: ToolCategory;
	description: string;
	parameters: S;
	/** Drives approval: the approval mode decides what each risk level needs. */
	risk: ToolRisk;
	/** Short label for the chat UI, e.g. "Saved to memory". */
	title(args: z.infer<S>): string;
	execute(args: z.infer<S>, ctx: ToolContext): Promise<unknown>;
	/** Offered only when this says so (e.g. desktop tools while the bot's computer is running). */
	available?(agent: Agent): boolean | Promise<boolean>;
	/** A reason to always ask you first (even in YOLO), or null to follow the approval mode. */
	askFirst?(args: z.infer<S>, ctx: ToolContext): string | null | Promise<string | null>;
	/** The risk of this particular call, when it depends on the arguments (e.g. acting on your own computer). */
	riskFor?(args: z.infer<S>, ctx: ToolContext): ToolRisk | Promise<ToolRisk>;
}

export interface ToolImage {
	mime: string;
	data: Uint8Array;
}

/** An image a tool adds to the bot's reply, for you to see (already saved as an upload). */
export interface ToolAttachment {
	url: string;
	alt: string;
	name?: string;
	width?: number;
	height?: number;
	source?: string;
}

/**
 * What a tool returns when it has pictures: text for the model, images for its eyes (screenshots), and
 * images to put in the reply for you (attach_image).
 */
export class ToolOutput {
	constructor(
		readonly content: string,
		readonly images: ToolImage[] = [],
		readonly attachments: ToolAttachment[] = [],
	) {}
}

export function defineTool<S extends z.ZodType>(def: ToolDefinition<S>): ToolDefinition<S> {
	return def;
}

/** Thrown by tools for expected failures; the message is shown to the model as the tool result. */
export class ToolError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ToolError";
	}
}
