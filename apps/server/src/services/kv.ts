import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.ts";

/** Settings rows that aren't part of the main Settings object (voice, Tailscale, push…), as JSON by key. */
export async function readKey(key: string): Promise<unknown> {
	const [row] = await db.select().from(schema.settings).where(eq(schema.settings.key, key));
	return row?.value;
}

export async function writeKey(key: string, value: unknown): Promise<void> {
	await db
		.insert(schema.settings)
		.values({ key, value })
		.onConflictDoUpdate({ target: schema.settings.key, set: { value } });
}

export async function deleteKey(key: string): Promise<void> {
	await db.delete(schema.settings).where(eq(schema.settings.key, key));
}
