import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Channel } from "@sekai/shared";
import {
	attachmentName,
	baseEmoji,
	parseSignalChat,
	parseSignalEvent,
	type SignalFrame,
	signalAdapter,
	signalDmChat,
	signalGroupChat,
	signalMessageId,
} from "../src/channels/signal.ts";
import type {
	ChannelAdapter,
	ChannelHandlers,
	GroupInvite,
	InboundMessage,
	InboundReaction,
} from "../src/channels/types.ts";
import { friendlySignalError } from "../src/signal/accounts.ts";
import {
	daemonArgs,
	downloadVerified,
	installSignalCli,
	installSupport,
	pruneAttachments,
} from "../src/signal/engine.ts";
import { callRpc, readSse, SignalRpcError } from "../src/signal/rpc.ts";
import { envelope, type FakeSignalCli, fakeSignalCli } from "./fixtures/fake-signal-cli.ts";

const BOT = "11111111-1111-4111-8111-111111111111";
const HAZEL = { uuid: "22222222-2222-4222-8222-222222222222", name: "Hazel", number: "+15550100001" };
const FERN = { uuid: "33333333-3333-4333-8333-333333333333", name: "Fern" };
const GROUP = "Pmpi+EfPWmsxiomLe9Nx2XF9HOE483p6iKiFj65iMwI=";

const frame = (x: Record<string, unknown>) => x as SignalFrame;

describe("signal-cli's events, read", () => {
	test("a DM: who sent it (by account id), where to answer, the text", () => {
		const ev = parseSignalEvent(frame(envelope(HAZEL, 1_800_000_000_001, { message: "hi **there**" })), BOT);
		expect(ev).toEqual({
			kind: "message",
			chatId: signalDmChat(BOT, HAZEL.uuid),
			groupId: null,
			groupName: null,
			senderId: HAZEL.uuid,
			senderName: "Hazel",
			timestamp: 1_800_000_000_001,
			text: "hi **there**",
			mentionIds: [],
			quote: null,
			attachments: [],
		});
	});

	test("a group message that mentions the bot, with styles and a quote of its message", () => {
		const ev = parseSignalEvent(
			frame(
				envelope(FERN, 1_800_000_000_002, {
					message: "\uFFFC look at this",
					mentions: [{ name: BOT, number: null, uuid: BOT, start: 0, length: 1 }],
					textStyles: [{ style: "BOLD", start: 2, length: 4 }],
					quote: { id: 1_800_000_000_000, author: BOT, authorNumber: null, authorUuid: BOT, text: "earlier" },
					groupInfo: { groupId: GROUP, groupName: "The gang", revision: 3, type: "DELIVER" },
				}),
			),
			BOT,
		);
		expect(ev.kind).toBe("message");
		if (ev.kind !== "message") return;
		expect(ev.chatId).toBe(signalGroupChat(GROUP));
		expect(ev.groupName).toBe("The gang");
		expect(ev.text).toBe(`<@${BOT}> **look** at this`);
		expect(ev.mentionIds).toEqual([BOT]);
		expect(ev.quote).toEqual({ timestamp: 1_800_000_000_000, author: BOT });
	});

	test("attachments (signal-cli's long-text files aren't attachments)", () => {
		const ev = parseSignalEvent(
			frame(
				envelope(HAZEL, 1_800_000_000_003, {
					message: null,
					attachments: [
						{ contentType: "image/jpeg", filename: null, id: "abc.jpg", size: 1234, isVoiceNote: false },
						{
							contentType: "text/x-signal-plain",
							filename: null,
							id: "long.txt",
							size: 9,
							isVoiceNote: false,
						},
					],
				}),
			),
			BOT,
		);
		expect(ev.kind === "message" && ev.attachments.map((a) => a.id)).toEqual(["abc.jpg"]);
		expect(attachmentName({ contentType: "image/jpeg", isVoiceNote: false })).toBe("signal-photo.jpg");
		expect(attachmentName({ contentType: "audio/aac", isVoiceNote: true })).toBe("voice-note.aac");
		expect(attachmentName({ contentType: "application/pdf", filename: "plan.pdf", isVoiceNote: false })).toBe(
			"plan.pdf",
		);
	});

	test("a reaction points at the message it reacts to", () => {
		const ev = parseSignalEvent(
			frame(
				envelope(HAZEL, 1_800_000_000_004, {
					reaction: {
						emoji: "👍🏽",
						targetAuthor: BOT,
						targetAuthorNumber: null,
						targetAuthorUuid: BOT,
						targetSentTimestamp: 1_800_000_000_000,
						isRemove: false,
					},
				}),
			),
			BOT,
		);
		expect(ev).toMatchObject({
			kind: "reaction",
			chatId: signalDmChat(BOT, HAZEL.uuid),
			senderId: HAZEL.uuid,
			emoji: "👍🏽",
			target: signalMessageId(1_800_000_000_000, BOT),
			remove: false,
		});
		expect(baseEmoji("👍🏽")).toBe("👍");
		expect(baseEmoji("❤️")).toBe("❤");
	});

	test("being added to a group is a group update, from whoever added it", () => {
		const ev = parseSignalEvent(
			frame(
				envelope(FERN, 1_800_000_000_005, {
					groupInfo: { groupId: GROUP, groupName: "Fern's group", revision: 1, type: "UPDATE" },
				}),
			),
			BOT,
		);
		expect(ev).toEqual({
			kind: "group-update",
			groupId: GROUP,
			groupName: "Fern's group",
			senderId: FERN.uuid,
			senderName: "Fern",
		});
	});

	test("a changed safety number arrives as an error naming the sender; it's never a message", () => {
		const ev = parseSignalEvent(
			frame({
				...envelope(HAZEL, 1_800_000_000_006, null),
				exception: { message: "Untrusted identity", type: "UntrustedIdentityException" },
			}),
			BOT,
		);
		expect(ev).toEqual({ kind: "identity", senderId: HAZEL.uuid, senderName: "Hazel" });
	});

	test("its own messages, edits, typing, receipts and numbers without an account id are left alone", () => {
		const own = envelope({ uuid: BOT, name: "Bot" }, 1, { message: "from the phone" });
		const sync = envelope(HAZEL, 2, null, { syncMessage: { sentMessage: { message: "x" } } });
		const edit = envelope(HAZEL, 3, null, { editMessage: { targetSentTimestamp: 1, dataMessage: {} } });
		const typing = envelope(HAZEL, 4, null, { typingMessage: { action: "STARTED", timestamp: 4 } });
		const noUuid = { envelope: { sourceNumber: "+15550100009", timestamp: 5, dataMessage: { message: "hi" } } };
		const deleted = envelope(HAZEL, 6, { remoteDelete: { timestamp: 1 } });
		for (const f of [own, sync, edit, typing, noUuid, deleted])
			expect(parseSignalEvent(frame(f), BOT).kind).toBe("ignored");
	});

	test("chat and message ids pack and unpack, and nothing else passes for one", () => {
		expect(parseSignalChat(signalGroupChat(GROUP))).toEqual({ kind: "group", groupId: GROUP });
		expect(parseSignalChat(signalDmChat(BOT, HAZEL.uuid))).toEqual({ kind: "dm", self: BOT, peer: HAZEL.uuid });
		expect(() => parseSignalChat("slack:T1:C1")).toThrow();
		expect(() => parseSignalChat("signal:dm:../../etc:x")).toThrow();
	});
});

describe("talking to signal-cli", () => {
	test("JSON-RPC errors carry signal-cli's code", async () => {
		const fake = fakeSignalCli([{ number: "+15550109999", aci: BOT }]);
		try {
			expect(await callRpc(fake.url, "version")).toEqual({ version: "0.14.10" });
			fake.state.failNext.set("send", { code: -5, message: "Rate limit exceeded" });
			const err = await callRpc(fake.url, "send", { account: BOT }).catch((e: unknown) => e);
			expect(err).toBeInstanceOf(SignalRpcError);
			expect((err as SignalRpcError).code).toBe(-5);
			const gone = await callRpc("http://127.0.0.1:9", "version", {}, { timeoutMs: 2000 }).catch(
				(e: unknown) => e,
			);
			expect((gone as Error).message).toMatch(/isn't answering|in time/);
		} finally {
			fake.stop();
		}
	});

	test("Server-Sent Events are read across chunks, keep-alives aside", async () => {
		const parts = [": keep-alive\n", "id:1-1\nevent:rec", 'eive\ndata:{"a":1}\n\n', ":\n", "id:1-2\ndata:x\n\n"];
		const body = new ReadableStream<Uint8Array>({
			start(c) {
				for (const p of parts) c.enqueue(new TextEncoder().encode(p));
				c.close();
			},
		});
		const events: unknown[] = [];
		let heard = 0;
		await readSse(
			body,
			(e) => {
				events.push(e);
			},
			() => heard++,
		);
		expect(events).toEqual([
			{ id: "1-1", event: "receive", data: '{"a":1}' },
			{ id: "1-2", event: "message", data: "x" },
		]);
		expect(heard).toBe(parts.length);
	});

	test("what signal-cli says is put in words for the page", () => {
		expect(
			friendlySignalError(
				new Error(
					"Captcha required for verification, use --captcha CAPTCHA\nTo get the token, go to https://signalcaptchas.org/registration/generate.html",
				),
			),
		).toMatch(/^Signal wants a captcha first/);
		expect(friendlySignalError(new Error("Invalid captcha given."))).toMatch(/didn't accept that captcha/);
		expect(friendlySignalError(new SignalRpcError(-5, "Rate limit exceeded: 3600s"))).toMatch(/wait a while/);
		expect(
			friendlySignalError(new Error("Verification failed! This number is locked with a pin. Hours remaining")),
		).toMatch(/registration lock PIN/);
		expect(friendlySignalError(new Error('The user +1555 already exists\nDelete "x" before trying again.'))).toBe(
			"That Signal account is already connected here.",
		);
		expect(friendlySignalError(new Error("Something odd\nwith details"))).toBe("Something odd");
	});

	test("downloaded attachments are deleted after a while", async () => {
		const dir = mkdtempSync(join(tmpdir(), "sekai-signal-prune-"));
		try {
			Bun.spawnSync(["mkdir", "-p", join(dir, "attachments")]);
			writeFileSync(join(dir, "attachments", "old.jpg"), "x");
			writeFileSync(join(dir, "attachments", "new.jpg"), "y");
			const old = new Date(Date.now() - 10 * 3_600_000);
			utimesSync(join(dir, "attachments", "old.jpg"), old, old);
			expect(await pruneAttachments(dir, 6 * 3_600_000)).toBe(1);
			expect(existsSync(join(dir, "attachments", "old.jpg"))).toBe(false);
			expect(existsSync(join(dir, "attachments", "new.jpg"))).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("the daemon listens on loopback only, for every account, receiving only while Sekai listens", () => {
		const args = daemonArgs("/data/signal", 41234);
		expect(args).toContain("127.0.0.1:41234");
		expect(args).not.toContain("-a");
		expect(args.slice(args.indexOf("--receive-mode"), args.indexOf("--receive-mode") + 2)).toEqual([
			"--receive-mode",
			"on-connection",
		]);
		expect(args.slice(args.indexOf("--trust-new-identities"), args.indexOf("--trust-new-identities") + 2)).toEqual([
			"--trust-new-identities",
			"on-first-use",
		]);
	});
});

describe("installing signal-cli", () => {
	let dir = "";
	let archive: Uint8Array = new Uint8Array();
	let digest = "";
	let server: ReturnType<typeof Bun.serve> | null = null;
	beforeAll(async () => {
		dir = mkdtempSync(join(tmpdir(), "sekai-signal-install-"));
		// A stand-in release: a signal-cli that only says its version.
		const src = join(dir, "src");
		Bun.spawnSync(["mkdir", "-p", src]);
		writeFileSync(join(src, "signal-cli"), '#!/bin/sh\necho "signal-cli 0.14.10"\n');
		chmodSync(join(src, "signal-cli"), 0o755);
		Bun.spawnSync(["tar", "-czf", join(dir, "release.tar.gz"), "-C", src, "signal-cli"]);
		archive = new Uint8Array(await Bun.file(join(dir, "release.tar.gz")).arrayBuffer());
		digest = new Bun.CryptoHasher("sha256").update(archive).digest("hex");
		server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response(archive) });
	});
	afterAll(() => {
		server?.stop(true);
		rmSync(dir, { recursive: true, force: true });
	});
	const url = () => `http://127.0.0.1:${server?.port}/signal-cli.tar.gz`;

	test("a download is kept only when its SHA-256 is the pinned one", async () => {
		const good = join(dir, "good.tar.gz");
		await downloadVerified(url(), good, digest);
		expect(existsSync(good)).toBe(true);
		const bad = join(dir, "bad.tar.gz");
		const err = await downloadVerified(url(), bad, "0".repeat(64)).catch((e: unknown) => e);
		expect((err as Error).message).toMatch(/didn't match its checksum/);
		expect(existsSync(bad)).toBe(false);
	});

	test("installing puts a checked signal-cli in the data folder's tools, and refuses a changed release", async () => {
		const data = join(dir, "data-bad");
		const refused = await installSignalCli({
			dataDir: data,
			release: { url: url(), sha256: "f".repeat(64), version: "0.14.10" },
		}).catch((e: unknown) => e);
		expect((refused as Error).message).toMatch(/checksum/);
		expect(existsSync(join(data, "tools", "signal-cli", "signal-cli"))).toBe(false);

		const path = await installSignalCli({
			dataDir: join(dir, "data"),
			release: { url: url(), sha256: digest, version: "0.14.10" },
		});
		expect(path).toBe(join(dir, "data", "tools", "signal-cli", "signal-cli"));
		expect(new TextDecoder().decode(Bun.spawnSync([path, "--version"]).stdout)).toContain("0.14.10");
		// Nothing left over from unpacking.
		expect(existsSync(join(dir, "data", "tools", "signal-cli", ".download.tar.gz"))).toBe(false);
	});

	test("only Linux on x86_64 gets Sekai's install; elsewhere it says what to install", () => {
		expect(installSupport("linux", "x64")).toEqual({ ok: true });
		const mac = installSupport("darwin", "arm64");
		expect(mac.ok).toBe(false);
		if (!mac.ok) expect(mac.note).toMatch(/Java 21.*SIGNAL_CLI/);
		expect(installSupport("linux", "arm64").ok).toBe(false);
	});
});

// ---------------------------------------------------------------- the adapter against a fake signal-cli

interface Seen {
	messages: InboundMessage[];
	reactions: InboundReaction[];
	invites: GroupInvite[];
	fatal: string[];
	logs: string[];
}

function channelFor(account: string, number: string): Channel {
	return {
		id: "chn_signal_test",
		agentId: "agt_test",
		type: "signal",
		name: "Signal",
		enabled: true,
		config: { account, number, mode: "linked", profileName: "" },
		secrets: {},
		dmPolicy: "pairing",
		allowFrom: [HAZEL.uuid],
		groupPolicy: "mention",
		delivery: "smart",
		createdAt: 0,
		updatedAt: 0,
	};
}

async function until(check: () => boolean, ms = 3000): Promise<void> {
	const end = Date.now() + ms;
	while (!check()) {
		if (Date.now() > end) throw new Error("Timed out waiting.");
		await Bun.sleep(10);
	}
}

describe("the Signal adapter", () => {
	let fake: FakeSignalCli;
	let adapter: ChannelAdapter;
	const seen: Seen = { messages: [], reactions: [], invites: [], fatal: [], logs: [] };
	const allowInvitesFrom = new Set([HAZEL.uuid]);
	const handlers: ChannelHandlers = {
		onMessage: async (m) => {
			seen.messages.push(m);
		},
		onCommand: async () => ({ text: "" }),
		onAutocomplete: async () => [],
		onAction: async () => ({}),
		onReaction: async (r) => {
			seen.reactions.push(r);
		},
		onInvite: async (i) => {
			seen.invites.push(i);
			return allowInvitesFrom.has(i.inviterId);
		},
		onFatal: (err) => seen.fatal.push(err instanceof Error ? err.message : String(err)),
		log: (_level, message) => seen.logs.push(message),
	};

	beforeAll(async () => {
		fake = fakeSignalCli([{ number: "+15550109999", aci: BOT }]);
		fake.state.groups.set(GROUP, {
			id: GROUP,
			name: "The gang",
			isMember: true,
			members: [{ uuid: BOT }, { uuid: HAZEL.uuid }, { uuid: FERN.uuid }],
			pendingMembers: [],
		});
		adapter = signalAdapter(channelFor(BOT, "+15550109999"), {
			connect: async () => fake.url,
			release: () => {},
			reconnectMs: 20,
			healthMs: 100_000,
		});
		const me = await adapter.start(handlers);
		expect(me).toMatchObject({ botId: BOT, botName: "+15550109999", readsAll: true });
		await until(() => fake.connected(BOT));
	});
	afterAll(async () => {
		await adapter.stop();
		fake.stop();
	});

	test("a DM arrives as a message for the manager: addressed, with its Signal ids", async () => {
		fake.push(BOT, envelope(HAZEL, 1_800_000_000_100, { message: "hello there" }));
		await until(() => seen.messages.length === 1);
		expect(seen.messages[0]).toMatchObject({
			chatId: signalDmChat(BOT, HAZEL.uuid),
			chatName: "DM with Hazel",
			isGroup: false,
			senderId: HAZEL.uuid,
			senderName: "Hazel",
			text: "hello there",
			messageId: signalMessageId(1_800_000_000_100, HAZEL.uuid),
			addressed: true,
			replyToId: null,
		});
	});

	test("in a group it's addressed only when mentioned or replied to", async () => {
		const before = seen.messages.length;
		const group = { groupId: GROUP, groupName: "The gang", revision: 4, type: "DELIVER" };
		fake.push(BOT, envelope(FERN, 1_800_000_000_101, { message: "just chatting", groupInfo: group }));
		fake.push(
			BOT,
			envelope(FERN, 1_800_000_000_102, {
				message: "\uFFFC what do you think?",
				mentions: [{ uuid: BOT, start: 0, length: 1 }],
				groupInfo: group,
			}),
		);
		fake.push(
			BOT,
			envelope(HAZEL, 1_800_000_000_103, {
				message: "and this?",
				quote: { id: 1_800_000_000_050, authorUuid: BOT, text: "my answer" },
				groupInfo: group,
			}),
		);
		await until(() => seen.messages.length === before + 3);
		const [plain, mentioned, replied] = seen.messages.slice(before);
		expect(plain).toMatchObject({ chatId: signalGroupChat(GROUP), isGroup: true, addressed: false });
		expect(mentioned).toMatchObject({ addressed: true, text: `<@${BOT}> what do you think?` });
		expect(mentioned?.mentions).toEqual([{ id: BOT, name: "+15550109999", bot: false, tokens: [`<@${BOT}>`] }]);
		expect(replied).toMatchObject({ addressed: true, replyToId: signalMessageId(1_800_000_000_050, BOT) });
	});

	test("the same envelope twice (after a reconnect) is one message", async () => {
		const before = seen.messages.length;
		const twice = envelope(HAZEL, 1_800_000_000_104, { message: "once" });
		fake.push(BOT, twice);
		fake.push(BOT, twice);
		await until(() => seen.messages.length > before);
		await Bun.sleep(50);
		expect(seen.messages.length).toBe(before + 1);
	});

	test("attachments load only when asked, from signal-cli, with their real type", async () => {
		const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
		fake.state.attachments.set("pic.jpg", png);
		fake.push(
			BOT,
			envelope(HAZEL, 1_800_000_000_105, {
				attachments: [{ contentType: "image/jpeg", id: "pic.jpg", size: png.length, isVoiceNote: false }],
			}),
		);
		await until(() => seen.messages.some((m) => m.attachments.length));
		const msg = seen.messages.find((m) => m.attachments.length);
		expect(fake.callsTo("getAttachment")).toHaveLength(0);
		const a = msg?.attachments[0];
		const data = await a?.load();
		expect(data).toEqual(png);
		expect(fake.callsTo("getAttachment")[0]?.params).toEqual({
			account: BOT,
			id: "pic.jpg",
			recipient: HAZEL.uuid,
		});
		expect(a?.mime).toBe("image/png");
		expect(a?.name).toBe("signal-photo.png");
	});

	test("replies go out with Signal's text styles; in groups they quote what they answer", async () => {
		const dm = signalDmChat(BOT, HAZEL.uuid);
		const id = await adapter.send(dm, "Sure: **done**");
		const sent = fake.callsTo("send").at(-1)?.params;
		expect(sent).toEqual({ account: BOT, recipient: [HAZEL.uuid], message: "Sure: done", textStyle: ["6:4:BOLD"] });
		expect(parseSignalChat(dm).kind).toBe("dm");
		expect(id).toMatch(new RegExp(`^\\d+:${BOT}$`));

		const asked = signalMessageId(1_800_000_000_102, FERN.uuid);
		await adapter.send(signalGroupChat(GROUP), `Yes ${adapter.mention(FERN.uuid)}`, { replyTo: asked });
		expect(fake.callsTo("send").at(-1)?.params).toEqual({
			account: BOT,
			groupId: GROUP,
			message: "Yes \uFFFC",
			mention: [`4:1:${FERN.uuid}`],
			quoteTimestamp: 1_800_000_000_102,
			quoteAuthor: FERN.uuid,
			quoteMessage: "@+15550109999 what do you think?",
		});
	});

	test("files go as attachments, with their names", async () => {
		await adapter.send(signalDmChat(BOT, HAZEL.uuid), {
			text: "Here",
			files: [{ name: "notes.txt", data: new TextEncoder().encode("hi"), mime: "text/plain" }],
		});
		expect(fake.callsTo("send").at(-1)?.params.attachment).toEqual([
			"data:text/plain;filename=notes.txt;base64,aGk=",
		]);
	});

	test("its own messages are edited in place; old ones are sent again instead", async () => {
		const dm = signalDmChat(BOT, HAZEL.uuid);
		const id = await adapter.send(dm, "draft");
		const { timestamp } = { timestamp: Number(id.split(":")[0]) };
		// The fake's timestamps are in the future, so it's "recent": edited.
		await adapter.edit(dm, id, "final *answer*");
		expect(fake.callsTo("send").at(-1)?.params).toEqual({
			account: BOT,
			recipient: [HAZEL.uuid],
			message: "final answer",
			textStyle: ["6:6:ITALIC"],
			editTimestamp: timestamp,
		});
		const old = signalMessageId(Date.now() - 2 * 24 * 3_600_000, BOT);
		const before = fake.callsTo("send").length;
		await adapter.edit(dm, old, "too late to edit");
		const resent = fake.callsTo("send").slice(before);
		expect(resent).toHaveLength(1);
		expect(resent[0]?.params.editTimestamp).toBeUndefined();
		// Someone else's message is never edited.
		await adapter.edit(dm, signalMessageId(1_800_000_000_100, HAZEL.uuid), "nope");
		expect(fake.callsTo("send")).toHaveLength(before + 1);
	});

	test("reactions, remote delete and typing", async () => {
		const dm = signalDmChat(BOT, HAZEL.uuid);
		await adapter.react(dm, signalMessageId(1_800_000_000_100, HAZEL.uuid), "👍");
		expect(fake.callsTo("sendReaction").at(-1)?.params).toEqual({
			account: BOT,
			recipient: [HAZEL.uuid],
			emoji: "👍",
			targetAuthor: HAZEL.uuid,
			targetTimestamp: 1_800_000_000_100,
		});
		await adapter.remove(dm, signalMessageId(1_800_000_000_200, BOT));
		expect(fake.callsTo("remoteDelete").at(-1)?.params).toEqual({
			account: BOT,
			recipient: [HAZEL.uuid],
			targetTimestamp: 1_800_000_000_200,
		});
		await adapter.typing(signalGroupChat(GROUP));
		await adapter.idle?.(signalGroupChat(GROUP));
		expect(fake.callsTo("sendTyping").map((c) => c.params)).toEqual([
			{ account: BOT, groupId: GROUP },
			{ account: BOT, groupId: GROUP, stop: true },
		]);
		// A chat of another account can't be written to.
		await expect(adapter.send(signalDmChat(FERN.uuid, HAZEL.uuid), "x")).rejects.toThrow(/another account/);
	});

	test("people reacting reach the manager (skin tones aside)", async () => {
		fake.push(
			BOT,
			envelope(HAZEL, 1_800_000_000_106, {
				reaction: {
					emoji: "👎🏻",
					targetAuthorUuid: BOT,
					targetSentTimestamp: 1_800_000_000_200,
					isRemove: false,
				},
			}),
		);
		await until(() => seen.reactions.length === 1);
		expect(seen.reactions[0]).toMatchObject({
			chatId: signalDmChat(BOT, HAZEL.uuid),
			senderId: HAZEL.uuid,
			messageId: signalMessageId(1_800_000_000_200, BOT),
			emoji: "👎",
			remove: false,
		});
	});

	test("an invite from someone it answers is accepted; one from anyone else is declined", async () => {
		const join = "Z3JvdXAtam9pbi0xMjM0NTY3ODkwYWJjZGVmZ2hpams=";
		const decline = "Z3JvdXAtZGVjbGluZS0xMjM0NTY3ODkwYWJjZGVmZ2g=";
		for (const id of [join, decline])
			fake.state.groups.set(id, {
				id,
				name: id === join ? "Hazel's" : "Spam",
				isMember: false,
				members: [],
				pendingMembers: [{ uuid: BOT }],
			});
		fake.push(
			BOT,
			envelope(HAZEL, 1_800_000_000_107, { groupInfo: { groupId: join, revision: 1, type: "UPDATE" } }),
		);
		fake.push(
			BOT,
			envelope(FERN, 1_800_000_000_108, { groupInfo: { groupId: decline, revision: 1, type: "UPDATE" } }),
		);
		await until(() => fake.callsTo("updateGroup").length === 1 && fake.callsTo("quitGroup").length === 1);
		expect(fake.callsTo("updateGroup")[0]?.params).toEqual({ account: BOT, groupId: join });
		expect(fake.callsTo("quitGroup")[0]?.params).toEqual({ account: BOT, groupId: decline });
		expect(seen.invites.map((i) => [i.inviterId, i.chatId])).toEqual([
			[HAZEL.uuid, signalGroupChat(join)],
			[FERN.uuid, signalGroupChat(decline)],
		]);
		// Later updates to a group it's in are no invitations.
		fake.push(
			BOT,
			envelope(FERN, 1_800_000_000_109, { groupInfo: { groupId: join, revision: 2, type: "UPDATE" } }),
		);
		await Bun.sleep(100);
		expect(seen.invites).toHaveLength(2);
		expect(await adapter.canPost(signalGroupChat(join))).toBe(true);
		expect(await adapter.groupMembers?.(signalGroupChat(GROUP))).toEqual([HAZEL.uuid, FERN.uuid]);
	});

	test("a changed safety number is logged, and nobody gets in because of it", async () => {
		const before = seen.messages.length;
		fake.push(BOT, {
			...envelope(FERN, 1_800_000_000_110, null),
			exception: { message: "Untrusted identity", type: "UntrustedIdentityException" },
		});
		await until(() => seen.logs.some((l) => /safety number changed/.test(l)));
		expect(seen.messages.length).toBe(before);
	});

	test("the event stream reconnects where it left off; an account signal-cli lost is signed out", async () => {
		fake.dropStreams();
		await until(() => fake.connected(BOT));
		expect(fake.state.resumedFrom.at(-1)).toMatch(/^1700000000000-\d+$/);
		const before = seen.messages.length;
		fake.push(BOT, envelope(HAZEL, 1_800_000_000_111, { message: "still there?" }));
		await until(() => seen.messages.length === before + 1);

		// The link was removed on the phone: signal-cli drops the account, its events answer 400.
		fake.state.accounts = [];
		fake.dropStreams();
		await until(() => seen.fatal.length > 0);
		expect(seen.fatal[0]).toMatch(/signed this account out/);
	});
});
