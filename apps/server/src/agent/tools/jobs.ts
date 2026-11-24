import { JobMessage, JobStart } from "@sekai/shared";
import { z } from "zod";
import { getJob, listJobs, sendJob, startJob, stopJob } from "../../jobs/index.ts";
import { defineTool } from "./types.ts";

const job = z.object({ id: z.string().min(1).max(100) });
export const jobTools = [
	defineTool({
		name: "job_start",
		category: "jobs",
		risk: "external",
		description:
			"Delegate a coding task to a subscription worker. It reports back in this chat; do not poll. Use a server folder, or this bot's computer or devbox. Claude Code and OpenCode support scoped workspaces.",
		parameters: JobStart,
		title: (a) => `Started job: ${a.title}`,
		execute: startJob,
	}),
	defineTool({
		name: "job_send",
		category: "jobs",
		risk: "external",
		description: "Send instructions or answer a worker's question. This never grants approval for a tool.",
		parameters: job.extend(JobMessage.shape),
		title: () => "Messaged the job",
		async execute(a, ctx) {
			await sendJob(a.id, a.message, ctx);
			return "Message delivered to the job queue.";
		},
	}),
	defineTool({
		name: "job_status",
		category: "jobs",
		risk: "read",
		description: "Check a coding job and its few most recent steps.",
		parameters: job,
		title: () => "Checked the job",
		async execute(a, ctx) {
			const { steps, ...j } = await getJob(a.id, ctx);
			return { ...j, recent: steps.slice(-5).map((s) => s.text.slice(0, 240)) };
		},
	}),
	defineTool({
		name: "job_list",
		category: "jobs",
		risk: "read",
		description: "List your recent jobs in this chat.",
		parameters: z.object({}),
		title: () => "Listed coding jobs",
		async execute(_, ctx) {
			return (await listJobs(ctx.agent.id, ctx.conversation.id))
				.slice(0, 15)
				.map(({ id, title, status, lastStep }) => ({ id, title, status, lastStep }));
		},
	}),
	defineTool({
		name: "job_stop",
		category: "jobs",
		risk: "write",
		description: "Stop one of your coding jobs. Its files and transcript remain.",
		parameters: job,
		title: () => "Stopped the job",
		async execute(a, ctx) {
			await stopJob(a.id, ctx);
			return "Stopped.";
		},
	}),
];
