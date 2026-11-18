/** One thing a bot did (a tool call), with how it ended and who allowed it. */
export interface ActivityEntry {
	id: string;
	at: number;
	agentId: string | null;
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
}

export interface ActivityQuery {
	q?: string;
	agentId?: string;
	status?: ActivityEntry["status"];
	risk?: NonNullable<ActivityEntry["risk"]>;
	decidedBy?: NonNullable<ActivityEntry["decidedBy"]>;
	/** Entries before this time (for the next page). */
	before?: number;
	limit?: number;
}
