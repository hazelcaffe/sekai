import { describe, expect, test } from "bun:test";
import type { Access, Permission } from "@sekai/shared";
import { botSectionsFor } from "../src/bots/registry.tsx";
import { allows, can, type Viewer } from "../src/lib/access.ts";
import {
	canEditSection,
	canOpenSection,
	homeSection,
	listedSections,
	SETTINGS_SECTIONS,
	searchSections,
	sectionBack,
	sectionFromPath,
	sectionPath,
	settingsSection,
} from "../src/settings/registry.tsx";

const access = (admin: boolean, permissions: Permission[]): Access => ({
	userId: "usr_1",
	roleId: admin ? "role_admin" : "role_member",
	roleName: admin ? "Admin" : "Member",
	admin,
	permissions,
	limits: {
		models: null,
		maxBots: null,
		tokensPerDay: null,
		tokensPerMonth: null,
		costPerMonth: null,
		storageMb: null,
	},
});

/** The built-in Member role's features (drizzle/0015_multi_user.sql). */
const MEMBER: Permission[] = ["bots", "web", "browser", "routines", "library", "voice", "compare"];

const admin: Viewer = { access: access(true, ["admin"]), session: true };
const member: Viewer = { access: access(false, MEMBER), session: true };
const nobody: Viewer = { access: access(false, []), session: true };
const ids = (v: Viewer) => listedSections(v).map((s) => s.id);

describe("who may do what", () => {
	test("admins may do everything; others what their role has", () => {
		expect(can(admin.access, "computers")).toBe(true);
		expect(can(member.access, "browser")).toBe(true);
		expect(can(member.access, "apps")).toBe(false);
		expect(can(null, "bots")).toBe(false);
		expect(allows("everyone", null)).toBe(true);
		expect(allows("admin", member.access)).toBe(false);
		expect(allows(["apps", "compare"], member.access)).toBe(true);
	});
});

describe("Settings sections", () => {
	test("admins see every section (sub-pages are reached from their parent)", () => {
		expect(ids(admin)).toEqual([
			"profile",
			"sign-in-security",
			"appearance",
			"notifications",
			"browser-extension",
			"get-apps",
			"sign-out",
			"approvals",
			"models",
			"subscriptions",
			"apps",
			"voice",
			"web-reading",
			"memory",
			"usage",
			"people",
			"roles",
			"sign-in-options",
			"status",
			"computers",
			"network",
			"backups",
			"about",
		]);
		expect(canOpenSection(settingsSection("compare") ?? SETTINGS_SECTIONS[0], admin)).toBe(true);
	});

	test("a member sees their own sections, Compare models on its own, and nothing that's the server's", () => {
		expect(ids(member)).toEqual([
			"profile",
			"sign-in-security",
			"appearance",
			"notifications",
			"browser-extension",
			"get-apps",
			"sign-out",
			"approvals",
			"compare",
			"usage",
			"about",
		]);
	});

	test("someone whose role has no features sees only their own things", () => {
		expect(ids(nobody)).toEqual([
			"profile",
			"sign-in-security",
			"appearance",
			"notifications",
			"get-apps",
			"sign-out",
			"approvals",
			"usage",
			"about",
		]);
	});

	test("a role's feature opens its section; some open read only", () => {
		const subs: Viewer = { access: access(false, ["subscriptions", "apps"]) };
		const subscriptions = settingsSection("subscriptions");
		expect(subscriptions && canOpenSection(subscriptions, subs)).toBe(true);
		expect(subscriptions && canEditSection(subscriptions, subs)).toBe(false);
		expect(subscriptions && canEditSection(subscriptions, admin)).toBe(true);
		expect(ids(subs)).toContain("apps");
	});

	test("the desktop app and the phone apps add their own sections", () => {
		expect(ids({ ...member, desktopApp: true })).toContain("this-computer");
		expect(ids({ ...member, phoneApp: true })).toContain("phone-server");
		expect(ids(member)).not.toContain("this-computer");
		// Signed in with a token (not a session): no Sign out.
		expect(ids({ access: member.access })).not.toContain("sign-out");
	});

	test("Status is the admins' home; everyone else's is Profile", () => {
		expect(homeSection(admin).id).toBe("status");
		expect(homeSection(member).id).toBe("profile");
	});

	test("addresses and sections match", () => {
		expect(sectionFromPath("/settings")).toBeNull();
		expect(sectionFromPath("/settings/models")?.section.id).toBe("models");
		expect(sectionFromPath("/settings/models/compare")?.section.id).toBe("compare");
		expect(sectionFromPath("/settings/people/usr_1")).toMatchObject({ rest: "usr_1" });
		expect(sectionFromPath("/settings/compare")).toBeNull();
		expect(sectionFromPath("/settings/sign-out")).toBeNull();
		expect(sectionFromPath("/settings/get-apps")).toBeNull();
		expect(sectionFromPath("/settings/nope")).toBeNull();
		expect(sectionPath("compare")).toBe("/settings/models/compare");
		for (const s of SETTINGS_SECTIONS) {
			if (s.action) continue;
			expect(s.component).toBeDefined();
			expect(sectionFromPath(sectionPath(s.id))?.section.id).toBe(s.id);
		}
	});

	test("search finds sections by name and by what's in them, only ones you may open", () => {
		expect(searchSections("tailnet", admin).map((s) => s.id)).toContain("network");
		expect(searchSections("gateway", admin)[0]?.id).toBe("models");
		expect(searchSections("tailnet", member)).toEqual([]);
		expect(searchSections("pass", member).map((s) => s.id)).toContain("sign-in-security");
	});
});

describe("back from a section", () => {
	const back = (id: string, v: Viewer) => {
		const section = settingsSection(id);
		if (!section) throw new Error(`No section ${id}`);
		return sectionBack(section, v);
	};
	test("a section's own page goes back to Settings, on phones only (the rail is the way back from tablets up)", () => {
		expect(back("profile", member)).toEqual({ label: "Settings", to: "/settings", phoneOnly: true });
		expect(back("status", admin)).toEqual({ label: "Settings", to: "/settings", phoneOnly: true });
	});
	test("a page inside another section goes back to it everywhere, when that's where it's reached from", () => {
		expect(back("compare", admin)).toEqual({ label: "Models", to: "/settings/models", phoneOnly: false });
		// A member can't open Models: Compare models is a section of its own for them.
		expect(back("compare", member)).toEqual({ label: "Settings", to: "/settings", phoneOnly: true });
	});
});

describe("a bot's sections", () => {
	test("its owner sees all of them; someone it's shared with sees their part", () => {
		expect(botSectionsFor({ sharedBy: null }).map((s) => s.id)).toEqual([
			"profile",
			"model",
			"memory",
			"tools",
			"accounts",
			"routines",
			"computer",
		]);
		expect(botSectionsFor({ sharedBy: "Hazel" }).map((s) => s.id)).toEqual(["profile", "memory", "routines"]);
	});
});
