import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { type Attachment, MAX_UPLOAD_BYTES, type Upload } from "@sekai/shared";
import { eq, inArray } from "drizzle-orm";
import { currentActor } from "../auth/actor.ts";
import { config } from "../config.ts";
import { db, schema } from "../db/index.ts";
import { badRequest, notFound } from "../lib/errors.ts";
import { ID } from "../lib/ids.ts";
import { imageMime } from "../lib/mime.ts";
import { checkStorage } from "./limits.ts";

type UploadRow = typeof schema.uploads.$inferSelect;

const EXT_BY_MIME: Record<string, string> = {
	"image/png": ".png",
	"image/jpeg": ".jpg",
	"image/gif": ".gif",
	"image/webp": ".webp",
	"image/svg+xml": ".svg",
	"application/pdf": ".pdf",
	"audio/ogg": ".ogg",
	"audio/webm": ".webm",
	"audio/wav": ".wav",
	"audio/mpeg": ".mp3",
};

export function uploadUrl(id: string): string {
	return `/api/uploads/${id}`;
}

function toUpload(row: UploadRow): Upload {
	return {
		id: row.id,
		name: row.name,
		mime: row.mime,
		size: row.size,
		kind: row.kind,
		url: uploadUrl(row.id),
		createdAt: row.createdAt,
	};
}

export function toAttachment(u: Upload): Attachment {
	return { id: u.id, name: u.name, mime: u.mime, size: u.size, url: u.url, kind: u.kind };
}

/**
 * Keeps a file. It belongs to the person Sekai acts for (or, for Sekai's own work, the server: admins only), and
 * counts toward their role's storage. "users": anyone signed in may see it (a bot's picture).
 */
export async function saveUpload(
	data: Blob | Uint8Array | string,
	name: string,
	mime: string,
	opts: { userId?: string | null; visibility?: "owner" | "users" } = {},
): Promise<Upload> {
	const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
	if (blob.size > MAX_UPLOAD_BYTES) throw badRequest("File is larger than 25 MB");
	await checkStorage(blob.size);
	const id = ID.upload();
	const safeName = name.replace(/[^\w.\- ()]/g, "_").slice(0, 200) || "file";
	const ext = EXT_BY_MIME[mime] ?? (safeName.includes(".") ? safeName.slice(safeName.lastIndexOf(".")) : "");
	// "image/SVG+xml; charset=utf-8" is still an SVG: compare and serve the bare, lower-case type.
	const labelled = (mime.split(";")[0] ?? "").trim().toLowerCase();
	const cleanMime = labelled.startsWith("image/")
		? imageMime(new Uint8Array(await blob.slice(0, 16).arrayBuffer()), labelled)
		: labelled;
	const path = join(config.dataDir, "uploads", `${id}${ext.slice(0, 12)}`);
	await Bun.write(path, blob);
	const row: UploadRow = {
		id,
		userId: opts.userId === undefined ? (currentActor()?.userId ?? null) : opts.userId,
		visibility: opts.visibility ?? "owner",
		name: safeName,
		mime: cleanMime || "application/octet-stream",
		size: blob.size,
		path,
		kind: cleanMime.startsWith("image/") ? "image" : "file",
		createdAt: Date.now(),
	};
	await db.insert(schema.uploads).values(row);
	return toUpload(row);
}

/**
 * Where the file is now. Paths are stored in full, so after the data folder moved (or a backup was restored on
 * another server) the file is found by its name in this data folder's uploads.
 */
function located(row: UploadRow): UploadRow {
	if (existsSync(row.path)) return row;
	const here = join(config.dataDir, "uploads", basename(row.path));
	return existsSync(here) ? { ...row, path: here } : row;
}

/** Whether someone may see a file: theirs, a bot's picture, or (admins) the server's own. */
export function canReadUpload(row: Pick<UploadRow, "userId" | "visibility">, actor = currentActor()): boolean {
	if (!actor) return true;
	if (row.visibility === "users" || row.userId === actor.userId) return true;
	return row.userId === null && actor.admin;
}

/** A file, if the person Sekai acts for may see it (someone else's is "not found"). */
export async function getUploadRow(id: string): Promise<UploadRow> {
	const row = await db.query.uploads.findFirst({ where: eq(schema.uploads.id, id) });
	if (!row || !canReadUpload(row)) throw notFound("Upload");
	return located(row);
}

/** Lets anyone signed in see a file (it became a bot's picture). */
export async function shareUploadWithUsers(id: string): Promise<void> {
	await db.update(schema.uploads).set({ visibility: "users" }).where(eq(schema.uploads.id, id));
}

/** The upload id in a URL like /api/uploads/upl_…, if it is one. */
export function uploadIdFromUrl(url: string): string | null {
	return url.match(/\/api\/uploads\/(upl_[A-Za-z0-9]+)/)?.[1] ?? null;
}

/** The acting person's files among these ids, in order (others' are left out). */
export async function getUploads(ids: string[]): Promise<Upload[]> {
	if (ids.length === 0) return [];
	const rows = (await db.select().from(schema.uploads).where(inArray(schema.uploads.id, ids))).filter((r) =>
		canReadUpload(r),
	);
	const byId = new Map(rows.map((r) => [r.id, r]));
	return ids.flatMap((id) => {
		const r = byId.get(id);
		return r ? [toUpload(r)] : [];
	});
}

const TEXT_MIME = /^(text\/|application\/(json|xml|yaml|x-yaml|javascript|typescript|x-sh|toml|sql|csv))/;
const TEXT_EXT =
	/\.(txt|md|markdown|json|ya?ml|toml|csv|tsv|xml|html?|css|js|jsx|ts|tsx|py|rb|go|rs|java|kt|c|h|cpp|hpp|cs|sh|ps1|sql|ini|env|log)$/i;

export function isTextFile(a: Pick<Attachment, "mime" | "name">): boolean {
	return TEXT_MIME.test(a.mime) || TEXT_EXT.test(a.name);
}

export async function readUploadBase64(id: string): Promise<{ mime: string; base64: string }> {
	const row = await getUploadRow(id);
	const buf = Buffer.from(await Bun.file(row.path).arrayBuffer());
	return {
		mime: row.mime.startsWith("image/") ? imageMime(buf, row.mime) : row.mime,
		base64: buf.toString("base64"),
	};
}

export async function readUploadText(id: string, maxChars = 100_000): Promise<string> {
	const row = await getUploadRow(id);
	const text = await Bun.file(row.path).text();
	return text.length > maxChars ? `${text.slice(0, maxChars)}\n[… truncated]` : text;
}
