import type { ApprovalMode, ToolRules } from "@sekai/shared";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.ts";

/**
 * Each person's own settings: their time zone, approval mode and tool rules, and smaller things by name in data
 * (their morning digest, memory check-ups, push subscriptions). Their name is their account's.
 */

export interface Prefs {
	userId: string;
	name: string;
	timezone: string;
	approvalMode: ApprovalMode | null;
	toolRules: ToolRules;
	data: Record<string, unknown>;
}

const cache = new Map<string, Prefs>();

export function forgetPrefs(userId?: string): void {
	if (userId) cache.delete(userId);
	else cache.clear();
}

export async function getPrefs(userId: string): Promise<Prefs> {
	const hit = cache.get(userId);
	if (hit) return hit;
	const [row] = await db
		.select({ name: schema.users.name, p: schema.userPrefs })
		.from(schema.users)
		.leftJoin(schema.userPrefs, eq(schema.userPrefs.userId, schema.users.id))
		.where(eq(schema.users.id, userId));
	const prefs: Prefs = {
		userId,
		name: row?.name ?? "",
		timezone: row?.p?.timezone ?? "auto",
		approvalMode: row?.p?.approvalMode ?? null,
		toolRules: (row?.p?.toolRules as ToolRules | undefined) ?? {},
		data: row?.p?.data ?? {},
	};
	if (cache.size > 2000) cache.clear();
	cache.set(userId, prefs);
	return prefs;
}

export async function updatePrefs(
	userId: string,
	patch: Partial<Pick<Prefs, "timezone" | "approvalMode" | "toolRules">>,
): Promise<Prefs> {
	const current = await getPrefs(userId);
	const next = {
		timezone: patch.timezone ?? current.timezone,
		approvalMode: patch.approvalMode === undefined ? current.approvalMode : patch.approvalMode,
		toolRules: patch.toolRules ?? current.toolRules,
	};
	await db
		.insert(schema.userPrefs)
		.values({ userId, ...next, data: current.data, updatedAt: Date.now() })
		.onConflictDoUpdate({ target: schema.userPrefs.userId, set: { ...next, updatedAt: Date.now() } });
	forgetPrefs(userId);
	return getPrefs(userId);
}

/** A personal setting kept by name (digest, check-ups, push…). */
export async function readPref<T>(userId: string, key: string): Promise<T | undefined> {
	return (await getPrefs(userId)).data[key] as T | undefined;
}

export async function writePref(userId: string, key: string, value: unknown): Promise<void> {
	const current = await getPrefs(userId);
	const data = { ...current.data };
	if (value === undefined) delete data[key];
	else data[key] = value;
	await db
		.insert(schema.userPrefs)
		.values({
			userId,
			timezone: current.timezone,
			approvalMode: current.approvalMode,
			toolRules: current.toolRules,
			data,
			updatedAt: Date.now(),
		})
		.onConflictDoUpdate({ target: schema.userPrefs.userId, set: { data, updatedAt: Date.now() } });
	forgetPrefs(userId);
}

/** Everyone's value for one personal setting (the digest scheduler, push fan-out). */
export async function allPrefs<T>(key: string): Promise<{ userId: string; value: T }[]> {
	const rows = await db
		.select({ userId: schema.userPrefs.userId, data: schema.userPrefs.data, disabledAt: schema.users.disabledAt })
		.from(schema.userPrefs)
		.innerJoin(schema.users, eq(schema.users.id, schema.userPrefs.userId));
	return rows
		.filter((r) => !r.disabledAt && r.data[key] !== undefined)
		.map((r) => ({ userId: r.userId, value: r.data[key] as T }));
}
