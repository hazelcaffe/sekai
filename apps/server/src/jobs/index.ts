import { join } from "node:path";
import {
	byosModelId,
	type Job,
	type JobDetail,
	type JobStart,
	type JobStatus,
	type JobStep,
	jobWorkspace,
	parseByosModel,
} from "@sekai/shared";
import { and, desc, eq, getTableColumns, inArray, sql } from "drizzle-orm";
import { authorizeToolCall } from "../agent/loop.ts";
import { fastModelFor } from "../agent/models.ts";
import { gateFor, matchRule, resolveApprovalMode, ruleSets } from "../agent/permissions.ts";
import type { ToolContext } from "../agent/tools/types.ts";
import { currentActor, requireActorId, requirePermission, runAsUser } from "../auth/actor.ts";
import { db, schema } from "../db/index.ts";
import { bus } from "../events/bus.ts";
import { badRequest, errorMessage, notFound } from "../lib/errors.ts";
import { newId } from "../lib/ids.ts";
import { log } from "../lib/log.ts";
import { addUsage, EMPTY_USAGE } from "../llm/types.ts";
import { machinesForBot } from "../machines/seats.ts";
import { interrupted, openWorker, supportsJobs, type Worker } from "../providers/job-worker.ts";
import { workspaceDir } from "../providers/process.ts";
import { listProviders, requireProvider } from "../providers/store.ts";
import { requireOwnedAgent } from "../services/agents.ts";
import { requireConversation } from "../services/conversations.ts";
import { checkUsageLimits, requireModelAllowed } from "../services/limits.ts";
import { createMessage, getMessage } from "../services/messages.ts";
import { getSettings } from "../services/settings.ts";
import { recordUsage } from "../services/usage.ts";
import { projectFolder, type WorkspaceTool, workspaceCall } from "./workspace.ts";

const table = schema.jobs;
type Row = typeof table.$inferSelect;
const liveStatuses: JobStatus[] = ["working", "approval", "question"];
const MAX_MS = 2 * 60 * 60_000;
const running = new Map<string, JobRun>();
const summary = ({
	id,
	agentId,
	conversationId,
	providerTitle,
	title,
	location,
	folder,
	status,
	lastStep,
	createdAt,
	updatedAt,
	usage,
}: Job): Job => ({
	id,
	agentId,
	conversationId,
	providerTitle,
	title,
	location,
	folder,
	status,
	lastStep,
	createdAt,
	updatedAt,
	usage,
});
const { steps: _steps, ...listColumns } = getTableColumns(table);

export async function listJobs(agentId?: string, conversationId?: string): Promise<Job[]> {
	const rows = await db
		.select(listColumns)
		.from(table)
		.where(
			and(
				eq(table.userId, requireActorId()),
				agentId ? eq(table.agentId, agentId) : undefined,
				conversationId ? eq(table.conversationId, conversationId) : undefined,
			),
		)
		.orderBy(
			sql`case when ${table.status} in ('working','approval','question') then 0 else 1 end`,
			desc(table.updatedAt),
		)
		.limit(100);
	return rows.map(summary);
}
export async function getJob(id: string, ctx?: ToolContext): Promise<JobDetail> {
	const row = await db.query.jobs.findFirst({
		where: and(
			eq(table.userId, requireActorId()),
			eq(table.id, id),
			ctx ? and(eq(table.agentId, ctx.agent.id), eq(table.conversationId, ctx.conversation.id)) : undefined,
		),
	});
	if (!row) throw notFound("Job");
	return { ...summary(row), steps: row.steps };
}
async function context(row: Row) {
	const [agent, conversation, settings] = await Promise.all([
		requireOwnedAgent(row.agentId),
		requireConversation(row.conversationId),
		getSettings(),
	]);
	if (agent.status !== "active" || (conversation.agentId !== agent.id && !conversation.memberIds.includes(agent.id)))
		throw badRequest("The bot is paused or no longer in this chat.");
	requireModelAllowed(byosModelId(row.providerId, row.model));
	if (!requireProvider(row.providerId).enabled) throw badRequest("The subscription was turned off.");
	return {
		agent,
		conversation,
		settings,
		rules: ruleSets(agent, conversation, settings),
		mode: resolveApprovalMode(settings, agent, conversation),
	};
}

async function relay(row: Row, what: string, notify = true) {
	const text = `${row.providerTitle} · ${row.title}: ${what.slice(0, 700)}`;
	const origin = await getMessage(row.messageId);
	const event = await createMessage({
		conversationId: row.conversationId,
		sender: "system",
		parts: [{ type: "text", text }],
		meta: { trigger: "job", channel: origin?.meta.channel },
	});
	if (notify)
		bus.emit(
			{
				type: "notification",
				title: row.title,
				body: what.slice(0, 200),
				agentId: row.agentId,
				conversationId: row.conversationId,
				url: `/jobs/${row.id}`,
			},
			{ to: [row.userId] },
		);
	const { enqueueRun } = await import("../agent/runtime.ts");
	await enqueueRun({
		conversationId: row.conversationId,
		agentId: row.agentId,
		trigger: "job",
		sourceMessageId: event.id,
		jobEvent: `Job ${row.id}: ${text}`,
	});
}

/** Only this object writes an active job. Coalesce token updates and serialize snapshots so Stop wins over late output. */
class JobRun {
	readonly abort = new AbortController();
	private worker: Worker | null = null;
	private timer: ReturnType<typeof setTimeout>;
	private saving: Promise<void> = Promise.resolve();
	private dirty: ReturnType<typeof setTimeout> | null = null;
	private pending: string[] = [];
	private turn = newId("turn");
	private busy = false;
	private acceptingCalls = false;
	private waiting = 0;
	private speaking = "";
	private response = "";
	private readonly changedParts = new Set<string>();
	private reachedLimit = false;
	constructor(readonly row: Row) {
		running.set(row.id, this);
		this.timer = setTimeout(
			() => void this.end("stopped", "Reached the two-hour time limit."),
			Math.max(0, row.createdAt + MAX_MS - Date.now()),
		);
	}
	private changed() {
		this.row.updatedAt = Date.now();
		if (!this.dirty)
			this.dirty = setTimeout(
				() => void this.flush().catch((err) => log.warn(`Job save failed: ${errorMessage(err)}`)),
				250,
			);
	}
	private flush() {
		if (this.dirty) clearTimeout(this.dirty);
		this.dirty = null;
		const { status, lastStep, sessionId, updatedAt, usage } = this.row;
		const steps = structuredClone(this.row.steps);
		const changedSteps = steps.filter((s) => this.changedParts.has(s.id));
		this.changedParts.clear();
		const job = summary(this.row);
		this.saving = this.saving
			.catch(() => {})
			.then(async () => {
				await db
					.update(table)
					.set({ status, lastStep, sessionId, updatedAt, usage, steps })
					.where(eq(table.id, job.id));
				bus.emit({ type: "job.changed", job, steps: changedSteps }, { to: [this.row.userId] });
			});
		return this.saving;
	}
	step = (kind: JobStep["kind"], text: string, detail?: string, key?: string) => {
		if (this.abort.signal.aborted) return;
		const id = key ? `${this.turn}:${key}` : newId("step");
		let part = this.row.steps.find((s) => s.id === id);
		if (!part) {
			if (this.row.steps.length >= 512 && !this.reachedLimit) {
				this.reachedLimit = true;
				void this.end("stopped", "Reached the 512-step transcript limit. The transcript and files are saved.");
				return;
			}
			part = { id, kind, text: "", at: Date.now() };
			this.row.steps.push(part);
		}
		if (text) part.text = text.slice(-16_384);
		if (detail) part.detail = detail.slice(0, 16_384);
		if (kind !== "message") this.speaking = "";
		this.changedParts.add(id);
		this.row.lastStep = part.text.slice(0, 240);
		this.changed();
	};
	private chunk = (delta: string) => {
		if (!this.speaking) this.speaking = newId("reply");
		const last = this.row.steps.at(-1);
		this.response = (this.response + delta).slice(-16_384);
		this.step(
			"message",
			(last?.id === `${this.turn}:${this.speaking}` ? last.text : "") + delta,
			undefined,
			this.speaking,
		);
	};
	async open(restoring: boolean) {
		try {
			if (restoring && !this.row.sessionId) throw new Error(interrupted);
			await context(this.row);
			await workspaceCall(this.row, "init", {}, this.abort.signal);
			const worker = await openWorker(
				requireProvider(this.row.providerId),
				this.row.id,
				this.row.model,
				this.row.sessionId,
				{
					signal: this.abort.signal,
					step: this.step,
					chunk: this.chunk,
					onSession: async (id) => {
						this.row.sessionId = id;
						await this.flush();
					},
					call: (name, args, signal) => runAsUser(this.row.userId, () => this.call(name, args, signal)),
				},
			);
			if (this.abort.signal.aborted) {
				worker.close();
				return;
			}
			this.worker = worker;
			if (restoring) {
				if (this.row.status !== "question") {
					this.row.status = "question";
					this.step(
						"notice",
						"Session reopened after restart. Check the last step, then send a message to continue.",
					);
					await this.flush();
					await relay(this.row, this.row.lastStep);
				}
			} else await this.drive();
		} catch (err) {
			await this.end(restoring ? "stopped" : "failed", restoring ? interrupted : errorMessage(err));
		}
	}
	async send(text: string) {
		if (this.abort.signal.aborted || this.pending.length >= 8)
			throw badRequest("This job has stopped or its message queue is full.");
		this.pending.push(text);
		this.step("input", text);
		this.row.status = this.waiting ? "approval" : "working";
		await this.flush();
		void this.drive();
	}
	private async drive() {
		if (!this.worker || this.busy || this.abort.signal.aborted) return;
		this.busy = true;
		try {
			while (this.pending.length) {
				await context(this.row);
				await checkUsageLimits();
				this.abort.signal.throwIfAborted();
				const text = this.pending.shift();
				if (!text) break;
				this.turn = newId("turn");
				this.response = "";
				this.speaking = "";
				this.acceptingCalls = true;
				const usage = await this.worker.prompt(text);
				this.acceptingCalls = false;
				this.abort.signal.throwIfAborted();
				if (usage) {
					this.row.usage = addUsage(this.row.usage ?? EMPTY_USAGE, usage);
					recordUsage({
						agentId: this.row.agentId,
						model: byosModelId(this.row.providerId, this.row.model),
						userId: this.row.userId,
						purpose: "background",
						usage,
					});
				}
				if (this.pending.length) continue;
				const answer = this.response.trim();
				const question =
					answer.match(/(?:^|\n)Question:\s*(.+)$/is)?.[1] ?? (answer.endsWith("?") ? answer : null);
				if (question) {
					this.row.status = "question";
					this.row.lastStep = question.slice(0, 240);
					await this.flush();
					await relay(this.row, `asks: ${question}`);
				} else {
					await this.end("done", answer || "Finished the task.");
					break;
				}
			}
		} catch (err) {
			await this.end("failed", errorMessage(err));
		} finally {
			this.acceptingCalls = false;
			this.busy = false;
		}
	}
	private async call(name: WorkspaceTool, args: Record<string, unknown>, other?: AbortSignal) {
		const signal = other ? AbortSignal.any([this.abort.signal, other]) : this.abort.signal;
		signal.throwIfAborted();
		if (!this.acceptingCalls) throw badRequest("No active job turn.");
		const { agent, conversation, settings, mode, rules } = await context(this.row);
		if (this.row.machineId) requirePermission("computers");
		const toolName = name === "terminal" ? "run_command" : name;
		const kind = name === "terminal" ? "execute" : name === "read_file" ? "read" : "edit";
		const risk = name === "terminal" ? "external" : name === "read_file" ? "read" : "write";
		const title =
			name === "terminal"
				? `Run ${String(args.command).slice(0, 100)}`
				: `${name === "read_file" ? "Read" : "Write"} ${String(args.path).slice(0, 100)}`;
		const callId = newId("jobcall", 20);
		this.step("tool", title, undefined, callId);
		const env = {
			ctx: {
				agent,
				conversation,
				runId: this.row.id,
				messageId: this.row.messageId,
				trigger: "job" as const,
				depth: 0,
				askChain: [],
				timezone: settings.timezone,
				approvalMode: mode,
				signal,
			},
			toolset: { rules },
			request: this.row.steps.filter((s) => s.kind === "input").at(-1)?.text ?? this.row.title,
			userName: settings.userName,
			reviewModel: await fastModelFor(agent, settings),
			approvalTimeoutMs: settings.approvalTimeoutMinutes * 60000,
			priorActions: this.row.steps
				.filter((s) => s.kind === "tool")
				.slice(-8)
				.map((s) => s.text),
			writer: { updateTool: () => {} },
			onStatus: (status: string) => {
				if (signal.aborted) return;
				this.waiting = Math.max(0, this.waiting + (status === "awaiting_approval" ? 1 : -1));
				this.row.status = this.waiting ? "approval" : "working";
				this.changed();
				if (status === "awaiting_approval")
					void relay(this.row, `needs your approval in Needs you: ${title}`, false).catch((err) =>
						log.warn(errorMessage(err)),
					);
			},
		};
		try {
			const external = {
				name: `external_${kind}`,
				category: "external",
				risk,
				title,
				description: `${this.row.providerTitle}: ${title}`,
			} as const;
			const tool = { ...external, name: toolName, category: "machines" };
			// An allow on the subscription side must never override a bot's blocked file or command tool.
			const guards = matchRule(rules, external.name, external.category) ? [tool, external] : [tool];
			if (guards.some((g) => gateFor(g, mode, rules).action === "deny"))
				throw badRequest("Blocked by the bot’s tool rules.");
			for (const guard of guards) {
				const decision = await authorizeToolCall(env, callId, guard, args);
				if (!decision.allowed) throw badRequest(decision.content);
			}
			signal.throwIfAborted();
			const out = await workspaceCall(this.row, name, args, signal);
			this.step("tool", title, out || "Done", callId);
			// The owner sees the diff. A write-only worker must not receive the file's previous contents.
			return name === "write_file" ? `Wrote ${args.path}.` : out;
		} catch (err) {
			this.step("tool", title, errorMessage(err), callId);
			throw err;
		}
	}
	async end(status: JobStatus, text: string) {
		if (this.abort.signal.aborted) return this.saving;
		if (status !== "done" || !this.response.trim()) this.step("notice", text);
		this.row.status = status;
		this.row.lastStep = text.slice(0, 240);
		await this.detach();
		await runAsUser(this.row.userId, () =>
			relay(this.row, `${status === "done" ? "finished" : status}: ${text}`),
		).catch((err) => log.warn(`Job relay: ${errorMessage(err)}`));
	}
	async detach() {
		this.abort.abort();
		clearTimeout(this.timer);
		this.worker?.close();
		running.delete(this.row.id);
		await this.flush();
	}
}

export async function startJob(input: JobStart, ctx: ToolContext): Promise<Job> {
	const userId = requireActorId();
	requirePermission("subscriptions");
	if (ctx.agent.userId !== userId || ctx.conversation.userId !== userId) throw notFound("Bot");
	const def = parseByosModel(ctx.agent.models.primary.model);
	const choices = listProviders().filter((p) => p.enabled && supportsJobs(p));
	const ref = input.subscription?.toLowerCase();
	const matches = ref
		? choices.filter((p) =>
				[p.title.toLowerCase(), p.id, p.preset, p.kind === "claude-sdk" ? "claude code" : p.preset].includes(
					ref,
				),
			)
		: choices.filter((p) => p.id === def?.providerId);
	const p = matches.length === 1 ? matches[0] : !ref && !def && choices.length === 1 ? choices[0] : null;
	if (!p)
		throw badRequest(
			`Choose a folder-scoped subscription by name or ID: ${choices.map((p) => `${p.title} (${p.id})`).join(", ") || "set up Claude Code or OpenCode in Settings → Subscriptions"}.`,
		);
	const model = def?.providerId === p.id ? def.model : null;
	requireModelAllowed(byosModelId(p.id, model));
	await checkUsageLimits();
	const id = newId("job");
	let folder = join(workspaceDir(ctx.agent.id), "jobs", id);
	let machineId: string | null = null;
	let location = "Server folder";
	if (input.machine && input.machine !== "server") {
		if (jobWorkspace(p) === "server")
			throw badRequest(
				`${p.title} doesn't run tools on the bot's computer. Use machine: server for a separate server folder.`,
			);
		requirePermission("computers");
		const machine = (await machinesForBot(ctx.agent.id)).find(
			(m) =>
				m.kind !== "device" &&
				m.status === "running" &&
				(m.id === input.machine || m.name === input.machine || m.kind === input.machine),
		);
		if (!machine) throw badRequest("Choose a running computer or devbox for this bot, or use the server folder.");
		machineId = machine.id;
		location = machine.name;
		folder = projectFolder(input.folder ?? `jobs/${id}`);
	} else if (input.folder) throw badRequest("On the server, each job gets its own new folder.");
	const now = Date.now();
	const row: Row = {
		id,
		userId,
		agentId: ctx.agent.id,
		conversationId: ctx.conversation.id,
		messageId: ctx.messageId,
		title: input.title,
		providerId: p.id,
		providerTitle: p.title,
		model,
		machineId,
		location,
		folder,
		status: "working",
		lastStep: "Starting the job…",
		sessionId: null,
		steps: [],
		usage: null,
		createdAt: now,
		updatedAt: now,
	};
	await db.transaction(async (tx) => {
		await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`jobs:${userId}`}))`);
		const active = await tx
			.select({ agent: table.agentId })
			.from(table)
			.where(and(eq(table.userId, userId), inArray(table.status, liveStatuses)));
		if (active.filter((j) => j.agent === row.agentId).length >= 2)
			throw badRequest("This bot already has two active jobs.");
		if (active.length >= (currentActor()?.limits.maxJobs ?? 4))
			throw badRequest("You’ve reached your active job limit. Stop or finish a job first.");
		ctx.signal.throwIfAborted();
		await tx.insert(table).values(row);
	});
	const job = new JobRun(row);
	try {
		await createMessage({
			conversationId: row.conversationId,
			sender: "system",
			agentId: row.agentId,
			meta: { jobId: id },
			parts: [{ type: "text", text: `Started job: ${input.title}` }],
		});
		await job.send(input.task);
		void job.open(false);
		return summary(row);
	} catch (err) {
		await job.end("failed", "Couldn't start the job.");
		throw err;
	}
}
export async function sendJob(id: string, text: string, ctx?: ToolContext) {
	await getJob(id, ctx);
	const job = running.get(id);
	if (!job) throw badRequest("This job has stopped.");
	requirePermission("subscriptions");
	await job.send(text);
}
export async function stopJob(id: string, ctx?: ToolContext) {
	await getJob(id, ctx);
	await running.get(id)?.end("stopped", "Stopped on request.");
}
export async function restoreJobs() {
	for (const row of await db.select().from(table).where(inArray(table.status, liveStatuses))) {
		try {
			await runAsUser(row.userId, async () => {
				const live = new JobRun(row);
				if (Date.now() - row.createdAt >= MAX_MS) await live.end("stopped", "Reached the two-hour time limit.");
				else void live.open(true);
			});
		} catch {
			await db
				.update(table)
				.set({ status: "stopped", lastStep: interrupted, updatedAt: Date.now() })
				.where(eq(table.id, row.id));
		}
	}
}
export async function shutdownJobs() {
	await Promise.all([...running.values()].map((j) => j.detach()));
}
