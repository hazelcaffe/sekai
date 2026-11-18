import { and, eq, lt } from "drizzle-orm";
import { db, schema } from "../db/index.ts";
import { newId } from "../lib/ids.ts";
import { randomSecret, safeEqual, sha256 } from "./request.ts";

/**
 * Short-lived, single-use secrets: the token is handed out once (in a link, a cookie, a provider's state) and only
 * its SHA-256 is kept. A ticket can also hold a code sent by email or text (hashed), with a limited number of tries.
 */

export type TicketKind = "mfa" | "code" | "invite" | "reset" | "sso";
type Row = typeof schema.authTickets.$inferSelect;

export const TICKET_MS: Record<TicketKind, number> = {
	mfa: 10 * 60_000,
	code: 10 * 60_000,
	invite: 7 * 86_400_000,
	reset: 60 * 60_000,
	sso: 10 * 60_000,
};
/** Wrong codes before a ticket is used up. */
export const MAX_ATTEMPTS = 5;

export async function createTicket(
	kind: TicketKind,
	opts: { userId?: string | null; data?: Record<string, unknown>; ttlMs?: number } = {},
): Promise<{ id: string; token: string; expiresAt: number }> {
	const token = randomSecret();
	const now = Date.now();
	const id = newId("tkt", 20);
	const expiresAt = now + (opts.ttlMs ?? TICKET_MS[kind]);
	await db.insert(schema.authTickets).values({
		id,
		kind,
		userId: opts.userId ?? null,
		tokenHash: sha256(token),
		data: opts.data ?? {},
		expiresAt,
		createdAt: now,
	});
	return { id, token, expiresAt };
}

/** The ticket a token belongs to, if it's this kind and not expired (it stays until consumed). */
export async function findTicket(kind: TicketKind, token: string | null | undefined): Promise<Row | null> {
	if (!token || token.length > 200) return null;
	const [row] = await db
		.select()
		.from(schema.authTickets)
		.where(eq(schema.authTickets.tokenHash, sha256(token)));
	if (!row || row.kind !== kind) return null;
	if (row.expiresAt < Date.now()) {
		await deleteTicket(row.id);
		return null;
	}
	return row;
}

/** Takes a ticket: returns it once, then it's gone. */
export async function consumeTicket(kind: TicketKind, token: string | null | undefined): Promise<Row | null> {
	const row = await findTicket(kind, token);
	if (!row) return null;
	// Only one caller wins a ticket used twice at once.
	const deleted = await db.delete(schema.authTickets).where(eq(schema.authTickets.id, row.id)).returning();
	return deleted.length ? row : null;
}

export async function deleteTicket(id: string): Promise<void> {
	await db.delete(schema.authTickets).where(eq(schema.authTickets.id, id));
}

export async function deleteUserTickets(userId: string, kind?: TicketKind): Promise<void> {
	await db
		.delete(schema.authTickets)
		.where(
			kind
				? and(eq(schema.authTickets.userId, userId), eq(schema.authTickets.kind, kind))
				: eq(schema.authTickets.userId, userId),
		);
}

/** A 6-digit code for email or text, stored hashed on the ticket (replacing an earlier one). */
export async function setTicketCode(id: string, data: Record<string, unknown>): Promise<string> {
	const n = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
	const code = String(n % 1_000_000).padStart(6, "0");
	await db
		.update(schema.authTickets)
		.set({ codeHash: sha256(`${id}:${code}`), data })
		.where(eq(schema.authTickets.id, id));
	return code;
}

/** Checks a code against a ticket; a wrong one uses up a try (and the ticket after MAX_ATTEMPTS). */
export async function checkTicketCode(row: Row, code: string): Promise<"ok" | "wrong" | "used_up"> {
	if (row.attempts >= MAX_ATTEMPTS) return "used_up";
	if (row.codeHash && safeEqual(sha256(`${row.id}:${code}`), row.codeHash)) return "ok";
	const attempts = row.attempts + 1;
	if (attempts >= MAX_ATTEMPTS) {
		await deleteTicket(row.id);
		return "used_up";
	}
	await db.update(schema.authTickets).set({ attempts }).where(eq(schema.authTickets.id, row.id));
	return "wrong";
}

/** A wrong second-factor code on a sign-in ticket (any method) uses up a try too. */
export async function failTicket(row: Row): Promise<"wrong" | "used_up"> {
	const attempts = row.attempts + 1;
	if (attempts >= MAX_ATTEMPTS) {
		await deleteTicket(row.id);
		return "used_up";
	}
	await db.update(schema.authTickets).set({ attempts }).where(eq(schema.authTickets.id, row.id));
	return "wrong";
}

export async function updateTicketData(id: string, data: Record<string, unknown>): Promise<void> {
	await db.update(schema.authTickets).set({ data }).where(eq(schema.authTickets.id, id));
}

/** Expired tickets (housekeeping). */
export async function pruneTickets(): Promise<number> {
	const rows = await db
		.delete(schema.authTickets)
		.where(lt(schema.authTickets.expiresAt, Date.now()))
		.returning({ id: schema.authTickets.id });
	return rows.length;
}
