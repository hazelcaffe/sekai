import { expect, test } from "bun:test";
import { join } from "node:path";
import postgres from "postgres";

// Slack threads, group delivery and approvals through the real channel manager (with a fake Slack), against a
// scratch database when Postgres is up; skipped otherwise. Run as its own process so DATABASE_URL applies first.
const MAIN_DB = process.env.DATABASE_URL ?? "postgres://sekai:sekai@127.0.0.1:5433/sekai";
const TEST_DB = MAIN_DB.replace(/\/[^/?]+(\?.*)?$/, "/sekai_slack_test$1");

async function prepareDb(): Promise<boolean> {
	const sql = postgres(MAIN_DB, { max: 1, connect_timeout: 3, onnotice: () => {} });
	try {
		const [row] = await sql`select 1 from pg_database where datname = 'sekai_slack_test'`;
		if (!row) await sql.unsafe("create database sekai_slack_test");
		return true;
	} catch {
		return false;
	} finally {
		await sql.end({ timeout: 2 });
	}
}

const dbReady = await prepareDb();

test.skipIf(!dbReady)(
	"Slack threads, group delivery and approvals run through the owner-scoped manager (needs Postgres)",
	async () => {
		const child = Bun.spawn(["bun", join(import.meta.dir, "fixtures", "slack-check.ts")], {
			stdout: "pipe",
			stderr: "pipe",
			env: {
				...process.env,
				DATABASE_URL: TEST_DB,
				SEKAI_DATA_DIR: join(import.meta.dir, ".slack-data"),
				SEKAI_LOG_LEVEL: "error",
				GATEWAY_URL: "http://127.0.0.1:9/v1",
			},
		});
		const output = await new Response(child.stdout).text();
		const line = output.split("\n").find((x) => x.startsWith("REPORT "));
		if (!line) throw new Error(`No Slack routing report: ${output}\n${await new Response(child.stderr).text()}`);
		expect(JSON.parse(line.slice(7))).toEqual({
			linked: true,
			oneThread: true,
			freshHistory: true,
			deduplicated: true,
			identities: [
				{ bot: "Miku", thread: "slack:T1:C1:100.000001", owner: true },
				{ bot: "Kanade", thread: "slack:T1:C1:100.000001", owner: true },
			],
			noStrangerDownloads: true,
			guestRefused: true,
			ownerApproved: true,
			ownerOnlyModel: true,
			threadBindings: 2,
			dmThreads: true,
			dmOneChat: true,
			dmKeepsItsChat: true,
		});
	},
	30_000,
);
