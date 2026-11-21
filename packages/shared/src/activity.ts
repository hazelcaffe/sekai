import type { UsageScope } from "./settings.ts";

/** One thing a bot did (a tool call), with how it ended and who allowed it. */
export interface ActivityEntry {
	id: string;
	at: number;
	userId?: string | null;
	userName?: string | null;
	agentId: string | null;
	agentName?: string | null;
	conversationId: string | null;
	messageId: string | null;
	tool: string;
	title: string;
	source: "builtin" | "mcp" | "external";
	risk: "read" | "write" | "external" | "destructive" | null;
	status: "done" | "error" | "denied";
	/** How it was allowed or refused, when that took a decision. */
	decision: "approved" | "denied" | null;
	decidedBy: "rule" | "mode" | "reviewer" | "primary" | "user" | "timeout" | null;
	note: string | null;
	/** What it was asked to do (long values shortened). */
	args: Record<string, unknown>;
	result: string | null;
	error: string | null;
	durationMs: number | null;
	/**
	 * Someone else's entry (an admin's Everyone or one person): only what happened is sent, never what it carried.
	 * Its title is the tool's plain name, and args, result, error and note are empty.
	 */
	private?: boolean;
}

export interface ActivityQuery {
	q?: string;
	/** Whose activity to show: yours ("me", default), everyone's ("all", admins), or one person's id (admins). */
	scope?: UsageScope;
	agentId?: string;
	status?: ActivityEntry["status"];
	risk?: NonNullable<ActivityEntry["risk"]>;
	decidedBy?: NonNullable<ActivityEntry["decidedBy"]>;
	/** Entries before this time (for the next page). */
	before?: number;
	limit?: number;
}
