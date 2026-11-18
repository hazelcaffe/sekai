import type { Agent, Memory, MemoryCheckupResult } from "@sekai/shared";
import { MEMORY_KINDS, type MemoryKind } from "@sekai/shared";
import { Cron } from "croner";
import { isNull } from "drizzle-orm";
import { requireActorId, runAsUser } from "../auth/actor.ts";
import { db, schema } from "../db/index.ts";
import { bus } from "../events/bus.ts";
import { errorMessage } from "../lib/errors.ts";
import { log } from "../lib/log.ts";
import { extractJson, truncate } from "../lib/text.ts";
import { chat } from "../llm/gateway.ts";
import { listAgents } from "../services/agents.ts";
import { getDirectConversation } from "../services/conversations.ts";
import { createMemory, deleteMemory, listMemories } from "../services/memories.ts";
import { createMessage } from "../services/messages.ts";
import { readPref, writePref } from "../services/prefs.ts";
import { effectiveTimezone, getSettings } from "../services/settings.ts";
import { fastModelFor } from "./models.ts";

/**
 * Memory check-ups: now and then each bot's fast model reads everything the bot remembers, merges memories that
 * say the same thing, drops ones a newer memory replaced, and comes up with a few questions about older facts that
 * may have changed. The bot posts what it changed and asks in its chat; your answers go through its memory tools.
 * Pinned memories and the ones you wrote yourself are never changed on their own (only asked about).
 */

/** Each person's own (their settings): how often, and when each bot last checked. */
const CONFIG = "checkups";
const LAST = "checkupsLast";
const MAX_QUESTIONS = 3;
/** Fewer than this, and there's nothing to tidy. */
const MIN_MEMORIES = 6;

interface Plan {
	merge?: { ids?: unknown; content?: unknown; kind?: unknown }[];
	remove?: { id?: unknown; why?: unknown }[];
	ask?: { id?: unknown; question?: unknown }[];
}

const SYSTEM = `You keep an AI agent's long-term memory tidy and true. You get every memory it has, each with an id, its kind,
when it was saved, who saved it, and whether it's pinned.

Return three lists:
- merge: memories that say the same thing (or where one fully contains another). Give their ids and ONE combined memory
  that keeps every detail and is self-contained. Same kind only.
- remove: memories that a NEWER memory clearly replaced or contradicted, and exact duplicates not already merged. "why"
  is a few plain words for the user, without ids (e.g. "replaced by: started at Initech in October"). Never remove
  something just because it's old.
- ask: at most ${MAX_QUESTIONS} short questions for the user about facts that may have changed since they were saved
  (job, home, projects, plans with dates, tools they use, people), or two memories that disagree when it's unclear which
  is right. Ask about things older than about six weeks first. Each question names what it's about, in plain words, and
  can be answered in a sentence. Don't ask about work_log entries or rules.

Never merge or remove pinned memories or ones saved by the user: you may only ask about those.
Most of the time there is little to do: empty lists are fine.
Reply with JSON only: {"merge":[{"ids":["..."],"kind":"...","content":"..."}],"remove":[{"id":"...","why":"..."}],"ask":[{"id":"...","question":"..."}]}`;

export async function checkupSchedule(userId = requireActorId()): Promise<"weekly" | "monthly" | "off"> {
	const v = (await readPref<{ schedule?: string }>(userId, CONFIG))?.schedule;
	return v === "monthly" || v === "off" ? v : "weekly";
}

function describe(m: Memory, tz: string): string {
	const date = new Date(m.updatedAt).toLocaleDateString("en-CA", { timeZone: tz });
	const by = m.source === "user" ? "the user" : m.source === "agent" ? "the agent" : "auto-learn";
	return `[${m.id}] (${m.kind}${m.agentId === null ? ", shared" : ""}${m.pinned ? ", PINNED" : ""}, saved ${date} by ${by}) ${m.content}`;
}

/** Checks one bot's memory now. Posts in its chat when it changed something or has questions. */
export async function checkupMemory(agent: Agent): Promise<MemoryCheckupResult> {
	const settings = await getSettings();
	const tz = await effectiveTimezone();
	// The primary bot looks after the memories every bot shares, too.
	const memories = (await listMemories({ agentId: agent.id, includeShared: agent.isPrimary, limit: 400 })).filter(
		(m) => m.agentId === agent.id || (agent.isPrimary && m.agentId === null),
	);
	const result: MemoryCheckupResult = { agentId: agent.id, merged: 0, removed: 0, questions: [], posted: false };
	if (memories.length < MIN_MEMORIES) return result;

	const byId = new Map(memories.map((m) => [m.id, m]));
	const model = await fastModelFor(agent, settings);
	const reply = await chat({
		meter: { agentId: agent.id, purpose: "background" },
		model: model.model,
		thinking: model.thinking === "default" ? "low" : model.thinking,
		maxTokens: 3000,
		messages: [
			{ role: "system", content: SYSTEM },
			{
				role: "user",
				content: `Agent: ${agent.name}. User: ${settings.userName || "the user"}. Today: ${new Date().toLocaleDateString("en-CA", { timeZone: tz })}.\n\nMemories:\n${memories.map((m) => describe(m, tz)).join("\n")}`,
			},
		],
	});
	const plan = (extractJson(reply.text) ?? {}) as Plan;
	const changeable = (id: unknown): Memory | null => {
		const m = typeof id === "string" ? byId.get(id) : undefined;
		return m && !m.pinned && m.source !== "user" ? m : null;
	};
	const gone = new Set<string>();
	const lines: string[] = [];

	for (const g of Array.isArray(plan.merge) ? plan.merge : []) {
		const group = (Array.isArray(g.ids) ? g.ids : []).map(changeable).filter((m): m is Memory => m !== null);
		const unique = [...new Map(group.map((m) => [m.id, m])).values()].filter((m) => !gone.has(m.id));
		const content = typeof g.content === "string" ? g.content.trim().slice(0, 4000) : "";
		const first = unique[0];
		if (!first || unique.length < 2 || !content) continue;
		// One scope: a bot's own memories don't merge into the shared ones (or the other way round).
		if (unique.some((m) => m.agentId !== first.agentId)) continue;
		const kind = MEMORY_KINDS.includes(g.kind as MemoryKind) ? (g.kind as MemoryKind) : first.kind;
		await createMemory(
			{ agentId: first.agentId, kind, content, pinned: false },
			unique.some((m) => m.source === "agent") ? "agent" : "auto",
		);
		for (const m of unique) {
			await deleteMemory(m.id);
			gone.add(m.id);
		}
		result.merged += unique.length;
		lines.push(`- Merged ${unique.length} that said the same thing into: "${truncate(content, 160)}"`);
	}

	for (const r of Array.isArray(plan.remove) ? plan.remove : []) {
		const m = changeable(r.id);
		if (!m || gone.has(m.id)) continue;
		await deleteMemory(m.id);
		gone.add(m.id);
		result.removed++;
		const why =
			typeof r.why === "string"
				? r.why
						.replace(/\(?\[?\bmem_\w+\]?\)?/g, "")
						.replace(/\s+([,.;:)])/g, "$1")
						.replace(/\s{2,}/g, " ")
						.trim()
				: "";
		lines.push(`- Removed "${truncate(m.content, 120)}"${why ? ` (${truncate(why, 140)})` : ""}`);
	}

	for (const q of (Array.isArray(plan.ask) ? plan.ask : []).slice(0, MAX_QUESTIONS)) {
		const question = typeof q.question === "string" ? q.question.trim().slice(0, 300) : "";
		if (question && !(typeof q.id === "string" && gone.has(q.id))) result.questions.push(question);
	}

	if (lines.length || result.questions.length) {
		const conversation = await getDirectConversation(agent.id);
		const text = [
			lines.length ? `**I tidied up my memory.**\n${lines.join("\n")}` : "",
			result.questions.length
				? `**A few things to check** (just reply, and I'll update what I remember):\n${result.questions.map((q, i) => `${i + 1}. ${q}`).join("\n")}`
				: "",
		]
			.filter(Boolean)
			.join("\n\n");
		await createMessage({
			conversationId: conversation.id,
			sender: "agent",
			agentId: agent.id,
			parts: [{ type: "text", text }],
			meta: { trigger: "checkup" },
		});
		if (result.questions.length) {
			bus.emit({
				type: "notification",
				title: `${agent.name} has ${result.questions.length === 1 ? "a question" : "a few questions"} about what it remembers`,
				body: result.questions[0] ?? "",
				agentId: agent.id,
				conversationId: conversation.id,
			});
		}
		result.posted = true;
	}
	const userId = requireActorId();
	const last = (await readPref<Record<string, number>>(userId, LAST)) ?? {};
	await writePref(userId, LAST, { ...last, [agent.id]: Date.now() });
	log.info(
		`memory check-up for ${agent.name}: ${result.merged} merged, ${result.removed} removed, ${result.questions.length} questions`,
	);
	return result;
}

/** Every bot with enough memories of the person (theirs, and shared with them), one after another. */
async function checkupAll(userId: string): Promise<void> {
	await runAsUser(userId, async () => {
		for (const agent of await listAgents()) {
			if (agent.status === "paused") continue;
			await checkupMemory(agent).catch((err: unknown) =>
				log.warn(`memory check-up for ${agent.name} failed: ${errorMessage(err)}`),
			);
		}
	}).catch(() => {});
}

const jobs = new Map<string, Cron>();

/** Sunday at 11:00 in their time zone: every week, or the first Sunday of the month. */
async function scheduleFor(userId: string): Promise<void> {
	jobs.get(userId)?.stop();
	jobs.delete(userId);
	await runAsUser(userId, async () => {
		const schedule = await checkupSchedule(userId);
		if (schedule === "off") return;
		const job = new Cron(
			schedule === "weekly" ? "0 11 * * 0" : "0 11 1-7 * 0",
			{ timezone: await effectiveTimezone(), domAndDow: true },
			() => void checkupAll(userId),
		);
		jobs.set(userId, job);
	}).catch(() => {});
}

/** Everyone's check-ups (at start, and when accounts or time zones change). */
export async function scheduleCheckups(): Promise<void> {
	const people = await db.select({ id: schema.users.id }).from(schema.users).where(isNull(schema.users.disabledAt));
	for (const [id, job] of jobs) {
		if (people.some((p) => p.id === id)) continue;
		job.stop();
		jobs.delete(id);
	}
	for (const p of people) await scheduleFor(p.id);
}

export async function setCheckupSchedule(schedule: "weekly" | "monthly" | "off") {
	const userId = requireActorId();
	await writePref(userId, CONFIG, { schedule });
	await scheduleFor(userId);
	return { schedule, nextAt: jobs.get(userId)?.nextRun()?.getTime() ?? null };
}

export async function checkupStatus() {
	const userId = requireActorId();
	return { schedule: await checkupSchedule(userId), nextAt: jobs.get(userId)?.nextRun()?.getTime() ?? null };
}

export function stopCheckups(): void {
	for (const job of jobs.values()) job.stop();
	jobs.clear();
}
