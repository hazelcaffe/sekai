import {
	type Permission,
	type Role,
	RoleInput,
	type RoleInput as RoleInputT,
	RoleLimits,
	RoleUpdate,
	type RoleUpdate as RoleUpdateT,
} from "@sekai/shared";
import { and, asc, count, eq, isNull } from "drizzle-orm";
import { db, schema } from "../db/index.ts";
import { bus } from "../events/bus.ts";
import { badRequest, notFound, parse } from "../lib/errors.ts";
import { newId } from "../lib/ids.ts";
import { forgetCachedPrincipals, MEMBER_ROLE } from "./service.ts";

type RoleRow = typeof schema.roles.$inferSelect;

function toRole(r: RoleRow, users: number): Role {
	return {
		id: r.id,
		name: r.name,
		description: r.description,
		builtin: r.builtin,
		permissions: r.builtin === "admin" ? ["admin"] : (r.permissions.filter((p) => p !== "admin") as Permission[]),
		limits: RoleLimits.parse(r.limits ?? {}),
		requireMfa: r.requireMfa,
		users,
		createdAt: r.createdAt,
		updatedAt: r.updatedAt,
	};
}

const changed = () => {
	forgetCachedPrincipals();
	bus.emit({ type: "settings.changed" }, { to: "everyone" });
};

export async function listRoles(): Promise<Role[]> {
	const rows = await db.select().from(schema.roles).orderBy(asc(schema.roles.createdAt));
	const counts = await db
		.select({ roleId: schema.users.roleId, n: count() })
		.from(schema.users)
		.groupBy(schema.users.roleId);
	const by = new Map(counts.map((c) => [c.roleId, Number(c.n)]));
	// Admin first, then Member, then the rest by age.
	const rank = (r: RoleRow) => (r.builtin === "admin" ? 0 : r.builtin === "member" ? 1 : 2);
	return rows.sort((a, b) => rank(a) - rank(b)).map((r) => toRole(r, by.get(r.id) ?? 0));
}

export async function getRole(id: string): Promise<Role> {
	const role = (await listRoles()).find((r) => r.id === id);
	if (!role) throw notFound("Role");
	return role;
}

/** Only the built-in Admin role is "admin": custom roles get features, never the keys to the server. */
function cleanPermissions(perms: Permission[]): Permission[] {
	return [...new Set(perms.filter((p) => p !== "admin"))];
}

export async function createRole(input: RoleInputT): Promise<Role> {
	const data = parse(RoleInput, input);
	const now = Date.now();
	const row: RoleRow = {
		id: newId("role", 12),
		name: data.name,
		description: data.description,
		builtin: null,
		permissions: cleanPermissions(data.permissions),
		limits: data.limits,
		requireMfa: data.requireMfa,
		createdAt: now,
		updatedAt: now,
	};
	await db.insert(schema.roles).values(row);
	changed();
	return toRole(row, 0);
}

export async function updateRole(id: string, input: RoleUpdateT): Promise<Role> {
	const patch = parse(RoleUpdate, input);
	const [current] = await db.select().from(schema.roles).where(eq(schema.roles.id, id));
	if (!current) throw notFound("Role");
	const set: Partial<RoleRow> = { updatedAt: Date.now() };
	if (patch.name !== undefined) set.name = patch.name;
	if (patch.description !== undefined) set.description = patch.description;
	if (patch.requireMfa !== undefined) set.requireMfa = patch.requireMfa;
	// The Admin role always has everything and no limits.
	if (current.builtin !== "admin") {
		if (patch.permissions !== undefined) set.permissions = cleanPermissions(patch.permissions);
		if (patch.limits !== undefined) set.limits = patch.limits;
	}
	await db.update(schema.roles).set(set).where(eq(schema.roles.id, id));
	changed();
	return getRole(id);
}

/** Deletes a role; its people move to Member. The built-in ones stay. */
export async function deleteRole(id: string): Promise<void> {
	const [current] = await db.select().from(schema.roles).where(eq(schema.roles.id, id));
	if (!current) throw notFound("Role");
	if (current.builtin) throw badRequest(`${current.name} comes with Sekai and can't be deleted.`);
	await db
		.update(schema.users)
		.set({ roleId: MEMBER_ROLE, updatedAt: Date.now() })
		.where(eq(schema.users.roleId, id));
	await db.delete(schema.roles).where(eq(schema.roles.id, id));
	changed();
}

/** Active admins, not counting one account (to check a change wouldn't leave none). */
export async function activeAdminsExcept(userId: string | null): Promise<number> {
	const rows = await db
		.select({ id: schema.users.id })
		.from(schema.users)
		.innerJoin(schema.roles, eq(schema.roles.id, schema.users.roleId))
		.where(and(eq(schema.roles.builtin, "admin"), isNull(schema.users.disabledAt)));
	return rows.filter((r) => r.id !== userId).length;
}

export async function isAdminRole(roleId: string): Promise<boolean> {
	const [r] = await db
		.select({ builtin: schema.roles.builtin })
		.from(schema.roles)
		.where(eq(schema.roles.id, roleId));
	return r?.builtin === "admin";
}
