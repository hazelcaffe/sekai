import {
	type Agent,
	type ChannelOrigin,
	type Conversation,
	isByosModel,
	type Message,
	type MessageRetry,
	MessageRetry as MessageRetrySchema,
	type MessageSend,
	type MessageSendResult,
	MessageSend as MessageSendSchema,
	type MessageVersion,
	type ModelRef,
	messageText,
	type Routine,
	type Run,
	type RunTrigger,
} from "@sekai/shared";
import { type Actor, actorFor, runAs } from "../auth/actor.ts";
import { bus } from "../events/bus.ts";
import { conversationOwner } from "../events/scope.ts";
import { badRequest, errorMessage, notFound, parse } from "../lib/errors.ts";
import { log } from "../lib/log.ts";
import { truncate } from "../lib/text.ts";
import { getModelInfo } from "../llm/catalog.ts";
import { runByosReply } from "../providers/index.ts";
import { getAgent, listAgents } from "../services/agents.ts";
import { getConversation, requireConversation } from "../services/conversations.ts";
import { checkUsageLimits, requireModelAllowed } from "../services/limits.ts";
import { createMessage, getMessage, listMessages, updateMessage } from "../services/messages.ts";
import { getRoutine } from "../services/routines.ts";
import { createRun, getRun, listRuns, updateRun } from "../services/runs.ts";
import { getSettings } from "../services/settings.ts";
import { getUploads, toAttachment } from "../services/uploads.ts";
import { recordUsage } from "../services/usage.ts";
import { maybeCompact } from "./compaction.ts";
import { prepareContext } from "./context.ts";
import { parseMentions, pickResponders } from "./group.ts";
import { fastModelFor } from "./models.ts";
import { reflect } from "./reflection.ts";
import { refusalRetryFor } from "./refusal.ts";
import { runStrategy, type StrategyInput } from "./strategies.ts";
import { generateTitle } from "./titles.ts";
import { MessageWriter } from "./writer.ts";

export interface RunRequest {
	agentId: string;
	conversationId: string;
	trigger: RunTrigger;
	/** Agent-to-agent hops so far (limits handoff chains). */
	depth?: number;
	routine?: Routine | null;
	/** The message this run responds to (your message, a handoff, or a group message that mentioned the agent). */
	sourceMessageId?: string | null;
	/** In groups: your message that started this chain of replies (shares one turn budget). */
	rootMessageId?: string | null;
	/** Retry: answer again in place of this reply, keeping it as a version or wiping it, maybe with another model. */
	retry?: { messageId: string; wipe: boolean; model: ModelRef | null } | null;
	/** agent_ask: agents waiting on this answer, outermost first (prevents ask loops). */
	askChain?: string[];
}

/** One queue per conversation: replies land in order and never interleave. */
const queues = new Map<string, Promise<unknown>>();
const controllers = new Map<string, AbortController>();
const completions = new Map<string, Promise<Run | null>>();
/** Remaining agent replies per group chain (keyed by the root message). */
const groupBudgets = new Map<string, number>();
/**
 * Queued or running runs per conversation and agent. An agent that's already up next (or replying) will
 * read any new mention when its turn loads history, so a mention never needs to queue it a second time.
 */
const pending = new Map<string, Map<string, number>>();

function trackPending(conversationId: string, agentId: string, delta: 1 | -1): void {
	const byAgent = pending.get(conversationId) ?? new Map<string, number>();
	const n = (byAgent.get(agentId) ?? 0) + delta;
	if (n > 0) byAgent.set(agentId, n);
	else byAgent.delete(agentId);
	if (byAgent.size) pending.set(conversationId, byAgent);
	else pending.delete(conversationId);
}

function isPending(conversationId: string, agentId: string): boolean {
	return (pending.get(conversationId)?.get(agentId) ?? 0) > 0;
}

function runTitle(req: RunRequest, agent: Agent): string {
	switch (req.trigger) {
		case "routine":
			return `Routine: ${req.routine?.name ?? "scheduled run"}`;
		case "test":
			return `Test run: ${req.routine?.name ?? "routine"}`;
		case "reminder":
			return `Reminder: ${req.routine?.name ?? ""}`;
		case "handoff":
			return `Handoff to ${agent.name}`;
		case "ask":
			return `${agent.name} answering a teammate`;
		case "channel":
			return `${agent.name} replying on a channel`;
		case "group":
			return `${agent.name} replying in group`;
		case "regenerate":
			return "Regenerating reply";
		default:
			return `${agent.name} replying`;
	}
}

/**
 * Queues a reply. Every run acts as the person whose chat it is (their bots, memory, settings and limits),
 * whoever started it: you, a routine, a message from Discord, another bot.
 */
export async function enqueueRun(req: RunRequest): Promise<Run> {
	const ownerId = await conversationOwner(req.conversationId);
	if (!ownerId) throw notFound("Chat");
	const actor = await actorFor(ownerId);
	return runAs(actor, () => enqueueAs(req, actor));
}

async function enqueueAs(req: RunRequest, actor: Actor): Promise<Run> {
	const agent = await getAgent(req.agentId);
	if (!agent) throw notFound("Bot");
	const run = await createRun({
		userId: actor.userId,
		agentId: agent.id,
		conversationId: req.conversationId,
		trigger: req.trigger,
		title: runTitle(req, agent),
		routineId: req.routine?.id ?? null,
		model: agent.models.primary.model,
	});
	const controller = new AbortController();
	controllers.set(run.id, controller);
	trackPending(req.conversationId, agent.id, 1);
	const prev = queues.get(req.conversationId) ?? Promise.resolve();
	const done = prev
		.catch(() => {})
		.then(() => runAs(actor, () => executeRun(run, req, controller)))
		.catch((err: unknown) => {
			log.error(`run ${run.id} crashed`, err);
			return null;
		})
		.finally(() => {
			trackPending(req.conversationId, agent.id, -1);
			// Over: anything still waiting on this run (an approval nobody answered, a stuck tool) is let go.
			if (!controller.signal.aborted) controller.abort(new Error("The run finished"));
			controllers.delete(run.id);
			if (queues.get(req.conversationId) === done) queues.delete(req.conversationId);
			setTimeout(() => completions.delete(run.id), 60_000);
		});
	queues.set(req.conversationId, done);
	completions.set(run.id, done);
	return run;
}

export async function waitForRun(runId: string): Promise<Run | null> {
	const p = completions.get(runId);
	return p ? p : getRun(runId);
}

export async function cancelRun(runId: string): Promise<boolean> {
	const c = controllers.get(runId);
	if (!c) return false;
	c.abort(new DOMException("Cancelled", "AbortError"));
	return true;
}

export async function cancelConversationRuns(conversationId: string): Promise<number> {
	const active = await listRuns({ conversationId, status: ["queued", "running", "awaiting_approval"] });
	let n = 0;
	for (const r of active) if (await cancelRun(r.id)) n++;
	return n;
}

/** Stops everything an agent is doing (it's being deleted): its approvals go away with its runs. */
export async function cancelAgentRuns(agentId: string): Promise<number> {
	// Everyone's: a shared bot may be replying in other people's chats.
	const active = await runAs(null, () => listRuns({ agentId, status: ["queued", "running", "awaiting_approval"] }));
	let n = 0;
	for (const r of active) if (await cancelRun(r.id)) n++;
	return n;
}

export function cancelAllRuns(): void {
	for (const c of controllers.values()) c.abort(new DOMException("Shutting down", "AbortError"));
}

function triggerLabel(req: RunRequest): string | null {
	if (!req.routine) return null;
	const label = req.trigger === "test" ? "Test run of routine" : "Scheduled routine";
	return `[${label} "${req.routine.name}"]\n${req.routine.instruction}\n\n(Automatic run: nobody may be watching live. Do the work and post the result as your reply.)`;
}

async function executeRun(run: Run, req: RunRequest, controller: AbortController): Promise<Run | null> {
	const signal = controller.signal;
	if (signal.aborted) return updateRun(run.id, { status: "cancelled", finishedAt: Date.now() });

	const agent = await getAgent(req.agentId);
	let conversation = await getConversation(req.conversationId);
	if (!agent || !conversation) {
		return updateRun(run.id, {
			status: "cancelled",
			error: "Agent or conversation no longer exists",
			finishedAt: Date.now(),
		});
	}
	if (agent.status === "paused") {
		return updateRun(run.id, { status: "cancelled", error: `${agent.name} is paused`, finishedAt: Date.now() });
	}
	await updateRun(run.id, { status: "running", startedAt: Date.now() });

	let writer: MessageWriter | null = null;
	try {
		const settings = await getSettings();
		const primaryInfo = await getModelInfo(agent.models.primary.model);
		conversation = await maybeCompact(conversation, agent, settings, primaryInfo?.contextWindow ?? 200_000);

		const triggerText = triggerLabel(req);
		const source = req.sourceMessageId ? await getMessage(req.sourceMessageId) : null;
		const retried = req.retry ? await getMessage(req.retry.messageId) : null;
		if (req.retry && !retried) {
			return updateRun(run.id, {
				status: "cancelled",
				error: "That reply no longer exists",
				finishedAt: Date.now(),
			});
		}
		const chosen = req.retry?.model ?? agent.models.primary;
		// Earlier answers to this turn that stay as versions (a wipe drops the one being replaced).
		const keptVersions = retried ? previousVersions(retried, req.retry?.wipe ?? false) : [];
		const meta = {
			trigger: req.trigger,
			routineId: req.routine?.id,
			triggerText: req.routine?.instruction,
			// Replies to a channel message carry its origin so they're delivered back there.
			channel: source?.meta.channel ?? retried?.meta.channel,
			versions: keptVersions.length ? keptVersions : undefined,
			version: keptVersions.length ? keptVersions.length : undefined,
		};
		const message = retried
			? await updateMessage(retried.id, {
					status: "streaming",
					parts: [],
					error: null,
					usage: null,
					runId: run.id,
					model: chosen.model,
					meta,
				})
			: await createMessage({
					conversationId: conversation.id,
					sender: "agent",
					agentId: agent.id,
					status: "streaming",
					runId: run.id,
					model: chosen.model,
					meta,
				});
		await updateRun(run.id, { messageId: message.id });
		writer = new MessageWriter(message);
		// Over the role's limits, or a model it doesn't include: the reply says so instead.
		await checkUsageLimits();
		requireModelAllowed(chosen.model);

		const ctx = await prepareContext({
			agent,
			conversation,
			trigger: req.trigger,
			excludeMessageId: message.id,
			before: retried ? retried.createdAt : undefined,
			model: chosen.model,
			channel: source?.meta.channel ?? null,
			voiceCall: source?.meta.call?.kind === "speech",
			xFrom: source?.meta.x && source.sender === "user" ? source.meta.x.author : undefined,
		});
		const messages = [...ctx.messages];
		if (triggerText) messages.push({ role: "user", content: triggerText });

		// Images + a text-only primary model: hand the turn to the vision model if one is set. Subscription
		// agents get attachments as files in their workspace instead.
		let primary = chosen;
		const byos = isByosModel(primary.model);
		if (!byos && ctx.hasImages && !ctx.vision) {
			if (agent.models.vision) primary = agent.models.vision;
			else {
				writer.notice(
					"warning",
					`${primary.model} can't see images; set a vision model in this agent's Model settings.`,
				);
			}
		}

		const request = triggerText ?? (source ? messageText(source) : "");

		const strategyInput: StrategyInput = {
			primary,
			// A retry with a model you picked is that model alone.
			strategy: req.retry?.model ? { type: "single" } : agent.models.strategy,
			refusalRetry: await refusalRetryFor(agent, settings),
			agentName: agent.name,
			messages,
			toolset: ctx.toolset,
			ctx: {
				agent,
				conversation,
				runId: run.id,
				messageId: message.id,
				trigger: req.trigger,
				depth: req.depth ?? 0,
				askChain: req.askChain ?? [],
				timezone: ctx.timezone,
				approvalMode: ctx.approvalMode,
				signal,
			},
			writer,
			maxSteps: agent.models.maxSteps,
			maxTokens: agent.models.maxOutputTokens,
			temperature: agent.models.temperature,
			webSearch: agent.capabilities.webSearch,
			reviewModel: await fastModelFor(agent, settings),
			request,
			userName: settings.userName,
			approvalTimeoutMs: settings.approvalTimeoutMinutes * 60_000,
			// Ignored once the run is over (a late approval must not flip a finished run back to "running").
			onStatus: (status) => {
				if (!signal.aborted) void updateRun(run.id, { status });
			},
		};
		const result = byos
			? await runByosReply(strategyInput, {
					prompt: ctx.prompt,
					triggerText,
					// A retried answer must not be seen by the agent again: start its session over.
					restart: Boolean(req.retry),
					before: retried?.createdAt,
				})
			: await runStrategy(strategyInput);

		// Subscription agents' tokens don't pass through the gateway: count them here (a fallback to a gateway
		// model was already counted where it ran).
		if (byos && result.usage && result.models.every((m) => isByosModel(m))) {
			recordUsage({
				model: primary.model,
				usage: result.usage,
				agentId: agent.id,
				purpose: "reply",
				runId: run.id,
			});
		}
		const final = await writer.finish({
			status: "done",
			usage: result.usage,
			model: result.model,
			meta: withVersion(
				{
					...message.meta,
					models: result.models,
					declined: result.declined?.length ? result.declined : undefined,
				},
				keptVersions,
				{
					parts: writer.parts,
					model: result.model,
					usage: result.usage,
					status: "done",
					error: null,
					createdAt: Date.now(),
				},
			),
		});
		const done = await updateRun(run.id, {
			status: "done",
			model: result.model,
			steps: result.steps,
			usage: result.usage,
			finishedAt: Date.now(),
		});
		// Mentions are queued before this conversation's queue moves on, so ordering stays deterministic.
		// A retried answer doesn't hand off again.
		if (!req.retry) {
			await groupFollowUps(agent, conversation, final, req).catch((err: unknown) =>
				log.warn(`group follow-ups failed: ${errorMessage(err)}`),
			);
		}
		void afterRun(agent, conversation, final, source, req);
		return done;
	} catch (err) {
		const cancelled = signal.aborted;
		const msg = cancelled ? "Stopped" : errorMessage(err);
		if (!cancelled) log.warn(`run ${run.id} (${agent.name}) failed: ${msg}`);
		if (writer) {
			if (!cancelled) writer.notice("error", truncate(msg, 1000));
			const status = cancelled ? "cancelled" : "error";
			const kept = writer.message.meta.versions ?? [];
			// The message may be gone (deleted while it was being written); the run must still be closed below.
			await writer
				.finish({
					status,
					error: cancelled ? null : msg,
					meta: kept.length
						? withVersion(writer.message.meta, kept, {
								parts: writer.parts,
								model: writer.message.model,
								usage: null,
								status,
								error: cancelled ? null : msg,
								createdAt: Date.now(),
							})
						: writer.message.meta,
				})
				.catch((e: unknown) => log.debug(`run ${run.id}: couldn't close its message: ${errorMessage(e)}`));
		}
		return updateRun(run.id, {
			status: cancelled ? "cancelled" : "error",
			error: cancelled ? null : msg,
			finishedAt: Date.now(),
		});
	}
}

/** In groups, agents @mentioned in a reply get the floor next (within the turn budget). */
async function groupFollowUps(
	agent: Agent,
	conversation: Conversation,
	reply: Message,
	req: RunRequest,
): Promise<void> {
	if (conversation.kind !== "group" || !req.rootMessageId) return;
	const members = (await listAgents()).filter((a) => conversation.memberIds.includes(a.id) && a.id !== agent.id);
	const { ids } = parseMentions(messageText(reply), members);
	for (const id of ids) {
		const left = groupBudgets.get(req.rootMessageId) ?? 0;
		if (left <= 0) break;
		if (isPending(conversation.id, id)) continue;
		groupBudgets.set(req.rootMessageId, left - 1);
		await enqueueRun({
			agentId: id,
			conversationId: conversation.id,
			trigger: "group",
			depth: (req.depth ?? 0) + 1,
			sourceMessageId: reply.id,
			rootMessageId: req.rootMessageId,
		});
	}
}

/** Follow-ups that shouldn't delay the reply: memory, titles, notifications. */
async function afterRun(
	agent: Agent,
	conversation: Conversation,
	reply: Message,
	source: Message | null,
	req: RunRequest,
): Promise<void> {
	const text = messageText(reply);

	// You sent a voice message: the answer comes as one too (checked fresh: the audio is added just after sending).
	if (source?.sender === "user" && text) {
		const { isVoiceMessage, voiceReply } = await import("../voice/voice-messages.ts");
		if (await isVoiceMessage(source.id)) void voiceReply(agent, reply);
	}

	if (
		agent.capabilities.autoLearn &&
		["user", "group", "handoff", "ask", "regenerate", "channel"].includes(req.trigger) &&
		text
	) {
		void reflect(agent, reply, source);
	}

	if (conversation.kind === "direct" && conversation.title === "New chat") {
		const recent = await listMessages(conversation.id, { limit: 4 });
		void generateTitle(conversation.id, agent, recent);
	}

	if (["routine", "test", "handoff"].includes(req.trigger) && !conversation.settings.team) {
		bus.emit({
			type: "notification",
			title: agent.name,
			body: truncate(text || "Finished a task", 200),
			agentId: agent.id,
			conversationId: conversation.id,
		});
	}
}

/**
 * Posts your message and queues the agents that should answer. channel: it came from a chat app, so the
 * answers go back there.
 */
export async function sendUserMessage(
	conversationId: string,
	input: MessageSend,
	opts: { channel?: ChannelOrigin } = {},
): Promise<MessageSendResult> {
	const body = parse(MessageSendSchema, input);
	const conversation = await requireConversation(conversationId);
	if (!body.text.trim() && body.attachmentIds.length === 0) throw badRequest("Message is empty");
	const uploads = await getUploads(body.attachmentIds);
	const agents = await listAgents();
	const members = agents.filter((a) => conversation.memberIds.includes(a.id));
	const mentions = parseMentions(body.text, members);

	const message = await createMessage({
		conversationId,
		sender: "user",
		parts: body.text.trim() ? [{ type: "text", text: body.text }] : [],
		attachments: uploads.map(toAttachment),
		replyToId: body.replyToId,
		meta: {
			trigger: opts.channel ? "channel" : "user",
			mentions: mentions.everyone ? members.map((m) => m.id) : mentions.ids,
			channel: opts.channel,
		},
	});

	if (conversation.kind === "direct") {
		const agent = members[0];
		const responders = agent && agent.status === "active" ? [agent.id] : [];
		for (const agentId of responders) {
			await enqueueRun({
				agentId,
				conversationId,
				trigger: opts.channel ? "channel" : "user",
				sourceMessageId: message.id,
				rootMessageId: message.id,
			});
		}
		return { message, responders };
	}
	const responders = await startGroupTurn(conversation, message, members);
	return { message, responders };
}

/**
 * Starts a round of replies in a group for a new message (yours, or an agent's kickoff). Mentions pick
 * who answers, otherwise the router does; replies can @mention others until the turn budget runs out.
 */
export async function startGroupTurn(
	conversation: Conversation,
	message: Message,
	members: Agent[],
	opts: { exclude?: string; depth?: number } = {},
): Promise<string[]> {
	const candidates = members.filter((m) => m.id !== opts.exclude);
	const responders = await pickResponders(conversation, message, candidates);
	groupBudgets.set(message.id, Math.max(0, conversation.settings.maxTurns - responders.length));
	setTimeout(() => groupBudgets.delete(message.id), 3_600_000);
	for (const agentId of responders) {
		await enqueueRun({
			agentId,
			conversationId: conversation.id,
			trigger: "group",
			depth: opts.depth ?? 0,
			sourceMessageId: message.id,
			rootMessageId: message.id,
		});
	}
	return responders;
}

/** The answer currently shown, as a version entry. */
function currentVersion(m: Message): MessageVersion {
	return {
		parts: m.parts,
		model: m.model,
		usage: m.usage,
		status: m.status === "streaming" ? "cancelled" : m.status,
		error: m.error,
		createdAt: m.updatedAt,
	};
}

/** Versions to keep when retrying: all of them (keep), or all but the one shown (wipe). */
function previousVersions(m: Message, wipe: boolean): MessageVersion[] {
	const all = m.meta.versions?.length ? m.meta.versions : [currentVersion(m)];
	if (!wipe) return all;
	const shown = m.meta.version ?? all.length - 1;
	return all.filter((_, i) => i !== shown);
}

function withVersion(meta: Message["meta"], kept: MessageVersion[], latest: MessageVersion): Message["meta"] {
	if (kept.length === 0) return { ...meta, versions: undefined, version: undefined };
	return { ...meta, versions: [...kept, latest], version: kept.length };
}

/**
 * Answers a turn again, in place of an agent's reply. keep: the old answer stays as a version you can switch
 * back to; wipe: it's erased. Either way the new attempt only sees what came before the reply.
 */
export async function retryMessage(messageId: string, input: MessageRetry = {}): Promise<void> {
	const opts = parse(MessageRetrySchema, input);
	const message = await getMessage(messageId);
	if (!message) throw notFound("Message");
	if (message.sender !== "agent" || !message.agentId) throw badRequest("Only a bot's replies can be retried");
	if (message.status === "streaming") throw badRequest("This reply is still being written");
	const history = await listMessages(message.conversationId);
	const index = history.findIndex((m) => m.id === messageId);
	const source = history
		.slice(0, index)
		.reverse()
		.find((m) => m.sender === "user");
	const routine = message.meta.routineId ? await getRoutine(message.meta.routineId) : null;
	await enqueueRun({
		agentId: message.agentId,
		conversationId: message.conversationId,
		trigger: routine ? "routine" : "regenerate",
		routine,
		sourceMessageId: routine ? null : (source?.id ?? null),
		retry: { messageId, wipe: opts.wipe, model: opts.model },
	});
}

/** Shows another version of a retried answer; the shown version is what the bot sees from then on. */
export async function setMessageVersion(messageId: string, version: number): Promise<Message> {
	const message = await getMessage(messageId);
	if (!message) throw notFound("Message");
	if (message.status === "streaming") throw badRequest("This reply is still being written");
	const v = message.meta.versions?.[version];
	if (!v) throw badRequest("No such version");
	return updateMessage(message.id, {
		parts: v.parts,
		model: v.model,
		usage: v.usage,
		status: v.status,
		error: v.error,
		meta: { ...message.meta, version },
	});
}
