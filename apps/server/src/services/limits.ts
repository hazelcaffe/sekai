import { isByosModel } from "@sekai/shared";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { type Actor, can, currentActor } from "../auth/actor.ts";
import { db, schema } from "../db/index.ts";
import { HttpError } from "../lib/errors.ts";
import { effectiveTimezone } from "./settings.ts";
import { modelPrices } from "./usage.ts";

/**
 * What a role's limits allow: which models, how many tokens a day and a month, how much money a month, and how
 * much storage. Admins and Sekai itself have none.
 */

export interface Spent {
	tokensToday: number;
	tokensMonth: number;
	/** null: none of the models used have a price. */
	costMonth: number | null;
}

/** Tokens and cost so far today and this month, in the person's time zone. */
export async function spentBy(userId: string): Promise<Spent> {
	const tz = await effectiveTimezone();
	const rows = (await db.execute(sql`
		select model,
			sum(input_tokens + output_tokens) filter (where to_timestamp(at / 1000.0) at time zone ${tz} >= date_trunc('day', now() at time zone ${tz})) as today,
			sum(input_tokens + output_tokens) as month,
			sum(input_tokens) as input,
			sum(output_tokens) as output
		from usage_log
		where user_id = ${userId}
			and to_timestamp(at / 1000.0) at time zone ${tz} >= date_trunc('month', now() at time zone ${tz})
		group by model`)) as unknown as {
		model: string;
		today: string | number | null;
		month: string | number | null;
		input: string | number | null;
		output: string | number | null;
	}[];
	const prices = await modelPrices();
	let cost: number | null = null;
	let today = 0;
	let month = 0;
	for (const r of rows) {
		today += Number(r.today ?? 0);
		month += Number(r.month ?? 0);
		const p = prices[r.model];
		if (p) cost = (cost ?? 0) + (Number(r.input ?? 0) * p.input + Number(r.output ?? 0) * p.output) / 1_000_000;
	}
	return { tokensToday: today, tokensMonth: month, costMonth: cost };
}

const fmt = (n: number) => new Intl.NumberFormat("en-US", { notation: "compact" }).format(n);

/** Throws a friendly error when the person has used up what their role allows. */
export async function checkUsageLimits(actor: Actor | null = currentActor()): Promise<void> {
	if (!actor || actor.admin) return;
	const l = actor.limits;
	if (l.tokensPerDay === null && l.tokensPerMonth === null && l.costPerMonth === null) return;
	const s = await spentBy(actor.userId);
	if (l.tokensPerDay !== null && s.tokensToday >= l.tokensPerDay) {
		throw new HttpError(
			429,
			`You've used today's ${fmt(l.tokensPerDay)} tokens. Your bots can answer again tomorrow.`,
			{
				code: "limit_reached",
			},
		);
	}
	if (l.tokensPerMonth !== null && s.tokensMonth >= l.tokensPerMonth) {
		throw new HttpError(429, `You've used this month's ${fmt(l.tokensPerMonth)} tokens. Ask an admin for more.`, {
			code: "limit_reached",
		});
	}
	if (l.costPerMonth !== null && (s.costMonth ?? 0) >= l.costPerMonth) {
		throw new HttpError(429, `You've reached this month's $${l.costPerMonth} limit. Ask an admin for more.`, {
			code: "limit_reached",
		});
	}
}

/** Whether the person may use a model: their role's list (if it has one), and subscriptions only with permission. */
export function modelAllowed(model: string, actor: Actor | null = currentActor()): boolean {
	if (!actor || actor.admin) return true;
	if (isByosModel(model) && !can("subscriptions", actor)) return false;
	const list = actor.limits.models;
	if (!list) return true;
	return list.includes(model) || (isByosModel(model) && can("subscriptions", actor));
}

export function requireModelAllowed(model: string, actor: Actor | null = currentActor()): void {
	if (modelAllowed(model, actor)) return;
	throw new HttpError(403, `Your role doesn't include ${model}. Pick another model, or ask an admin.`, {
		code: "model_not_allowed",
	});
}

/** Megabytes of uploads and library documents someone keeps. */
export async function storageUsedBytes(userId: string): Promise<number> {
	const [row] = await db
		.select({ n: sql<string>`coalesce(sum(${schema.uploads.size}), 0)` })
		.from(schema.uploads)
		.where(and(isNotNull(schema.uploads.userId), eq(schema.uploads.userId, userId)));
	return Number(row?.n ?? 0);
}

/** Throws when adding this many bytes would go over the role's storage. */
export async function checkStorage(addBytes: number, actor: Actor | null = currentActor()): Promise<void> {
	if (!actor || actor.admin || actor.limits.storageMb === null) return;
	const used = await storageUsedBytes(actor.userId);
	if (used + addBytes > actor.limits.storageMb * 1024 * 1024) {
		throw new HttpError(
			413,
			`That's over your ${actor.limits.storageMb} MB of storage. Delete some files or documents, or ask an admin for more.`,
			{ code: "limit_reached" },
		);
	}
}
