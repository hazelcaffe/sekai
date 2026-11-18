import type { Agent, DigestStatus } from "@sekai/shared";
import { DigestConfig, DigestConfigUpdate } from "@sekai/shared";
import { Cron } from "croner";
import { and, gte, isNull, lte, sql } from "drizzle-orm";
import { listPendingApprovals } from "../agent/approvals.ts";
import { fastModelFor } from "../agent/models.ts";
import { actorFor, currentActor, requireActorId, runAs, runAsUser } from "../auth/actor.ts";
import { listCredentialRequests } from "../browser/credentials.ts";
import { db, schema } from "../db/index.ts";
import { bus } from "../events/bus.ts";
import { errorMessage, parse } from "../lib/errors.ts";
import { log } from "../lib/log.ts";
import { chat } from "../llm/gateway.ts";
import { activitySince } from "./activity.ts";
import { listAgents, listOwnAgents } from "./agents.ts";
import { getDirectConversation } from "./conversations.ts";
import { healthReport } from "./health.ts";
import { createMessage } from "./messages.ts";
import { readPref, writePref } from "./prefs.ts";
import { effectiveTimezone, getSettings } from "./settings.ts";
import { modelPrices } from "./usage.ts";
import { ownWhere } from "./visibility.ts";

/** Each person's digest: their settings (digest, digestLastSentAt), their bots, their chats. */
const CONFIG = "digest";
const LAST = "digestLastSentAt";

export async function digestConfig(userId = requireActorId()): Promise<DigestConfig> {
	return DigestConfig.parse((await readPref(userId, CONFIG)) ?? {});
}

async function primaryAgent(): Promise<Agent | null> {
	const agents = (await listOwnAgents()).filter((a) => !a.hidden);
	return agents.find((a) => a.isPrimary) ?? agents[0] ?? null;
}

const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

function timeIn(ms: number, tz: string): string {
	return new Date(ms).toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
}

/** The end of today in a time zone (ms). */
function endOfToday(now: number, tz: string): number {
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat("en-US", {
			timeZone: tz,
			hour: "numeric",
			minute: "numeric",
			second: "numeric",
			hourCycle: "h23",
		})
			.formatToParts(new Date(now))
			.map((p) => [p.type, Number(p.value)]),
	) as Record<string, number>;
	const elapsed = ((parts.hour ?? 0) * 3600 + (parts.minute ?? 0) * 60 + (parts.second ?? 0)) * 1000;
	return now - elapsed + 86_400_000 - 1;
}

export interface Digest {
	/** Markdown, the facts as a list. */
	text: string;
	/** One line for the notification. */
	summary: string;
	/** Nothing happened, nothing waits, nothing's planned. */
	quiet: boolean;
}

/** What happened since `since`, what waits for you, and what's planned for the rest of today. */
export async function buildDigest(since: number, now = Date.now()): Promise<Digest> {
	const settings = await getSettings();
	const tz = await effectiveTimezone();
	const actor = currentActor();
	const me = actor?.userId ?? null;
	const agents = await listAgents();
	const name = (id: string | null) => agents.find((a) => a.id === id)?.name ?? "A bot";

	// Replies and routine runs, per bot.
	const runs = await db
		.select({
			agentId: schema.runs.agentId,
			status: schema.runs.status,
			trigger: schema.runs.trigger,
			title: schema.runs.title,
			error: schema.runs.error,
		})
		.from(schema.runs)
		.where(and(gte(schema.runs.createdAt, since), lte(schema.runs.createdAt, now), ownWhere(schema.runs.userId)));
	const actions = await activitySince(since);
	const failedRoutines = (await db.execute(sql`
		select r.name, r.agent_id, rr.error from routine_runs rr join routines r on r.id = rr.routine_id
		where rr.started_at >= ${since} and rr.status = 'failed' and (${me}::text is null or r.user_id = ${me})
		order by rr.started_at desc limit 5`)) as unknown as {
		name: string;
		agent_id: string;
		error: string | null;
	}[];

	const perBot = new Map<string, { replies: number; routines: number; actions: number }>();
	const bump = (id: string, k: "replies" | "routines" | "actions") => {
		const e = perBot.get(id) ?? { replies: 0, routines: 0, actions: 0 };
		e[k]++;
		perBot.set(id, e);
	};
	for (const r of runs) bump(r.agentId, r.trigger === "routine" ? "routines" : "replies");
	for (const a of actions) if (a.agentId) bump(a.agentId, "actions");

	const did = [...perBot.entries()]
		.sort((a, b) => b[1].replies + b[1].routines - (a[1].replies + a[1].routines))
		.map(([id, e]) => {
			const bits = [
				e.replies ? plural(e.replies, "reply", "replies") : null,
				e.routines ? plural(e.routines, "routine run") : null,
				e.actions ? plural(e.actions, "action") : null,
			].filter(Boolean);
			return `- **${name(id)}**: ${bits.join(", ")}`;
		});

	const failedRuns = runs.filter((r) => r.status === "error");
	const failedActions = actions.filter((a) => a.status === "error");
	const denied = actions.filter((a) => a.status === "denied");
	const broke: string[] = [];
	for (const r of failedRoutines) {
		broke.push(`- ${name(r.agent_id)}'s routine "${r.name}" failed${r.error ? `: ${r.error.slice(0, 120)}` : ""}`);
	}
	const otherFailedRuns = failedRuns.filter((r) => r.trigger !== "routine");
	if (otherFailedRuns.length) {
		broke.push(
			`- ${plural(otherFailedRuns.length, "reply", "replies")} ended with an error (${[...new Set(otherFailedRuns.map((r) => name(r.agentId)))].join(", ")})`,
		);
	}
	if (failedActions.length) {
		const examples = [...new Set(failedActions.map((a) => a.title))].slice(0, 3).join("; ");
		broke.push(`- ${plural(failedActions.length, "action")} failed: ${examples}`);
	}
	if (denied.length) broke.push(`- ${plural(denied.length, "action")} denied`);

	const approvals = listPendingApprovals();
	const logins = listCredentialRequests();
	const waiting = [
		...approvals.slice(0, 5).map((a) => `- ${name(a.agentId)} asks: ${a.title}`),
		...(approvals.length > 5 ? [`- and ${approvals.length - 5} more requests`] : []),
		...logins.slice(0, 3).map((l) => `- ${name(l.agentId)} needs you to sign in to ${l.site}`),
	];

	const end = endOfToday(now, tz);
	const routines = await db
		.select({
			name: schema.routines.name,
			agentId: schema.routines.agentId,
			nextRunAt: schema.routines.nextRunAt,
			action: schema.routines.action,
		})
		.from(schema.routines)
		.where(
			and(
				sql`${schema.routines.enabled} = true`,
				gte(schema.routines.nextRunAt, now),
				lte(schema.routines.nextRunAt, end),
				ownWhere(schema.routines.userId),
			),
		)
		.orderBy(schema.routines.nextRunAt);
	const today = routines
		.slice(0, 8)
		.map(
			(r) =>
				`- ${timeIn(r.nextRunAt ?? now, tz)} · ${r.action === "notify" ? "⏰ " : ""}${r.name} (${name(r.agentId)})`,
		);
	if (routines.length > 8) today.push(`- and ${routines.length - 8} more`);

	// The server's own problems are for admins.
	const health = !actor || actor.admin ? await healthReport().catch(() => null) : null;
	const server = (health?.issues ?? []).map((i) => `- ${i.title}. ${i.detail}`);

	const allUsage = (await db.execute(sql`
		select model, sum(input_tokens)::float8 as input, sum(output_tokens)::float8 as output
		from usage_log where at >= ${since} and at <= ${now} and (${me}::text is null or user_id = ${me})
		group by model`)) as unknown as {
		model: string;
		input: number;
		output: number;
	}[];
	const prices = await modelPrices();
	const tokens = allUsage.reduce((n, r) => n + Number(r.input) + Number(r.output), 0);
	let cost: number | null = null;
	for (const r of allUsage) {
		const p = prices[r.model];
		if (p) cost = (cost ?? 0) + (Number(r.input) * p.input + Number(r.output) * p.output) / 1_000_000;
	}
	const fmtTokens = (n: number) =>
		n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);

	const who = settings.userName?.trim().split(/\s+/)[0];
	const sinceText =
		now - since > 30 * 3_600_000
			? `since ${new Date(since).toLocaleDateString("en-US", { timeZone: tz, weekday: "long" })}`
			: "since yesterday";
	const parts = [`**Good morning${who ? `, ${who}` : ""}.** Here's what happened ${sinceText}.`];
	if (did.length) parts.push(`**What your bots did**\n${did.join("\n")}`);
	else parts.push("Your bots had a quiet day.");
	if (broke.length) parts.push(`**Didn't work**\n${broke.join("\n")}`);
	if (waiting.length) parts.push(`**Waiting for you**\n${waiting.join("\n")}`);
	if (today.length) parts.push(`**Today**\n${today.join("\n")}`);
	if (server.length) parts.push(`**This server**\n${server.join("\n")}`);
	if (tokens) parts.push(`Used ${fmtTokens(tokens)} tokens${cost !== null ? ` (about $${cost.toFixed(2)})` : ""}.`);

	const summary = [
		runs.length ? plural(runs.length, "reply", "replies") : "A quiet day",
		broke.length ? `${broke.length} didn't work` : null,
		approvals.length + logins.length ? `${approvals.length + logins.length} waiting for you` : null,
		routines.length ? `${plural(routines.length, "thing")} today` : null,
	]
		.filter(Boolean)
		.join(" · ");
	const quiet = !runs.length && !actions.length && !waiting.length && !today.length && !server.length;
	return { text: parts.join("\n\n"), summary, quiet };
}

/** The primary bot puts the facts in its own words (keeping every one); the plain list when that fails. */
async function inVoice(agent: Agent, facts: string): Promise<string> {
	const settings = await getSettings();
	const model = await fastModelFor(agent, settings);
	try {
		const result = await chat({
			meter: { agentId: agent.id, purpose: "background" },
			model: model.model,
			thinking: "default",
			maxTokens: 900,
			messages: [
				{
					role: "system",
					content: [
						`You are ${agent.name}${agent.label ? `, ${agent.label}` : ""}.`,
						agent.personality ? `Your personality:\n${agent.personality.slice(0, 2000)}` : "",
						`Write ${settings.userName || "the user"}'s morning digest in your own voice from the facts below.`,
						"Keep every fact, number, name and time exactly; add nothing that isn't there. Keep the bold section headings and the bullet lists; at most one short friendly line of your own at the start or end. No preamble, no sign-off with your name.",
					]
						.filter(Boolean)
						.join("\n\n"),
				},
				{ role: "user", content: facts },
			],
		});
		const text = result.text.trim();
		return text.length > 40 ? text : facts;
	} catch (err) {
		log.warn(`digest in ${agent.name}'s voice failed, sending the plain one: ${errorMessage(err)}`);
		return facts;
	}
}

/** Builds and posts the digest in the primary bot's chat, with a notification. Returns false when it skipped. */
export async function sendDigest(opts: { force?: boolean } = {}): Promise<boolean> {
	const userId = requireActorId();
	const agent = await primaryAgent();
	if (!agent) return false;
	const cfg = await digestConfig(userId);
	const now = Date.now();
	const last = await readPref<number>(userId, LAST);
	// Since the last one (at most a week back), else the last day. One sent by hand covers the last day, and
	// doesn't move where the next morning's starts.
	const since = opts.force ? now - 86_400_000 : Math.max(last ?? now - 86_400_000, now - 7 * 86_400_000);
	const digest = await buildDigest(since, now);
	if (digest.quiet && cfg.skipQuiet && !opts.force) {
		log.info("digest: nothing to say today, skipped");
		await writePref(userId, LAST, now);
		return false;
	}
	const text = cfg.style === "bot" ? await inVoice(agent, digest.text) : digest.text;
	const conversation = await getDirectConversation(agent.id);
	await createMessage({
		conversationId: conversation.id,
		sender: "agent",
		agentId: agent.id,
		parts: [{ type: "text", text }],
		meta: { trigger: "digest" },
	});
	bus.emit({
		type: "notification",
		title: `☀️ ${agent.name}: your morning digest`,
		body: digest.summary,
		agentId: agent.id,
		conversationId: conversation.id,
	});
	if (!opts.force) await writePref(userId, LAST, now);
	log.info(`digest sent (${digest.summary})`);
	return true;
}

export async function digestStatus(): Promise<DigestStatus> {
	const userId = requireActorId();
	return {
		config: await digestConfig(userId),
		nextAt: jobs.get(userId)?.nextRun()?.getTime() ?? null,
		lastSentAt: (await readPref<number>(userId, LAST)) ?? null,
		agentId: (await primaryAgent())?.id ?? null,
	};
}

export async function configureDigest(input: unknown): Promise<DigestStatus> {
	const userId = requireActorId();
	const next = DigestConfig.parse({ ...(await digestConfig(userId)), ...parse(DigestConfigUpdate, input) });
	await writePref(userId, CONFIG, next);
	await scheduleFor(userId);
	bus.emit({ type: "settings.changed" });
	return digestStatus();
}

// ---------------------------------------------------------------- schedule (one job per person)

const jobs = new Map<string, Cron>();
let unsubscribe: (() => void) | null = null;

async function scheduleFor(userId: string): Promise<void> {
	jobs.get(userId)?.stop();
	jobs.delete(userId);
	const actor = await actorFor(userId).catch(() => null);
	if (!actor) return;
	await runAs(actor, async () => {
		const cfg = await digestConfig(userId);
		if (!cfg.enabled) return;
		const [h, m] = cfg.time.split(":").map(Number);
		const job = new Cron(`${m} ${h} * * *`, { timezone: await effectiveTimezone() }, () => {
			void runAsUser(userId, () => sendDigest()).catch((err: unknown) =>
				log.error(`digest failed: ${errorMessage(err)}`),
			);
		});
		jobs.set(userId, job);
	});
}

async function scheduleAll(): Promise<void> {
	const people = await db.select({ id: schema.users.id }).from(schema.users).where(isNull(schema.users.disabledAt));
	for (const [id, job] of jobs) {
		if (people.some((p) => p.id === id)) continue;
		job.stop();
		jobs.delete(id);
	}
	for (const p of people) await scheduleFor(p.id);
}

export async function startDigest(): Promise<void> {
	await scheduleAll();
	// Someone's time zone changed (so does their 8:00), or an account was added or turned off.
	unsubscribe = bus.subscribe((ev) => {
		if (ev.type === "settings.changed") void scheduleAll().catch(() => {});
	});
}

export function stopDigest(): void {
	for (const job of jobs.values()) job.stop();
	jobs.clear();
	unsubscribe?.();
	unsubscribe = null;
}
