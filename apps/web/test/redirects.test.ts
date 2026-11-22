import { describe, expect, test } from "bun:test";
import { parentOf } from "../src/lib/back.ts";
import { ADMIN_TABS, currentPath, redirectFor } from "../src/lib/redirects.ts";
import { sectionFromPath } from "../src/settings/registry.tsx";

describe("old addresses", () => {
	test("every admin page goes to its Settings section (or Activity → Log)", () => {
		const cases: [string, string][] = [
			["/admin", "/settings/status"],
			["/admin/", "/settings/status"],
			["/admin/overview", "/settings/status"],
			["/admin/models", "/settings/models"],
			["/admin/subscriptions", "/settings/subscriptions"],
			["/admin/apps", "/settings/apps"],
			["/admin/voice", "/settings/voice"],
			["/admin/web", "/settings/web-reading"],
			["/admin/memory", "/settings/memory"],
			["/admin/compare", "/settings/models/compare"],
			["/admin/usage", "/settings/usage"],
			["/admin/approvals", "/settings/approvals"],
			["/admin/activity", "/activity?view=log"],
			["/admin/people", "/settings/people"],
			["/admin/roles", "/settings/roles"],
			["/admin/signin", "/settings/sign-in-options"],
			["/admin/computers", "/settings/computers"],
			["/admin/tailscale", "/settings/network"],
			["/admin/account", "/settings/sign-in-security"],
			["/admin/devices", "/settings/sign-in-security#sessions"],
			["/admin/backups", "/settings/backups"],
			["/admin/about", "/settings/about"],
			["/admin/mobile", "/settings/network/notifications"],
			["/admin/no-such-page", "/settings/status"],
			["/admin/models/", "/settings/models"],
		];
		for (const [from, to] of cases) expect(redirectFor(from)).toBe(to);
		// The table and the cases agree: every tab is covered above.
		for (const tab of Object.keys(ADMIN_TABS)) expect(cases.some(([from]) => from === `/admin/${tab}`)).toBe(true);
	});

	test("every target is a real Settings section", () => {
		for (const target of Object.values(ADMIN_TABS)) {
			if (!target.startsWith("/settings/")) continue;
			expect(sectionFromPath(target.split("#")[0] ?? "")).not.toBeNull();
		}
	});

	test("the server's back-from-sign-in addresses keep their query", () => {
		expect(redirectFor("/admin/voice", "?q=calls")).toBe("/settings/voice?q=calls");
		expect(redirectFor("/admin/apps", "?tab=mcp&signin_error=Nope")).toBe(
			"/settings/apps?tab=mcp&signin_error=Nope",
		);
		expect(redirectFor("/admin/apps", "?tab=skills")).toBe("/settings/apps?tab=skills");
		expect(redirectFor("/admin/account", "?sso_linked=1")).toBe("/settings/sign-in-security?sso_linked=1");
		expect(redirectFor("/admin/activity", "?q=note")).toBe("/activity?view=log&q=note");
	});

	test("/apps went to the admin app's Apps & skills and Subscriptions", () => {
		expect(redirectFor("/apps")).toBe("/settings/apps");
		expect(redirectFor("/apps", "?tab=mcp")).toBe("/settings/apps");
		expect(redirectFor("/apps", "?tab=subscriptions")).toBe("/settings/subscriptions");
	});

	test("Settings tabs became sections", () => {
		expect(redirectFor("/settings", "?tab=profile")).toBe("/settings/profile");
		expect(redirectFor("/settings", "?tab=appearance")).toBe("/settings/appearance");
		expect(redirectFor("/settings", "?tab=notifications")).toBe("/settings/notifications");
		expect(redirectFor("/settings", "?tab=browser")).toBe("/settings/browser-extension");
		expect(redirectFor("/settings", "?tab=computer")).toBe("/settings/this-computer");
		expect(redirectFor("/settings", "?tab=nonsense")).toBe("/settings");
		// The desktop app's tray.
		expect(redirectFor("/settings", "", "#this-computer")).toBe("/settings/this-computer");
	});

	test("current addresses stay", () => {
		for (const path of [
			"/",
			"/c/cnv_1",
			"/inbox",
			"/activity",
			"/library",
			"/settings",
			"/settings/models",
			"/bots/agt_1/profile",
			"/bot/agt_1",
			"/welcome",
			"/welcome/invite/abcdefghijklmnopqrstuvwxyz",
		]) {
			expect(redirectFor(path)).toBeNull();
		}
	});

	test("paths from notifications and the tray go where they live now", () => {
		expect(currentPath("/settings?tab=notifications")).toBe("/settings/notifications");
		expect(currentPath("/admin")).toBe("/settings/status");
		expect(currentPath("/c/cnv_1?m=msg_2")).toBe("/c/cnv_1?m=msg_2");
		expect(currentPath("/inbox")).toBe("/inbox");
	});
});

describe("the screen under each screen on phones", () => {
	test("tab-bar screens have none", () => {
		for (const p of ["/", "/inbox", "/activity", "/library", "/welcome"]) expect(parentOf(p)).toBeNull();
	});
	test("a chat sits over Chats, a setting over Settings, a bot's section over the bot", () => {
		expect(parentOf("/c/cnv_1")).toBe("/");
		expect(parentOf("/settings")).toBe("/");
		expect(parentOf("/settings/notifications")).toBe("/settings");
		expect(parentOf("/settings/models/compare")).toBe("/settings/models");
		expect(parentOf("/bots/agt_1")).toBe("/");
		expect(parentOf("/bots/agt_1/memory")).toBe("/bots/agt_1");
		expect(parentOf("/bots/agt_1/accounts/x")).toBe("/bots/agt_1/accounts");
	});
});
