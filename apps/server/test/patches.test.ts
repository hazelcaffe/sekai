import { describe, expect, test } from "bun:test";
import {
	AgentUpdate,
	ChannelUpdate,
	ConversationUpdate,
	McpServerUpdate,
	MemoryUpdate,
	NoteUpdate,
	RoutineUpdate,
	SettingsUpdate,
	SkillUpdate,
} from "@sekai/shared";

// Zod fills in .default() values even for keys left out of a .partial() schema. An update schema that did
// that would silently reset fields on every PATCH, so every update schema must leave missing keys missing.
describe("update schemas only contain the keys you send", () => {
	const schemas = {
		AgentUpdate,
		ChannelUpdate,
		ConversationUpdate,
		McpServerUpdate,
		MemoryUpdate,
		NoteUpdate,
		RoutineUpdate,
		SettingsUpdate,
		SkillUpdate,
	};
	for (const [name, schema] of Object.entries(schemas)) {
		test(name, () => {
			expect(schema.parse({})).toEqual({});
		});
	}

	test("nested conversation settings stay partial", () => {
		expect(ConversationUpdate.parse({ settings: { approvalMode: "manual" } })).toEqual({
			settings: { approvalMode: "manual" },
		});
	});

	test("channel allowlist update doesn't touch policies", () => {
		expect(ChannelUpdate.parse({ allowFrom: ["123"] })).toEqual({ allowFrom: ["123"] });
	});
});
