import {
	type EmailAccount,
	EmailAccountUpdate,
	EmailConnect,
	type EmailItem,
	EmailMailboxCreate,
	type EmailSenderNote,
	type EmailServerGuess,
	EmailTestInput,
	type EmailTestResult,
} from "@sekai/shared";
import { and, desc, eq, inArray } from "drizzle-orm";
import { currentActor } from "../auth/actor.ts";
import { db, schema } from "../db/index.ts";
import { badRequest, notFound, parse } from "../lib/errors.ts";
import { randomChars } from "../lib/ids.ts";
import { log } from "../lib/log.ts";
import { listOwnAgents, requireOwnedAgent } from "../services/agents.ts";
import { discoverServers } from "./autoconfig.ts";
import { testCredentials } from "./connect.ts";
import { MailcowError, mailboxPassword } from "./mailcow.ts";
import { mailcowClient, mailcowSettings } from "./settings.ts";
import {
	clearStatus,
	deleteAccountRow,
	emitEmailChanged,
	insertAccount,
	type MailRow,
	recentMailRows,
	type StoredAccount,
	sentInLastDay,
	statusOf,
	storedAccount,
	updateAccountRow,
} from "./store.ts";
import { restartWatcher, stopWatcher } from "./watch.ts";

/** A bot's email account, as its owner's app sees it (and changes it). Everything here is for the bot's owner. */

const usageCache = new Map<string, { usage: EmailAccount["usage"]; until: number }>();

async function usageOf(account: StoredAccount): Promise<EmailAccount["usage"]> {
	if (account.kind !== "mailcow") return null;
	const hit = usageCache.get(account.agentId);
	if (hit && hit.until > Date.now()) return hit.usage;
	const mailcow = await mailcowClient();
	const box =
		mailcow?.base === account.mailcowUrl ? await mailcow.getMailbox(account.address).catch(() => null) : null;
	const usage = box ? { usedBytes: box.usedBytes, quotaBytes: box.quotaBytes } : null;
	usageCache.set(account.agentId, { usage, until: Date.now() + 5 * 60_000 });
	return usage;
}

export async function publicAccount(account: StoredAccount): Promise<EmailAccount> {
	return {
		agentId: account.agentId,
		address: account.address,
		name: account.name,
		kind: account.kind,
		imap: account.imap,
		smtp: account.smtp,
		username: account.username,
		allowFrom: account.allowFrom,
		signature: account.signature,
		notifyUnknown: account.notifyUnknown,
		dailyLimit: account.dailyLimit,
		sentToday: await sentInLastDay(account.agentId),
		enabled: account.enabled,
		status: statusOf(account.agentId),
		usage: await usageOf(account),
		webmailUrl: account.kind === "mailcow" && account.mailcowUrl ? `${account.mailcowUrl}/SOGo/` : null,
		createdAt: account.createdAt,
	};
}

export async function getEmailAccount(agentId: string): Promise<EmailAccount | null> {
	await requireOwnedAgent(agentId);
	const account = await storedAccount(agentId);
	return account ? publicAccount(account) : null;
}

/** For the bot's prompt: its address and whether it works. */
export async function emailAddressOf(agentId: string): Promise<{ address: string; connected: boolean } | null> {
	if (currentActor() && !(await requireOwnedAgent(agentId).catch(() => null))) return null;
	const account = await storedAccount(agentId).catch(() => null);
	if (!account?.enabled) return null;
	return { address: account.address, connected: statusOf(agentId).state === "connected" };
}

/** The owner's own address first on a new list (when their account has one). */
async function withOwner(allowFrom: string[]): Promise<string[]> {
	const me = currentActor()?.userId;
	const user = me ? await db.query.users.findFirst({ where: eq(schema.users.id, me) }) : null;
	const own = user?.email?.trim().toLowerCase();
	return [...new Set([...(own ? [own] : []), ...allowFrom.map((a) => a.toLowerCase())])];
}

async function requireNoAccount(agentId: string): Promise<void> {
	if (await storedAccount(agentId))
		throw badRequest("This bot already has an email address. Remove it first to use another.");
}

/** Makes a mailbox on mailcow for the bot (one click): its name, a generated password Sekai keeps sealed. */
export async function createMailbox(agentId: string, input: unknown): Promise<EmailAccount> {
	const data = parse(EmailMailboxCreate, input);
	const agent = await requireOwnedAgent(agentId);
	await requireNoAccount(agentId);
	const settings = await mailcowSettings();
	const mailcow = await mailcowClient();
	if (!mailcow || !settings.domains.length)
		throw badRequest("Email addresses aren't set up on this server yet. Ask an admin to connect mailcow.");
	if (!settings.domains.includes(data.domain)) throw badRequest(`Bots can't get addresses on ${data.domain}.`);
	const address = `${data.localPart}@${data.domain}`;
	const password = mailboxPassword(randomChars);
	try {
		if (await mailcow.getMailbox(address)) throw badRequest(`${address} is already taken. Pick another name.`);
		await mailcow.createMailbox({
			localPart: data.localPart,
			domain: data.domain,
			name: agent.name,
			password,
			quotaMb: settings.defaultQuotaMb,
		});
	} catch (err) {
		if (err instanceof MailcowError) throw badRequest(err.message);
		throw err;
	}
	const host = new URL(mailcow.base).hostname;
	const now = Date.now();
	try {
		await insertAccount({
			agentId,
			address,
			name: agent.name,
			kind: "mailcow",
			mailcowUrl: mailcow.base,
			imap: { host, port: 993, security: "tls" },
			smtp: { host, port: 465, security: "tls" },
			username: address,
			password,
			allowFrom: await withOwner(data.allowFrom),
			signature: "",
			notifyUnknown: true,
			dailyLimit: 50,
			enabled: true,
			sync: { uidValidity: null, lastUid: 0 },
			createdAt: now,
			updatedAt: now,
		});
	} catch (err) {
		await mailcow.deleteMailbox(address);
		throw err;
	}
	log.info(`email: made ${address} on mailcow for ${agent.name}`);
	await restartWatcher(agentId);
	void emitEmailChanged(agentId);
	return (await getEmailAccount(agentId)) as EmailAccount;
}

/** Connects any email account after signing in to both of its servers. */
export async function connectAccount(agentId: string, input: unknown): Promise<EmailAccount> {
	const data = parse(EmailConnect, input);
	const agent = await requireOwnedAgent(agentId);
	await requireNoAccount(agentId);
	const creds = {
		imap: data.imap,
		smtp: data.smtp,
		username: data.username || data.address,
		password: data.password,
	};
	const test = await testCredentials(creds);
	if (!test.imap.ok || !test.smtp.ok)
		throw badRequest([test.imap.error, test.smtp.error].filter(Boolean).join(" "), test);
	const now = Date.now();
	await insertAccount({
		agentId,
		address: data.address,
		name: data.name || agent.name,
		kind: "account",
		mailcowUrl: null,
		imap: data.imap,
		smtp: data.smtp,
		username: data.username || data.address,
		password: data.password,
		allowFrom: await withOwner(data.allowFrom),
		signature: "",
		notifyUnknown: true,
		dailyLimit: 50,
		enabled: true,
		sync: { uidValidity: null, lastUid: 0 },
		createdAt: now,
		updatedAt: now,
	});
	await restartWatcher(agentId);
	void emitEmailChanged(agentId);
	return (await getEmailAccount(agentId)) as EmailAccount;
}

/** Whether an update brings new sign-in details (then it wants a recent sign-in). */
export function changesCredentials(input: unknown): boolean {
	const p = (input ?? {}) as Record<string, unknown>;
	return ["password", "imap", "smtp", "username"].some((key) => Object.hasOwn(p, key));
}

export async function updateAccount(agentId: string, input: unknown): Promise<EmailAccount> {
	const patch = parse(EmailAccountUpdate, input);
	await requireOwnedAgent(agentId);
	const account = await storedAccount(agentId);
	if (!account) throw notFound("Email account");
	const password = patch.password || undefined;
	const signIn = Boolean(password || patch.imap || patch.smtp || patch.username !== undefined);
	if (signIn && account.kind === "mailcow") throw badRequest("A mailcow mailbox's servers are set by Sekai.");
	const next = {
		imap: patch.imap ?? account.imap,
		smtp: patch.smtp ?? account.smtp,
		username: patch.username ?? account.username,
		password: password ?? account.password,
	};
	if (signIn) {
		if (!password && (patch.imap || patch.smtp || patch.username !== undefined))
			throw badRequest("Enter the password again to change the sign-in details.");
		const test = await testCredentials({ ...next, username: next.username || account.address });
		if (!test.imap.ok || !test.smtp.ok)
			throw badRequest([test.imap.error, test.smtp.error].filter(Boolean).join(" "), test);
	}
	const name = patch.name?.trim();
	if (name !== undefined && name && name !== account.name && account.kind === "mailcow") {
		const mailcow = await mailcowClient();
		if (mailcow?.base !== account.mailcowUrl || !mailcow)
			throw badRequest("Reconnect the original mailcow server first.");
		await mailcow.updateMailbox(account.address, { name });
	}
	await updateAccountRow(agentId, {
		...(name ? { name } : {}),
		...(patch.allowFrom ? { allowFrom: [...new Set(patch.allowFrom.map((a) => a.toLowerCase()))] } : {}),
		...(patch.signature !== undefined ? { signature: patch.signature.trim() } : {}),
		...(patch.notifyUnknown !== undefined ? { notifyUnknown: patch.notifyUnknown } : {}),
		...(patch.dailyLimit !== undefined ? { dailyLimit: patch.dailyLimit } : {}),
		...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
		...(signIn ? next : {}),
	});
	if (signIn || patch.enabled !== undefined) {
		if (patch.enabled === false) await stopWatcher(agentId);
		else await restartWatcher(agentId);
	}
	void emitEmailChanged(agentId);
	return (await getEmailAccount(agentId)) as EmailAccount;
}

export async function reconnectAccount(agentId: string): Promise<EmailAccount> {
	await requireOwnedAgent(agentId);
	if (!(await storedAccount(agentId))) throw notFound("Email account");
	await restartWatcher(agentId);
	return (await getEmailAccount(agentId)) as EmailAccount;
}

/** Disconnects the bot's email; with deleteMailbox, its mailcow mailbox (and all its mail) is deleted too. */
export async function removeAccount(agentId: string, opts: { deleteMailbox?: boolean } = {}): Promise<void> {
	await requireOwnedAgent(agentId);
	const account = await storedAccount(agentId);
	if (!account) return;
	if (opts.deleteMailbox) {
		if (account.kind !== "mailcow")
			throw badRequest("Only a mailbox Sekai made on mailcow can be deleted from here.");
		const mailcow = await mailcowClient();
		if (!mailcow || mailcow.base !== account.mailcowUrl)
			throw badRequest("Reconnect the original mailcow server to delete this mailbox.");
		try {
			await mailcow.deleteMailbox(account.address);
		} catch (err) {
			if (err instanceof MailcowError) throw badRequest(err.message);
			throw err;
		}
		log.info(`email: deleted the mailbox ${account.address}`);
	}
	await stopWatcher(agentId, { forget: true });
	await deleteAccountRow(agentId);
	clearStatus(agentId);
	usageCache.delete(agentId);
	void emitEmailChanged(agentId);
}

/** A test never forwards a stored password to a caller-supplied server. */
export async function testAccount(input: unknown): Promise<EmailTestResult> {
	const data = parse(EmailTestInput, input);
	const password = data.password;
	if (!password) throw badRequest("Enter the password first.");
	return testCredentials({ imap: data.imap, smtp: data.smtp, username: data.username || data.address, password });
}

export async function guessServers(address: string): Promise<EmailServerGuess> {
	const parsed = EmailConnect.shape.address.safeParse(address);
	if (!parsed.success) throw badRequest("That doesn't look like an email address.");
	return discoverServers(parsed.data);
}

function toItem(r: MailRow): EmailItem {
	return {
		id: r.id,
		direction: r.direction,
		from: r.fromAddress,
		fromName: r.fromName,
		to: r.to,
		subject: r.subject,
		snippet: r.snippet,
		sender: r.sender,
		automated: r.automated,
		conversationId: r.conversationId,
		attachments: r.attachments,
		at: r.at,
	};
}

export async function recentMail(agentId: string, limit = 20): Promise<EmailItem[]> {
	await requireOwnedAgent(agentId);
	return (await recentMailRows(agentId, Math.min(Math.max(limit, 1), 100))).map(toItem);
}

/** Mail from people the acting person's bots don't know, waiting in Needs you. */
export async function senderNotes(): Promise<EmailSenderNote[]> {
	const own = (await listOwnAgents()).map((a) => a.id);
	if (!own.length) return [];
	const rows = await db
		.select()
		.from(schema.emailMessages)
		.where(and(inArray(schema.emailMessages.agentId, own), eq(schema.emailMessages.note, "waiting")))
		.orderBy(desc(schema.emailMessages.at))
		.limit(200);
	// One per sender and bot: the latest.
	const seen = new Set<string>();
	const out: EmailSenderNote[] = [];
	for (const r of rows) {
		const key = `${r.agentId}|${r.fromAddress}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push({
			id: r.id,
			agentId: r.agentId,
			address: r.fromAddress,
			name: r.fromName,
			subject: r.subject,
			verified: r.sender === "unknown" ? r.verifiedBy !== null : false,
			at: r.at,
		});
	}
	return out;
}

/** "Allow this sender" (they can email the bot to get things done from now on) or dismiss the note. */
export async function decideSender(id: string, allow: boolean): Promise<void> {
	const row = await db.query.emailMessages.findFirst({ where: eq(schema.emailMessages.id, id) });
	if (row?.note !== "waiting") throw notFound("Email");
	await requireOwnedAgent(row.agentId);
	const account = await storedAccount(row.agentId);
	if (allow && (!row.verifiedBy || !account)) throw badRequest("Only a verified sender can be allowed here.");
	if (allow && account && row.fromAddress && !account.allowFrom.includes(row.fromAddress))
		await updateAccountRow(row.agentId, { allowFrom: [...account.allowFrom, row.fromAddress] });
	// Every waiting note from the same sender to this bot goes together.
	await db
		.update(schema.emailMessages)
		.set({ note: allow ? "allowed" : "dismissed" })
		.where(
			and(
				eq(schema.emailMessages.agentId, row.agentId),
				eq(schema.emailMessages.fromAddress, row.fromAddress),
				eq(schema.emailMessages.note, "waiting"),
			),
		);
	void emitEmailChanged(row.agentId);
}
