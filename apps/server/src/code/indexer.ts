import { basename } from "node:path";
import type { CodeIndex, CodeIndexProgress, CodeSearchHit, Machine } from "@sekai/shared";
import { and, eq, inArray, sql } from "drizzle-orm";
import { currentActor } from "../auth/actor.ts";
import { db, schema } from "../db/index.ts";
import { bus } from "../events/bus.ts";
import { badRequest, errorMessage, notFound } from "../lib/errors.ts";
import { newId } from "../lib/ids.ts";
import { log } from "../lib/log.ts";
import { embed } from "../llm/embeddings.ts";
import { driverFor } from "../machines/drivers.ts";
import { getMachine, listMachines } from "../machines/manager.ts";
import { chunkFile, embeddingText } from "./chunker.ts";

/**
 * Code indexes: a bot reads a folder of code on one of its machines, splits it into chunks, and embeds them
 * through the gateway, so it can search the code by meaning (and by name). Re-indexing only reads files whose
 * contents changed.
 */

const DEFAULT_MODEL = "text-embedding-3-small";
/** Files read per round trip to the machine. */
const READ_BATCH = 120;
/** Chunks embedded per request. */
const EMBED_BATCH = 64;
const MAX_CHUNKS = 60_000;
const TEST_PATH = /(^|\/)(tests?|__tests__|spec|test-d|e2e)\/|\.(test|spec)\.[a-z]+$/i;

const running = new Map<string, AbortController>();

type Row = typeof schema.codeIndexes.$inferSelect;

function toPublic(r: Row, machines: Map<string, Machine>): CodeIndex {
	return {
		id: r.id,
		agentId: r.agentId,
		machineId: r.machineId,
		machineName: machines.get(r.machineId)?.name ?? "a machine",
		root: r.root,
		name: r.name,
		embeddingModel: r.embeddingModel,
		status: r.status,
		progress: r.progress ?? null,
		files: r.files,
		chunks: r.chunks,
		bytes: r.bytes,
		error: r.error,
		lastIndexedAt: r.lastIndexedAt ?? null,
		createdAt: r.createdAt,
	};
}

async function machineMap(): Promise<Map<string, Machine>> {
	return new Map((await listMachines({})).map((m) => [m.id, m]));
}

export async function listCodeIndexes(agentId?: string): Promise<CodeIndex[]> {
	const rows = await db
		.select()
		.from(schema.codeIndexes)
		.where(agentId ? eq(schema.codeIndexes.agentId, agentId) : undefined)
		.orderBy(schema.codeIndexes.name);
	// Only indexes on machines the acting person sees (their own bots').
	const machines = await machineMap();
	return rows.filter((r) => !currentActor() || machines.has(r.machineId)).map((r) => toPublic(r, machines));
}

export async function getCodeIndex(id: string): Promise<CodeIndex> {
	const [r] = await db.select().from(schema.codeIndexes).where(eq(schema.codeIndexes.id, id));
	const machines = await machineMap();
	if (!r || (currentActor() && !machines.has(r.machineId))) throw notFound("Code index");
	return toPublic(r, machines);
}

function changed(agentId: string): void {
	bus.emit({ type: "code.changed", agentId });
}

async function patch(id: string, set: Partial<Row>): Promise<void> {
	await db
		.update(schema.codeIndexes)
		.set({ ...set, updatedAt: Date.now() })
		.where(eq(schema.codeIndexes.id, id));
}

/** Starts indexing a folder (or refreshes the index it already has). Returns at once; indexing runs on. */
export async function indexFolder(input: {
	agentId: string;
	machine: Machine;
	root: string;
	name?: string;
	/** An embedding model (gateway or API provider); text-embedding-3-small by default. */
	model?: string;
}): Promise<CodeIndex> {
	const root = input.root.trim().replace(/\/+$/, "") || "/";
	const [existing] = await db
		.select()
		.from(schema.codeIndexes)
		.where(and(eq(schema.codeIndexes.machineId, input.machine.id), eq(schema.codeIndexes.root, root)));
	let id = existing?.id;
	if (!id) {
		const model = input.model?.trim() || DEFAULT_MODEL;
		id = newId("cix", 12);
		const now = Date.now();
		await db.insert(schema.codeIndexes).values({
			id,
			agentId: input.agentId,
			machineId: input.machine.id,
			root,
			name: input.name?.trim() || basename(root) || root,
			embeddingModel: model,
			status: "indexing",
			progress: { phase: "scanning", done: 0, total: 0 },
			files: 0,
			chunks: 0,
			bytes: 0,
			createdAt: now,
			updatedAt: now,
		});
	}
	startIndexing(id);
	return getCodeIndex(id);
}

/** Indexes again: only changed files are read and embedded. */
export async function refreshCodeIndex(id: string): Promise<CodeIndex> {
	await getCodeIndex(id);
	startIndexing(id);
	return getCodeIndex(id);
}

function startIndexing(id: string): void {
	if (running.has(id)) return;
	const ctl = new AbortController();
	running.set(id, ctl);
	void run(id, ctl.signal)
		.catch(async (err: unknown) => {
			const message = ctl.signal.aborted ? "Stopped" : reason(err);
			log.warn(`code index ${id} failed: ${message}`);
			await patch(id, { status: "error", error: message, progress: null }).catch(() => {});
		})
		.finally(async () => {
			running.delete(id);
			const [r] = await db.select().from(schema.codeIndexes).where(eq(schema.codeIndexes.id, id));
			if (r) changed(r.agentId);
		});
}

/** A short reason (the database's own message, not the whole query it failed on). */
function reason(err: unknown): string {
	const cause = (err as { cause?: { message?: string } }).cause?.message;
	return (cause ?? errorMessage(err)).replace(/\0/g, "").split("\n")[0]?.slice(0, 300) ?? "Failed";
}

/** Postgres text can't hold NUL characters (they turn up in odd files). */
const clean = (s: string) => s.replace(/\0/g, "");

/** Waits for an index to finish (up to a limit). */
export async function waitForIndex(id: string, ms: number, signal?: AbortSignal): Promise<CodeIndex> {
	const end = Date.now() + ms;
	while (running.has(id) && Date.now() < end && !signal?.aborted) await Bun.sleep(1000);
	return getCodeIndex(id);
}

export async function deleteCodeIndex(id: string): Promise<void> {
	const ix = await getCodeIndex(id);
	running.get(id)?.abort();
	await db.delete(schema.codeIndexes).where(eq(schema.codeIndexes.id, id));
	changed(ix.agentId);
}

async function run(id: string, signal: AbortSignal): Promise<void> {
	const [row] = await db.select().from(schema.codeIndexes).where(eq(schema.codeIndexes.id, id));
	if (!row) return;
	const machine = await getMachine(row.machineId);
	if (!machine) throw new Error("The machine is gone");
	if (machine.status !== "running") throw new Error(`${machine.name} isn't running`);
	const progress = async (p: CodeIndexProgress) => {
		await patch(id, { status: "indexing", error: null, progress: p });
		changed(row.agentId);
	};
	await progress({ phase: "scanning", done: 0, total: 0 });
	const driver = await driverFor(machine);
	const scan = await driver.codeScan(row.root, signal);
	if (scan.root && scan.root !== row.root) await patch(id, { root: scan.root });

	const known = new Map(
		(await db.select().from(schema.codeFiles).where(eq(schema.codeFiles.indexId, id))).map((f) => [f.path, f]),
	);
	const present = new Map(scan.files.map(([path, size, hash]) => [path, { size, hash }]));
	const gone = [...known.keys()].filter((p) => present.get(p)?.hash !== known.get(p)?.hash);
	const todo = scan.files.filter(([path, , hash]) => known.get(path)?.hash !== hash);

	// Files that changed or went away lose their old chunks first.
	if (gone.length) {
		await progress({ phase: "cleaning", done: 0, total: gone.length });
		for (let i = 0; i < gone.length; i += 500) {
			const paths = gone.slice(i, i + 500);
			await db
				.delete(schema.codeChunks)
				.where(and(eq(schema.codeChunks.indexId, id), inArray(schema.codeChunks.path, paths)));
			await db
				.delete(schema.codeFiles)
				.where(and(eq(schema.codeFiles.indexId, id), inArray(schema.codeFiles.path, paths)));
		}
	}

	let total = (await counts(id)).chunks;
	let done = 0;
	await progress({ phase: "embedding", done, total: todo.length });
	for (let i = 0; i < todo.length; i += READ_BATCH) {
		if (signal.aborted) throw new Error("Stopped");
		const batch = todo.slice(i, i + READ_BATCH);
		const texts = await driver.codeRead(
			scan.root || row.root,
			batch.map(([p]) => p),
			signal,
		);
		const pending: { path: string; hash: string; size: number; chunks: ReturnType<typeof chunkFile> }[] = [];
		for (const [path, size, hash] of batch) {
			const text = texts[path];
			// Unreadable or binary: remembered with no chunks, so it isn't read again until it changes.
			pending.push({ path, hash, size, chunks: text ? chunkFile(path, text) : [] });
		}
		const flat = pending.flatMap((f) => f.chunks.map((c) => ({ path: f.path, chunk: c })));
		if (total + flat.length > MAX_CHUNKS) {
			throw new Error(
				`This folder is too big to index (over ${MAX_CHUNKS.toLocaleString()} pieces). Index a smaller folder inside it.`,
			);
		}
		for (let j = 0; j < flat.length; j += EMBED_BATCH) {
			const slice = flat.slice(j, j + EMBED_BATCH);
			const vectors = await embed(
				row.embeddingModel,
				slice.map((x) => embeddingText(x.path, x.chunk)),
				signal,
			);
			if (!row.dimensions && vectors[0]) {
				row.dimensions = vectors[0].length;
				await patch(id, { dimensions: row.dimensions });
			}
			await db.insert(schema.codeChunks).values(
				slice.map((x, k) => ({
					indexId: id,
					path: clean(x.path),
					startLine: x.chunk.startLine,
					endLine: x.chunk.endLine,
					symbol: x.chunk.symbol ? clean(x.chunk.symbol) : null,
					content: clean(x.chunk.content),
					embedding: vectors[k] ?? [],
				})),
			);
		}
		await db
			.insert(schema.codeFiles)
			.values(
				pending.map((f) => ({
					indexId: id,
					path: f.path,
					hash: f.hash,
					size: f.size,
					chunks: f.chunks.length,
				})),
			)
			.onConflictDoUpdate({
				target: [schema.codeFiles.indexId, schema.codeFiles.path],
				set: { hash: sql`excluded.hash`, size: sql`excluded.size`, chunks: sql`excluded.chunks` },
			});
		total += flat.length;
		done += batch.length;
		await progress({ phase: "embedding", done, total: todo.length });
	}
	const c = await counts(id);
	await patch(id, {
		status: "ready",
		progress: null,
		error: null,
		files: c.files,
		chunks: c.chunks,
		bytes: c.bytes,
		lastIndexedAt: Date.now(),
	});
	log.info(
		`code index ${row.name}: ${c.files} files, ${c.chunks} chunks (${todo.length} read, ${gone.length} dropped)`,
	);
}

async function counts(id: string): Promise<{ files: number; chunks: number; bytes: number }> {
	const [r] = await db
		.select({
			files: sql<number>`count(*)::int`,
			chunks: sql<number>`coalesce(sum(${schema.codeFiles.chunks}), 0)::int`,
			bytes: sql<number>`coalesce(sum(${schema.codeFiles.size}), 0)::bigint`,
		})
		.from(schema.codeFiles)
		.where(eq(schema.codeFiles.indexId, id));
	return { files: r?.files ?? 0, chunks: r?.chunks ?? 0, bytes: Number(r?.bytes ?? 0) };
}

/**
 * Searches indexes by meaning and by words (names, identifiers), merged by rank. Several indexes can be searched
 * at once (they must use the same embedding model; others are searched by words only).
 */
export async function searchCode(
	indexIds: string[],
	query: string,
	opts: { limit?: number; pathPrefix?: string; signal?: AbortSignal } = {},
): Promise<(CodeSearchHit & { indexId: string })[]> {
	const q = query.trim();
	if (!q) throw badRequest("Say what to look for");
	if (indexIds.length === 0) return [];
	const limit = Math.min(30, Math.max(1, opts.limit ?? 8));
	const visible = currentActor() ? await machineMap() : null;
	const rows = (await db.select().from(schema.codeIndexes).where(inArray(schema.codeIndexes.id, indexIds))).filter(
		(r) => !visible || visible.has(r.machineId),
	);
	if (rows.length === 0) return [];
	const model = rows.find((r) => r.chunks > 0 || r.status === "indexing")?.embeddingModel ?? rows[0]?.embeddingModel;
	const sameModel = rows.filter((r) => r.embeddingModel === model).map((r) => r.id);
	const prefix = opts.pathPrefix?.replace(/^\.?\/+/, "");
	const pathFilter = prefix ? sql`and path like ${`${prefix.replace(/[%_]/g, "\\$&")}%`}` : sql``;
	const pool = limit * 4;

	type Hit = {
		id: number;
		index_id: string;
		path: string;
		start_line: number;
		end_line: number;
		symbol: string | null;
		content: string;
	};
	let byMeaning: Hit[] = [];
	if (model && sameModel.length) {
		const [vector] = await embed(model, [q], opts.signal);
		if (vector) {
			const literal = `[${vector.join(",")}]`;
			const r = await db.execute(sql`
				select id, index_id, path, start_line, end_line, symbol, content
				from code_chunks
				where index_id in (${sql.join(
					sameModel.map((x) => sql`${x}`),
					sql`, `,
				)}) ${pathFilter}
				order by embedding <=> ${literal}::vector
				limit ${pool}`);
			byMeaning = r as unknown as Hit[];
		}
	}
	const words = q
		.replace(/[^A-Za-z0-9_]+/g, " ")
		.split(/\s+/)
		.filter((w) => w.length > 1)
		.slice(0, 12);
	let byWords: Hit[] = [];
	// (Only letters and digits reach to_tsquery: "foo__bar" or "___" must not make it a syntax error.)
	// Identifiers split the way the index does (fooBar_baz → foobar, baz), any word may match.
	const tsq = words
		.map((w) =>
			w
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, " ")
				.trim()
				.split(/\s+/)
				.filter(Boolean)
				.join(" & "),
		)
		.filter(Boolean)
		.join(" | ");
	if (tsq) {
		const r = await db.execute(sql`
			select id, index_id, path, start_line, end_line, symbol, content
			from code_chunks
			where index_id in (${sql.join(
				indexIds.map((x) => sql`${x}`),
				sql`, `,
			)}) ${pathFilter}
				and tsv @@ to_tsquery('simple', ${tsq})
			order by ts_rank(tsv, to_tsquery('simple', ${tsq})) desc
			limit ${pool}`);
		byWords = r as unknown as Hit[];
	}
	// Reciprocal rank fusion: good in either list, best in both.
	const score = new Map<number, { hit: Hit; score: number }>();
	const add = (list: Hit[], weight: number) =>
		list.forEach((h, rank) => {
			const prev = score.get(h.id);
			const s = weight / (60 + rank);
			score.set(h.id, { hit: h, score: (prev?.score ?? 0) + s });
		});
	add(byMeaning, 1);
	add(byWords, 0.8);
	// "Where is X done" usually means the code, not its tests: those rank a little lower (still found).
	for (const v of score.values()) if (TEST_PATH.test(v.hit.path)) v.score *= 0.8;
	return [...score.values()]
		.sort((a, b) => b.score - a.score)
		.slice(0, limit)
		.map(({ hit, score: s }) => ({
			indexId: hit.index_id,
			path: hit.path,
			startLine: hit.start_line,
			endLine: hit.end_line,
			symbol: hit.symbol,
			content: hit.content,
			score: Math.round(s * 10_000) / 10_000,
		}));
}

/** Indexes still marked as indexing after a restart pick up where they stopped. */
export async function resumeCodeIndexes(): Promise<void> {
	const rows = await db.select().from(schema.codeIndexes).where(eq(schema.codeIndexes.status, "indexing"));
	for (const r of rows) startIndexing(r.id);
}

export function stopCodeIndexes(): void {
	for (const c of running.values()) c.abort();
}
