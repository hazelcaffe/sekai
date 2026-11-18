import { z } from "zod";
import type { Access } from "./access.ts";

export interface AuthUser {
	id: string;
	username: string;
	name: string;
	email: string | null;
	phone: string | null;
	createdAt: number;
}

/** A single sign-on button on the sign-in page. */
export interface SsoButton {
	id: string;
	kind: SsoKind;
	name: string;
}

export interface AuthStatus {
	/** Nobody has set up this server yet: the first visitor creates the owner account. */
	setupRequired: boolean;
	/** Setting up from another device needs the code printed in the server's log. */
	setupCodeRequired: boolean;
	signedIn: boolean;
	user: AuthUser | null;
	/** How this request was authenticated. */
	via: "session" | "token" | "root" | null;
	/** Someone here has registered a passkey (the sign-in page offers it). */
	hasPasskeys: boolean;
	/** Passkeys work on this address (https, or localhost). */
	passkeysAvailable: boolean;
	/** What you may do (null when signed out). */
	access: Access | null;
	/** Signed in, but owes a step first: choose your own password, or set up two-factor sign-in. */
	restriction: SessionRestriction | null;
	/** Single sign-on providers to offer. */
	sso: SsoButton[];
	/** "Forgot your password?" can email a link (email is set up). */
	passwordReset: boolean;
}

export type SessionRestriction = "password" | "mfa";

/** How a session signed in ("app": the phone app, through the browser). */
export type SessionMethod = "password" | "passkey" | "setup" | "sso" | "invite" | "app";

// ---------------------------------------------------------------- two-step sign-in

export const MFA_METHODS = ["totp", "email", "sms", "recovery"] as const;
export type MfaMethod = (typeof MFA_METHODS)[number];

/** What signing in returns: done, or a second step. */
export type SignInResult =
	| { status: "signed_in"; user: AuthUser; restriction: SessionRestriction | null }
	| {
			status: "mfa";
			/** What this account can use for the second step. */
			methods: MfaMethod[];
			/** Where email and text codes go, partly hidden (h•••@example.com, +1 ••• ••• 4567). */
			hints: { email?: string; sms?: string };
	  };

export const MfaSend = z.object({ method: z.enum(["email", "sms"]) });
export const MfaVerify = z.object({
	method: z.enum(MFA_METHODS),
	code: z
		.string()
		.trim()
		.min(4)
		.max(40)
		.transform((c) => c.replace(/[\s-]/g, "")),
});
export type MfaVerify = z.input<typeof MfaVerify>;

/** Your two-factor sign-in, as Account shows it. */
export interface MfaStatus {
	totp: boolean;
	email: string | null;
	sms: string | null;
	recoveryCodesLeft: number;
	/** Your role requires two-factor sign-in. */
	required: boolean;
	/** Email and text codes can be sent here (an admin set them up). */
	emailAvailable: boolean;
	smsAvailable: boolean;
}

export interface TotpSetup {
	/** For typing in by hand. */
	secret: string;
	/** otpauth:// link (what the QR code holds). */
	uri: string;
	/** The QR code, as an SVG image. */
	qrSvg: string;
}

// ---------------------------------------------------------------- single sign-on

export const SSO_KINDS = ["google", "github", "discord", "oidc"] as const;
export type SsoKind = (typeof SSO_KINDS)[number];

export const SsoProviderInput = z.object({
	kind: z.enum(SSO_KINDS),
	name: z.string().trim().min(1).max(60),
	enabled: z.boolean().default(true),
	clientId: z.string().trim().min(1).max(500),
	/** Masked when read back; send it again (or the masked value) to keep it. */
	clientSecret: z.string().trim().min(1).max(2000),
	/** OpenID Connect: the issuer URL (https://auth.example.com/application/o/sekai/). */
	issuer: z
		.string()
		.trim()
		.url()
		.max(500)
		.refine((u) => u.startsWith("https://") || /^http:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(u), "Use https")
		.nullable()
		.default(null),
	/** Extra scopes, space-separated (the needed ones are always asked for). */
	scopes: z.string().trim().max(500).default(""),
	linkByEmail: z.boolean().default(true),
});
export type SsoProviderInput = z.input<typeof SsoProviderInput>;

export interface SsoProvider {
	id: string;
	kind: SsoKind;
	name: string;
	enabled: boolean;
	clientId: string;
	clientSecret: string;
	issuer: string | null;
	scopes: string;
	linkByEmail: boolean;
	/** Paste this into the provider's app settings as the redirect (callback) URL. */
	callbackUrl: string;
	/** How many accounts are linked to it. */
	linked: number;
	createdAt: number;
}

/** A single sign-on account linked to you. */
export interface LinkedIdentity {
	id: string;
	providerId: string;
	providerName: string;
	kind: SsoKind;
	email: string | null;
	createdAt: number;
	lastUsedAt: number | null;
}

// ---------------------------------------------------------------- invites and resets

/** A one-time link (an invite, or a password reset), as its page sees it. */
export interface TicketInfo {
	kind: "invite" | "reset";
	name: string;
	username: string;
}

export const TicketAccept = z.object({ password: z.string().min(8).max(256) });
export const ForgotPassword = z.object({ email: z.string().trim().toLowerCase().email().max(254) });

// ---------------------------------------------------------------- email and text messages (admin)

export const EmailConfig = z.object({
	enabled: z.boolean().default(false),
	host: z.string().trim().max(200).default(""),
	port: z.number().int().min(1).max(65535).default(587),
	/** TLS from the start (port 465); otherwise STARTTLS when the server offers it. */
	secure: z.boolean().default(false),
	username: z.string().max(200).default(""),
	/** Masked when read back. */
	password: z.string().max(500).default(""),
	from: z.string().trim().max(200).default(""),
});
export type EmailConfig = z.infer<typeof EmailConfig>;

export const SmsConfig = z.object({
	enabled: z.boolean().default(false),
	provider: z.enum(["twilio", "webhook"]).default("twilio"),
	/** Twilio: Account SID, auth token (masked when read back), and a From number or Messaging Service SID. */
	accountSid: z.string().trim().max(100).default(""),
	authToken: z.string().max(200).default(""),
	from: z.string().trim().max(60).default(""),
	/** Webhook: Sekai POSTs {"to", "message"} here with the secret in X-Sekai-Signature (HMAC-SHA256 of the body). */
	webhookUrl: z.string().trim().max(500).default(""),
	webhookSecret: z.string().max(200).default(""),
});
export type SmsConfig = z.infer<typeof SmsConfig>;

export interface SessionInfo {
	id: string;
	method: SessionMethod;
	userAgent: string | null;
	ip: string | null;
	createdAt: number;
	lastSeenAt: number;
	expiresAt: number;
	current: boolean;
}

export interface PasskeyInfo {
	id: string;
	name: string;
	/** Synced across devices (iCloud Keychain, Google Password Manager, a password manager). */
	backedUp: boolean;
	rpId: string;
	createdAt: number;
	lastUsedAt: number | null;
}

export const API_TOKEN_SCOPES = ["full", "bridge"] as const;
export type ApiTokenScope = (typeof API_TOKEN_SCOPES)[number];

export interface ApiTokenInfo {
	id: string;
	name: string;
	scope: ApiTokenScope;
	prefix: string;
	createdAt: number;
	lastUsedAt: number | null;
}

export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{1,38}$/;
export const PASSWORD_MIN = 8;

const Username = z
	.string()
	.trim()
	.toLowerCase()
	.regex(USERNAME_PATTERN, "2-39 characters: letters, digits, dots, dashes or underscores");
const Password = z.string().min(PASSWORD_MIN, `At least ${PASSWORD_MIN} characters`).max(256);
const Email = z
	.string()
	.trim()
	.toLowerCase()
	.email("Enter a valid email")
	.max(254)
	.nullable()
	.optional()
	.or(z.literal("").transform(() => null));

export const SetupInput = z.object({
	username: Username,
	name: z.string().trim().min(1).max(80),
	email: Email,
	password: Password,
	code: z.string().trim().toUpperCase().optional(),
});
export type SetupInput = z.input<typeof SetupInput>;

export const Reauth = z.object({
	password: z.string().max(256).optional(),
	method: z.enum(MFA_METHODS).optional(),
	code: z.string().trim().max(40).optional(),
});

export const LoginInput = z.object({
	/** Username or email. */
	username: z.string().trim().toLowerCase().min(1).max(254),
	password: z.string().min(1).max(256),
});
export type LoginInput = z.input<typeof LoginInput>;

export const AccountPatch = z.object({
	username: Username.optional(),
	name: z.string().trim().min(1).max(80).optional(),
	email: Email,
	phone: z
		.string()
		.trim()
		.regex(/^\+[1-9]\d{6,14}$/, "A phone number with its country code, like +15551234567")
		.nullable()
		.optional()
		.or(z.literal("").transform(() => null)),
});
export type AccountPatch = z.input<typeof AccountPatch>;

export const PasswordChange = z.object({
	/** Not needed when choosing your own password for the first time (after a temporary one). */
	current: z.string().max(256).default(""),
	next: Password,
});
export type PasswordChange = z.input<typeof PasswordChange>;

export const ApiTokenCreate = z.object({
	name: z.string().trim().min(1).max(80),
	scope: z.enum(API_TOKEN_SCOPES).default("full"),
});
export type ApiTokenCreate = z.input<typeof ApiTokenCreate>;

export interface CreatedApiToken extends ApiTokenInfo {
	/** Shown once. */
	token: string;
}
