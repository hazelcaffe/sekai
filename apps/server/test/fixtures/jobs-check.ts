import assert from "node:assert/strict";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { decideApproval, listPendingApprovals } from "../../src/agent/approvals.ts";
import { cancelAllRuns, sendUserMessage } from "../../src/agent/runtime.ts";
import { createApp } from "../../src/app.ts";
import { actorFor, runAs, runAsUser } from "../../src/auth/actor.ts";
import { ensureSetupCode, setup, setupCodeForTests } from "../../src/auth/service.ts";
import { config } from "../../src/config.ts";
import { closeDb, db, initDb, schema } from "../../src/db/index.ts";
import { bus } from "../../src/events/bus.ts";
import { getJob, listJobs, restoreJobs, sendJob, shutdownJobs, startJob, stopJob } from "../../src/jobs/index.ts";
import { initProviders, shutdownProviders } from "../../src/providers/index.ts";
import { createProvider } from "../../src/providers/store.ts";
import { createAgent } from "../../src/services/agents.ts";
import { getDirectConversation } from "../../src/services/conversations.ts";
import { createMessage, listMessages } from "../../src/services/messages.ts";

async function until<T>(read: () => Promise<T | undefined | false>) {
	for (let i = 0; i < 220; i++) {
		const v = await read();
		if (v) return v;
		await Bun.sleep(40);
	}
	throw new Error("Timed out waiting for the job.");
}
if (!new URL(config.databaseUrl).pathname.startsWith("/sekai_jobs_test_"))
	throw new Error("Scratch database required.");
await initDb();
await initProviders();
const app = createApp();
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (req, srv) => app.fetch(req, srv) });
config.port = server.port ?? 0;
try {
	await ensureSetupCode("http://localhost");
	const owner = await setup({
		name: "A",
		username: "jobtest",
		password: crypto.randomUUID(),
		code: setupCodeForTests() ?? "",
	});
	await runAsUser(owner.id, async () => {
		const provider = {
			preset: "custom" as const,
			command: process.execPath,
			args: [join(import.meta.dir, "mock-acp-agent.ts")],
		};
		const manager = await createProvider({ ...provider, title: "Manager", env: { MOCK_JOB_MANAGER: "1" } });
		const worker = await createProvider({
			...provider,
			title: "Worker",
			env: { SEKAI_JOB_CLIENT_ONLY: "1", MOCK_ACP_LOAD: "1" },
		});
		const bot = await createAgent({
			name: "Test bot",
			models: { primary: { model: manager.id } },
			capabilities: { approvalMode: "yolo", autoLearn: false, tools: { write_file: "ask" } },
		});
		const chat = await getDirectConversation(bot.id);
		let sawDone = false;
		const off = bus.subscribe((ev, to) => {
			if (ev.type === "job.changed") {
				assert.deepEqual(to, [owner.id]);
				if (ev.job.status === "done") sawDone = true;
			}
		});
		await sendUserMessage(chat.id, { text: "Launch the job" });
		const approval = await until(async () => listPendingApprovals().find((a) => a.toolName === "write_file"));
		const job = await until(async () => (await listJobs())[0]);
		const stranger = { ...(await actorFor(owner.id)), userId: "unrelated" };
		await runAs(stranger, async () => {
			assert.equal((await listJobs()).length, 0);
			await assert.rejects(getJob(job.id));
			assert.equal(await decideApproval(approval.toolCallId, { approve: true, scope: "once" }), false);
		});
		assert(await decideApproval(approval.toolCallId, { approve: true, scope: "once" }));
		await until(async () => (await getJob(job.id)).status === "done");
		const detail = await getJob(job.id);
		assert(detail.steps.some((s) => s.text.includes("job-answer: spring")));
		assert(detail.steps.some((s) => s.detail?.includes("+Spring rain")));
		assert(sawDone);
		assert.equal(detail.usage?.outputTokens, 5);
		const messages = await listMessages(chat.id);
		assert(messages.some((m) => m.meta.jobId === job.id));
		assert(messages.some((m) => m.parts.some((p) => p.type === "text" && p.text.includes("asks: Which season"))));
		await until(
			async () =>
				(await db.select().from(schema.usageLog).where(eq(schema.usageLog.model, worker.id))).length > 0,
		);
		const message = await createMessage({
			conversationId: chat.id,
			sender: "user",
			parts: [{ type: "text", text: "Testing lifecycle" }],
		});
		const ctx = {
			agent: bot,
			conversation: chat,
			messageId: message.id,
			runId: "test",
			approvalMode: "yolo" as const,
			trigger: "user" as const,
			depth: 0,
			askChain: [],
			timezone: "UTC",
			signal: new AbortController().signal,
		};
		const start = (task: string, subscription = "Worker") =>
			startJob({ title: "Test job", task, subscription }, ctx);
		const limitActor = await actorFor(owner.id);
		await runAs({ ...limitActor, limits: { ...limitActor.limits, maxJobs: 0 } }, () =>
			assert.rejects(start("over limit"), /active job limit/),
		);
		const slow = await start("slow");
		const second = await start("slow");
		await assert.rejects(start("third"), /two active/);
		await stopJob(second.id);
		assert.equal((await getJob(second.id)).status, "stopped");
		await until(async () =>
			Boolean((await db.query.jobs.findFirst({ where: eq(schema.jobs.id, slow.id) }))?.sessionId),
		);
		await shutdownJobs();
		await restoreJobs();
		await until(async () => (await getJob(slow.id)).status === "question");
		await sendJob(slow.id, "resume after restart");
		await until(async () => (await getJob(slow.id)).status === "done");
		const fail = await start("job-fail");
		await until(async () => (await getJob(fail.id)).status === "failed");
		await createProvider({ ...provider, title: "No resume", env: { SEKAI_JOB_CLIENT_ONLY: "1" } });
		const no = await start("slow", "No resume");
		await shutdownJobs();
		await restoreJobs();
		await until(async () => (await getJob(no.id)).status === "stopped");
		assert.equal((await getJob(no.id)).lastStep, "Stopped when Sekai restarted");
		off();
	});
	process.stdout.write("Jobs verified\n");
} finally {
	cancelAllRuns();
	await shutdownJobs();
	await shutdownProviders();
	await server.stop(true);
	await closeDb();
}
process.exit(0);
