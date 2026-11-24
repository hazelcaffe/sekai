import { z } from "zod";
import { patchOf } from "./patch.ts";

/*
 * Email for bots: a bot's own address, made on a mailcow server Sekai is connected to (one click) or any email
 * account (IMAP and SMTP). Mail from the people on its list (whose own mail server vouched for them) starts or
 * continues a chat and gets an email reply; everyone else's mail stays in its inbox as untrusted data.
 */

/** An email address, compared in lower case. */
export const EmailAddress = z.string().trim().toLowerCase().email().max(254);

// ---------------------------------------------------------------- mailcow (Settings → Bots → Email)

export const MailcowSettingsInput = z.object({
	/** mailcow's web address, e.g. https://mail.example.com. */
	url: z.string().trim().max(300).default(""),
	/** A read-write API key. Masked when read back; sending the masked value keeps it. */
	apiKey: z.string().trim().max(500).default(""),
	/** Domains bots may get addresses on (from mailcow's list). None until an admin picks them. */
	domains: z.array(z.string().trim().toLowerCase().min(1).max(253)).max(100).default([]),
	/** Size of a new mailbox, in MiB. */
	defaultQuotaMb: z.number().int().min(16).max(1_048_576).default(1024),
});
export type MailcowSettingsInput = z.input<typeof MailcowSettingsInput>;
export const MailcowSettingsUpdate = patchOf(MailcowSettingsInput);
export type MailcowSettingsUpdate = z.input<typeof MailcowSettingsUpdate>;

export interface MailcowSettings {
	url: string;
	/** Masked, or "" when there's none. */
	apiKey: string;
	domains: string[];
	defaultQuotaMb: number;
	/** An address and a key are saved. */
	configured: boolean;
}

export interface MailcowDomainInfo {
	name: string;
	active: boolean;
	mailboxes: number;
	defaultQuotaMb: number;
	maxQuotaMb: number;
}

/** "Check": whether mailcow answers with this address and key, and what it serves. */
export interface MailcowCheck {
	ok: boolean;
	error: string | null;
	/** The key may create mailboxes (a read-only key can't). */
	readWrite: boolean;
	version: string | null;
	domains: MailcowDomainInfo[];
}

/** Check an address and key before saving them (blank: the saved ones). */
export const MailcowCheckInput = z.object({
	url: z.string().trim().max(300).optional(),
	apiKey: z.string().trim().max(500).optional(),
});
export type MailcowCheckInput = z.input<typeof MailcowCheckInput>;

/** What a bot's owner may pick from when giving it an address. */
export interface EmailOptions {
	mailcow: {
		/** Connected, with a read-write key and at least one domain for bots. */
		ready: boolean;
		domains: string[];
	};
}

// ---------------------------------------------------------------- a bot's account

/** "tls": encrypted from the start (993, 465); "starttls": the server's own upgrade (143, 587). */
export const EmailSecurity = z.enum(["tls", "starttls"]);
export type EmailSecurity = z.infer<typeof EmailSecurity>;

export const EmailServer = z.object({
	host: z
		.string()
		.trim()
		.toLowerCase()
		.min(1)
		.max(253)
		.regex(/^[a-z0-9.-]+$/, "A server name like imap.example.com"),
	port: z.number().int().min(1).max(65535),
	security: EmailSecurity,
});
export type EmailServer = z.infer<typeof EmailServer>;

/** Any email account: its address, servers and password (an app password for Gmail, Fastmail…). */
export const EmailConnect = z.object({
	address: EmailAddress,
	/** The name people see on its mail (default: the bot's name). */
	name: z.string().trim().max(120).default(""),
	imap: EmailServer,
	smtp: EmailServer,
	/** Usually the address itself (blank). */
	username: z.string().trim().max(254).default(""),
	password: z.string().min(1).max(500),
	allowFrom: z.array(EmailAddress).max(100).default([]),
});
export type EmailConnect = z.input<typeof EmailConnect>;

/** A mailbox Sekai makes on mailcow: the part before the @ and one of the domains for bots. */
export const EmailMailboxCreate = z.object({
	localPart: z
		.string()
		.trim()
		.toLowerCase()
		.regex(
			/^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/,
			"Letters, numbers, dots, dashes and underscores (not at the start or end)",
		),
	domain: z.string().trim().toLowerCase().min(1).max(253),
	allowFrom: z.array(EmailAddress).max(100).default([]),
});
export type EmailMailboxCreate = z.input<typeof EmailMailboxCreate>;

const EmailAccountFields = z.object({
	name: z.string().trim().max(120),
	/** Who can email it to get things done (the owner's address first). */
	allowFrom: z.array(EmailAddress).max(100),
	/** Added under its emails (plain text). */
	signature: z.string().max(2000),
	/** Mail from people it doesn't know shows up in Needs you. */
	notifyUnknown: z.boolean(),
	/** Emails it may send a day (replies included), to keep the domain's reputation. */
	dailyLimit: z.number().int().min(1).max(2000),
	enabled: z.boolean(),
	/** New sign-in details (reconnecting an account). The password is masked when read back. */
	imap: EmailServer,
	smtp: EmailServer,
	username: z.string().trim().max(254),
	password: z.string().max(500),
});
export const EmailAccountUpdate = patchOf(EmailAccountFields);
export type EmailAccountUpdate = z.input<typeof EmailAccountUpdate>;

export type EmailProblem = "auth" | "full" | "network" | "other";

export interface EmailStatus {
	state: "off" | "connecting" | "connected" | "error";
	problem: EmailProblem | null;
	/** What went wrong, in words. */
	error: string | null;
	since: number | null;
	/** Mail arrives the moment it's delivered (IMAP IDLE); false: checked every few minutes. */
	live: boolean;
}

export interface EmailAccount {
	agentId: string;
	address: string;
	name: string;
	/** Made by Sekai on mailcow, or an account connected with its own sign-in. */
	kind: "mailcow" | "account";
	imap: EmailServer;
	smtp: EmailServer;
	username: string;
	allowFrom: string[];
	signature: string;
	notifyUnknown: boolean;
	dailyLimit: number;
	/** Emails sent in the last 24 hours. */
	sentToday: number;
	enabled: boolean;
	status: EmailStatus;
	/** mailcow mailboxes: how full it is. */
	usage: { usedBytes: number; quotaBytes: number } | null;
	/** mailcow mailboxes: its webmail. */
	webmailUrl: string | null;
	createdAt: number;
}

/** Server settings found for an address (its domain's autoconfig, Mozilla's ISPDB, DNS records, or a guess). */
export interface EmailServerGuess {
	imap: EmailServer;
	smtp: EmailServer;
	/** What to sign in with (usually the address). */
	username: string;
	source: "autoconfig" | "ispdb" | "dns" | "guess";
	/** The provider's name, when known ("Google Mail"). */
	provider: string | null;
}

/** Signs in to both servers without saving anything. */
export const EmailTestInput = z.object({
	address: EmailAddress,
	imap: EmailServer,
	smtp: EmailServer,
	username: z.string().trim().max(254).default(""),
	password: z.string().min(1).max(500),
});
export type EmailTestInput = z.input<typeof EmailTestInput>;

export interface EmailTestResult {
	imap: { ok: boolean; error: string | null };
	smtp: { ok: boolean; error: string | null };
}

/**
 * Who sent a message, as far as Sekai is concerned. allowed: on the list and verified by mail server or signature
 * (it drives the bot); unverified: says it's from someone on the list but nothing vouched for it; unknown: anyone
 * else; self: the bot's own.
 */
export type EmailSender = "allowed" | "unverified" | "unknown" | "self";

/** One email in a bot's recent mail. */
export interface EmailItem {
	id: string;
	direction: "in" | "out";
	from: string;
	fromName: string;
	to: string[];
	subject: string;
	snippet: string;
	sender: EmailSender;
	/** Automatic mail (a bounce, a newsletter, an auto-reply): never acted on. */
	automated: boolean;
	conversationId: string | null;
	attachments: number;
	at: number;
}

/** Mail from someone the bot doesn't know, waiting in Needs you. */
export interface EmailSenderNote {
	id: string;
	agentId: string;
	address: string;
	name: string;
	subject: string;
	/** Its sender's mail server (or a signature) vouched for the address. */
	verified: boolean;
	at: number;
}

/** A chat that came in by email (shown in the chat list with an email mark). */
export interface EmailChat {
	conversationId: string;
	agentId: string;
	/** Who it's with. */
	with: string;
	subject: string;
}

/** "Re: …" once, however many replies deep. */
export function replySubject(subject: string): string {
	const s = subject.trim();
	if (!s) return "Re: (no subject)";
	return /^(re|aw|sv|antw|r)\s*:/i.test(s) ? s : `Re: ${s}`;
}

/** A safe part before the @ from a bot's name: "Mizuki Akiyama" → "mizuki.akiyama". */
export function mailboxName(name: string): string {
	return (
		name
			.normalize("NFKD")
			.replace(/[\u0300-\u036f]/g, "")
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, ".")
			.replace(/^[._-]+|[._-]+$/g, "")
			.replace(/\.{2,}/g, ".")
			.slice(0, 40)
			.replace(/[._-]+$/, "") || "bot"
	);
}
