import { expect, test } from "bun:test";
import { join } from "node:path";

// Opt in with a disposable database, separate from the existing access/auth test databases and live Sekai.
test.skipIf(!process.env.SEKAI_SLACK_TEST_DATABASE_URL)(
	"Slack threads, group delivery and approvals run through the owner-scoped manager",
	async () => {
		const child = Bun.spawn(["bun", join(import.meta.dir, "fixtures", "slack-check.ts")], {
			stdout: "pipe",
			stderr: "pipe",
			env: {
				...process.env,
				DATABASE_URL: process.env.SEKAI_SLACK_TEST_DATABASE_URL,
				SEKAI_DATA_DIR: "/tmp/opencode/slack-routing-data",
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
		});
	},
	30_000,
);
