import type { LibraryDocument, LibraryHit } from "@sekai/shared";
import { and, asc, eq, sql } from "drizzle-orm";
import { requirePermission, runAs } from "../auth/actor.ts";
import { db, schema } from "../db/index.ts";
import { bus } from "../events/bus.ts";
import { badRequest, errorMessage, notFound } from "../lib/errors.ts";
import { newId } from "../lib/ids.ts";
import { log } from "../lib/log.ts";
import { embed } from "../llm/embeddings.ts";
import { readKey } from "../services/kv.ts";
import { getUploadRow, saveUpload, uploadUrl } from "../services/uploads.ts";
import { isMine, newOwner, ownWhere } from "../services/visibility.ts";
import { chunkSections } from "./chunk.ts";
import { extract, kindOf, SUPPORTED } from "./extract.ts";

/**
 * The document library: files you upload are read, split into passages and embedded, so every bot can search
 * them by meaning (and by words) with library_search, and read around a hit with library_read.
 */

const DEFAULT_MODEL = "text-embedding-3-small";
type Row = typeof schema.documents.$inferSelect;

const changed = (userId?: string) => bus.emit({ type: "library.changed" }, userId ? { to: [userId] } : {});

function toDocument(r: Row): LibraryDocument {
	const { uploadId, embeddingModel: _model, userId: _owner, ...rest } = r;
	return { ...rest, url: uploadId ? uploadUrl(uploadId) : null };
}

async function embeddingModel(): Promise<string> {
	return ((await readKey("library.embeddingModel")) as string | undefined) || DEFAULT_MODEL;
}

/** Each person's library is their own (Sekai itself sees everyone's). */
export async function listDocuments(): Promise<LibraryDocument[]> {
	const rows = await db
		.select()
		.from(schema.documents)
		.where(ownWhere(schema.documents.userId))
		.orderBy(asc(schema.documents.collection), asc(schema.documents.title));
	return rows.map(toDocument);
}

/** How many documents bots can search (for the tools and the system prompt). */
export async function readyCount(): Promise<number> {
	const [row] = await db
		.select({ n: sql<number>`count(*)::int` })
		.from(schema.documents)
		.where(and(eq(schema.documents.status, "ready"), ownWhere(schema.documents.userId)));
	return row?.n ?? 0;
}

async function requireDocument(id: string): Promise<Row> {
	const [row] = await db.select().from(schema.documents).where(eq(schema.documents.id, id));
	if (!row || !isMine(row.userId)) throw notFound("Document");
	return row;
}

/** A file to add: kept as an upload, then read and indexed in the background. */
export async function addDocument(file: File, collection = ""): Promise<LibraryDocument> {
	const name = file.name.split(/[\\/]/).pop() || "document";
	if (!kindOf(name, file.type)) throw badRequest(`Sekai can't read "${name}". It reads ${SUPPORTED}.`);
	requirePermission("library");
	const userId = newOwner();
	const upload = await saveUpload(file, name, file.type || "application/octet-stream", { userId });
	const now = Date.now();
	const row: Row = {
		id: newId("doc", 16),
		userId,
		title:
			name
				.replace(/\.[^.]+$/, "")
				.replace(/[_-]+/g, " ")
				.trim() || name,
		collection: collection.trim().slice(0, 120),
		fileName: name,
		mime: upload.mime,
		size: upload.size,
		uploadId: upload.id,
		status: "indexing",
		error: null,
		pages: null,
		chunks: 0,
		chars: 0,
		embeddingModel: null,
		createdAt: now,
		updatedAt: now,
	};
	await db.insert(schema.documents).values(row);
	changed(userId);
	enqueue(row.id);
	return toDocument(row);
}

export async function renameDocument(id: string, title: string): Promise<LibraryDocument> {
	const t = title.trim().slice(0, 200);
	if (!t) throw badRequest("Give it a title");
	await requireDocument(id);
	await db.update(schema.documents).set({ title: t, updatedAt: Date.now() }).where(eq(schema.documents.id, id));
	changed();
	return toDocument(await requireDocument(id));
}

export async function deleteDocument(id: string): Promise<void> {
	const row = await requireDocument(id);
	await db.delete(schema.documents).where(eq(schema.documents.id, id));
	if (row.uploadId) {
		// The original file goes too (it was only kept for the library).
		const up = await getUploadRow(row.uploadId).catch(() => null);
		if (up) {
			await db.delete(schema.uploads).where(eq(schema.uploads.id, up.id));
			await Bun.file(up.path)
				.delete()
				.catch(() => {});
		}
	}
	changed();
}

export async function reindexDocument(id: string): Promise<LibraryDocument> {
	await requireDocument(id);
	await db
		.update(schema.documents)
		.set({ status: "indexing", error: null, updatedAt: Date.now() })
		.where(eq(schema.documents.id, id));
	changed();
	enqueue(id);
	return toDocument(await requireDocument(id));
}

// ---------------------------------------------------------------- indexing (one document at a time)

const queue: string[] = [];
let working = false;

function enqueue(id: string): void {
	if (!queue.includes(id)) queue.push(id);
	void drain();
}

async function drain(): Promise<void> {
	if (working) return;
	working = true;
	try {
		for (let id = queue.shift(); id; id = queue.shift()) await indexOne(id);
	} finally {
		working = false;
	}
}

async function indexOne(id: string): Promise<void> {
	// Whoever's document it is (the queue is shared).
	const row = await runAs(null, () => requireDocument(id)).catch(() => null);
	if (!row?.uploadId) return;
	const started = Date.now();
	const uploadId = row.uploadId;
	try {
		const up = await runAs(null, () => getUploadRow(uploadId));
		const bytes = new Uint8Array(await Bun.file(up.path).arrayBuffer());
		const text = await extract(bytes, row.fileName, row.mime);
		const passages = chunkSections(text.sections);
		if (!passages.length) throw badRequest("There's no text in it to search.");
		const model = await embeddingModel();
		let vectors: (number[] | null)[] = passages.map(() => null);
		let warning: string | null = null;
		try {
			vectors = await embed(
				model,
				passages.map((p) => `${row.title}${p.heading ? ` — ${p.heading}` : ""}\n${p.content}`),
			);
		} catch (err) {
			warning = `Searchable by words only: the embedding model (${model}) didn't answer (${errorMessage(err)}). Index it again later.`;
		}
		await db.transaction(async (tx) => {
			await tx.delete(schema.documentChunks).where(eq(schema.documentChunks.documentId, id));
			for (let i = 0; i < passages.length; i += 200) {
				await tx.insert(schema.documentChunks).values(
					passages.slice(i, i + 200).map((p, k) => ({
						documentId: id,
						ord: p.ord,
						page: p.page,
						heading: p.heading,
						content: p.content,
						embedding: vectors[i + k] ?? null,
					})),
				);
			}
			await tx
				.update(schema.documents)
				.set({
					status: "ready",
					error: warning,
					pages: text.pages,
					chunks: passages.length,
					chars: passages.reduce((n, p) => n + p.content.length, 0),
					embeddingModel: warning ? null : model,
					updatedAt: Date.now(),
				})
				.where(eq(schema.documents.id, id));
		});
		log.info(
			`library: indexed "${row.title}" (${passages.length} passages, ${((Date.now() - started) / 1000).toFixed(1)}s)`,
		);
	} catch (err) {
		log.warn(`library: couldn't index "${row.title}": ${errorMessage(err)}`);
		await db
			.update(schema.documents)
			.set({ status: "error", error: errorMessage(err), updatedAt: Date.now() })
			.where(eq(schema.documents.id, id));
	}
	changed(row.userId);
}

/** At startup: documents a restart interrupted are indexed again. */
export async function resumeLibrary(): Promise<void> {
	const rows = await db
		.select({ id: schema.documents.id })
		.from(schema.documents)
		.where(eq(schema.documents.status, "indexing"));
	for (const r of rows) enqueue(r.id);
}

// ---------------------------------------------------------------- search and reading

/** Words too common to say anything about a passage ("is a broken glass covered?" is about glass and covers). */
const STOPWORDS = new Set(
	"a an and are as at be but by can could did do does for from had has have how i if in into is it its me my no not of on or our should so than that the their them then there these they this to was we were what when where which who why will with would you your".split(
		" ",
	),
);

type HitRow = {
	id: number;
	document_id: string;
	ord: number;
	page: number | null;
	heading: string | null;
	content: string;
};

/** Documents matching a title, file name or id. */
export async function findDocuments(ref: string): Promise<LibraryDocument[]> {
	const r = ref.trim().toLowerCase();
	const all = (await listDocuments()).filter((d) => d.status === "ready");
	const exact = all.filter((d) => d.id === ref || d.title.toLowerCase() === r || d.fileName.toLowerCase() === r);
	if (exact.length) return exact;
	return all.filter(
		(d) =>
			d.title.toLowerCase().includes(r) ||
			d.fileName.toLowerCase().includes(r) ||
			d.collection.toLowerCase() === r,
	);
}

/** Passages that match, by meaning and by words, best first (reciprocal rank fusion of the two). */
export async function searchLibrary(
	query: string,
	opts: { documentIds?: string[]; limit?: number; signal?: AbortSignal } = {},
): Promise<LibraryHit[]> {
	const q = query.trim();
	if (!q) throw badRequest("Say what to look for");
	const limit = Math.min(Math.max(opts.limit ?? 6, 1), 20);
	const pool = limit * 4;
	const docs = await db
		.select()
		.from(schema.documents)
		.where(and(eq(schema.documents.status, "ready"), ownWhere(schema.documents.userId)));
	const scope = opts.documentIds?.length ? docs.filter((d) => opts.documentIds?.includes(d.id)) : docs;
	if (!scope.length) return [];
	const ids = sql.join(
		scope.map((d) => sql`${d.id}`),
		sql`, `,
	);

	let byMeaning: HitRow[] = [];
	const models = [...new Set(scope.map((d) => d.embeddingModel).filter((m): m is string => Boolean(m)))];
	// The model most documents were embedded with (others are found by their words).
	const model = models.sort(
		(a, b) =>
			scope.filter((d) => d.embeddingModel === b).length - scope.filter((d) => d.embeddingModel === a).length,
	)[0];
	if (model) {
		const sameModel = sql.join(
			scope.filter((d) => d.embeddingModel === model).map((d) => sql`${d.id}`),
			sql`, `,
		);
		try {
			const [vector] = await embed(model, [q], opts.signal);
			if (vector) {
				byMeaning = (await db.execute(sql`
					select id, document_id, ord, page, heading, content from document_chunks
					where document_id in (${sameModel}) and embedding is not null
					order by embedding <=> ${`[${vector.join(",")}]`}::vector limit ${pool}`)) as unknown as HitRow[];
			}
		} catch (err) {
			log.debug(`library search by meaning failed, words only: ${errorMessage(err)}`);
		}
	}
	const words = q
		.toLowerCase()
		.split(/[^\p{L}\p{N}]+/u)
		.filter((w) => w.length > 1 && !STOPWORDS.has(w))
		.slice(0, 12);
	let byWords: HitRow[] = [];
	if (words.length) {
		const tsq = words.join(" | ");
		byWords = (await db.execute(sql`
			select id, document_id, ord, page, heading, content from document_chunks
			where document_id in (${ids}) and tsv @@ to_tsquery('simple', ${tsq})
			order by ts_rank(tsv, to_tsquery('simple', ${tsq}), 1) desc limit ${pool}`)) as unknown as HitRow[];
	}
	const score = new Map<number, { hit: HitRow; score: number }>();
	const add = (list: HitRow[], weight: number) =>
		list.forEach((h, rank) => {
			const prev = score.get(h.id);
			score.set(h.id, { hit: h, score: (prev?.score ?? 0) + weight / (60 + rank) });
		});
	add(byMeaning, 1);
	add(byWords, 0.6);
	const byId = new Map(scope.map((d) => [d.id, d]));
	return [...score.values()]
		.sort((a, b) => b.score - a.score)
		.slice(0, limit)
		.map(({ hit, score: s }) => ({
			documentId: hit.document_id,
			title: byId.get(hit.document_id)?.title ?? "",
			collection: byId.get(hit.document_id)?.collection ?? "",
			chunk: hit.ord,
			page: hit.page,
			heading: hit.heading,
			content: hit.content,
			score: Math.round(s * 10_000) / 10_000,
		}));
}

/** A stretch of a document: around a passage from a search, a page, or from the start. */
export async function readDocument(
	id: string,
	at: { chunk?: number; page?: number } = {},
	maxChars = 8000,
): Promise<{ document: LibraryDocument; text: string; from: number; to: number; more: boolean }> {
	const doc = await requireDocument(id);
	const t = schema.documentChunks;
	let rows: { ord: number; page: number | null; heading: string | null; content: string }[];
	if (at.page !== undefined) {
		rows = await db
			.select({ ord: t.ord, page: t.page, heading: t.heading, content: t.content })
			.from(t)
			.where(sql`${t.documentId} = ${id} and ${t.page} = ${at.page}`)
			.orderBy(asc(t.ord));
		if (!rows.length) throw badRequest(`It has no page ${at.page}${doc.pages ? ` (it has ${doc.pages})` : ""}.`);
	} else {
		const start = Math.max(0, (at.chunk ?? 0) - (at.chunk ? 1 : 0));
		rows = await db
			.select({ ord: t.ord, page: t.page, heading: t.heading, content: t.content })
			.from(t)
			.where(sql`${t.documentId} = ${id} and ${t.ord} >= ${start}`)
			.orderBy(asc(t.ord))
			.limit(12);
	}
	const parts: string[] = [];
	let size = 0;
	let last = rows[0]?.ord ?? 0;
	for (const r of rows) {
		if (size && size + r.content.length > maxChars) break;
		parts.push(r.page !== null ? `[page ${r.page}] ${r.content}` : r.content);
		size += r.content.length;
		last = r.ord;
	}
	return {
		document: toDocument(doc),
		text: parts.join("\n\n"),
		from: rows[0]?.ord ?? 0,
		to: last,
		more: last < doc.chunks - 1,
	};
}
