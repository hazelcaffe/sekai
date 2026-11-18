import {
	type Memory,
	MemoryCreate,
	type MemoryCreate as MemoryCreateInput,
	type MemoryKind,
	MemoryUpdate,
	type MemoryUpdate as MemoryUpdateInput,
	type Note,
	NoteCreate,
	type NoteCreate as NoteCreateInput,
	NoteUpdate,
	type NoteUpdate as NoteUpdateInput,
} from "@sekai/shared";
import { and, desc, eq, ilike, isNull, or, type SQL } from "drizzle-orm";
import { db, schema } from "../db/index.ts";
import { bus } from "../events/bus.ts";
import { notFound, parse } from "../lib/errors.ts";
import { ID } from "../lib/ids.ts";
import { getAgent } from "./agents.ts";
import { isMine, newOwner, ownWhere } from "./visibility.ts";

/**
 * Memories and notes are each person's own: a bot shared with you remembers you separately from its owner (and
 * keeps separate notes with you).
 */

/** The bot a memory or note is about must be one you see. */
async function checkAgent(agentId: string | null | undefined): Promise<void> {
	if (agentId && !(await getAgent(agentId))) throw notFound("Agent");
}

// ---------------------------------------------------------------- memories

export interface MemoryFilter {
	agentId?: string | null;
	/** Include memories shared by every agent (agentId null). */
	includeShared?: boolean;
	/** Only shared memories. */
	sharedOnly?: boolean;
	kind?: MemoryKind;
	query?: string;
	limit?: number;
}

export async function listMemories(filter: MemoryFilter = {}): Promise<Memory[]> {
	const where: (SQL | undefined)[] = [ownWhere(schema.memories.userId)];
	if (filter.sharedOnly) where.push(isNull(schema.memories.agentId));
	else if (filter.agentId) {
		where.push(
			filter.includeShared
				? or(eq(schema.memories.agentId, filter.agentId), isNull(schema.memories.agentId))
				: eq(schema.memories.agentId, filter.agentId),
		);
	}
	if (filter.kind) where.push(eq(schema.memories.kind, filter.kind));
	if (filter.query?.trim()) where.push(ilike(schema.memories.content, `%${filter.query.trim()}%`));
	const q = db
		.select()
		.from(schema.memories)
		.where(and(...where))
		.orderBy(desc(schema.memories.pinned), desc(schema.memories.updatedAt));
	return filter.limit ? q.limit(filter.limit) : q;
}

export async function getMemory(id: string): Promise<Memory | null> {
	const row = await db.query.memories.findFirst({ where: eq(schema.memories.id, id) });
	return row && isMine(row.userId) ? row : null;
}

export async function createMemory(input: MemoryCreateInput, source: Memory["source"] = "user"): Promise<Memory> {
	const data = parse(MemoryCreate, input);
	await checkAgent(data.agentId);
	const agent = data.agentId ? await getAgent(data.agentId) : null;
	const now = Date.now();
	const row = {
		id: ID.memory(),
		userId: newOwner(agent?.userId),
		agentId: data.agentId,
		kind: data.kind,
		content: data.content,
		source,
		pinned: data.pinned,
		createdAt: now,
		updatedAt: now,
	};
	await db.insert(schema.memories).values(row);
	bus.emit({ type: "memory.changed", agentId: row.agentId });
	return row satisfies Memory;
}

export async function updateMemory(id: string, input: MemoryUpdateInput): Promise<Memory> {
	const patch = parse(MemoryUpdate, input);
	const before = await getMemory(id);
	if (!before) throw notFound("Memory");
	if (patch.agentId !== undefined) await checkAgent(patch.agentId);
	await db
		.update(schema.memories)
		.set({ ...patch, updatedAt: Date.now() })
		.where(eq(schema.memories.id, id));
	const after = await getMemory(id);
	if (!after) throw notFound("Memory");
	bus.emit({ type: "memory.changed", agentId: before.agentId });
	if (after.agentId !== before.agentId) bus.emit({ type: "memory.changed", agentId: after.agentId });
	return after;
}

export async function deleteMemory(id: string): Promise<void> {
	const m = await getMemory(id);
	if (!m) throw notFound("Memory");
	await db.delete(schema.memories).where(eq(schema.memories.id, id));
	bus.emit({ type: "memory.changed", agentId: m.agentId });
}

export async function clearMemories(filter: { agentId?: string; shared?: boolean; kind?: MemoryKind }) {
	const where: SQL[] = [];
	const own = ownWhere(schema.memories.userId);
	if (own) where.push(own);
	if (filter.shared) where.push(isNull(schema.memories.agentId));
	else if (filter.agentId) where.push(eq(schema.memories.agentId, filter.agentId));
	else throw new Error("clearMemories needs agentId or shared");
	if (filter.kind) where.push(eq(schema.memories.kind, filter.kind));
	const rows = await db
		.delete(schema.memories)
		.where(and(...where))
		.returning({ id: schema.memories.id });
	bus.emit({ type: "memory.changed", agentId: filter.shared ? null : (filter.agentId ?? null) });
	return rows.length;
}

// ---------------------------------------------------------------- notes

export async function listNotes(agentId: string): Promise<Note[]> {
	return db
		.select()
		.from(schema.notes)
		.where(and(eq(schema.notes.agentId, agentId), ownWhere(schema.notes.userId)))
		.orderBy(desc(schema.notes.pinned), desc(schema.notes.updatedAt));
}

export async function getNote(id: string): Promise<Note | null> {
	const row = await db.query.notes.findFirst({ where: eq(schema.notes.id, id) });
	return row && isMine(row.userId) ? row : null;
}

export async function createNote(input: NoteCreateInput, createdBy: Note["createdBy"] = "user"): Promise<Note> {
	const data = parse(NoteCreate, input);
	const agent = await getAgent(data.agentId);
	if (!agent) throw notFound("Agent");
	const now = Date.now();
	const row = { id: ID.note(), userId: newOwner(agent.userId), ...data, createdBy, createdAt: now, updatedAt: now };
	await db.insert(schema.notes).values(row);
	bus.emit({ type: "note.changed", agentId: row.agentId });
	return row;
}

export async function updateNote(id: string, input: NoteUpdateInput): Promise<Note> {
	const patch = parse(NoteUpdate, input);
	const before = await getNote(id);
	if (!before) throw notFound("Note");
	await db
		.update(schema.notes)
		.set({ ...patch, updatedAt: Date.now() })
		.where(eq(schema.notes.id, id));
	const after = await getNote(id);
	if (!after) throw notFound("Note");
	bus.emit({ type: "note.changed", agentId: after.agentId });
	return after;
}

export async function deleteNote(id: string): Promise<void> {
	const n = await getNote(id);
	if (!n) throw notFound("Note");
	await db.delete(schema.notes).where(eq(schema.notes.id, id));
	bus.emit({ type: "note.changed", agentId: n.agentId });
}
