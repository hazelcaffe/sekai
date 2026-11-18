import { describe, expect, test } from "bun:test";
import { gateFor, matchRule, type RuleSets } from "../src/agent/permissions.ts";

const none: RuleSets = { conversation: {}, agent: {}, global: {} };
const read = { name: "memory_search", category: "memory", risk: "read" as const };
const write = { name: "note_write", category: "notes", risk: "write" as const };
const external = { name: "agent_message", category: "agents", risk: "external" as const };
const destructive = { name: "note_delete", category: "notes", risk: "destructive" as const };

describe("approval modes", () => {
	test("read-only blocks everything that changes something", () => {
		expect(gateFor(read, "readonly", none).action).toBe("run");
		expect(gateFor(write, "readonly", none).action).toBe("deny");
		expect(gateFor(external, "readonly", none).action).toBe("deny");
	});

	test("ask-every-time asks for anything beyond reads", () => {
		expect(gateFor(read, "manual", none).action).toBe("run");
		expect(gateFor(write, "manual", none).action).toBe("ask");
		expect(gateFor(destructive, "manual", none).action).toBe("ask");
	});

	test("auto runs workspace changes and sends risky calls to the reviewer", () => {
		expect(gateFor(write, "auto", none).action).toBe("run");
		expect(gateFor(external, "auto", none).action).toBe("review");
		expect(gateFor(destructive, "auto", none).action).toBe("review");
	});

	test("yolo runs everything", () => {
		expect(gateFor(destructive, "yolo", none).action).toBe("run");
	});
});

describe("rules", () => {
	test("an explicit ask still asks in yolo", () => {
		const rules = { ...none, agent: { agent_message: "ask" as const } };
		expect(gateFor(external, "yolo", rules).action).toBe("ask");
	});

	test("an explicit allow skips the reviewer", () => {
		const rules = { ...none, global: { "category:agents": "allow" as const } };
		expect(gateFor(external, "auto", rules).action).toBe("run");
	});

	test("a request that always asks (root on a device) asks even with an allow rule, in yolo", () => {
		const rootAsk = {
			name: "host_request_access",
			category: "machines",
			risk: "external" as const,
			askFirst: "root",
		};
		for (const rules of [
			{ ...none, agent: { host_request_access: "allow" as const } },
			{ ...none, global: { "category:machines": "allow" as const } },
		]) {
			const gate = gateFor(rootAsk, "yolo", rules);
			expect(gate.action).toBe("ask");
			expect(gate.action === "ask" && gate.alwaysAsk).toBe(true);
		}
		// Blocking still wins.
		expect(gateFor(rootAsk, "yolo", { ...none, agent: { host_request_access: "off" as const } }).action).toBe(
			"deny",
		);
	});

	test("read-only beats an allow rule", () => {
		const rules = { ...none, agent: { note_write: "allow" as const } };
		expect(gateFor(write, "readonly", rules).action).toBe("deny");
	});

	test("off blocks", () => {
		const rules = { ...none, conversation: { note_delete: "off" as const } };
		expect(gateFor(destructive, "yolo", rules).action).toBe("deny");
	});

	test("chat beats agent beats global; a tool name beats its kind", () => {
		const rules: RuleSets = {
			conversation: { note_write: "allow" },
			agent: { note_write: "ask", "category:notes": "off" },
			global: { note_write: "off" },
		};
		expect(matchRule(rules, "note_write", "notes")).toEqual({
			permission: "allow",
			source: "conversation",
			key: "note_write",
		});
		expect(matchRule({ ...rules, conversation: {} }, "note_write", "notes")?.permission).toBe("ask");
		expect(matchRule({ ...rules, conversation: {} }, "note_delete", "notes")?.permission).toBe("off");
		expect(matchRule(none, "note_write", "notes")).toBeNull();
	});
});
