import { afterAll, expect, test } from "bun:test";
import { join } from "node:path";
import postgres from "postgres";

// Signal through the real channel manager (with a fake signal-cli and a fake model gateway), against a scratch
// database when Postgres is up; skipped otherwise. Run as its own process so DATABASE_URL applies first.
const MAIN_DB = process.env.DATABASE_URL ?? "postgres://sekai:sekai@127.0.0.1:5433/sekai";
const TEST_DB = MAIN_DB.replace(/\/[^/?]+(\?.*)?$/, "/sekai_signal_test$1");

async function prepareDb(): Promise<boolean> {
	const sql = postgres(MAIN_DB, { max: 1, connect_timeout: 3, onnotice: () => {} });
	try {
		const [row] = await sql`select 1 from pg_database where datname = 'sekai_signal_test'`;
		if (!row) await sql.unsafe("create database sekai_signal_test");
		return true;
	} catch {
		return false;
	} finally {
		await sql.end({ timeout: 2 });
	}
}

const dbReady = await prepareDb();

/** A model gateway that always answers the same, streamed like OpenAI's Chat Completions. */
const gateway = Bun.serve({
	port: 0,
	hostname: "127.0.0.1",
	async fetch(req) {
		const url = new URL(req.url);
		if (url.pathname.endsWith("/models"))
			return Response.json({ data: [{ id: "claude-sonnet-5-5", owned_by: "anthropic" }] });
		if (url.pathname.endsWith("/chat/completions")) {
			const chunk = (x: unknown) => `data: ${JSON.stringify(x)}\n\n`;
			const body = [
				chunk({ choices: [{ index: 0, delta: { role: "assistant", content: "Hi Hazel! **Nice** to " } }] }),
				chunk({ choices: [{ index: 0, delta: { content: "meet you." } }] }),
				chunk({
					choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
					usage: { prompt_tokens: 10, completion_tokens: 6, total_tokens: 16 },
				}),
				"data: [DONE]\n\n",
			].join("");
			return new Response(body, { headers: { "content-type": "text/event-stream" } });
		}
		return Response.json({ error: { message: "not here" } }, { status: 404 });
	},
});
afterAll(() => gateway.stop(true));

test.skipIf(!dbReady)(
	"Signal DMs, pairing, approvals by text and reaction, and groups run through the manager (needs Postgres)",
	async () => {
		const child = Bun.spawn(["bun", join(import.meta.dir, "fixtures", "signal-check.ts")], {
			stdout: "pipe",
			stderr: "pipe",
			env: {
				...process.env,
				DATABASE_URL: TEST_DB,
				SEKAI_DATA_DIR: join(import.meta.dir, ".signal-data"),
				SEKAI_LOG_LEVEL: "error",
				GATEWAY_URL: `http://127.0.0.1:${gateway.port}/v1`,
			},
		});
		const output = await new Response(child.stdout).text();
		const line = output.split("\n").find((x) => x.startsWith("REPORT "));
		if (!line) throw new Error(`No Signal routing report: ${output}\n${await new Response(child.stderr).text()}`);
		expect(JSON.parse(line.slice(7))).toEqual({
			connected: true,
			strangerGetsCode: true,
			strangerNoChat: true,
			pairedByAccountId: true,
			sameNameIsStranger: true,
			reply: { message: "Hi Hazel! Nice to meet you.", textStyle: ["10:4:BOLD"] },
			typed: true,
			chat: "Signal: DM with Hazel",
			inbound: true,
			promptHidesSecrets: true,
			promptSaysHow: true,
			approvedByText: true,
			requestMarked: true,
			approvedByReaction: true,
			joinedOwnersGroup: true,
			leftStrangersGroup: true,
			groupReplyQuotes: true,
			groupChat: true,
		});
	},
	60_000,
);
