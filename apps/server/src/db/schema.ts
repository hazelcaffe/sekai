import type {
	AgentCapabilities,
	AgentMcpBinding,
	AgentModels,
	AgentStatus,
	ApiKind,
	ApiModel,
	ApprovalMode,
	Attachment,
	Avatar,
	ChannelDelivery,
	ChannelType,
	CodeIndexProgress,
	CodeIndexStatus,
	ConversationKind,
	ConversationSettings,
	DmPolicy,
	GroupPolicy,
	Machine,
	MachineBackend,
	MachineKind,
	MachineProvider,
	MachineSpecs,
	MachineStatus,
	McpScope,
	McpTransport,
	MemberStatus,
	MemoryKind,
	MessageMeta,
	MessagePart,
	MessageSender,
	MessageStatus,
	Permission,
	ProviderKind,
	ProviderPresetId,
	ProviderStatus,
	RoleLimits,
	RoutineAction,
	RoutineStatus,
	RunStatus,
	RunTrigger,
	Schedule,
	SignInMode,
	ToolRules,
	Usage,
} from "@sekai/shared";
import { sql } from "drizzle-orm";
import {
	bigint,
	bigserial,
	boolean,
	customType,
	doublePrecision,
	index,
	integer,
	jsonb,
	pgTable,
	primaryKey,
	text,
	uniqueIndex,
} from "drizzle-orm/pg-core";

/** All timestamps are milliseconds since the epoch, matching the API types. */
const ms = () => bigint({ mode: "number" });
const timestamps = {
	createdAt: ms().notNull(),
	updatedAt: ms().notNull(),
};

/** The person a row belongs to (their workspace). Deleting the account deletes it. */
const owner = () =>
	text()
		.notNull()
		.references(() => users.id, { onDelete: "cascade" });

export const settings = pgTable("settings", {
	key: text().primaryKey(),
	value: jsonb().$type<unknown>().notNull(),
});

export const agents = pgTable("agents", {
	id: text().primaryKey(),
	userId: owner(),
	name: text().notNull(),
	label: text().notNull().default(""),
	job: text().notNull().default(""),
	personality: text().notNull().default(""),
	instructions: text().notNull().default(""),
	avatar: jsonb().$type<Avatar>().notNull(),
	models: jsonb().$type<AgentModels>().notNull(),
	capabilities: jsonb().$type<AgentCapabilities>().notNull(),
	skillIds: jsonb().$type<string[]>().notNull(),
	mcp: jsonb().$type<AgentMcpBinding[]>().notNull(),
	isPrimary: boolean().notNull().default(false),
	pinned: boolean().notNull().default(false),
	hidden: boolean().notNull().default(false),
	section: text(),
	status: text().$type<AgentStatus>().notNull().default("active"),
	sortOrder: doublePrecision().notNull().default(0),
	...timestamps,
});

/** Bots shared with other people: one person, everyone with a role, or everyone. */
export const agentShares = pgTable(
	"agent_shares",
	{
		id: text().primaryKey(),
		agentId: text()
			.notNull()
			.references(() => agents.id, { onDelete: "cascade" }),
		kind: text().$type<"user" | "role" | "everyone">().notNull(),
		/** The user or role id; null for everyone. */
		targetId: text(),
		createdAt: ms().notNull(),
	},
	(t) => [index("agent_shares_agent_idx").on(t.agentId), index("agent_shares_target_idx").on(t.kind, t.targetId)],
);

export const conversations = pgTable(
	"conversations",
	{
		id: text().primaryKey(),
		userId: owner(),
		kind: text().$type<ConversationKind>().notNull(),
		title: text().notNull(),
		agentId: text().references(() => agents.id, { onDelete: "cascade" }),
		memberIds: jsonb().$type<string[]>().notNull(),
		settings: jsonb().$type<ConversationSettings>().notNull(),
		summary: text(),
		summaryUntil: ms(),
		pinned: boolean().notNull().default(false),
		archived: boolean().notNull().default(false),
		lastMessageAt: ms(),
		lastMessagePreview: text(),
		...timestamps,
	},
	(t) => [index("conversations_agent_idx").on(t.agentId), index("conversations_user_idx").on(t.userId)],
);

export const messages = pgTable(
	"messages",
	{
		id: text().primaryKey(),
		conversationId: text()
			.notNull()
			.references(() => conversations.id, { onDelete: "cascade" }),
		sender: text().$type<MessageSender>().notNull(),
		agentId: text(),
		parts: jsonb().$type<MessagePart[]>().notNull(),
		attachments: jsonb().$type<Attachment[]>().notNull(),
		replyToId: text(),
		status: text().$type<MessageStatus>().notNull(),
		error: text(),
		model: text(),
		usage: jsonb().$type<Usage>(),
		runId: text(),
		meta: jsonb().$type<MessageMeta>().notNull(),
		/** The message's words (its text parts), for search across every chat. Kept by services/messages.ts. */
		searchText: text().notNull().default(""),
		...timestamps,
	},
	(t) => [
		index("messages_conversation_idx").on(t.conversationId, t.createdAt),
		index("messages_search_idx").using("gin", sql`to_tsvector('simple', ${t.searchText})`),
	],
);

export const memories = pgTable(
	"memories",
	{
		id: text().primaryKey(),
		userId: owner(),
		agentId: text().references(() => agents.id, { onDelete: "cascade" }),
		kind: text().$type<MemoryKind>().notNull(),
		content: text().notNull(),
		source: text().$type<"user" | "agent" | "auto">().notNull(),
		pinned: boolean().notNull().default(false),
		...timestamps,
	},
	(t) => [index("memories_agent_idx").on(t.agentId), index("memories_user_idx").on(t.userId)],
);

export const notes = pgTable(
	"notes",
	{
		id: text().primaryKey(),
		userId: owner(),
		agentId: text()
			.notNull()
			.references(() => agents.id, { onDelete: "cascade" }),
		title: text().notNull(),
		content: text().notNull(),
		pinned: boolean().notNull().default(false),
		createdBy: text().$type<"user" | "agent">().notNull(),
		...timestamps,
	},
	(t) => [index("notes_agent_idx").on(t.agentId), index("notes_user_idx").on(t.userId)],
);

export const routines = pgTable(
	"routines",
	{
		id: text().primaryKey(),
		userId: owner(),
		agentId: text()
			.notNull()
			.references(() => agents.id, { onDelete: "cascade" }),
		conversationId: text().references(() => conversations.id, { onDelete: "set null" }),
		name: text().notNull(),
		instruction: text().notNull(),
		action: text().$type<RoutineAction>().notNull(),
		schedule: jsonb().$type<Schedule>().notNull(),
		timezone: text().notNull(),
		enabled: boolean().notNull(),
		createdBy: text().$type<"user" | "agent">().notNull(),
		lastRunAt: ms(),
		lastStatus: text().$type<RoutineStatus>(),
		nextRunAt: ms(),
		runCount: integer().notNull().default(0),
		...timestamps,
	},
	(t) => [
		index("routines_agent_idx").on(t.agentId),
		index("routines_next_idx").on(t.enabled, t.nextRunAt),
		index("routines_user_idx").on(t.userId),
	],
);

export const routineRuns = pgTable(
	"routine_runs",
	{
		id: text().primaryKey(),
		routineId: text()
			.notNull()
			.references(() => routines.id, { onDelete: "cascade" }),
		conversationId: text(),
		messageId: text(),
		status: text().$type<RoutineStatus>().notNull(),
		error: text(),
		startedAt: ms().notNull(),
		finishedAt: ms(),
	},
	(t) => [index("routine_runs_routine_idx").on(t.routineId, t.startedAt)],
);

/**
 * Everything bots did (tool calls) and how each was allowed, for the activity log. Kept apart from chats so
 * deleting a chat doesn't erase what happened in it. Written by agent/writer.ts when a tool call ends.
 */
export const activityLog = pgTable(
	"activity_log",
	{
		id: text().primaryKey(),
		at: ms().notNull(),
		/** Whose bot did it (an audit trail: kept when the account is deleted). */
		userId: text(),
		agentId: text(),
		conversationId: text(),
		messageId: text(),
		runId: text(),
		toolCallId: text().notNull(),
		tool: text().notNull(),
		title: text().notNull(),
		source: text().$type<"builtin" | "mcp" | "external">().notNull(),
		risk: text().$type<"read" | "write" | "external" | "destructive">(),
		status: text().$type<"done" | "error" | "denied">().notNull(),
		decision: text().$type<"approved" | "denied">(),
		decidedBy: text().$type<"rule" | "mode" | "reviewer" | "primary" | "user" | "timeout">(),
		note: text(),
		args: jsonb().$type<Record<string, unknown>>().notNull(),
		result: text(),
		error: text(),
		durationMs: integer(),
	},
	(t) => [
		index("activity_log_at_idx").on(t.at),
		index("activity_log_user_idx").on(t.userId, t.at),
		index("activity_log_agent_idx").on(t.agentId, t.at),
		uniqueIndex("activity_log_call_idx").on(t.messageId, t.toolCallId),
	],
);

/**
 * Every model call's tokens, kept apart from chats so deleting a chat (or a bot) doesn't erase what was used.
 * Written where calls end (llm/gateway.ts) and for subscription agents' replies (agent/runtime.ts).
 */
export const usageLog = pgTable(
	"usage_log",
	{
		id: text().primaryKey(),
		at: ms().notNull(),
		/** Who it counts for (kept when the account is deleted, so totals stay right). */
		userId: text(),
		agentId: text(),
		purpose: text().$type<"reply" | "background">().notNull(),
		model: text().notNull(),
		inputTokens: integer().notNull().default(0),
		outputTokens: integer().notNull().default(0),
		reasoningTokens: integer().notNull().default(0),
		cachedTokens: integer().notNull().default(0),
		runId: text(),
	},
	(t) => [
		index("usage_log_at_idx").on(t.at),
		index("usage_log_agent_idx").on(t.agentId, t.at),
		index("usage_log_user_idx").on(t.userId, t.at),
	],
);

export const runs = pgTable(
	"runs",
	{
		id: text().primaryKey(),
		userId: owner(),
		agentId: text()
			.notNull()
			.references(() => agents.id, { onDelete: "cascade" }),
		conversationId: text()
			.notNull()
			.references(() => conversations.id, { onDelete: "cascade" }),
		messageId: text(),
		trigger: text().$type<RunTrigger>().notNull(),
		title: text().notNull(),
		status: text().$type<RunStatus>().notNull(),
		model: text(),
		steps: integer().notNull().default(0),
		usage: jsonb().$type<Usage>(),
		error: text(),
		routineId: text(),
		createdAt: ms().notNull(),
		startedAt: ms(),
		finishedAt: ms(),
	},
	(t) => [
		index("runs_agent_idx").on(t.agentId, t.createdAt),
		index("runs_status_idx").on(t.status),
		index("runs_user_idx").on(t.userId, t.createdAt),
	],
);

export const skills = pgTable(
	"skills",
	{
		id: text().primaryKey(),
		/** null: built in, for everyone. */
		userId: text().references(() => users.id, { onDelete: "cascade" }),
		name: text().notNull(),
		title: text().notNull(),
		description: text().notNull(),
		instructions: text().notNull(),
		builtin: boolean().notNull().default(false),
		enabled: boolean().notNull().default(true),
		shared: boolean().notNull().default(false),
		createdBy: text().$type<"system" | "user" | "agent">().notNull(),
		...timestamps,
	},
	(t) => [
		uniqueIndex("skills_owner_name_idx").on(t.userId, t.name),
		// Built-in skills (no owner) have unique names too.
		uniqueIndex("skills_builtin_name_idx").on(t.name).where(sql`${t.userId} is null`),
	],
);

export const mcpServers = pgTable(
	"mcp_servers",
	{
		id: text().primaryKey(),
		userId: owner(),
		name: text().notNull(),
		title: text().notNull(),
		description: text().notNull().default(""),
		transport: jsonb().$type<McpTransport>().notNull(),
		enabled: boolean().notNull().default(true),
		requireApproval: boolean().notNull().default(false),
		/** "all": every bot has its tools; "agents": only bots it's turned on for. */
		scope: text().$type<McpScope>().notNull().default("agents"),
		/** The app store entry it was added from, if any. */
		catalogId: text(),
		/** OAuth sign-in (client registration, tokens), encrypted. */
		oauth: text(),
		/** An admin's app that everyone's bots may use (with the admin's sign-in). */
		everyone: boolean().notNull().default(false),
		...timestamps,
	},
	(t) => [uniqueIndex("mcp_servers_owner_name_idx").on(t.userId, t.name)],
);

export const uploads = pgTable("uploads", {
	id: text().primaryKey(),
	/** Whose file it is. null: the server's own (only admins see it). */
	userId: text().references(() => users.id, { onDelete: "cascade" }),
	/** "users": anyone signed in may see it (bots' pictures, which shared bots show to others). */
	visibility: text().$type<"owner" | "users">().notNull().default("owner"),
	name: text().notNull(),
	mime: text().notNull(),
	size: integer().notNull(),
	path: text().notNull(),
	kind: text().$type<"image" | "file">().notNull(),
	createdAt: ms().notNull(),
});

export const channels = pgTable(
	"channels",
	{
		id: text().primaryKey(),
		agentId: text()
			.notNull()
			.references(() => agents.id, { onDelete: "cascade" }),
		type: text().$type<ChannelType>().notNull(),
		name: text().notNull(),
		enabled: boolean().notNull().default(true),
		config: jsonb().$type<Record<string, string>>().notNull(),
		secrets: jsonb().$type<Record<string, string>>().notNull(),
		dmPolicy: text().$type<DmPolicy>().notNull(),
		allowFrom: jsonb().$type<string[]>().notNull(),
		groupPolicy: text().$type<GroupPolicy>().notNull(),
		delivery: text().$type<ChannelDelivery>().notNull(),
		...timestamps,
	},
	(t) => [index("channels_agent_idx").on(t.agentId)],
);

/** Links an external chat (a Telegram DM, a Discord channel…) to the Sekai conversation it feeds. */
export const channelBindings = pgTable(
	"channel_bindings",
	{
		id: text().primaryKey(),
		channelId: text()
			.notNull()
			.references(() => channels.id, { onDelete: "cascade" }),
		externalChatId: text().notNull(),
		conversationId: text()
			.notNull()
			.references(() => conversations.id, { onDelete: "cascade" }),
		chatName: text().notNull(),
		isGroup: boolean().notNull(),
		listen: boolean().notNull().default(false),
		lastInboundAt: ms(),
		createdAt: ms().notNull(),
	},
	(t) => [
		uniqueIndex("channel_bindings_chat_idx").on(t.channelId, t.externalChatId),
		index("channel_bindings_conversation_idx").on(t.conversationId),
		index("channel_bindings_external_idx").on(t.externalChatId),
	],
);

/**
 * Which platform messages show which Sekai message: replies stream into (and retries edit) the same
 * platform messages, and a platform reply or context-menu action finds the Sekai message it's about.
 */
export const channelMessages = pgTable(
	"channel_messages",
	{
		id: text().primaryKey(),
		channelId: text()
			.notNull()
			.references(() => channels.id, { onDelete: "cascade" }),
		externalChatId: text().notNull(),
		externalMessageId: text().notNull(),
		/** No foreign key: when a message is deleted in Sekai, its platform copies are removed first. */
		messageId: text().notNull(),
		/** in: someone wrote it on the platform. out: the bot posted it (seq orders a long reply's pieces). */
		direction: text().$type<"in" | "out">().notNull(),
		seq: integer().notNull().default(0),
		createdAt: ms().notNull(),
	},
	(t) => [
		index("channel_messages_external_idx").on(t.externalChatId, t.externalMessageId),
		index("channel_messages_message_idx").on(t.messageId),
	],
);

/** Agent CLIs you've signed in to yourself (BYOS): Codex, Claude Code, OpenCode, Pi… */
export const providers = pgTable("providers", {
	id: text().primaryKey(),
	preset: text().$type<ProviderPresetId>().notNull(),
	kind: text().$type<ProviderKind>().notNull(),
	title: text().notNull(),
	enabled: boolean().notNull().default(true),
	command: text().notNull(),
	args: jsonb().$type<string[]>().notNull(),
	env: jsonb().$type<Record<string, string>>().notNull(),
	extraModels: jsonb().$type<string[]>().notNull(),
	/** The last check (models, reasoning levels, sign-in state), so the model picker works after a restart. */
	status: jsonb().$type<ProviderStatus>(),
	...timestamps,
});

/**
 * One external agent session per agent, conversation and provider. The agent keeps its own transcript;
 * Sekai remembers which messages it has already seen so each turn only sends what's new.
 */
export const externalSessions = pgTable(
	"external_sessions",
	{
		id: text().primaryKey(),
		agentId: text()
			.notNull()
			.references(() => agents.id, { onDelete: "cascade" }),
		conversationId: text()
			.notNull()
			.references(() => conversations.id, { onDelete: "cascade" }),
		providerId: text()
			.notNull()
			.references(() => providers.id, { onDelete: "cascade" }),
		/** Capability token in the URL of this session's Sekai tools bridge (MCP over HTTP). */
		token: text().notNull(),
		/** The agent's own session id (ACP sessionId or Claude Code session id). */
		sessionId: text(),
		/** createdAt of the newest Sekai message the agent has been shown. */
		syncedAt: ms(),
		/** Hash per system-prompt section, so changed instructions are re-sent (ACP has no system prompt refresh). */
		promptHashes: jsonb().$type<Record<string, string>>(),
		...timestamps,
	},
	(t) => [
		uniqueIndex("external_sessions_key_idx").on(t.agentId, t.conversationId, t.providerId),
		uniqueIndex("external_sessions_token_idx").on(t.token),
	],
);

/** Each bot's SSH keypair, used for all its machines. */
export const agentKeys = pgTable("agent_keys", {
	agentId: text()
		.primaryKey()
		.references(() => agents.id, { onDelete: "cascade" }),
	publicKey: text().notNull(),
	/** Encrypted at rest (see lib/secrets.ts). */
	privateKey: text().notNull(),
	createdAt: ms().notNull(),
});

/** Bots' computers (with a desktop) and devboxes (temporary), as Proxmox VMs or containers, and lent devices. */
export const machines = pgTable(
	"machines",
	{
		id: text().primaryKey(),
		agentId: text()
			.notNull()
			.references(() => agents.id, { onDelete: "cascade" }),
		kind: text().$type<MachineKind>().notNull(),
		provider: text().$type<MachineProvider>().notNull(),
		/** Proxmox machines: "vm" or "lxc" (a container). */
		backend: text().$type<MachineBackend>(),
		name: text().notNull(),
		status: text().$type<MachineStatus>().notNull(),
		statusDetail: text(),
		specs: jsonb().$type<MachineSpecs>().notNull(),
		hostname: text().notNull(),
		username: text().notNull(),
		addresses: jsonb().$type<Machine["addresses"]>().notNull(),
		ports: jsonb().$type<Machine["ports"]>().notNull(),
		remoteId: text(),
		/** Passwords (root, the bot's user, VNC), encrypted at rest. */
		secrets: text().notNull(),
		expiresAt: ms(),
		/** Its bots may use it when people they're shared with chat with them (see mayUseShared). */
		shareWithViewers: boolean().notNull().default(false),
		createdBy: text().$type<"user" | "agent">().notNull(),
		lastUsedAt: ms(),
		...timestamps,
	},
	(t) => [index("machines_agent_idx").on(t.agentId)],
);

/**
 * Other bots on a bot's machine: each its own account (and on a computer its own screen :display, VNC port and
 * Chrome debugging port). The machine's owner is its own bot's owner.
 */
export const machineMembers = pgTable(
	"machine_members",
	{
		id: text().primaryKey(),
		machineId: text()
			.notNull()
			.references(() => machines.id, { onDelete: "cascade" }),
		agentId: text()
			.notNull()
			.references(() => agents.id, { onDelete: "cascade" }),
		username: text().notNull(),
		display: integer(),
		vncPort: integer(),
		cdpPort: integer(),
		status: text().$type<MemberStatus>().notNull(),
		statusDetail: text(),
		/** The account's password and VNC's, encrypted at rest. */
		secrets: text().notNull(),
		...timestamps,
	},
	(t) => [
		uniqueIndex("machine_members_seat_idx").on(t.machineId, t.agentId),
		index("machine_members_agent_idx").on(t.agentId),
	],
);

/** Browsers several bots use, on the server (machineId null) or one of the owner's computers. */
export const sharedBrowsers = pgTable(
	"shared_browsers",
	{
		id: text().primaryKey(),
		userId: owner(),
		name: text().notNull(),
		machineId: text().references(() => machines.id, { onDelete: "cascade" }),
		signIns: text().$type<SignInMode>().notNull(),
		shareWithViewers: boolean().notNull().default(false),
		/** On a computer with shared sign-ins: its Chrome's debugging port there. */
		port: integer(),
		...timestamps,
	},
	(t) => [index("shared_browsers_user_idx").on(t.userId)],
);

export const sharedBrowserMembers = pgTable(
	"shared_browser_members",
	{
		browserId: text()
			.notNull()
			.references(() => sharedBrowsers.id, { onDelete: "cascade" }),
		agentId: text()
			.notNull()
			.references(() => agents.id, { onDelete: "cascade" }),
		/** On a computer with separate sign-ins: this bot's Chrome's debugging port there. */
		port: integer(),
		createdAt: ms().notNull(),
	},
	(t) => [primaryKey({ columns: [t.browserId, t.agentId] }), index("shared_browser_members_agent_idx").on(t.agentId)],
);

/** Logins you let a bot reuse. Passwords are encrypted at rest. */
export const savedLogins = pgTable(
	"saved_logins",
	{
		id: text().primaryKey(),
		agentId: text()
			.notNull()
			.references(() => agents.id, { onDelete: "cascade" }),
		site: text().notNull(),
		username: text().notNull(),
		secret: text().notNull(),
		lastUsedAt: ms(),
		createdAt: ms().notNull(),
	},
	(t) => [uniqueIndex("saved_logins_site_idx").on(t.agentId, t.site, t.username)],
);

/** The owner's account. Sekai has a single owner; the table leaves room for more later. */
/** What people may do: built-in Admin and Member, and the ones admins make. */
export const roles = pgTable("roles", {
	id: text().primaryKey(),
	name: text().notNull(),
	description: text().notNull().default(""),
	builtin: text().$type<"admin" | "member">(),
	permissions: jsonb().$type<Permission[]>().notNull(),
	limits: jsonb().$type<RoleLimits>().notNull(),
	requireMfa: boolean().notNull().default(false),
	...timestamps,
});

export const users = pgTable(
	"users",
	{
		id: text().primaryKey(),
		username: text().notNull(),
		email: text(),
		/** For text-message sign-in codes, with its country code (+15551234567). */
		phone: text(),
		name: text().notNull(),
		roleId: text()
			.notNull()
			.references(() => roles.id),
		/** argon2id (Bun.password). null: no password (single sign-on only, or an invite not used yet). */
		passwordHash: text(),
		passwordChangedAt: ms().notNull(),
		/** A temporary password an admin set: they choose their own at the next sign-in. */
		mustChangePassword: boolean().notNull().default(false),
		/** Every sign-in that didn't use a passkey ends with one (or a recovery code) as its second step. */
		requirePasskey: boolean().notNull().default(false),
		disabledAt: ms(),
		lastLoginAt: ms(),
		...timestamps,
	},
	(t) => [uniqueIndex("users_username_idx").on(t.username), uniqueIndex("users_email_idx").on(t.email)],
);

/** Each person's own settings (the server's are in settings). */
export const userPrefs = pgTable("user_prefs", {
	userId: text()
		.primaryKey()
		.references(() => users.id, { onDelete: "cascade" }),
	/** IANA zone, or "auto" for the server's. */
	timezone: text().notNull().default("auto"),
	approvalMode: text().$type<ApprovalMode>(),
	toolRules: jsonb().$type<ToolRules>().notNull().default({}),
	/** Smaller personal settings by name (digest, memory check-ups…). */
	data: jsonb().$type<Record<string, unknown>>().notNull().default({}),
	updatedAt: ms().notNull(),
});

/** Single sign-on: Google, GitHub, Discord, or any OpenID Connect provider (Authentik, Keycloak, Okta…). */
export const authProviders = pgTable("auth_providers", {
	id: text().primaryKey(),
	kind: text().$type<"google" | "github" | "discord" | "oidc">().notNull(),
	name: text().notNull(),
	enabled: boolean().notNull().default(true),
	clientId: text().notNull(),
	/** Sealed. */
	clientSecret: text().notNull(),
	/** OpenID Connect only: the issuer (its /.well-known/openid-configuration is read from there). */
	issuer: text(),
	scopes: text(),
	/** Sign in someone whose verified email matches their Sekai account, linking it the first time. */
	linkByEmail: boolean().notNull().default(true),
	...timestamps,
});

/** Sign-in accounts linked to a person (a provider's user id). */
export const userIdentities = pgTable(
	"user_identities",
	{
		id: text().primaryKey(),
		userId: text()
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		providerId: text()
			.notNull()
			.references(() => authProviders.id, { onDelete: "cascade" }),
		subject: text().notNull(),
		email: text(),
		createdAt: ms().notNull(),
		lastUsedAt: ms(),
	},
	(t) => [
		uniqueIndex("user_identities_subject_idx").on(t.providerId, t.subject),
		index("user_identities_user_idx").on(t.userId),
	],
);

/** Two-factor sign-in methods: an authenticator app (TOTP), or codes by email or text message. */
export const mfaFactors = pgTable(
	"mfa_factors",
	{
		id: text().primaryKey(),
		userId: text()
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		kind: text().$type<"totp" | "email" | "sms">().notNull(),
		/** TOTP: the shared secret, sealed. */
		secret: text(),
		/** Email or sms: where codes go. */
		target: text(),
		/** Set once a first code was entered (unconfirmed ones don't count). */
		confirmedAt: ms(),
		/** TOTP: the last time step used, so a code can't be used twice. */
		lastStep: bigint({ mode: "number" }),
		createdAt: ms().notNull(),
		lastUsedAt: ms(),
	},
	(t) => [index("mfa_factors_user_idx").on(t.userId)],
);

/** One-time recovery codes for when two-factor methods are lost (hashed). */
export const recoveryCodes = pgTable(
	"recovery_codes",
	{
		id: text().primaryKey(),
		userId: text()
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		codeHash: text().notNull(),
		usedAt: ms(),
		createdAt: ms().notNull(),
	},
	(t) => [index("recovery_codes_user_idx").on(t.userId)],
);

/**
 * Short-lived, single-use secrets: a sign-in waiting for its second factor, a code sent by email or text, an invite or
 * a password reset link, a single sign-on round trip. Only hashes are stored.
 */
export const authTickets = pgTable(
	"auth_tickets",
	{
		id: text().primaryKey(),
		kind: text().$type<"mfa" | "code" | "invite" | "reset" | "sso" | "app" | "app_code">().notNull(),
		userId: text().references(() => users.id, { onDelete: "cascade" }),
		tokenHash: text().notNull(),
		/** A code sent by email or text (hashed). */
		codeHash: text(),
		attempts: integer().notNull().default(0),
		data: jsonb().$type<Record<string, unknown>>().notNull().default({}),
		expiresAt: ms().notNull(),
		createdAt: ms().notNull(),
	},
	(t) => [uniqueIndex("auth_tickets_token_idx").on(t.tokenHash), index("auth_tickets_user_idx").on(t.userId, t.kind)],
);

/** WebAuthn credentials (Face ID, Touch ID, Windows Hello, password managers, security keys). */
export const passkeys = pgTable(
	"passkeys",
	{
		/** The credential id, base64url. */
		id: text().primaryKey(),
		userId: text()
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		name: text().notNull(),
		publicKey: text().notNull(),
		counter: bigint({ mode: "number" }).notNull(),
		transports: jsonb().$type<string[]>().notNull(),
		aaguid: text(),
		backedUp: boolean().notNull(),
		rpId: text().notNull(),
		createdAt: ms().notNull(),
		lastUsedAt: ms(),
	},
	(t) => [index("passkeys_user_idx").on(t.userId)],
);

/** Signed-in browsers. The cookie holds a secret; only its SHA-256 is stored. */
export const sessions = pgTable(
	"sessions",
	{
		id: text().primaryKey(),
		tokenHash: text().notNull(),
		userId: text()
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		method: text().$type<"password" | "passkey" | "setup" | "sso" | "invite" | "app">().notNull(),
		/**
		 * Signed in, but owes a step before anything else: choose their own password (an admin set a temporary one),
		 * or set up two-factor sign-in (their role requires it).
		 */
		restriction: text().$type<"password" | "mfa">(),
		/** The last time they proved it's them (password, passkey or second factor): sensitive changes ask again after a while. */
		verifiedAt: ms(),
		userAgent: text(),
		ip: text(),
		createdAt: ms().notNull(),
		lastSeenAt: ms().notNull(),
		expiresAt: ms().notNull(),
	},
	(t) => [uniqueIndex("sessions_token_idx").on(t.tokenHash), index("sessions_user_idx").on(t.userId)],
);

/** Tokens for scripts and the desktop app. "bridge" tokens only let a desktop app lend its computer. */
export const apiTokens = pgTable(
	"api_tokens",
	{
		id: text().primaryKey(),
		userId: text()
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		name: text().notNull(),
		scope: text().$type<"full" | "bridge" | "extension">().notNull(),
		tokenHash: text().notNull(),
		/** The first characters, so you can tell tokens apart. */
		prefix: text().notNull(),
		createdAt: ms().notNull(),
		lastUsedAt: ms(),
	},
	(t) => [uniqueIndex("api_tokens_hash_idx").on(t.tokenHash)],
);

/** API providers you added: OpenAI-, Anthropic- or Gemini-compatible model APIs. */
export const apiProviders = pgTable("api_providers", {
	id: text().primaryKey(),
	name: text().notNull(),
	preset: text().notNull(),
	kind: text().$type<ApiKind>().notNull(),
	baseUrl: text().notNull(),
	/** Encrypted at rest; empty when the provider needs no key. */
	apiKey: text().notNull(),
	headers: jsonb().$type<Record<string, string>>().notNull(),
	discover: boolean().notNull(),
	models: jsonb().$type<ApiModel[]>().notNull(),
	enabled: boolean().notNull(),
	...timestamps,
});

/** A pgvector column of any size (each code index keeps the size of its embedding model). */
const vector = customType<{ data: number[]; driverData: string }>({
	dataType: () => "vector",
	toDriver: (v) => `[${v.join(",")}]`,
	fromDriver: (v) => JSON.parse(String(v)) as number[],
});
const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

/** A folder of code a bot indexed for search by meaning, on one of its machines (or your computer). */
export const codeIndexes = pgTable(
	"code_indexes",
	{
		id: text().primaryKey(),
		agentId: text()
			.notNull()
			.references(() => agents.id, { onDelete: "cascade" }),
		machineId: text()
			.notNull()
			.references(() => machines.id, { onDelete: "cascade" }),
		/** The folder, as an absolute path on that machine. */
		root: text().notNull(),
		name: text().notNull(),
		embeddingModel: text().notNull(),
		dimensions: integer(),
		status: text().$type<CodeIndexStatus>().notNull(),
		progress: jsonb().$type<CodeIndexProgress | null>(),
		files: integer().notNull(),
		chunks: integer().notNull(),
		bytes: bigint({ mode: "number" }).notNull(),
		error: text(),
		lastIndexedAt: ms(),
		...timestamps,
	},
	(t) => [
		uniqueIndex("code_indexes_root_idx").on(t.machineId, t.root),
		index("code_indexes_agent_idx").on(t.agentId),
	],
);

export const codeFiles = pgTable(
	"code_files",
	{
		indexId: text()
			.notNull()
			.references(() => codeIndexes.id, { onDelete: "cascade" }),
		path: text().notNull(),
		hash: text().notNull(),
		size: integer().notNull(),
		chunks: integer().notNull(),
	},
	(t) => [primaryKey({ columns: [t.indexId, t.path] })],
);

export const codeChunks = pgTable(
	"code_chunks",
	{
		id: bigserial({ mode: "number" }).primaryKey(),
		indexId: text()
			.notNull()
			.references(() => codeIndexes.id, { onDelete: "cascade" }),
		path: text().notNull(),
		startLine: integer().notNull(),
		endLine: integer().notNull(),
		symbol: text(),
		content: text().notNull(),
		embedding: vector().notNull(),
		/** Words and identifiers, for keyword matches next to the meaning search. */
		tsv: tsvector().generatedAlwaysAs(
			sql`to_tsvector('simple', regexp_replace(path || ' ' || content, '[^A-Za-z0-9]+', ' ', 'g'))`,
		),
	},
	(t) => [index("code_chunks_file_idx").on(t.indexId, t.path), index("code_chunks_tsv_idx").using("gin", t.tsv)],
);

/** Your document library: files you uploaded (PDFs, Word, Markdown, text…) that every bot can search. */
export const documents = pgTable(
	"documents",
	{
		id: text().primaryKey(),
		userId: owner(),
		title: text().notNull(),
		/** The folder it came in with ("" for files uploaded on their own). */
		collection: text().notNull().default(""),
		fileName: text().notNull(),
		mime: text().notNull(),
		size: integer().notNull(),
		/** The original file, in uploads. */
		uploadId: text(),
		status: text().$type<"indexing" | "ready" | "error">().notNull(),
		/** Why it failed; or, when ready, a warning (e.g. searchable by words only). */
		error: text(),
		pages: integer(),
		chunks: integer().notNull().default(0),
		chars: integer().notNull().default(0),
		embeddingModel: text(),
		...timestamps,
	},
	(t) => [index("documents_collection_idx").on(t.collection), index("documents_user_idx").on(t.userId)],
);

export const documentChunks = pgTable(
	"document_chunks",
	{
		id: bigserial({ mode: "number" }).primaryKey(),
		documentId: text()
			.notNull()
			.references(() => documents.id, { onDelete: "cascade" }),
		ord: integer().notNull(),
		page: integer(),
		heading: text(),
		content: text().notNull(),
		/** null when the embedding model couldn't be reached: the chunk is still found by its words. */
		embedding: vector(),
		tsv: tsvector().generatedAlwaysAs(sql`to_tsvector('simple', coalesce(heading, '') || ' ' || content)`),
	},
	(t) => [
		index("document_chunks_doc_idx").on(t.documentId, t.ord),
		index("document_chunks_tsv_idx").using("gin", t.tsv),
	],
);

/** Your own servers and devices that Sekai's master SSH key can log in to (often found on your tailnet). */
export const hosts = pgTable("hosts", {
	id: text().primaryKey(),
	name: text().notNull().unique(),
	address: text().notNull(),
	port: integer().notNull().default(22),
	/** The account the master key logs in as (bots get their keys added to it). */
	user: text().notNull(),
	/** More accounts bots may be let into (root, a service account…), each with the master key installed. */
	accounts: jsonb().$type<string[]>().notNull().default([]),
	source: text().$type<"manual" | "tailscale">().notNull().default("manual"),
	tailscaleId: text(),
	os: text(),
	description: text().notNull().default(""),
	...timestamps,
});

/**
 * Bots allowed onto a host or another bot's machine: their own key is in its authorized_keys. Exactly one of
 * hostId / machineId is set.
 */
export const accessGrants = pgTable(
	"access_grants",
	{
		id: text().primaryKey(),
		hostId: text().references(() => hosts.id, { onDelete: "cascade" }),
		machineId: text().references(() => machines.id, { onDelete: "cascade" }),
		agentId: text()
			.notNull()
			.references(() => agents.id, { onDelete: "cascade" }),
		/** On a host: the account the bot's key is in (null: the host's own account). */
		account: text(),
		/** Who said yes, in words: you, the reviewer, the primary bot, or the Don't ask rule. */
		grantedBy: text().notNull(),
		reason: text().notNull().default(""),
		createdAt: ms().notNull(),
	},
	(t) => [index("access_grants_agent_idx").on(t.agentId)],
);
