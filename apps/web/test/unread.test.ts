import { expect, test } from "bun:test";
import { isUnreadChat } from "../src/lib/unread.ts";

const chat = (id: string, lastMessageAt: number | null) => ({ id, lastMessageAt });

test("a chat is unread when something came after you last saw it", () => {
	expect(isUnreadChat(chat("a", 200), { a: 100 }, 0)).toBe(true);
	expect(isUnreadChat(chat("a", 100), { a: 100 }, 0)).toBe(false);
	expect(isUnreadChat(chat("a", 50), { a: 100 }, 0)).toBe(false);
});

test("a new device starts with what's already there read", () => {
	// Never seen here, but older than when this device started keeping track.
	expect(isUnreadChat(chat("a", 900), {}, 1000)).toBe(false);
	// Something new since then.
	expect(isUnreadChat(chat("a", 1100), {}, 1000)).toBe(true);
	// Devices that kept track before (since 0) are unchanged: anything never seen is unread.
	expect(isUnreadChat(chat("a", 900), {}, 0)).toBe(true);
});

test("the open chat and empty chats are never unread", () => {
	expect(isUnreadChat(chat("a", 200), {}, 0, "a")).toBe(false);
	expect(isUnreadChat(chat("a", null), {}, 0)).toBe(false);
	expect(isUnreadChat(undefined, {}, 0)).toBe(false);
});
