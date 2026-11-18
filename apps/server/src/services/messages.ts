import type { Message, MessageMeta, MessagePart, MessageSearchHit } from "@sekai/shared";
import { and, asc, desc, eq, gt, lt, sql } from "drizzle-orm";
import { currentActor } from "../auth/actor.ts";
import { db, schema } from "../db/index.ts";
import { bus } from "../events/bus.ts";
import { conversationOwner } from "../events/scope.ts";
import { notFound } from "../lib/errors.ts";
import { ID } from "../lib/ids.ts";
import { touchConversation } from "./conversations.ts";

type MessageRow = typeof schema.messages.$inferSelect;

export function toMessage(row: MessageRow): Message {
	const { searchText: _words, ...rest } = row;
	return { ...rest, meta: row.meta ?? {} };
}

/** What search looks at: the message's text parts (voice messages carry their words as text too). */
export function searchTextOf(parts: Message["parts"]): string {
	return parts
		.flatMap((p) => (p.type === "text" && p.text.trim() ? [p.text] : []))
		.join("\n")
		.slice(0, 20_000);
}

export async function listMessages(
	conversationId: string,
	opts: { before?: number; after?: number; limit?: number } = {},
): Promise<Message[]> {
	const where = [eq(schema.messages.conversationId, conversationId)];
	if (opts.before) where.push(lt(schema.messages.createdAt, opts.before));
	if (opts.after) where.push(gt(schema.messages.createdAt, opts.after));
	if (opts.limit) {
		const rows = await db
			.select()
			.from(schema.messages)
			.where(and(...where))
			.orderBy(desc(schema.messages.createdAt))
			.limit(opts.limit);
		return rows.reverse().map(toMessage);
	}
	const rows = await db
		.select()
		.from(schema.messages)
		.where(and(...where))
		.orderBy(asc(schema.messages.createdAt));
	return rows.map(toMessage);
}

/** A message, if it's in one of the acting person's chats. */
export async function getMessage(id: string): Promise<Message | null> {
	const row = await db.query.messages.findFirst({ where: eq(schema.messages.id, id) });
	if (!row) return null;
	const actor = currentActor();
	if (actor && (await conversationOwner(row.conversationId)) !== actor.userId) return null;
	return toMessage(row);
}

export async function requireMessage(id: string): Promise<Message> {
	const m = await getMessage(id);
	if (!m) throw notFound("Message");
	return m;
}

export interface NewMessage {
	conversationId: string;
	sender: Message["sender"];
	agentId?: string | null;
	parts?: MessagePart[];
	attachments?: Message["attachments"];
	replyToId?: string | null;
	status?: Message["status"];
	model?: string | null;
	runId?: string | null;
	meta?: MessageMeta;
	createdAt?: number;
}

let lastCreatedAt = 0;

/** Strictly increasing timestamps keep message order stable even within the same millisecond. */
function nextTimestamp(): number {
	const now = Date.now();
	lastCreatedAt = now > lastCreatedAt ? now : lastCreatedAt + 1;
	return lastCreatedAt;
}

export async function createMessage(input: NewMessage): Promise<Message> {
	const createdAt = input.createdAt ?? nextTimestamp();
	const row: MessageRow = {
		id: ID.message(),
		conversationId: input.conversationId,
		sender: input.sender,
		agentId: input.agentId ?? null,
		parts: input.parts ?? [],
		attachments: input.attachments ?? [],
		replyToId: input.replyToId ?? null,
		status: input.status ?? "done",
		error: null,
		model: input.model ?? null,
		usage: null,
		runId: input.runId ?? null,
		meta: input.meta ?? {},
		searchText: searchTextOf(input.parts ?? []),
		createdAt,
		updatedAt: createdAt,
	};
	await db.insert(schema.messages).values(row);
	const message = toMessage(row);
	bus.emit({ type: "message.created", message });
	if (message.status === "done") await touchConversation(message);
	return message;
}

export async function updateMessage(
	id: string,
	patch: Partial<Pick<Message, "parts" | "status" | "error" | "model" | "usage" | "meta" | "runId">>,
	opts: { emit?: boolean } = {},
): Promise<Message> {
	await db
		.update(schema.messages)
		.set({ ...patch, ...(patch.parts ? { searchText: searchTextOf(patch.parts) } : {}), updatedAt: Date.now() })
		.where(eq(schema.messages.id, id));
	const message = await requireMessage(id);
	if (opts.emit !== false) bus.emit({ type: "message.updated", message });
	if (patch.status && patch.status !== "streaming") await touchConversation(message);
	return message;
}

export async function deleteMessage(id: string): Promise<void> {
	const m = await requireMessage(id);
	await db.delete(schema.messages).where(eq(schema.messages.id, id));
	bus.emit({ type: "message.deleted", conversationId: m.conversationId, messageId: id });
	// The chat's preview (and place in the list) comes from its newest message that's left.
	const [newest] = await db
		.select()
		.from(schema.messages)
		.where(and(eq(schema.messages.conversationId, m.conversationId), eq(schema.messages.status, "done")))
		.orderBy(desc(schema.messages.createdAt))
		.limit(1);
	if (newest && newest.createdAt <= m.createdAt) await touchConversation(toMessage(newest));
}

/** Messages interrupted by a server restart are marked as errors on boot. */
export async function failStreamingMessages(): Promise<number> {
	const rows = await db
		.update(schema.messages)
		.set({ status: "error", error: "Interrupted: the server restarted", updatedAt: Date.now() })
		.where(eq(schema.messages.status, "streaming"))
		.returning({ id: schema.messages.id });
	return rows.length;
}

/**
 * Searches every chat's messages: all the words must match (the last one as a prefix, so results come as you type),
 * best matches first, newer ones breaking ties.
 */
export async function searchMessages(query: string, limit = 30): Promise<MessageSearchHit[]> {
	const words = query
		.toLowerCase()
		.split(/[^\p{L}\p{N}]+/u)
		.filter(Boolean)
		.slice(0, 8);
	if (!words.length) return [];
	const tsq = words.map((w, i) => (i === words.length - 1 ? `${w}:*` : w)).join(" & ");
	const me = currentActor()?.userId ?? null;
	const opts = "StartSel=\u0001, StopSel=\u0002, MaxWords=24, MinWords=10, MaxFragments=1";
	const rows = (await db.execute(sql`
		select m.id, m.conversation_id, m.sender, m.agent_id, m.created_at, c.title, c.kind,
			ts_headline('simple', m.search_text, q, ${opts}) as snippet
		from messages m
		join conversations c on c.id = m.conversation_id,
			to_tsquery('simple', ${tsq}) q
		where to_tsvector('simple', m.search_text) @@ q
			and (${me}::text is null or c.user_id = ${me})
		order by ts_rank(to_tsvector('simple', m.search_text), q) desc, m.created_at desc
		limit ${Math.min(Math.max(limit, 1), 100)}
	`)) as unknown as {
		id: string;
		conversation_id: string;
		sender: MessageSearchHit["sender"];
		agent_id: string | null;
		created_at: string | number;
		title: string;
		kind: MessageSearchHit["conversationKind"];
		snippet: string;
	}[];
	return rows.map((r) => ({
		messageId: r.id,
		conversationId: r.conversation_id,
		conversationTitle: r.title,
		conversationKind: r.kind,
		sender: r.sender,
		agentId: r.agent_id,
		createdAt: Number(r.created_at),
		snippet: r.snippet.replace(/\s+/g, " ").trim(),
	}));
}
