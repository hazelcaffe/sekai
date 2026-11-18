import { existsSync } from "node:fs";
import { chmod, mkdir, readdir, rename, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { BackupKind } from "@sekai/shared";
import { APP_VERSION, config } from "../config.ts";
import { db } from "../db/index.ts";
import { badRequest, errorMessage } from "../lib/errors.ts";
import { log } from "../lib/log.ts";

/**
 * A backup is a .tar.gz of:
 *   manifest.json        what's in it (tables with their columns and row counts, files, Sekai version)
 *   db/<table>.jsonl     every row of every table, one JSON object per line
 *   data/<path>          the data folder's files that can't come back by themselves (DATA_PATHS)
 * Caches (avatars, voices, app icons), browser profiles, desktop app builds and SSH connections are left out.
 */
export const DATA_PATHS = ["secret.key", "ssh/keys", "ssh/known_hosts", "uploads", "workspaces"];

export interface Manifest {
	format: "sekai-backup";
	version: 1;
	app: string;
	kind: BackupKind;
	createdAt: number;
	/** Database migrations applied when it was made: one from a newer Sekai can't be restored by an older one. */
	migrations: number;
	tables: Record<string, { rows: number; columns: string[] }>;
	files: { paths: string[]; count: number };
}

const sql = db.$client;

/** A quoted SQL identifier (only plain lowercase names, which is all Sekai's schema uses). */
function ident(name: string): string {
	if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Unexpected table or column name: ${name}`);
	return `"${name}"`;
}

/** The database's tables and their (writable) columns. */
async function currentTables(): Promise<Map<string, string[]>> {
	const rows = await sql<{ table_name: string; column_name: string }[]>`
		select c.table_name, c.column_name
		from information_schema.columns c
		join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
		where c.table_schema = 'public' and t.table_type = 'BASE TABLE' and c.is_generated = 'NEVER'
		order by c.table_name, c.ordinal_position`;
	const out = new Map<string, string[]>();
	for (const r of rows) out.set(r.table_name, [...(out.get(r.table_name) ?? []), r.column_name]);
	return out;
}

export async function appliedMigrations(): Promise<number> {
	const [row] = await sql<{ n: string }[]>`select count(*)::text as n from drizzle.__drizzle_migrations`;
	return Number(row?.n ?? 0);
}

/** Tables in an order where every table comes after the ones it references (so inserts never break a foreign key). */
export function insertOrder(tables: string[], refs: { child: string; parent: string }[]): string[] {
	const parents = new Map(tables.map((t) => [t, new Set<string>()]));
	for (const r of refs) if (r.child !== r.parent) parents.get(r.child)?.add(r.parent);
	const order: string[] = [];
	const done = new Set<string>();
	const visit = (t: string, path: Set<string>) => {
		if (done.has(t) || path.has(t)) return;
		path.add(t);
		for (const p of parents.get(t) ?? []) if (parents.has(p)) visit(p, path);
		path.delete(t);
		done.add(t);
		order.push(t);
	};
	for (const t of [...tables].sort()) visit(t, new Set());
	return order;
}

async function foreignKeys(): Promise<{ child: string; parent: string }[]> {
	return sql<{ child: string; parent: string }[]>`
		select cl.relname as child, pl.relname as parent
		from pg_constraint c
		join pg_class cl on cl.oid = c.conrelid
		join pg_class pl on pl.oid = c.confrelid
		where c.contype = 'f' and c.connamespace = 'public'::regnamespace`;
}

async function run(cmd: string[], okCodes = [0]): Promise<string> {
	const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
	const [out, err, code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	if (!okCodes.includes(code)) {
		throw new Error(err.trim().split("\n").slice(-3).join(" ") || `${cmd[0]} exited with ${code}`);
	}
	return out;
}

async function countFiles(path: string): Promise<number> {
	try {
		const entries = await readdir(path, { recursive: true, withFileTypes: true });
		return entries.filter((e) => e.isFile()).length;
	} catch {
		return 1; // a file (secret.key)
	}
}

/** Writes a backup of the database and the data folder's kept files to `out` (a .tar.gz, readable only by Sekai). */
export async function writeBackup(out: string, kind: BackupKind): Promise<Manifest> {
	const work = `${out}.work`;
	const part = `${out}.part`;
	await rm(work, { recursive: true, force: true });
	await mkdir(join(work, "db"), { recursive: true, mode: 0o700 });
	try {
		const schema = await currentTables();
		const manifest: Manifest = {
			format: "sekai-backup",
			version: 1,
			app: APP_VERSION,
			kind,
			createdAt: Date.now(),
			migrations: await appliedMigrations(),
			tables: {},
			files: { paths: [], count: 0 },
		};
		// One consistent snapshot of the whole database: a reply saved while this runs is either all in or not at all.
		await sql.begin("isolation level repeatable read read only", async (tx) => {
			for (const [table, columns] of schema) {
				const writer = Bun.file(join(work, "db", `${table}.jsonl`)).writer();
				let rows = 0;
				await tx
					.unsafe<{ j: string }[]>(`select row_to_json(t)::text as j from ${ident(table)} t`)
					.cursor(500, (batch) => {
						for (const r of batch) writer.write(`${r.j}\n`);
						rows += batch.length;
					});
				await writer.end();
				manifest.tables[table] = { rows, columns };
			}
		});
		for (const p of DATA_PATHS) {
			const full = join(config.dataDir, p);
			if (!existsSync(full)) continue;
			manifest.files.paths.push(p);
			manifest.files.count += await countFiles(full);
		}
		await writeFile(join(work, "manifest.json"), JSON.stringify(manifest), { mode: 0o600 });
		// data/… in the archive, whatever the data folder is called (tar follows the link for the paths under it).
		await symlink(config.dataDir, join(work, "data"));
		// GNU tar exits with 1 when a file changed while it was read (an upload arriving): the archive is still fine.
		await run(
			[
				"tar",
				"-czf",
				part,
				"--exclude=node_modules",
				"-C",
				work,
				"manifest.json",
				"db",
				...manifest.files.paths.map((p) => `data/${p}`),
			],
			[0, 1],
		);
		await chmod(part, 0o600);
		await rename(part, out);
		return manifest;
	} finally {
		// The link first, so nothing could ever delete through it into the data folder.
		await unlink(join(work, "data")).catch(() => {});
		await rm(work, { recursive: true, force: true });
		await rm(part, { force: true });
	}
}

/** Checks that something is a Sekai backup's manifest this Sekai can read. */
export function checkManifest(value: unknown): Manifest {
	const m = value as Partial<Manifest> | null;
	// "feesh-backup": made before the rename (Feesh → Sekai), restored the same way.
	if (
		!m ||
		typeof m !== "object" ||
		(m.format !== "sekai-backup" && (m.format as unknown) !== "feesh-backup") ||
		typeof m.tables !== "object" ||
		!m.tables
	) {
		throw badRequest("That isn't a Sekai backup.");
	}
	if (m.version !== 1) throw badRequest("This backup was made by a newer version of Sekai. Update Sekai first.");
	for (const [table, t] of Object.entries(m.tables)) {
		if (!/^[a-z_][a-z0-9_]*$/.test(table) || !Array.isArray(t?.columns))
			throw badRequest("This backup is damaged.");
	}
	return m as Manifest;
}

/** Reads a backup's manifest without unpacking the rest. */
export async function readManifest(file: string): Promise<Manifest> {
	let text: string;
	try {
		text = await run(["tar", "-xzOf", file, "manifest.json"]);
	} catch {
		throw badRequest("That isn't a Sekai backup (it isn't a .tar.gz with a manifest).");
	}
	try {
		return checkManifest(JSON.parse(text));
	} catch (err) {
		if (err instanceof SyntaxError) throw badRequest("This backup is damaged.");
		throw err;
	}
}

/** Only plain files and folders come out of an archive: links could point anywhere on this server. */
async function dropLinks(dir: string): Promise<void> {
	for (const e of await readdir(dir, { withFileTypes: true })) {
		const full = join(dir, e.name);
		if (e.isDirectory()) await dropLinks(full);
		else if (!e.isFile()) await rm(full, { force: true });
	}
}

/** A table's rows, a batch at a time (each a JSON object's text, passed to Postgres as is). */
async function* rowBatches(path: string, maxRows = 500, maxChars = 8_000_000): AsyncGenerator<string[]> {
	if (!existsSync(path)) return;
	const decoder = new TextDecoder();
	let batch: string[] = [];
	let chars = 0;
	let rest = "";
	for await (const chunk of Bun.file(path).stream()) {
		const lines = (rest + decoder.decode(chunk, { stream: true })).split("\n");
		rest = lines.pop() ?? "";
		for (const line of lines) {
			if (!line.trim()) continue;
			batch.push(line);
			chars += line.length;
			if (batch.length >= maxRows || chars >= maxChars) {
				yield batch;
				batch = [];
				chars = 0;
			}
		}
	}
	rest += decoder.decode();
	if (rest.trim()) batch.push(rest);
	if (batch.length) yield batch;
}

async function restoreTables(work: string, manifest: Manifest): Promise<number> {
	const schema = await currentTables();
	const order = insertOrder([...schema.keys()], await foreignKeys());
	let total = 0;
	// All or nothing: if any row doesn't fit, the database stays as it was.
	await sql.begin(async (tx) => {
		await tx.unsafe(`truncate ${[...schema.keys()].map(ident).join(", ")} restart identity cascade`);
		// A backup from before accounts had roles: the built-in ones, and everyone in it is an admin.
		if (schema.has("roles") && !manifest.tables.roles?.rows) {
			const now = Date.now();
			await tx.unsafe(
				`insert into roles (id, name, description, builtin, permissions, limits, require_mfa, created_at, updated_at) values
				('role_admin', 'Admin', 'Everything: server settings, users and roles, every feature, no limits.', 'admin', '["admin"]', '{}', false, $1, $1),
				('role_member', 'Member', 'Their own bots and chats, with the features this role allows.', 'member', '["bots","web","browser","routines","library","voice","compare"]', '{}', false, $1, $1)`,
				[now],
			);
		}
		for (const table of order) {
			const saved = manifest.tables[table];
			if (!saved?.rows) continue;
			// Columns added since the backup get their defaults; ones since removed are left out.
			const current = new Set(schema.get(table));
			const kept = saved.columns.filter((c) => current.has(c));
			const cols = kept.map(ident);
			const values = [...cols];
			// From before things had owners: they're the first account's (built-in skills stay everyone's).
			if (current.has("user_id") && !kept.includes("user_id") && table !== "users") {
				cols.push("user_id");
				values.push(
					table === "skills"
						? "case when builtin then null else (select id from users order by created_at limit 1) end"
						: "(select id from users order by created_at limit 1)",
				);
			}
			if (table === "users" && current.has("role_id") && !kept.includes("role_id")) {
				cols.push("role_id");
				values.push("'role_admin'");
			}
			const insert = `insert into ${ident(table)} (${cols.join(", ")}) select ${values.join(", ")} from json_populate_recordset(null::${ident(table)}, $1::json)`;
			for await (const batch of rowBatches(join(work, "db", `${table}.jsonl`))) {
				await tx.unsafe(insert, [`[${batch.join(",")}]`]);
				total += batch.length;
			}
		}
	});
	return total;
}

async function restoreFiles(work: string, manifest: Manifest): Promise<void> {
	for (const p of manifest.files.paths) {
		if (!DATA_PATHS.includes(p)) continue;
		const from = join(work, "data", p);
		if (!existsSync(from)) continue;
		const to = join(config.dataDir, p);
		await mkdir(dirname(to), { recursive: true, mode: 0o700 });
		await rm(to, { recursive: true, force: true });
		await rename(from, to);
	}
	// Keys and passwords stay private; connections opened with the old keys aren't reused.
	if (existsSync(join(config.dataDir, "secret.key"))) await chmod(join(config.dataDir, "secret.key"), 0o600);
	if (existsSync(join(config.dataDir, "ssh"))) await chmod(join(config.dataDir, "ssh"), 0o700);
	await rm(join(config.dataDir, "ssh", "ctl"), { recursive: true, force: true });
}

/**
 * Replaces the database and the data folder's kept files with a backup's. Run it before anything else has started
 * (secrets, bots, channels…): Sekai does, at startup.
 */
export async function restoreBackup(file: string): Promise<{ manifest: Manifest; rows: number }> {
	const work = `${file}.restore`;
	await rm(work, { recursive: true, force: true });
	await mkdir(work, { recursive: true, mode: 0o700 });
	try {
		try {
			await run(["tar", "-xzf", file, "-C", work, "--no-same-owner"]);
		} catch (err) {
			throw badRequest(
				`This backup couldn't be unpacked, so nothing was changed (${errorMessage(err).slice(0, 200)}).`,
			);
		}
		const text = await Bun.file(join(work, "manifest.json"))
			.text()
			.catch(() => null);
		if (text === null) throw badRequest("That isn't a Sekai backup (it has no manifest).");
		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch {
			throw badRequest("This backup is damaged.");
		}
		const manifest = checkManifest(parsed);
		if (manifest.migrations > (await appliedMigrations())) {
			throw badRequest("This backup was made by a newer version of Sekai. Update Sekai first.");
		}
		await dropLinks(work);
		const rows = await restoreTables(work, manifest);
		log.info(`restored ${rows} rows`);
		await restoreFiles(work, manifest);
		return { manifest, rows };
	} finally {
		await rm(work, { recursive: true, force: true });
	}
}
