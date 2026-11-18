import type { Permission } from "@sekai/shared";
import type { Context, MiddlewareHandler } from "hono";
import type { ZodType } from "zod";
import { requirePermission } from "../auth/actor.ts";
import { badRequest, parse } from "../lib/errors.ts";

export async function readJson(c: Context): Promise<unknown> {
	const text = await c.req.text();
	if (!text.trim()) return {};
	try {
		return JSON.parse(text) as unknown;
	} catch {
		throw badRequest("Body must be valid JSON");
	}
}

export async function body<T>(c: Context, schema: ZodType<T>): Promise<T> {
	return parse(schema, await readJson(c));
}

export function queryBool(value: string | undefined): boolean | undefined {
	if (value === undefined) return undefined;
	return value === "1" || value === "true";
}

export function queryInt(value: string | undefined, fallback?: number): number | undefined {
	if (value === undefined || value === "") return fallback;
	const n = Number(value);
	return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

export const ok = { ok: true } as const;

/** Only admins (server setup: models, subscriptions, devices, backups…). */
export const adminOnly: MiddlewareHandler = async (_c, next) => {
	requirePermission("admin");
	return next();
};

/** Only people whose role includes a feature. */
export function needs(permission: Permission): MiddlewareHandler {
	return async (_c, next) => {
		requirePermission(permission);
		return next();
	};
}

/** Routes about one bot (by the :agentId parameter): its owner only (someone it's shared with gets "not found"). */
export function ownBotParam(param = "agentId"): MiddlewareHandler {
	return async (c, next) => {
		const { requireOwnedAgent } = await import("../services/agents.ts");
		await requireOwnedAgent(c.req.param(param) ?? "");
		return next();
	};
}

/** Changes need the feature; looking (GET) doesn't (the app shows what's there, greyed out). */
export function changesNeed(permission: Permission): MiddlewareHandler {
	return async (c, next) => {
		if (c.req.method !== "GET" && c.req.method !== "HEAD") requirePermission(permission);
		return next();
	};
}
