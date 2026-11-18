import { AsyncLocalStorage } from "node:async_hooks";
import { type Access, type Permission, RoleLimits } from "@sekai/shared";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.ts";
import { HttpError } from "../lib/errors.ts";

/**
 * The person Sekai is acting for: the one signed in to a request, or whose bot is replying, whose routine runs,
 * whose Discord bot got a message. Every lookup of personal data (bots, chats, memory…) is limited to what this
 * person owns or was shared, and events go to them. No actor means Sekai's own work (startup, the scheduler's loop),
 * which sees everything: entry points switch to the right person with runAs() before touching anyone's data.
 */
export interface Actor extends Access {
	/** For fast checks. */
	can: ReadonlySet<Permission>;
}

const store = new AsyncLocalStorage<Actor | null>();

export function currentActor(): Actor | null {
	return store.getStore() ?? null;
}

/** Runs fn as this person (or, with null, as Sekai itself). */
export function runAs<T>(actor: Actor | null, fn: () => T): T {
	return store.run(actor, fn);
}

/** Runs fn as the person with this id (looked up, with their role). */
export async function runAsUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
	return runAs(await actorFor(userId), fn);
}

const cache = new Map<string, { actor: Actor; until: number }>();
const CACHE_MS = 15_000;

/** Forget cached roles (a role or someone's account changed). */
export function forgetActors(): void {
	cache.clear();
}

/** A person's access: their role's permissions and limits (admins: everything, no limits). */
export async function actorFor(userId: string): Promise<Actor> {
	const hit = cache.get(userId);
	if (hit && hit.until > Date.now()) return hit.actor;
	const [row] = await db
		.select({ user: schema.users, role: schema.roles })
		.from(schema.users)
		.innerJoin(schema.roles, eq(schema.roles.id, schema.users.roleId))
		.where(eq(schema.users.id, userId));
	if (!row) throw new HttpError(401, "Sign in to continue");
	// A turned-off account acts for no one: its sessions, routines and bots stop.
	if (row.user.disabledAt) throw new HttpError(403, "This account is turned off");
	const admin = row.role.builtin === "admin" || row.role.permissions.includes("admin");
	const permissions: Permission[] = admin ? (["admin"] as Permission[]) : row.role.permissions;
	const actor: Actor = {
		userId,
		roleId: row.role.id,
		roleName: row.role.name,
		admin,
		permissions,
		limits: admin ? RoleLimits.parse({}) : RoleLimits.parse(row.role.limits ?? {}),
		can: new Set(permissions),
	};
	if (cache.size > 500) cache.clear();
	cache.set(userId, { actor, until: Date.now() + CACHE_MS });
	return actor;
}

/** Whether the actor may use a feature (Sekai itself and admins: always). */
export function can(permission: Permission, actor = currentActor()): boolean {
	return !actor || actor.admin || actor.can.has(permission);
}

/** Throws a friendly 403 unless the actor may use the feature. */
export function requirePermission(permission: Permission, actor = currentActor()): void {
	if (can(permission, actor)) return;
	throw new HttpError(
		403,
		permission === "admin"
			? "Only admins can do that."
			: "Your role doesn't include this. Ask an admin if you need it.",
	);
}

/** The acting person's id; for code that must have one (throws for Sekai's own work, which shouldn't get here). */
export function requireActorId(): string {
	const a = currentActor();
	if (!a) throw new Error("No one to act for: wrap this in runAs()");
	return a.userId;
}

/** The person data is scoped to: the actor, or null (Sekai itself: everything). */
export function scopeUserId(): string | null {
	return currentActor()?.userId ?? null;
}
