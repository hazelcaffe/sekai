import { randomBytes } from "node:crypto";
import MailComposer from "nodemailer/lib/mail-composer";
import { errorMessage } from "../lib/errors.ts";
import { log } from "../lib/log.ts";
import { composeEmail, type Quote } from "./compose.ts";
import { describeMailError, smtpTransport, withImap } from "./connect.ts";
import { snippetOf } from "./parse.ts";
import { credentialsOf, emitEmailChanged, recordMail, sentInLastDay, setStatus, storedAccount } from "./store.ts";
import { domainOf } from "./verify.ts";

/**
 * Sending as a bot: through its own SMTP server (mailcow signs it with DKIM), within its daily limit, with a copy
 * in its Sent folder so its mailbox shows the whole conversation.
 */

export class EmailSendError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "EmailSendError";
	}
}

export interface OutgoingFile {
	name: string;
	mime: string;
	data: Uint8Array;
}

export interface OutgoingMail {
	to: string[];
	cc?: string[];
	bcc?: string[];
	subject: string;
	/** The body, in Markdown. */
	markdown: string;
	files?: OutgoingFile[];
	inReplyTo?: string | null;
	references?: string[];
	quote?: Quote | null;
	autoReply?: boolean;
}

export interface SentMail {
	messageId: string;
	recipients: string[];
	/** The raw message (for tests and the Sent copy). */
	raw: Buffer;
}

const MAX_RECIPIENTS = 50;
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

/** Every recipient of a mail, lower case, once. */
export function recipientsOf(mail: Pick<OutgoingMail, "to" | "cc" | "bcc">): string[] {
	return [
		...new Set([...mail.to, ...(mail.cc ?? []), ...(mail.bcc ?? [])].map((a) => a.trim().toLowerCase())),
	].filter(Boolean);
}

/** The raw message a bot sends: its name and address, its signature, threading headers. */
export async function buildMessage(
	account: { address: string; name: string; signature: string },
	mail: OutgoingMail,
	messageId: string,
): Promise<Buffer> {
	const body = composeEmail(mail.markdown, { signature: account.signature, quote: mail.quote ?? null });
	const composer = new MailComposer({
		from: { name: account.name, address: account.address },
		to: mail.to,
		cc: mail.cc?.length ? mail.cc : undefined,
		bcc: mail.bcc?.length ? mail.bcc : undefined,
		subject: mail.subject,
		text: body.text,
		html: body.html,
		messageId: `<${messageId}>`,
		inReplyTo: mail.inReplyTo ? `<${mail.inReplyTo}>` : undefined,
		references: mail.references?.length ? mail.references.map((r) => `<${r}>`) : undefined,
		attachments: (mail.files ?? []).map((f) => ({
			filename: f.name,
			content: Buffer.from(f.data),
			contentType: f.mime,
		})),
		headers: { "X-Mailer": "Sekai", ...(mail.autoReply ? { "Auto-Submitted": "auto-replied" } : {}) },
	});
	return composer.compile().build();
}

/** Keeps a copy in the account's Sent folder (Gmail and Outlook keep their own: skipped there). */
async function copyToSent(account: NonNullable<Awaited<ReturnType<typeof storedAccount>>>, raw: Buffer): Promise<void> {
	if (/(^|\.)(gmail|googlemail|google|outlook|office365|hotmail|live)\.com$/.test(account.smtp.host)) return;
	await withImap(credentialsOf(account), async (client) => {
		const folders = await client.list();
		const sent =
			folders.find((f) => f.specialUse === "\\Sent") ??
			folders.find((f) => /^sent( items| messages)?$/i.test(f.name));
		if (sent) await client.append(sent.path, raw, ["\\Seen"]);
	}).catch((err: unknown) => log.warn(`email: couldn't keep a copy in Sent: ${errorMessage(err)}`));
}

/** Sends an email as the bot. Throws EmailSendError with a sentence the bot (or you) can act on. */
type SendContext = { conversationId?: string | null; sekaiMessageId?: string | null; accountSince?: number };
const sending = new Map<string, Promise<unknown>>();

export async function sendAsBot(agentId: string, mail: OutgoingMail, opts: SendContext = {}): Promise<SentMail> {
	// One server owns these mailboxes. Competing runs must not spend the same last send.
	const next = (sending.get(agentId) ?? Promise.resolve()).catch(() => {}).then(() => sendOne(agentId, mail, opts));
	sending.set(agentId, next);
	try {
		return await next;
	} finally {
		if (sending.get(agentId) === next) sending.delete(agentId);
	}
}

async function sendOne(agentId: string, mail: OutgoingMail, opts: SendContext): Promise<SentMail> {
	const account = await storedAccount(agentId);
	if (!account) throw new EmailSendError("This bot has no email address. Give it one in its Accounts → Email.");
	if (!account.enabled) throw new EmailSendError("This bot's email is turned off (its Accounts → Email).");
	const recipients = recipientsOf(mail);
	if (
		mail.autoReply &&
		(account.createdAt !== opts.accountSince || !recipients.every((r) => account.allowFrom.includes(r)))
	)
		throw new EmailSendError("The account or its list of allowed senders changed before the reply was ready.");
	if (!recipients.length) throw new EmailSendError("Who should it go to? Give at least one address.");
	if (recipients.length > MAX_RECIPIENTS) throw new EmailSendError(`At most ${MAX_RECIPIENTS} recipients.`);
	const size = (mail.files ?? []).reduce((n, f) => n + f.data.byteLength, 0);
	if (size > MAX_ATTACHMENT_BYTES) throw new EmailSendError("The attachments are over 20 MB together; send fewer.");
	const sent = await sentInLastDay(agentId);
	if (sent >= account.dailyLimit)
		throw new EmailSendError(
			`It has sent ${sent} emails in the last 24 hours, its daily limit (${account.dailyLimit}). The owner can raise it in its Accounts → Email.`,
		);

	const messageId = `${randomBytes(12).toString("hex")}.sekai@${domainOf(account.address)}`;
	const raw = await buildMessage(account, mail, messageId);
	const transport = await smtpTransport(credentialsOf(account));
	try {
		await transport.sendMail({ envelope: { from: account.address, to: recipients }, raw });
	} catch (err) {
		const { problem, message } = describeMailError(err, "SMTP");
		if (problem === "auth") setStatus(agentId, { problem, error: message });
		throw new EmailSendError(`The email wasn't sent. ${message}`);
	} finally {
		transport.close();
	}

	await recordMail({
		agentId,
		direction: "out",
		messageId,
		inReplyTo: mail.inReplyTo ?? null,
		references: mail.references ?? [],
		fromAddress: account.address,
		fromName: account.name,
		to: recipients,
		subject: mail.subject,
		snippet: snippetOf(mail.markdown),
		sender: "self",
		conversationId: opts.conversationId ?? null,
		sekaiMessageId: opts.sekaiMessageId ?? null,
		folder: null,
		uid: null,
		attachments: mail.files?.length ?? 0,
		at: Date.now(),
	});
	void emitEmailChanged(agentId);
	void copyToSent(account, raw);
	log.info(`email: ${account.address} sent "${mail.subject.slice(0, 60)}" to ${recipients.length} recipient(s)`);
	return { messageId, recipients, raw };
}
