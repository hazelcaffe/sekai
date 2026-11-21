import { z } from "zod";

export const MCP_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,40}$/;

export const McpTransport = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("stdio"),
		command: z.string().min(1),
		args: z.array(z.string()).default([]),
		env: z.record(z.string(), z.string()).default({}),
		cwd: z.string().nullable().default(null),
	}),
	/** Streamable HTTP (current MCP spec). */
	z.object({
		type: z.literal("http"),
		url: z.string().url(),
		headers: z.record(z.string(), z.string()).default({}),
	}),
	/** Legacy HTTP+SSE transport. */
	z.object({
		type: z.literal("sse"),
		url: z.string().url(),
		headers: z.record(z.string(), z.string()).default({}),
	}),
]);
export type McpTransport = z.infer<typeof McpTransport>;
export type McpTransportInput = z.input<typeof McpTransport>;

/** "all": every bot has its tools; "agents": only bots it's turned on for (in their Tools & access). */
export const McpScope = z.enum(["all", "agents"]);
export type McpScope = z.infer<typeof McpScope>;

export const McpServer = z.object({
	id: z.string(),
	/** Whose app it is. */
	userId: z.string(),
	/** An admin's app that everyone's bots may use (signed in as the admin). */
	everyone: z.boolean(),
	/** Slug used to namespace tools: mcp__<name>__<tool>. */
	name: z.string(),
	title: z.string(),
	description: z.string(),
	transport: McpTransport,
	enabled: z.boolean(),
	/** Ask before every tool call from this server. */
	requireApproval: z.boolean(),
	scope: McpScope,
	/** The app store entry it came from. */
	catalogId: z.string().nullable(),
	/** It signs in with OAuth; signedIn once you've approved it. */
	oauth: z.object({ signedIn: z.boolean() }).nullable(),
	createdAt: z.number(),
	updatedAt: z.number(),
});
export type McpServer = z.infer<typeof McpServer>;

export const McpServerCreate = z.object({
	name: z.string().regex(MCP_NAME_RE, "Use lowercase letters, digits, dashes and underscores"),
	title: z.string().trim().min(1).max(120),
	description: z.string().max(2000).default(""),
	transport: McpTransport,
	enabled: z.boolean().default(true),
	requireApproval: z.boolean().default(false),
	scope: McpScope.default("agents"),
	catalogId: z.string().max(80).nullable().default(null),
	/** Sign in with OAuth (the app's own login page) instead of a key. */
	oauth: z
		.object({
			/** Your own OAuth client, for apps that don't register clients automatically (Google, GitHub, Slack…). */
			clientId: z.string().trim().max(500).default(""),
			clientSecret: z.string().trim().max(500).default(""),
			scope: z.string().trim().max(2000).default(""),
			/** Extra parameters on the sign-in page's address. */
			params: z.record(z.string(), z.string()).default({}),
		})
		.nullable()
		.default(null),
	/** Bots to turn it on for right away (scope "agents"). */
	agentIds: z.array(z.string()).default([]),
	/** Admins: let everyone's bots use it. */
	everyone: z.boolean().default(false),
});
export type McpServerCreate = z.input<typeof McpServerCreate>;

// Explicit rather than McpServerCreate.partial(), which would apply defaults to omitted keys.
export const McpServerUpdate = z
	.object({
		name: z.string().regex(MCP_NAME_RE, "Use lowercase letters, digits, dashes and underscores"),
		title: z.string().trim().min(1).max(120),
		description: z.string().max(2000),
		transport: McpTransport,
		enabled: z.boolean(),
		requireApproval: z.boolean(),
		scope: McpScope,
		everyone: z.boolean(),
	})
	.partial();
export type McpServerUpdate = z.input<typeof McpServerUpdate>;

export interface McpToolInfo {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
	/** Hints from the server (MCP tool annotations), used to pick a risk level. */
	annotations: {
		title?: string;
		readOnlyHint?: boolean;
		destructiveHint?: boolean;
		openWorldHint?: boolean;
	};
}

export interface McpServerStatus {
	serverId: string;
	/** needs_auth: waiting for you to sign in (authUrl). */
	state: "disconnected" | "connecting" | "connected" | "needs_auth" | "error";
	/** Where to sign in, when it needs you to. */
	authUrl?: string | null;
	error: string | null;
	tools: McpToolInfo[];
	connectedAt: number | null;
}

export type McpServerWithStatus = McpServer & { status: McpServerStatus };
