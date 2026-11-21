import {
	type Conversation,
	ConversationCreate,
	type ConversationCreate as ConversationCreateInput,
	ConversationSettings,
	ConversationUpdate,
	type ConversationUpdate as ConversationUpdateInput,
	type Message,
	messageText,
} from "@sekai/shared";
import { and, desc, eq, type SQL, sql } from "drizzle-orm";
import { db, schema } from "../db/index.ts";
import { bus } from "../events/bus.ts";
import { rememberConversationOwner } from "../events/scope.ts";
import { badRequest, notFound, parse } from "../lib/errors.ts";
import { ID } from "../lib/ids.ts";
import { truncate } from "../lib/text.ts";
import { getAgent, listAgents } from "./agents.ts";
import { isMine, newOwner, ownWhere } from "./visibility.ts";

type ConversationRow = typeof schema.conversations.$inferSelect;

export function toConversation(row: ConversationRow): Conversation {
	rememberConversationOwner(row.id, row.userId);
	return { ...row, settings: ConversationSettings.parse(row.settings ?? {}) };
}

/** The chats of the person Sekai acts for (everyone's, for Sekai itself). */
export async function listConversations(
	filter: { agentId?: string; kind?: "direct" | "group"; archived?: boolean; userId?: string } = {},
): Promise<Conversation[]> {
	const where: SQL[] = [eq(schema.conversations.archived, filter.archived ?? false)];
	const own = ownWhere(schema.conversations.userId);
	if (own) where.push(own);
	if (filter.userId) where.push(eq(schema.conversations.userId, filter.userId));
	if (filter.agentId) where.push(eq(schema.conversations.agentId, filter.agentId));
	if (filter.kind) where.push(eq(schema.conversations.kind, filter.kind));
	const rows = await db
		.select()
		.from(schema.conversations)
		.where(and(...where))
		.orderBy(
			desc(schema.conversations.pinned),
			sql`coalesce(${schema.conversations.lastMessageAt}, ${schema.conversations.createdAt}) desc`,
		);
	return rows.map(toConversation);
}

/** A chat, if it's the acting person's (another person's chat doesn't exist, as far as they can tell). */
export async function getConversation(id: string): Promise<Conversation | null> {
	const row = await db.query.conversations.findFirst({ where: eq(schema.conversations.id, id) });
	return row && isMine(row.userId) ? toConversation(row) : null;
}

export async function requireConversation(id: string): Promise<Conversation> {
	const c = await getConversation(id);
	if (!c) throw notFound("Chat");
	return c;
}

function groupTitle(names: string[]): string {
	if (names.length <= 1) return names[0] ?? "Group";
	if (names.length === 2) return `${names[0]} & ${names[1]}`;
	return `${names.slice(0, -1).join(", ")} & ${names.at(-1)}`;
}

export async function createConversation(
	input: ConversationCreateInput,
	opts: { ownerId?: string } = {},
): Promise<Conversation> {
	const data = parse(ConversationCreate, input);
	const now = Date.now();
	let row: ConversationRow;
	if (data.kind === "direct") {
		const agent = await getAgent(data.agentId);
		if (!agent) throw notFound("Bot");
		row = {
			id: ID.conversation(),
			userId: opts.ownerId ?? newOwner(agent.userId),
			kind: "direct",
			title: data.title ?? "New chat",
			agentId: agent.id,
			memberIds: [agent.id],
			settings: ConversationSettings.parse({}),
			summary: null,
			summaryUntil: null,
			pinned: false,
			archived: false,
			lastMessageAt: null,
			lastMessagePreview: null,
			createdAt: now,
			updatedAt: now,
		};
	} else {
		const all = await listAgents();
		const members = [...new Set(data.memberIds)].map((id) => all.find((a) => a.id === id));
		if (members.some((m) => !m)) throw badRequest("One of these bots isn't here anymore");
		const names = members.flatMap((m) => (m ? [m.name] : []));
		const ownerId = opts.ownerId ?? newOwner(members[0]?.userId);
		row = {
			id: ID.conversation(),
			userId: ownerId,
			kind: "group",
			title: data.title?.trim() || groupTitle(names),
			agentId: null,
			memberIds: [...new Set(data.memberIds)],
			settings: ConversationSettings.parse(data.settings ?? {}),
			summary: null,
			summaryUntil: null,
			pinned: false,
			archived: false,
			lastMessageAt: null,
			lastMessagePreview: null,
			createdAt: now,
			updatedAt: now,
		};
	}
	await db.insert(schema.conversations).values(row);
	const conversation = toConversation(row);
	bus.emit({ type: "conversation.created", conversation }, { to: [row.userId] });
	return conversation;
}

/** The persistent agent-to-agent thread for a pair of agents (used by agent_ask). */
export async function getTeamThread(aId: string, bId: string): Promise<Conversation> {
	const groups = await listConversations({ kind: "group" });
	const pair = [aId, bId].sort().join("|");
	const existing = groups.find((c) => c.settings.team && [...c.memberIds].sort().join("|") === pair);
	if (existing) return existing;
	const agents = await listAgents();
	const name = (id: string) => agents.find((a) => a.id === id)?.name ?? "Agent";
	return createConversation({
		kind: "group",
		memberIds: [aId, bId],
		title: `${name(aId)} ↔ ${name(bId)}`,
		settings: {
			team: true,
			createdByAgentId: aId,
			maxTurns: 2,
			purpose:
				"Bot-to-bot thread: questions and answers between these two bots. The user can read along and join in.",
		},
	});
}

/**
 * The agent's main chat with someone: their most recently active direct chat with it, created on first use. For
 * Sekai's own work (a routine, a message from Discord) that's the person it acts for, else the bot's owner.
 */
export async function getDirectConversation(agentId: string, userId?: string): Promise<Conversation> {
	const agent = await getAgent(agentId);
	if (!agent) throw notFound("Bot");
	const ownerId = userId ?? newOwner(agent.userId);
	const [latest] = await listConversations({ agentId, kind: "direct", userId: ownerId });
	if (latest) return latest;
	return createConversation({ kind: "direct", agentId, title: "New chat" }, { ownerId });
}

export async function updateConversation(id: string, input: ConversationUpdateInput): Promise<Conversation> {
	const patch = parse(ConversationUpdate, input);
	const current = await requireConversation(id);
	if (patch.memberIds && current.kind !== "group") throw badRequest("Only group chats have editable members");
	await db
		.update(schema.conversations)
		.set({
			...patch,
			settings: patch.settings
				? ConversationSettings.parse({ ...current.settings, ...patch.settings })
				: undefined,
			updatedAt: Date.now(),
		})
		.where(eq(schema.conversations.id, id));
	const conversation = await requireConversation(id);
	bus.emit({ type: "conversation.updated", conversation });
	return conversation;
}

/** A chat whoever's it is (Sekai's own bookkeeping, like previews and summaries). */
export async function loadConversation(id: string): Promise<Conversation | null> {
	const row = await db.query.conversations.findFirst({ where: eq(schema.conversations.id, id) });
	return row ? toConversation(row) : null;
}

export async function setConversationSummary(id: string, summary: string | null, until: number | null) {
	await db
		.update(schema.conversations)
		.set({ summary, summaryUntil: until, updatedAt: Date.now() })
		.where(eq(schema.conversations.id, id));
	const conversation = await loadConversation(id);
	if (!conversation) throw notFound("Chat");
	bus.emit({ type: "conversation.updated", conversation });
	return conversation;
}

export async function deleteConversation(id: string): Promise<void> {
	await requireConversation(id);
	await db.delete(schema.conversations).where(eq(schema.conversations.id, id));
	bus.emit({ type: "conversation.deleted", conversationId: id });
}

/** Clears the history. Memory, notes, routines and settings are kept. */
export async function resetConversation(id: string): Promise<Conversation> {
	await requireConversation(id);
	await db.delete(schema.messages).where(eq(schema.messages.conversationId, id));
	// External agents keep their own transcripts; a reset starts them over too.
	await db.delete(schema.externalSessions).where(eq(schema.externalSessions.conversationId, id));
	await db
		.update(schema.conversations)
		.set({
			summary: null,
			summaryUntil: null,
			lastMessageAt: null,
			lastMessagePreview: null,
			updatedAt: Date.now(),
		})
		.where(eq(schema.conversations.id, id));
	bus.emit({ type: "conversation.reset", conversationId: id });
	const conversation = await requireConversation(id);
	bus.emit({ type: "conversation.updated", conversation });
	return conversation;
}

/** A message's text without markdown marks (**bold**, `code`, headings, bullets, links), for one-line previews. */
export function plainPreview(text: string): string {
	return text
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/^\s{0,3}(#{1,6}\s+|[-*+]\s+|>\s?)/gm, "")
		.replace(/\*\*|__|~~|`/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

export async function touchConversation(message: Message): Promise<void> {
	const text = plainPreview(messageText(message));
	const preview = text ? truncate(text, 140) : (message.attachments[0]?.name ?? null);
	await db
		.update(schema.conversations)
		.set({ lastMessageAt: message.createdAt, lastMessagePreview: preview, updatedAt: Date.now() })
		.where(eq(schema.conversations.id, message.conversationId));
	const conversation = await loadConversation(message.conversationId);
	if (conversation) bus.emit({ type: "conversation.updated", conversation });
}
