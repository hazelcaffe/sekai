import { z } from "zod";
import type { Usage } from "./message.ts";
import type { Provider } from "./provider.ts";

/** Only adapters whose actions can be confined to a job folder are offered as workers. */
export function jobWorkspace(p: Pick<Provider, "kind" | "preset" | "env">): "computer" | "server" | null {
	if (p.preset === "codex") return "server";
	return p.kind === "claude-sdk" ||
		p.preset === "opencode" ||
		(p.preset === "custom" && p.env.SEKAI_JOB_CLIENT_ONLY === "1")
		? "computer"
		: null;
}

export const JobStart = z.object({
	task: z.string().trim().min(1).max(16000),
	title: z.string().trim().min(1).max(100),
	subscription: z
		.string()
		.trim()
		.max(100)
		.optional()
		.describe("Subscription name or ID. Defaults to the bot's subscription."),
	machine: z
		.string()
		.trim()
		.max(100)
		.optional()
		.describe("server (default), or the name or ID of the bot's computer or devbox"),
	folder: z
		.string()
		.trim()
		.min(1)
		.max(300)
		.optional()
		.describe(
			"On a computer or devbox: a project folder relative to the bot's home. Defaults to a fresh job folder.",
		),
});
export type JobStart = z.infer<typeof JobStart>;
export const JobMessage = z.object({ message: z.string().trim().min(1).max(16000) });

export type JobStatus = "working" | "question" | "approval" | "done" | "stopped" | "failed";
export const activeJob = (status: JobStatus) => status === "working" || status === "question" || status === "approval";
export interface JobStep {
	id: string;
	kind: "message" | "input" | "plan" | "tool" | "notice";
	text: string;
	detail?: string;
	at: number;
}
export interface Job {
	id: string;
	agentId: string;
	conversationId: string;
	providerTitle: string;
	title: string;
	location: string;
	folder: string;
	status: JobStatus;
	lastStep: string;
	createdAt: number;
	updatedAt: number;
	usage: Usage | null;
}
export interface JobDetail extends Job {
	steps: JobStep[];
}
