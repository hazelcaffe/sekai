import type { Channel, ChannelBinding, ChannelStatus, ChannelWithStatus } from "@sekai/shared";
import { and, asc, eq, gte, inArray } from "drizzle-orm";
import { currentActor } from "../auth/actor.ts";
import { db, schema } from "../db/index.ts";
import { bus } from "../events/bus.ts";
import { newId } from "../lib/ids.ts";
import { maskSecret } from "../services/settings.ts";
import type { ChannelAdapter } from "./types.ts";

/** Shared by the channel manager, streaming and commands. */

export interface Running {
	adapter: ChannelAdapter;
	channel: Channel;
	retry: ReturnType<typeof setTimeout> | null;
	attempts: number;
}

export const running = new Map<string, Running>();
const statuses = new Map<string, ChannelStatus>();

export function status(channelId: string): ChannelStatus {
	return (
		statuses.get(channelId) ?? {
			channelId,
			state: "stopped",
			error: null,
			botName: null,
			botId: null,
			connectedAt: null,
			inviteUrl: null,
			readsAll: false,
		}
	);
}

export function setStatus(channelId: string, patch: Partial<ChannelStatus>): void {
	statuses.set(channelId, { ...status(channelId), ...patch });
	bus.emit({ type: "channel.changed", channelId });
}

export function clearStatus(channelId: string): void {
	statuses.delete(channelId);
}

export function publicChannel(c: Channel): ChannelWithStatus {
	const secrets = Object.fromEntries(Object.entries(c.secrets).map(([k, v]) => [k, maskSecret(v)]));
	return { ...c, secrets, status: status(c.id) };
}

export async function getChannel(id: string): Promise<Channel | null> {
	return (await db.query.channels.findFirst({ where: eq(schema.channels.id, id) })) ?? null;
}

/** A connected channel, or null. */
export function live(channelId: string): Running | null {
	const entry = running.get(channelId);
	return entry && status(channelId).state === "connected" ? entry : null;
}

/** Bot user id → the agent it speaks for, across every connected channel. */
export function agentBots(): Map<string, { agentId: string; channelId: string }> {
	const out = new Map<string, { agentId: string; channelId: string }>();
	for (const [id, entry] of running) {
		const botId = status(id).botId;
		if (botId && status(id).state === "connected")
			out.set(botId, { agentId: entry.channel.agentId, channelId: id });
	}
	return out;
}

// ---------------------------------------------------------------- bindings

export async function getBinding(id: string): Promise<ChannelBinding | null> {
	return (await db.query.channelBindings.findFirst({ where: eq(schema.channelBindings.id, id) })) ?? null;
}

export async function findBinding(channelId: string, chatId: string): Promise<ChannelBinding | null> {
	return (
		(await db.query.channelBindings.findFirst({
			where: and(
				eq(schema.channelBindings.channelId, channelId),
				eq(schema.channelBindings.externalChatId, chatId),
			),
		})) ?? null
	);
}

/** Every bot's binding for one platform chat (several when agents share a linked group chat). */
export async function bindingsForChat(chatId: string): Promise<ChannelBinding[]> {
	const me = currentActor()?.userId;
	const rows = await db
		.select({ binding: schema.channelBindings })
		.from(schema.channelBindings)
		.innerJoin(schema.channels, eq(schema.channels.id, schema.channelBindings.channelId))
		.innerJoin(schema.agents, eq(schema.agents.id, schema.channels.agentId))
		.where(and(eq(schema.channelBindings.externalChatId, chatId), me ? eq(schema.agents.userId, me) : undefined))
		.orderBy(asc(schema.channelBindings.createdAt));
	return rows.map((r) => r.binding);
}

export async function bindingsForConversation(conversationId: string): Promise<ChannelBinding[]> {
	return db
		.select()
		.from(schema.channelBindings)
		.where(eq(schema.channelBindings.conversationId, conversationId))
		.orderBy(asc(schema.channelBindings.createdAt));
}

export async function upsertBinding(
	row: Omit<ChannelBinding, "id" | "createdAt" | "lastInboundAt">,
): Promise<ChannelBinding> {
	const existing = await findBinding(row.channelId, row.externalChatId);
	if (existing) {
		await db
			.update(schema.channelBindings)
			.set({
				conversationId: row.conversationId,
				chatName: row.chatName,
				isGroup: row.isGroup,
				listen: row.listen,
			})
			.where(eq(schema.channelBindings.id, existing.id));
		bus.emit({ type: "channel.changed", channelId: row.channelId });
		return { ...existing, ...row };
	}
	const created: ChannelBinding = { ...row, id: newId("cb"), lastInboundAt: null, createdAt: Date.now() };
	await db.insert(schema.channelBindings).values(created);
	bus.emit({ type: "channel.changed", channelId: row.channelId });
	return created;
}

export async function updateBindings(ids: string[], patch: Partial<Pick<ChannelBinding, "conversationId" | "listen">>) {
	if (ids.length === 0) return;
	await db.update(schema.channelBindings).set(patch).where(inArray(schema.channelBindings.id, ids));
}

export async function deleteBindings(ids: string[]): Promise<void> {
	if (ids.length === 0) return;
	await db.delete(schema.channelBindings).where(inArray(schema.channelBindings.id, ids));
}

// ---------------------------------------------------------------- platform message ids

export async function recordPlatformMessage(row: {
	channelId: string;
	chatId: string;
	externalMessageId: string;
	messageId: string;
	direction: "in" | "out";
	seq?: number;
}): Promise<void> {
	await db.insert(schema.channelMessages).values({
		id: newId("cm"),
		channelId: row.channelId,
		externalChatId: row.chatId,
		externalMessageId: row.externalMessageId,
		messageId: row.messageId,
		direction: row.direction,
		seq: row.seq ?? 0,
		createdAt: Date.now(),
	});
}

/** The platform messages a bot posted for a Sekai message in one chat, in order. */
export async function postedFor(messageId: string, channelId: string, chatId: string): Promise<string[]> {
	const rows = await db
		.select()
		.from(schema.channelMessages)
		.where(
			and(
				eq(schema.channelMessages.messageId, messageId),
				eq(schema.channelMessages.channelId, channelId),
				eq(schema.channelMessages.externalChatId, chatId),
				eq(schema.channelMessages.direction, "out"),
			),
		)
		.orderBy(asc(schema.channelMessages.seq));
	return rows.map((r) => r.externalMessageId);
}

/** Every platform message posted for a Sekai message, by any bot. */
export async function allPostedFor(messageId: string) {
	return db
		.select()
		.from(schema.channelMessages)
		.where(and(eq(schema.channelMessages.messageId, messageId), eq(schema.channelMessages.direction, "out")));
}

export async function forgetAllPosted(messageId: string): Promise<void> {
	await db.delete(schema.channelMessages).where(eq(schema.channelMessages.messageId, messageId));
}

export async function forgetPosted(messageId: string, channelId: string, chatId: string, fromSeq: number) {
	await db
		.delete(schema.channelMessages)
		.where(
			and(
				eq(schema.channelMessages.messageId, messageId),
				eq(schema.channelMessages.channelId, channelId),
				eq(schema.channelMessages.externalChatId, chatId),
				eq(schema.channelMessages.direction, "out"),
				gte(schema.channelMessages.seq, fromSeq),
			),
		);
}

/** The Sekai message a platform message shows (or came in as). */
export async function sekaiMessageId(chatId: string, externalMessageId: string): Promise<string | null> {
	const me = currentActor()?.userId;
	const [row] = await db
		.select({ messageId: schema.channelMessages.messageId })
		.from(schema.channelMessages)
		.innerJoin(schema.messages, eq(schema.messages.id, schema.channelMessages.messageId))
		.innerJoin(schema.conversations, eq(schema.conversations.id, schema.messages.conversationId))
		.where(
			and(
				eq(schema.channelMessages.externalChatId, chatId),
				eq(schema.channelMessages.externalMessageId, externalMessageId),
				me ? eq(schema.conversations.userId, me) : undefined,
			),
		)
		.limit(1);
	return row?.messageId ?? null;
}
