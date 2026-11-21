import { describe, expect, test } from "bun:test";
import type { Permission } from "@sekai/shared";
import { ruleCatalog } from "../src/agent/tools/index.ts";
import { type Actor, runAs } from "../src/auth/actor.ts";

const actor = (admin: boolean, permissions: Permission[]): Actor =>
	({
		userId: "usr_me",
		roleId: "role_x",
		roleName: "Role",
		admin,
		permissions,
		limits: { maxBots: null, maxTokensPerDay: null, maxCostPerMonth: null, maxStorageMb: null, models: null },
		can: new Set(permissions),
	}) as unknown as Actor;

const rules = { global: {}, agent: {}, conversation: {}, mode: "manual" } as never;
const bot = { userId: "usr_me" };
const categories = (a: Actor) => new Set(runAs(a, () => ruleCatalog(bot, rules)).map((t) => t.category));

describe("the tools whose rules you can set", () => {
	test("a role without computers, code or accounts doesn't see them", () => {
		const member = categories(actor(false, ["bots", "web", "browser", "routines", "library", "voice"]));
		for (const gone of ["computer", "machines", "code", "x"]) expect(member.has(gone)).toBe(false);
		for (const kept of ["memory", "notes", "web", "browser", "routines", "library"])
			expect(member.has(kept)).toBe(true);
	});

	test("without web or routines those go too", () => {
		const guest = categories(actor(false, ["bots"]));
		expect(guest.has("web")).toBe(false);
		expect(guest.has("routines")).toBe(false);
		expect(guest.has("memory")).toBe(true);
	});

	test("admins see every kind", () => {
		const admin = categories(actor(true, ["admin"]));
		for (const all of ["computer", "machines", "code", "x", "web", "routines", "memory"])
			expect(admin.has(all)).toBe(true);
	});
});
