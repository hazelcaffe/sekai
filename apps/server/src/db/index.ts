import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { config } from "../config.ts";
import { log } from "../lib/log.ts";
import * as schema from "./schema.ts";

const client = postgres(config.databaseUrl, {
	max: 10,
	onnotice: () => {},
});

export const db = drizzle(client, { schema, casing: "snake_case" });
export type Db = typeof db;
export { schema };

/** Waits for Postgres (it may still be starting in Docker), then applies pending migrations. */
export async function initDb(timeoutMs = 60_000): Promise<void> {
	const started = Date.now();
	let attempt = 0;
	for (;;) {
		try {
			await client`select 1`;
			break;
		} catch (err) {
			attempt++;
			if (Date.now() - started > timeoutMs) {
				throw new Error(`Postgres is unreachable at ${redactUrl(config.databaseUrl)}: ${String(err)}`);
			}
			if (attempt === 1) log.warn(`waiting for Postgres at ${redactUrl(config.databaseUrl)}…`);
			await Bun.sleep(Math.min(500 * attempt, 3000));
		}
	}
	await migrate(db, { migrationsFolder: config.migrationsDir });
	log.info("database ready");
}

export async function closeDb(): Promise<void> {
	await client.end({ timeout: 5 });
}

function redactUrl(url: string): string {
	return url.replace(/\/\/([^:@/]+):[^@/]+@/, "//$1:***@");
}
