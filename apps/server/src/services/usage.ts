import type { ModelPrice, UsageBucket, UsagePurpose, UsageReport, UsageScope, UsageTotals } from "@sekai/shared";
import { ModelPrice as ModelPriceSchema } from "@sekai/shared";
import { eq, sql } from "drizzle-orm";
import { currentActor } from "../auth/actor.ts";
import { db, schema } from "../db/index.ts";
import { agentOwner } from "../events/scope.ts";
import { errorMessage, parse } from "../lib/errors.ts";
import { newId } from "../lib/ids.ts";
import { log } from "../lib/log.ts";
import { csvCell } from "../lib/text.ts";
import { readKey, writeKey } from "./kv.ts";
import { effectiveTimezone } from "./settings.ts";

const PRICES = "usage.prices";

/**
 * Records one model call's tokens (never throws: stats must not break a reply). They count for the person Sekai
 * acts for (whose chat or routine it is), else the bot's owner.
 */
export function recordUsage(entry: {
	model: string;
	usage: { inputTokens: number; outputTokens: number; reasoningTokens: number; cachedTokens: number };
	agentId: string | null;
	purpose: UsagePurpose;
	runId?: string | null;
	userId?: string | null;
}): void {
	const u = entry.usage;
	if (!u.inputTokens && !u.outputTokens) return;
	const at = Date.now();
	const actorId = entry.userId ?? currentActor()?.userId ?? null;
	void (async () => {
		const userId = actorId ?? (entry.agentId ? await agentOwner(entry.agentId) : null);
		await db.insert(schema.usageLog).values({
			id: newId("use", 16),
			at,
			userId,
			agentId: entry.agentId,
			purpose: entry.purpose,
			model: entry.model,
			inputTokens: Math.round(u.inputTokens),
			outputTokens: Math.round(u.outputTokens),
			reasoningTokens: Math.round(u.reasoningTokens),
			cachedTokens: Math.round(u.cachedTokens),
			runId: entry.runId ?? null,
		});
	})().catch((err: unknown) => log.warn(`couldn't record usage: ${errorMessage(err)}`));
}

export async function modelPrices(): Promise<Record<string, ModelPrice>> {
	return ((await readKey(PRICES)) as Record<string, ModelPrice> | undefined) ?? {};
}

/** Sets (or, with null, clears) the price of a model. */
export async function setModelPrice(model: string, price: unknown): Promise<Record<string, ModelPrice>> {
	const all = await modelPrices();
	if (price === null) delete all[model];
	else all[model.slice(0, 200)] = parse(ModelPriceSchema, price);
	await writeKey(PRICES, all);
	return all;
}

type Row = {
	calls: number | string;
	input: number | string | null;
	output: number | string | null;
	reasoning: number | string | null;
	cached: number | string | null;
};

function totalsOf(rows: (Row & { model?: string })[], prices: Record<string, ModelPrice>): UsageTotals {
	let cost: number | null = null;
	const t = { calls: 0, inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cachedTokens: 0 };
	for (const r of rows) {
		t.calls += Number(r.calls);
		t.inputTokens += Number(r.input ?? 0);
		t.outputTokens += Number(r.output ?? 0);
		t.reasoningTokens += Number(r.reasoning ?? 0);
		t.cachedTokens += Number(r.cached ?? 0);
		const p = r.model ? prices[r.model] : undefined;
		if (p) cost = (cost ?? 0) + (Number(r.input ?? 0) * p.input + Number(r.output ?? 0) * p.output) / 1_000_000;
	}
	return { ...t, cost };
}

const SUMS = sql`count(*) as calls, sum(input_tokens) as input, sum(output_tokens) as output,
	sum(reasoning_tokens) as reasoning, sum(cached_tokens) as cached`;

interface Grain extends Row {
	bucket: string;
	model: string;
	agent_id: string | null;
	purpose: UsagePurpose;
	user_id: string | null;
}

const TOP = 6;

/**
 * Tokens and cost over the last `days` days (in your time zone): bars by hour (a day or two) or day, stacked by
 * model and bot; a weekday × hour heatmap; the period before, to compare; per person for admins; plus run stats.
 * scope: "me", or (admins) "all" or someone's id.
 */
export async function usageReport(days: number, scopeIn: UsageScope = "me"): Promise<UsageReport> {
	const span = Math.min(Math.max(Math.round(days), 1), 366);
	const actor = currentActor();
	const scopeKind: UsageReport["scope"]["kind"] =
		!actor || (actor.admin && scopeIn === "all") ? "all" : actor.admin && scopeIn !== "me" ? "user" : "me";
	const scopeUser = scopeKind === "all" ? null : scopeKind === "user" ? scopeIn : (actor?.userId ?? null);
	const tz = await effectiveTimezone();
	const prices = await modelPrices();
	const to = Date.now();
	const from = to - span * 86_400_000;
	const hourly = span <= 2;
	const fmt = hourly ? "YYYY-MM-DD HH24" : "YYYY-MM-DD";
	const local = sql`(to_timestamp(at / 1000.0) at time zone ${tz})`;
	const who = scopeUser ? sql`and user_id = ${scopeUser}` : sql``;

	const grains = (await db.execute(sql`
		select to_char(${local}, ${fmt}) as bucket, model, agent_id, purpose, user_id, ${SUMS}
		from usage_log where at >= ${from} ${who}
		group by 1, 2, 3, 4, 5`)) as unknown as Grain[];
	const before = (await db.execute(sql`
		select model, ${SUMS} from usage_log where at >= ${from - span * 86_400_000} and at < ${from} ${who}
		group by 1`)) as unknown as (Row & { model: string })[];
	const heat = (await db.execute(sql`
		select (extract(isodow from ${local})::int - 1) as dow, extract(hour from ${local})::int as hour,
			sum(input_tokens + output_tokens) as tokens
		from usage_log where at >= ${from} ${who} group by 1, 2`)) as unknown as {
		dow: number | string;
		hour: number | string;
		tokens: number | string | null;
	}[];
	const runWho = scopeUser ? sql`and user_id = ${scopeUser}` : sql``;
	const runs = (await db.execute(sql`
		select status, trigger, count(*) as n,
			avg(extract(epoch from (to_timestamp(finished_at / 1000.0) - to_timestamp(coalesce(started_at, created_at) / 1000.0)))) as secs
		from runs where created_at >= ${from} ${runWho} group by 1, 2`)) as unknown as {
		status: string;
		trigger: string;
		n: number | string;
		secs: number | string | null;
	}[];

	// Bots by name: yours and shared with you, or (everyone's view) every bot.
	const agentRows = await db.select({ id: schema.agents.id, name: schema.agents.name }).from(schema.agents);
	const agentName = new Map(agentRows.map((a) => [a.id, a.name]));
	const nameOfAgent = (id: string | null) => (id ? (agentName.get(id) ?? "A deleted bot") : "Sekai (no bot)");

	const group = <K extends string>(rows: Grain[], key: (r: Grain) => K) => {
		const m = new Map<K, Grain[]>();
		for (const r of rows) m.set(key(r), [...(m.get(key(r)) ?? []), r]);
		return m;
	};
	const tokensOf = (rows: Row[]) => rows.reduce((n, r) => n + Number(r.input ?? 0) + Number(r.output ?? 0), 0);
	const costOf = (r: Row & { model: string }) => {
		const p = prices[r.model];
		return p ? (Number(r.input ?? 0) * p.input + Number(r.output ?? 0) * p.output) / 1_000_000 : null;
	};

	const perModel = group(grains, (r) => r.model);
	const perAgent = group(grains, (r) => r.agent_id ?? "");
	const topModels = [...perModel.entries()]
		.sort((a, b) => tokensOf(b[1]) - tokensOf(a[1]))
		.slice(0, TOP)
		.map(([m]) => m);
	const topAgentIds = [...perAgent.entries()]
		.sort((a, b) => tokensOf(b[1]) - tokensOf(a[1]))
		.slice(0, TOP)
		.map(([id]) => id);

	// Every bucket in the range, oldest first (empty ones show as zero).
	const keyFmt = new Intl.DateTimeFormat("en-CA", {
		timeZone: tz,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		...(hourly ? { hour: "2-digit", hourCycle: "h23" as const } : {}),
	});
	const keyOf = (t: number) => {
		const p = Object.fromEntries(keyFmt.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
		return hourly ? `${p.year}-${p.month}-${p.day} ${p.hour}` : `${p.year}-${p.month}-${p.day}`;
	};
	const step = hourly ? 3_600_000 : 86_400_000;
	const starts = new Map<string, number>();
	for (let t = from + (hourly ? 0 : step); t <= to + 1; t += step) {
		const k = keyOf(t);
		if (!starts.has(k)) starts.set(k, t);
	}
	const perBucket = group(grains, (r) => r.bucket);
	const buckets: UsageBucket[] = [...new Set([...starts.keys(), ...perBucket.keys()])].sort().map((key) => {
		const rows = perBucket.get(key) ?? [];
		const models: Record<string, number> = {};
		const agents: Record<string, number> = {};
		const costs: Record<string, number> = {};
		for (const r of rows) {
			const t = Number(r.input ?? 0) + Number(r.output ?? 0);
			const m = topModels.includes(r.model) ? r.model : "other";
			models[m] = (models[m] ?? 0) + t;
			const a = topAgentIds.includes(r.agent_id ?? "") ? r.agent_id || "none" : "other";
			agents[a] = (agents[a] ?? 0) + t;
			const c = costOf(r);
			if (c !== null) costs[m] = (costs[m] ?? 0) + c;
		}
		return {
			key,
			start: starts.get(key) ?? 0,
			...totalsOf(rows, prices),
			reply: tokensOf(rows.filter((r) => r.purpose === "reply")),
			background: tokensOf(rows.filter((r) => r.purpose === "background")),
			models,
			agents,
			costs,
		};
	});

	const heatmap = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
	for (const h of heat) {
		const row = heatmap[Number(h.dow)];
		if (row) row[Number(h.hour)] = Number(h.tokens ?? 0);
	}

	const runTotals = { total: 0, done: 0, error: 0, cancelled: 0 };
	let secsSum = 0;
	let secsCount = 0;
	const triggers = new Map<string, number>();
	for (const r of runs) {
		const n = Number(r.n);
		runTotals.total += n;
		if (r.status === "done" || r.status === "error" || r.status === "cancelled") runTotals[r.status] += n;
		triggers.set(r.trigger, (triggers.get(r.trigger) ?? 0) + n);
		if (r.secs !== null && r.status === "done") {
			secsSum += Number(r.secs) * n;
			secsCount += n;
		}
	}

	let byUser: UsageReport["byUser"] = [];
	if (scopeKind === "all") {
		const people = await db
			.select({ id: schema.users.id, name: schema.users.name, role: schema.roles.name })
			.from(schema.users)
			.innerJoin(schema.roles, eq(schema.roles.id, schema.users.roleId));
		byUser = [...group(grains, (r) => r.user_id ?? "").entries()].map(([id, rows]) => {
			const p = people.find((x) => x.id === id);
			return {
				userId: id || null,
				name: p?.name ?? (id ? "Someone who left" : "Sekai itself"),
				role: p?.role ?? null,
				...totalsOf(rows, prices),
			};
		});
	}

	let scopeName = "Everyone";
	if (scopeUser) {
		const [u] = await db
			.select({ name: schema.users.name })
			.from(schema.users)
			.where(eq(schema.users.id, scopeUser));
		scopeName = u?.name ?? "Someone";
	}
	let limits: UsageReport["limits"] = null;
	if (scopeKind === "me" && actor && !actor.admin) {
		const { spentBy } = await import("./limits.ts");
		const spent = await spentBy(actor.userId);
		limits = {
			tokensPerDay: actor.limits.tokensPerDay,
			tokensPerMonth: actor.limits.tokensPerMonth,
			costPerMonth: actor.limits.costPerMonth,
			...spent,
		};
	}

	const byTokens = (a: UsageTotals, b: UsageTotals) =>
		b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens);
	const days_ = group(grains, (r) => r.bucket.slice(0, 10));
	return {
		from,
		to,
		timezone: tz,
		scope: { kind: scopeKind, userId: scopeUser, name: scopeName },
		bucket: hourly ? "hour" : "day",
		buckets,
		previous: totalsOf(before, prices),
		heatmap,
		topModels,
		topAgents: topAgentIds.map((id) => ({ id: id || "none", name: nameOfAgent(id || null) })),
		byUser: byUser.sort(byTokens),
		limits,
		totals: totalsOf(grains, prices),
		daily: [...new Set([...[...starts.keys()].map((k) => k.slice(0, 10)), ...days_.keys()])].sort().map((date) => {
			const rows = days_.get(date) ?? [];
			return {
				date,
				...totalsOf(rows, prices),
				reply: tokensOf(rows.filter((r) => r.purpose === "reply")),
				background: tokensOf(rows.filter((r) => r.purpose === "background")),
			};
		}),
		byAgent: [...perAgent.entries()]
			.map(([id, rows]) => ({ agentId: id || null, name: nameOfAgent(id || null), ...totalsOf(rows, prices) }))
			.sort(byTokens),
		byModel: [...perModel.entries()]
			.map(([model, rows]) => ({ model, price: prices[model] ?? null, ...totalsOf(rows, prices) }))
			.sort(byTokens),
		byPurpose: [...group(grains, (r) => r.purpose).entries()].map(([purpose, rows]) => ({
			purpose,
			...totalsOf(rows, prices),
		})),
		runs: {
			...runTotals,
			avgSeconds: secsCount ? Math.round((secsSum / secsCount) * 10) / 10 : null,
			byTrigger: [...triggers.entries()]
				.map(([trigger, count]) => ({ trigger, count }))
				.sort((a, b) => b.count - a.count),
		},
		prices,
	};
}

/** The same report's rows as CSV: one line per day, person, bot, model and purpose. */
export async function usageCsv(days: number, scope: UsageScope = "me"): Promise<string> {
	const report = await usageReport(days, scope);
	const span = Math.min(Math.max(Math.round(days), 1), 366);
	const tz = report.timezone;
	const who = report.scope.userId ? sql`and u.user_id = ${report.scope.userId}` : sql``;
	const rows = (await db.execute(sql`
		select to_char(to_timestamp(u.at / 1000.0) at time zone ${tz}, 'YYYY-MM-DD') as date,
			coalesce(p.name, '') as person, coalesce(a.name, '') as bot, u.model, u.purpose, ${SUMS}
		from usage_log u
		left join users p on p.id = u.user_id
		left join agents a on a.id = u.agent_id
		where u.at >= ${Date.now() - span * 86_400_000} ${who}
		group by 1, 2, 3, 4, 5 order by 1, 2, 3, 4`)) as unknown as (Row & {
		date: string;
		person: string;
		bot: string;
		model: string;
		purpose: string;
	})[];
	const q = csvCell;
	const lines = [
		"date,person,bot,model,purpose,calls,input_tokens,output_tokens,reasoning_tokens,cached_tokens,cost_usd",
	];
	for (const r of rows) {
		const p = report.prices[r.model];
		const cost = p ? (Number(r.input ?? 0) * p.input + Number(r.output ?? 0) * p.output) / 1_000_000 : null;
		lines.push(
			[
				r.date,
				q(r.person),
				q(r.bot),
				q(r.model),
				r.purpose,
				Number(r.calls),
				Number(r.input ?? 0),
				Number(r.output ?? 0),
				Number(r.reasoning ?? 0),
				Number(r.cached ?? 0),
				cost === null ? "" : cost.toFixed(4),
			].join(","),
		);
	}
	return `${lines.join("\n")}\n`;
}
