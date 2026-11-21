import { describe, expect, test } from "bun:test";
import type { Access } from "@sekai/shared";
import type { Viewer } from "../src/lib/access.ts";
import { MESSAGE_SCORE, matchScore, ranked } from "../src/lib/search.ts";
import { scoredSections } from "../src/settings/registry.tsx";

const access: Access = {
	userId: "usr_1",
	roleId: "role_admin",
	roleName: "Admin",
	admin: true,
	permissions: ["admin"],
	limits: {
		models: null,
		maxBots: null,
		tokensPerDay: null,
		tokensPerMonth: null,
		costPerMonth: null,
		storageMb: null,
	},
};
const admin: Viewer = { access, session: true };

const bots = [
	{ name: "Pico", label: "Prototype engineer" },
	{ name: "Moss", label: "Research librarian" },
	{ name: "Lumen", label: "Editorial partner" },
	{ name: "Kite", label: "Operations & logistics" },
	{ name: "Sable", label: "Personal planning" },
	{ name: "Nori", label: "Studio coordinator" },
];

describe("search (⌘K)", () => {
	test("exact and starting title matches come first, fuzzy letters last", () => {
		expect(matchScore("people", "People")).toBe(100);
		expect(matchScore("appr", "Approvals")).toBe(80);
		expect(matchScore("out", "Sign out")).toBe(60);
		expect(matchScore("scale", "Tailscale")).toBe(40);
		expect(matchScore("tailnet", "Network & devices", "tailscale tailnet devices")).toBe(30);
		expect(matchScore("nwk", "Network & devices")).toBe(5);
		expect(matchScore("zzz", "Network & devices")).toBe(0);
		// A message the server found sits below any title match.
		expect(matchScore("appr", "Approvals")).toBeGreaterThan(MESSAGE_SCORE);
	});

	test("bots don't match letters they merely contain somewhere", () => {
		expect(ranked("appr", bots, (b) => [b.name, b.label])).toEqual([]);
		expect(ranked("mo", bots, (b) => [b.name, b.label]).map((x) => x.item.name)).toEqual(["Moss"]);
		expect(ranked("research", bots, (b) => [b.name, b.label])[0]?.item.name).toBe("Moss");
	});

	test("Settings sections by name first", () => {
		expect(scoredSections("appr", admin)[0]?.item.id).toBe("approvals");
		expect(scoredSections("people", admin)[0]?.item.id).toBe("people");
		expect(scoredSections("sign out", admin)[0]?.item.id).toBe("sign-out");
		expect(scoredSections("usage", admin)[0]?.item.id).toBe("usage");
		expect(scoredSections("tailscale", admin)[0]?.item.id).toBe("network");
	});
});
