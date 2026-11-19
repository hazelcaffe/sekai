import { describe, expect, spyOn, test } from "bun:test";
import { ExtensionAction, extensionWebUrl, isExtensionOrigin } from "@sekai/shared";
import { extensionManifest } from "../../extension/manifests.ts";
import { denyReason } from "../src/auth/index.ts";
import { EXTENSION_LEASE_MS, ExtensionBroker } from "../src/browser/extension.ts";

const input = { agentId: "agent", conversationId: "chat", name: "Firefox" };

describe("browser extension protocol", () => {
	test("builds no always-on host access or remotely callable extension channel", () => {
		for (const target of ["chromium", "firefox", "safari"] as const) {
			const manifest = extensionManifest(target);
			expect(manifest).not.toHaveProperty("host_permissions");
			expect(manifest).not.toHaveProperty("content_scripts");
			expect(manifest).not.toHaveProperty("externally_connectable");
			expect(manifest.permissions).not.toContain("debugger");
			expect(manifest.permissions).not.toContain("cookies");
		}
	});
	test("rejects arbitrary execution, privileged URLs and ambiguous targets", () => {
		expect(ExtensionAction.safeParse({ action: "evaluate", code: "document.cookie" }).success).toBe(false);
		expect(ExtensionAction.safeParse({ action: "snapshot" }).success).toBe(false);
		expect(ExtensionAction.safeParse({ action: "click", tabId: 1, ref: "button" }).success).toBe(false);
		expect(ExtensionAction.safeParse({ action: "click", tabId: 1, pageId: "doc", ref: "e1" }).success).toBe(true);
		for (const url of [
			"file:///etc/passwd",
			"javascript:alert(1)",
			"chrome://settings",
			"https://user:pass@example.com",
			"data:text/html,x",
		])
			expect(() => extensionWebUrl(url)).toThrow();
		expect(extensionWebUrl("https://example.com/path").hostname).toBe("example.com");
	});

	test("recognizes extension origins, not lookalike websites", () => {
		expect(isExtensionOrigin(`chrome-extension://${"a".repeat(32)}`)).toBe(true);
		expect(isExtensionOrigin("moz-extension://01234567-89ab-cdef-0123-456789abcdef")).toBe(true);
		expect(isExtensionOrigin("safari-web-extension://ABCD-1234")).toBe(true);
		for (const url of [
			"null",
			"https://chrome-extension.example",
			`chrome-extension://${"a".repeat(32)}/path`,
			"chrome-extension://bad",
		])
			expect(isExtensionOrigin(url)).toBe(false);
	});

	test("extension tokens cannot mint tokens, use other APIs or open sockets", () => {
		const p = { kind: "token", userId: "user", tokenId: "token", scope: "extension" } as const;
		const request = (path: string) => new Request(`http://sekai${path}`);
		expect(denyReason(p, request("/api/extension/agents"))).toBeNull();
		for (const path of [
			"/api/auth/tokens",
			"/api/settings",
			"/api/extension/token",
			"/api/extension/token?x=1",
			"/api/extensionish/agents",
			"/api/extension/../auth/tokens",
		])
			expect(denyReason(p, request(path))).not.toBeNull();
		expect(denyReason(p, request("/api/extension/agents"), { websocket: true })).not.toBeNull();
	});
});

describe("browser extension grants", () => {
	test("scopes discovery, commands, polls and results by person, bot, chat and token", async () => {
		const broker = new ExtensionBroker();
		const session = broker.connect("alice", "token1", input);
		expect(broker.list("bob")).toEqual([]);
		expect(broker.list("alice", "other")).toEqual([]);
		expect(broker.list("alice", "agent", "elsewhere")).toEqual([]);
		const signal = new AbortController().signal;
		for (const [user, agent, chat] of [
			["bob", "agent", "chat"],
			["alice", "other", "chat"],
			["alice", "agent", "elsewhere"],
		]) {
			await expect(
				broker.command(user ?? "", agent ?? "", chat ?? "", session.id, { action: "tabs" }, signal),
			).rejects.toThrow("No browser");
		}
		expect(() => broker.poll("bob", "token1", session.id)).toThrow();
		expect(() => broker.poll("alice", "token2", session.id)).toThrow();
		const result = broker.command("alice", "agent", "chat", session.id, { action: "tabs" }, signal);
		const command = broker.poll("alice", "token1", session.id);
		expect(command?.input).toEqual({ action: "tabs" });
		expect(broker.claim("alice", "token1", session.id, command?.id ?? "")).toBe(true);
		expect(broker.claim("alice", "token1", session.id, command?.id ?? "")).toBe(false);
		expect(broker.poll("alice", "token1", session.id)).toBeNull();
		expect(broker.complete("alice", "token1", session.id, { commandId: "wrong", result: "no" })).toBe(false);
		expect(() => broker.complete("bob", "token1", session.id, { commandId: command?.id ?? "" })).toThrow();
		expect(
			broker.complete("alice", "token1", session.id, { commandId: command?.id ?? "", image: "unexpected" }),
		).toBe(false);
		expect(broker.complete("alice", "token1", session.id, { commandId: command?.id ?? "", result: "[]" })).toBe(
			true,
		);
		expect((await result).result).toBe("[]");
		expect(broker.claim("alice", "token1", session.id, command?.id ?? "")).toBe(false);
		expect(broker.complete("alice", "token1", session.id, { commandId: command?.id ?? "" })).toBe(false);
	});

	test("stopping, cancellation and expiry release commands; nothing is replayed", async () => {
		const broker = new ExtensionBroker();
		const session = broker.connect("alice", "token", input);
		const controller = new AbortController();
		const result = broker.command("alice", "agent", "chat", session.id, { action: "tabs" }, controller.signal);
		const rejected = result.catch((err: Error) => err.message);
		controller.abort();
		expect(await rejected).toContain("cancelled");
		expect(broker.poll("alice", "token", session.id)).toBeNull();
		const next = broker.command(
			"alice",
			"agent",
			"chat",
			session.id,
			{ action: "tabs" },
			new AbortController().signal,
		);
		const stopped = next.catch((err: Error) => err.message);
		broker.disconnect("alice", "token", session.id);
		expect(await stopped).toContain("stopped");
		expect(broker.list("alice")).toEqual([]);
		broker.connect("alice", "token", input);
		const now = Date.now();
		const clock = spyOn(Date, "now").mockReturnValue(now + EXTENSION_LEASE_MS + 1);
		try {
			expect(broker.list("alice")).toEqual([]);
		} finally {
			clock.mockRestore();
		}
	});
});
