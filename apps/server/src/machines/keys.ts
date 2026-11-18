import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { config } from "../config.ts";
import { db, schema } from "../db/index.ts";
import { seal, unseal } from "../lib/secrets.ts";

export interface Keypair {
	publicKey: string;
	privateKey: string;
}

/** Linux account names that already mean something on a Debian system. */
const RESERVED = new Set([
	"root",
	"daemon",
	"bin",
	"sys",
	"sync",
	"games",
	"man",
	"lp",
	"mail",
	"news",
	"uucp",
	"proxy",
	"www-data",
	"backup",
	"list",
	"irc",
	"nobody",
	"admin",
	"sshd",
	"messagebus",
	"systemd",
	"lightdm",
	"debian",
	"user",
]);

/** The bot's account name on its machines: its name, made into a valid Linux username ("Smoke" → smoke). */
export function linuxUsername(agentName: string): string {
	let name = agentName
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9-]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.replace(/^[^a-z]+/, "")
		.slice(0, 30)
		.replace(/-+$/, "");
	if (!name) name = "bot";
	return RESERVED.has(name) ? `${name}-bot` : name;
}

/** Host names allow letters, digits and hyphens. */
export function hostnameFor(agentName: string, suffix?: string): string {
	const base = linuxUsername(agentName);
	return `${base}${suffix ? `-${suffix}` : ""}`.slice(0, 60).replace(/-+$/, "");
}

export async function generate(comment: string): Promise<Keypair> {
	const dir = join(tmpdir(), `sekai-key-${crypto.randomUUID()}`);
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	const file = join(dir, "id");
	try {
		const proc = Bun.spawn(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-C", comment, "-f", file], {
			stdout: "ignore",
			stderr: "pipe",
		});
		if ((await proc.exited) !== 0) {
			throw new Error(`ssh-keygen failed: ${await new Response(proc.stderr).text()}`);
		}
		return {
			publicKey: readFileSync(`${file}.pub`, "utf8").trim(),
			privateKey: readFileSync(file, "utf8"),
		};
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

/** The bot's SSH keypair, created the first time it's needed and the same for all its machines. */
export async function agentKeypair(agentId: string, agentName: string): Promise<Keypair> {
	const row = await db.query.agentKeys.findFirst({ where: eq(schema.agentKeys.agentId, agentId) });
	if (row) return { publicKey: row.publicKey, privateKey: unseal(row.privateKey) };
	const pair = await generate(`sekai-${linuxUsername(agentName)}`);
	await db
		.insert(schema.agentKeys)
		.values({ agentId, publicKey: pair.publicKey, privateKey: seal(pair.privateKey), createdAt: Date.now() })
		.onConflictDoNothing();
	// Another request may have won the race; use whatever was stored.
	const stored = await db.query.agentKeys.findFirst({ where: eq(schema.agentKeys.agentId, agentId) });
	return stored ? { publicKey: stored.publicKey, privateKey: unseal(stored.privateKey) } : pair;
}

/** Writes the bot's private key where ssh can read it (only you can), and returns the path. */
export async function agentKeyFile(agentId: string, agentName: string): Promise<string> {
	const dir = join(config.dataDir, "ssh", "keys");
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	const file = join(dir, agentId);
	const { privateKey } = await agentKeypair(agentId, agentName);
	writeFileSync(file, privateKey.endsWith("\n") ? privateKey : `${privateKey}\n`, { mode: 0o600 });
	return file;
}
