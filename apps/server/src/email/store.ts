import type { EmailStatus } from "@sekai/shared";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db, schema } from "../db/index.ts";
import { bus } from "../events/bus.ts";
import { agentOwner } from "../events/scope.ts";
import { newId } from "../lib/ids.ts";
import { log } from "../lib/log.ts";
import { seal, unseal } from "../lib/secrets.ts";
import type { Credentials } from "./connect.ts";

/** Bots' email accounts and mail in the database, and how each account's connection is doing. */

export type AccountRow = typeof schema.emailAccounts.$inferSelect;
export type MailRow = typeof schema.emailMessages.$inferSelect;

/** An account with its password readable (server-side only). */
export type StoredAccount = Omit<AccountRow, "password"> & { password: string };

export async function storedAccount(agentId: string): Promise<StoredAccount | null> {
	const row = await db.query.emailAccounts.findFirst({ where: eq(schema.emailAccounts.agentId, agentId) });
	if (!row) return null;
	let password = "";
	try {
		password = row.password ? unseal(row.password) : "";
	} catch {
		log.warn(`email: couldn't read the saved password of ${row.address}`);
	}
	return { ...row, password };
}

export function credentialsOf(
	a: Pick<StoredAccount, "imap" | "smtp" | "username" | "address" | "password" | "kind">,
): Credentials {
	return {
		imap: a.imap,
		smtp: a.smtp,
		username: a.username || a.address,
		password: a.password,
		configured: a.kind === "mailcow",
	};
}

export async function insertAccount(row: StoredAccount): Promise<void> {
	await db.insert(schema.emailAccounts).values({ ...row, password: seal(row.password) });
}

export async function updateAccountRow(
	agentId: string,
	patch: Partial<Omit<AccountRow, "agentId" | "password">> & { password?: string },
): Promise<void> {
	const { password, ...rest } = patch;
	await db
		.update(schema.emailAccounts)
		.set({ ...rest, ...(password !== undefined ? { password: seal(password) } : {}), updatedAt: Date.now() })
		.where(eq(schema.emailAccounts.agentId, agentId));
}

export async function deleteAccountRow(agentId: string): Promise<void> {
	await db.transaction(async (tx) => {
		// Keep the chats and the bot's 24-hour send count. Old allow requests and thread IDs
		// must not apply to the next mailbox connected to this bot.
		await tx
			.delete(schema.emailMessages)
			.where(and(eq(schema.emailMessages.agentId, agentId), eq(schema.emailMessages.direction, "in")));
		await tx
			.update(schema.emailMessages)
			.set({ conversationId: null })
			.where(eq(schema.emailMessages.agentId, agentId));
		await tx.delete(schema.emailAccounts).where(eq(schema.emailAccounts.agentId, agentId));
	});
}

export async function enabledAccountIds(): Promise<string[]> {
	const rows = await db
		.select({ agentId: schema.emailAccounts.agentId })
		.from(schema.emailAccounts)
		.where(eq(schema.emailAccounts.enabled, true));
	return rows.map((r) => r.agentId);
}

// ---------------------------------------------------------------- mail

type NewMail = Omit<MailRow, "id" | "createdAt" | "note" | "startedChat" | "automated" | "verifiedBy"> &
	Partial<Pick<MailRow, "note" | "startedChat" | "automated" | "verifiedBy">>;

export async function recordMail(row: NewMail): Promise<MailRow> {
	const full: MailRow = {
		note: null,
		startedChat: false,
		automated: false,
		verifiedBy: null,
		...row,
		id: newId("eml"),
		createdAt: Date.now(),
	};
	await db.insert(schema.emailMessages).values(full);
	return full;
}

export async function updateMail(id: string, patch: Partial<Omit<MailRow, "id" | "agentId">>): Promise<void> {
	await db.update(schema.emailMessages).set(patch).where(eq(schema.emailMessages.id, id));
}

export async function mailById(id: string): Promise<MailRow | null> {
	return (await db.query.emailMessages.findFirst({ where: eq(schema.emailMessages.id, id) })) ?? null;
}

/** A bot's mail with this Message-ID (received or sent), if Sekai has seen it. */
export async function mailByMessageId(agentId: string, messageId: string): Promise<MailRow | null> {
	return (
		(await db.query.emailMessages.findFirst({
			where: and(eq(schema.emailMessages.agentId, agentId), eq(schema.emailMessages.messageId, messageId)),
		})) ?? null
	);
}

/** The chat an email thread is in: the nearest of these Message-IDs that Sekai saw in a chat. */
export async function threadChat(agentId: string, keys: string[]): Promise<string | null> {
	for (const key of keys.slice(0, 30)) {
		const rows = await db
			.select({ conversationId: schema.emailMessages.conversationId })
			.from(schema.emailMessages)
			.where(and(eq(schema.emailMessages.agentId, agentId), eq(schema.emailMessages.messageId, key)));
		const hit = rows.find((r) => r.conversationId)?.conversationId;
		if (hit) return hit;
	}
	return null;
}

/** Emails a bot sent in the last 24 hours (its daily limit counts these). */
export async function sentInLastDay(agentId: string): Promise<number> {
	const [row] = await db
		.select({ n: sql<number>`count(*)::int` })
		.from(schema.emailMessages)
		.where(
			and(
				eq(schema.emailMessages.agentId, agentId),
				eq(schema.emailMessages.direction, "out"),
				gte(schema.emailMessages.createdAt, Date.now() - 24 * 3_600_000),
			),
		);
	return row?.n ?? 0;
}

export async function recentMailRows(agentId: string, limit = 20): Promise<MailRow[]> {
	return db
		.select()
		.from(schema.emailMessages)
		.where(eq(schema.emailMessages.agentId, agentId))
		.orderBy(desc(schema.emailMessages.at))
		.limit(limit);
}

// ---------------------------------------------------------------- how each account is doing

const statuses = new Map<string, EmailStatus>();
const OFF: EmailStatus = { state: "off", problem: null, error: null, since: null, live: false };

export function statusOf(agentId: string): EmailStatus {
	return statuses.get(agentId) ?? OFF;
}

export function setStatus(agentId: string, patch: Partial<EmailStatus>): void {
	const prev = statusOf(agentId);
	const next: EmailStatus = { ...prev, ...patch };
	if (patch.state && patch.state !== prev.state) next.since = Date.now();
	statuses.set(agentId, next);
	if (JSON.stringify(prev) !== JSON.stringify(next)) void emitEmailChanged(agentId);
}

export function clearStatus(agentId: string): void {
	statuses.delete(agentId);
}

/** Tells the bot's owner's app that its email changed. */
export async function emitEmailChanged(agentId: string): Promise<void> {
	const owner = await agentOwner(agentId).catch(() => null);
	if (owner) bus.emit({ type: "email.changed", agentId }, { to: [owner] });
}
