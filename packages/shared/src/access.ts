import { z } from "zod";
import { USERNAME_PATTERN } from "./auth.ts";
import { patchOf } from "./patch.ts";

/**
 * What a role lets its people do. "admin" is everything: server settings, users and roles, every feature, no limits.
 * The rest are features of a person's own workspace (their bots, chats, memory…), each off unless the role has it.
 */
export const PERMISSIONS = [
	"admin",
	"bots",
	"web",
	"browser",
	"routines",
	"library",
	"voice",
	"apps",
	"channels",
	"computers",
	"code",
	"subscriptions",
	"compare",
	"share",
] as const;
export const Permission = z.enum(PERMISSIONS);
export type Permission = z.infer<typeof Permission>;

export const PERMISSION_INFO: Record<Permission, { label: string; description: string; risky?: boolean }> = {
	admin: {
		label: "Admin",
		description: "Everything: server settings, people and roles, backups, every feature, no limits.",
		risky: true,
	},
	bots: { label: "Make bots", description: "Create and change their own bots, up to the limit." },
	web: { label: "Web", description: "Bots search the web and read pages." },
	browser: {
		label: "Browser",
		description: "Bots use a browser on this server: sign in to sites, click and fill forms.",
	},
	routines: { label: "Routines", description: "Schedules, reminders and webhooks that run on their own." },
	library: { label: "Library", description: "Their own documents for bots to search." },
	voice: { label: "Voice", description: "Calls, read-aloud, voice messages and making voices." },
	apps: { label: "Apps", description: "Connect apps for their own bots." },
	channels: { label: "Accounts", description: "Discord, Slack, X, Instagram and TikTok accounts for their bots." },
	computers: {
		label: "Computers",
		description: "Bots' own computers and devboxes.",
		risky: true,
	},
	code: { label: "Code search", description: "Index and search code on their bots' computers." },
	subscriptions: {
		label: "Subscriptions",
		description:
			"Use the subscriptions connected here (Codex, Claude Code…) as a model. They can run commands on this server.",
		risky: true,
	},
	compare: { label: "Compare models", description: "Send one prompt to several models side by side." },
	share: { label: "Share bots", description: "Share their bots with other people here." },
};

/** Usage limits for a role (null: no limit). Admins have none. */
export const RoleLimits = z.object({
	/** Models they may use (gateway or API provider ids). null: any. */
	models: z.array(z.string().min(1).max(200)).max(200).nullable().default(null),
	maxBots: z.number().int().min(0).max(1000).nullable().default(null),
	tokensPerDay: z.number().int().min(0).nullable().default(null),
	tokensPerMonth: z.number().int().min(0).nullable().default(null),
	/** US dollars a month, at the model prices set in Usage. */
	costPerMonth: z.number().min(0).max(1_000_000).nullable().default(null),
	/** Uploads and library documents together, in megabytes. */
	storageMb: z.number().int().min(0).max(1_000_000).nullable().default(null),
});
export type RoleLimits = z.infer<typeof RoleLimits>;

export interface Role {
	id: string;
	name: string;
	description: string;
	/** "admin" and "member" come with Sekai: they can be changed (admin's permissions can't) but not deleted. */
	builtin: "admin" | "member" | null;
	permissions: Permission[];
	limits: RoleLimits;
	/** People with this role must set up two-factor sign-in. */
	requireMfa: boolean;
	/** How many people have it. */
	users: number;
	createdAt: number;
	updatedAt: number;
}

export const RoleInput = z.object({
	name: z.string().trim().min(1).max(60),
	description: z.string().max(300).default(""),
	permissions: z.array(Permission).max(PERMISSIONS.length).default([]),
	limits: RoleLimits.default(RoleLimits.parse({})),
	requireMfa: z.boolean().default(false),
});
export type RoleInput = z.input<typeof RoleInput>;
export const RoleUpdate = patchOf(RoleInput);
export type RoleUpdate = z.input<typeof RoleUpdate>;

/** What you're allowed to do here (for the apps to show and hide things; the server checks every request). */
export interface Access {
	userId: string;
	roleId: string;
	roleName: string;
	admin: boolean;
	permissions: Permission[];
	limits: RoleLimits;
}

export const USERNAME = z
	.string()
	.trim()
	.toLowerCase()
	.regex(USERNAME_PATTERN, "2-39 characters: letters, digits, dots, dashes or underscores");

/** An account as admins see it. */
export interface ManagedUser {
	id: string;
	username: string;
	name: string;
	email: string | null;
	phone: string | null;
	roleId: string;
	disabled: boolean;
	mustChangePassword: boolean;
	/** Two-factor methods set up (totp, email, sms), whether recovery codes are left, and a required passkey. */
	mfa: {
		totp: boolean;
		email: boolean;
		sms: boolean;
		passkeys: number;
		recoveryCodes: number;
		passkeyRequired: boolean;
	};
	/** Single sign-on accounts linked to it (provider names). */
	identities: { providerId: string; providerName: string; email: string | null }[];
	lastLoginAt: number | null;
	createdAt: number;
}

export const UserCreate = z.object({
	username: USERNAME,
	name: z.string().trim().min(1).max(80),
	email: z.string().trim().toLowerCase().email().max(200).nullable().default(null),
	phone: z
		.string()
		.trim()
		.regex(/^\+[1-9]\d{6,14}$/, "A phone number with its country code, like +15551234567")
		.nullable()
		.default(null),
	roleId: z.string().min(1),
	/** none: they sign in with single sign-on only. temporary: a password they change at first sign-in. invite: a one-time link. */
	password: z.enum(["temporary", "invite", "none"]).default("temporary"),
});
export type UserCreate = z.input<typeof UserCreate>;

export const UserUpdate = z
	.object({
		name: z.string().trim().min(1).max(80),
		email: z.string().trim().toLowerCase().email().max(200).nullable(),
		phone: z
			.string()
			.trim()
			.regex(/^\+[1-9]\d{6,14}$/, "A phone number with its country code, like +15551234567")
			.nullable(),
		roleId: z.string().min(1),
		disabled: z.boolean(),
	})
	.partial();
export type UserUpdate = z.input<typeof UserUpdate>;

/** What an admin gets back after making an account or resetting its sign-in (shown once). */
export interface UserCredentials {
	user: ManagedUser;
	/** A temporary password (they choose their own at first sign-in). */
	temporaryPassword?: string;
	/** A one-time link to set their password (expires in 7 days). */
	inviteUrl?: string;
	/** The invite was emailed to them. */
	emailed?: boolean;
}

/** Who a bot is shared with. */
export const ShareTarget = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("user"), userId: z.string().min(1) }),
	z.object({ kind: z.literal("role"), roleId: z.string().min(1) }),
	z.object({ kind: z.literal("everyone") }),
]);
export type ShareTarget = z.infer<typeof ShareTarget>;

/** One way a bot is shared. */
export interface AgentShare {
	id: string;
	kind: ShareTarget["kind"];
	targetId: string | null;
	/** The person's or role's name; "Everyone". */
	name: string;
	createdAt: number;
}

/** Someone you can share with: other people here (names only). */
export interface Person {
	id: string;
	name: string;
	username: string;
}
