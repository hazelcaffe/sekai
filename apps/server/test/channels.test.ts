import { describe, expect, test } from "bun:test";
import { chunkText } from "../src/channels/format.ts";

describe("chunkText", () => {
	test("short text is one chunk", () => {
		expect(chunkText("hello", 100)).toEqual(["hello"]);
	});

	test("splits on paragraphs and respects the limit", () => {
		const text = Array.from({ length: 20 }, (_, i) => `Paragraph ${i} ${"x".repeat(40)}`).join("\n\n");
		const chunks = chunkText(text, 200);
		expect(chunks.length).toBeGreaterThan(1);
		for (const c of chunks) expect(c.length).toBeLessThanOrEqual(210);
		expect(chunks.join("\n\n").replace(/\s+/g, " ")).toBe(text.replace(/\s+/g, " "));
	});

	test("never leaves a code fence open across chunks", () => {
		const code = Array.from({ length: 60 }, (_, i) => `line ${i}`).join("\n");
		const chunks = chunkText(`Intro\n\n\`\`\`ts\n${code}\n\`\`\`\n\nOutro`, 150);
		for (const c of chunks) expect((c.match(/^```/gm) ?? []).length % 2).toBe(0);
		expect(chunks.some((c) => c.startsWith("```ts"))).toBe(true);
	});
});

import type { Message } from "@sekai/shared";
import { COMMANDS, splitReminder } from "../src/channels/commands.ts";
import { commandJson } from "../src/channels/discord.ts";
import { fromPlatformMentions, parseTextCommand, renderMessage, toPlatformMentions } from "../src/channels/render.ts";
import { OutboundStream, type PostedStore } from "../src/channels/stream.ts";
import type { ChannelAdapter } from "../src/channels/types.ts";

describe("typed commands", () => {
	const parse = (t: string) => parseTextCommand(t, COMMANDS);

	test("positional words and flags", () => {
		expect(parse("/retry gpt-6.1-sol erase")).toEqual({
			name: "retry",
			sub: null,
			options: { model: "gpt-6.1-sol", erase: true },
		});
		expect(parse("/retry")).toEqual({ name: "retry", sub: null, options: {} });
		expect(parse("/retry erase:yes")?.options).toEqual({ erase: true });
	});

	test("the last text option takes the rest", () => {
		expect(parse("/memory add I take my coffee black")).toEqual({
			name: "memory",
			sub: "add",
			options: { text: "I take my coffee black" },
		});
		expect(parse("/group link Echo Pip")?.options).toEqual({ bots: "Echo Pip" });
	});

	test("subcommands default to the first", () => {
		expect(parse("/memory")).toEqual({ name: "memory", sub: "list", options: {} });
		expect(parse("/memory tea")).toEqual({ name: "memory", sub: "list", options: { search: "tea" } });
	});

	test("choices match by value or name, key:value works", () => {
		expect(parse("/listen on")?.options).toEqual({ state: "on" });
		expect(parse("/mode mode:yolo")?.options).toEqual({ mode: "yolo" });
		expect(parse("/model gpt-6.1-sol high")?.options).toEqual({ model: "gpt-6.1-sol", thinking: "high" });
	});

	test("unknown commands and the bot suffix", () => {
		expect(parse("/nope")).toBeNull();
		expect(parse("hello /status")).toBeNull();
		expect(parse("/status@SmokeBot")?.name).toBe("status");
	});

	test("reminders typed as one phrase", () => {
		expect(splitReminder("in 20 minutes take the pizza out")).toEqual({
			when: "in 20 minutes",
			what: "take the pizza out",
		});
		expect(splitReminder("in 2h to stretch")).toEqual({ when: "in 2h", what: "stretch" });
		expect(splitReminder("2026-12-01 09:00 call mum")).toEqual({ when: "2026-12-01T09:00", what: "call mum" });
		expect(splitReminder("tomorrow at 9 call mum")).toBeNull();
	});
});

describe("Discord commands", () => {
	test("valid names, descriptions and option order", () => {
		for (const spec of COMMANDS) {
			const json = commandJson(spec) as {
				name: string;
				description?: string;
				options?: { required?: boolean }[];
			};
			if (spec.kind === "message") {
				expect(json.name.length).toBeLessThanOrEqual(32);
				continue;
			}
			expect(json.name).toMatch(/^[a-z0-9_-]{1,32}$/);
			expect(json.description?.length ?? 0).toBeGreaterThan(0);
			expect(json.description?.length ?? 0).toBeLessThanOrEqual(100);
			const lists = spec.subcommands?.length
				? spec.subcommands.map((s) => s.options ?? [])
				: [spec.options ?? []];
			for (const opts of lists) {
				// Discord requires required options first.
				const firstOptional = opts.findIndex((o) => !o.required);
				if (firstOptional >= 0) expect(opts.slice(firstOptional).some((o) => o.required)).toBe(false);
			}
		}
		expect(COMMANDS.filter((c) => c.kind === "message").length).toBeLessThanOrEqual(5);
	});
});

describe("mentions", () => {
	const bots = new Map([["echo", "<@200>"]]);

	test("agent names become platform mentions, outside code", () => {
		expect(toPlatformMentions("@Echo can you check? `@Echo` stays", bots)).toBe(
			"<@200> can you check? `@Echo` stays",
		);
		expect(toPlatformMentions("mail me at x@echo.com", bots)).toBe("mail me at x@echo.com");
		expect(toPlatformMentions("@Echoes is someone else", bots)).toBe("@Echoes is someone else");
	});

	test("platform mentions become names; this bot's own mention disappears", () => {
		const mentions = [
			{ id: "100", name: "SmokeBot", bot: true, tokens: ["<@100>", "<@&900>"] },
			{ id: "200", name: "EchoBot", bot: true, tokens: ["<@200>"] },
			{ id: "300", name: "Sam", bot: false, tokens: ["<@300>"] },
		];
		const names = new Map([
			["100", "Smoke"],
			["200", "Echo"],
		]);
		expect(fromPlatformMentions("<@100> ask <@200> and <@300>", mentions, names, new Set(["100"]))).toBe(
			"ask @Echo and @Sam",
		);
		expect(fromPlatformMentions("<@&900> hi", mentions, names)).toBe("@Smoke hi");
	});
});

function msg(patch: Partial<Message>): Message {
	return {
		id: "msg_1",
		conversationId: "cnv_1",
		sender: "agent",
		agentId: "agt_1",
		parts: [],
		attachments: [],
		status: "streaming",
		error: null,
		model: "m",
		usage: null,
		replyToId: null,
		runId: null,
		meta: {},
		createdAt: 1,
		updatedAt: 1,
		...patch,
	} as Message;
}

const subtext = (s: string) => `-# ${s}`;

describe("rendering replies", () => {
	test("text, warnings as small print; tools and Sekai's own notes stay in Sekai", () => {
		const m = msg({
			status: "done",
			parts: [
				{ type: "text", text: "" },
				{ type: "notice", level: "info", text: "Haiku declined, so Sol answered instead." },
				{ type: "tool", id: "t", name: "x", status: "done" } as never,
				{ type: "text", text: "Here you go." },
				{ type: "notice", level: "warning", text: "The reply hit the length limit." },
				{ type: "notice", level: "info", text: "Saved to memory: likes tea" },
			],
		});
		expect(renderMessage(m, { subtext })).toBe("Here you go.\n\n-# ⚠️ The reply hit the length limit.");
	});

	test("errors, stops and headers", () => {
		expect(renderMessage(msg({ status: "error", error: "boom" }), { subtext })).toBe("⚠️ I hit an error: boom");
		expect(renderMessage(msg({ status: "cancelled" }), { subtext })).toBe("");
		expect(renderMessage(msg({ status: "cancelled", parts: [{ type: "text", text: "Half" }] }), { subtext })).toBe(
			"Half\n\n-# Stopped",
		);
		expect(
			renderMessage(msg({ status: "done", parts: [{ type: "text", text: "Yo @Echo" }] }), {
				subtext,
				header: "**Pip**",
				mentions: new Map([["echo", "<@2>"]]),
			}),
		).toBe("**Pip**\nYo <@2>");
	});
});

describe("streaming into a chat", () => {
	function fake() {
		const log: string[] = [];
		const messages = new Map<string, string>();
		let n = 0;
		const adapter: ChannelAdapter = {
			maxText: 60,
			mention: (id) => `<@${id}>`,
			subtext,
			start: async () => ({ botId: "b", botName: "b", inviteUrl: null, readsAll: false }),
			stop: async () => {},
			send: async (_chat, content) => {
				const id = `p${++n}`;
				messages.set(id, typeof content === "string" ? content : content.text);
				log.push(`send ${id}`);
				return id;
			},
			edit: async (_chat, id, content) => {
				messages.set(id, typeof content === "string" ? content : content.text);
				log.push(`edit ${id}`);
			},
			remove: async (_chat, id) => {
				messages.delete(id);
				log.push(`remove ${id}`);
			},
			react: async () => {},
			typing: async () => {},
			canPost: async () => true,
			registerCommands: async () => {},
		};
		const rows: { messageId: string; externalMessageId: string; seq: number }[] = [];
		const store: PostedStore = {
			load: async (messageId) => rows.filter((r) => r.messageId === messageId).map((r) => r.externalMessageId),
			add: async (r) => {
				rows.push(r);
			},
			trim: async (messageId, _c, _chat, from) => {
				for (let i = rows.length - 1; i >= 0; i--) {
					const r = rows[i];
					if (r && r.messageId === messageId && r.seq >= from) rows.splice(i, 1);
				}
			},
		};
		return { adapter, store, log, messages, rows };
	}
	const target = { channelId: "c", chatId: "chat", header: null, replyTo: "u1", mentions: new Map() };

	test("posts a reply once, when it's finished (no edits while it's written)", async () => {
		const f = fake();
		const s = new OutboundStream(target, msg({}), () => f.adapter, f.store);
		s.update(msg({ parts: [{ type: "text", text: "Hello" }] }));
		s.update(msg({ parts: [{ type: "tool", id: "t", name: "x", title: "Working", status: "running" } as never] }));
		await Bun.sleep(50);
		await s.settled();
		expect(f.log).toEqual([]);
		s.update(msg({ status: "done", parts: [{ type: "text", text: "Hello there" }] }));
		await s.settled();
		expect(f.log).toEqual(["send p1"]);
		expect(f.messages.get("p1")).toBe("Hello there");
		// A later change that shows nothing new (a memory note) doesn't edit it, even from a new delivery.
		const later = msg({
			status: "done",
			parts: [
				{ type: "text", text: "Hello there" },
				{ type: "notice", level: "info", text: "Saved to memory: x" },
			],
		});
		s.update(later);
		await s.settled();
		const again = new OutboundStream(target, later, () => f.adapter, f.store);
		again.update(later);
		await again.settled();
		expect(f.log).toEqual(["send p1"]);
	});

	test("long replies continue in more messages; a retry reuses and trims them", async () => {
		const f = fake();
		const long = Array.from({ length: 6 }, (_, i) => `Paragraph ${i} with some words.`).join("\n\n");
		const s = new OutboundStream(target, msg({}), () => f.adapter, f.store);
		s.update(msg({ status: "done", parts: [{ type: "text", text: long }] }));
		await s.settled();
		const first = f.messages.size;
		expect(first).toBeGreaterThan(1);
		// Retried: the same Sekai message streams a short answer into the same platform messages.
		const again = new OutboundStream(target, msg({}), () => f.adapter, f.store);
		again.update(msg({ status: "done", parts: [{ type: "text", text: "Short now." }] }));
		await again.settled();
		expect(f.messages.size).toBe(1);
		expect(f.messages.get("p1")).toBe("Short now.");
		expect(f.rows.length).toBe(1);
	});

	test("a reply that ends with nothing to show posts nothing; an error is still said", async () => {
		const f = fake();
		const s = new OutboundStream(target, msg({}), () => f.adapter, f.store);
		s.update(msg({ parts: [{ type: "tool", id: "t", name: "x", title: "Working", status: "running" } as never] }));
		s.update(msg({ status: "cancelled", parts: [{ type: "tool", id: "t", name: "x", status: "error" } as never] }));
		await s.settled();
		expect(f.log).toEqual([]);
		const e = new OutboundStream(target, msg({ id: "m2" }), () => f.adapter, f.store);
		e.update(msg({ id: "m2", status: "error", error: "boom" }));
		await e.settled();
		expect([...f.messages.values()]).toEqual(["⚠️ I hit an error: boom"]);
	});
});
