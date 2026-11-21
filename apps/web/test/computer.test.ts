import { expect, test } from "bun:test";
import { DEFAULT_COMPUTER_SPECS, type Machine, type MachineSeat } from "@sekai/shared";
import { validSpecs } from "../src/components/computer/Specs.tsx";
import { availableScreens, offersSharedAccess } from "../src/components/computer/screens.ts";

test("a borrowed bot only shows its account on a computer shared by the person in this chat", () => {
	const agent = { id: "bot", sharedBy: "another person" };
	const own = { id: "private", kind: "computer", agentId: agent.id } as Machine;
	const seat = {
		machine: { id: "my-computer", kind: "computer", agentId: "my-bot" },
		member: { agentId: agent.id, available: true, status: "ready" },
	} as MachineSeat;
	const unavailable = { ...seat, member: { ...seat.member, available: false } };
	expect(availableScreens(agent, [own], [seat, unavailable])).toEqual([{ machine: seat.machine, bot: agent.id }]);
	expect(availableScreens({ ...agent, sharedBy: null }, [own], [seat])).toEqual([
		{ machine: own },
		{ machine: seat.machine, bot: agent.id },
	]);
});

test("resizing keeps the disk and memory floor within the computer's limits", () => {
	expect(validSpecs(DEFAULT_COMPUTER_SPECS, 64)).toBe(true);
	expect(validSpecs({ ...DEFAULT_COMPUTER_SPECS, diskGb: 32 }, 64)).toBe(false);
	expect(validSpecs({ ...DEFAULT_COMPUTER_SPECS, memoryMb: 1024, minMemoryMb: 2048 })).toBe(false);
});

test("a shared bot's chat offers your shared access when you may lend something or already do", () => {
	const shared = { sharedBy: "Hazel" };
	const none = () => false;
	expect(offersSharedAccess(shared, (p) => p === "computers", 0)).toBe(true);
	expect(offersSharedAccess(shared, (p) => p === "browser", 0)).toBe(true);
	expect(offersSharedAccess(shared, none, 1)).toBe(true);
	expect(offersSharedAccess(shared, none, 0)).toBe(false);
	// Your own bot has its Computer section instead.
	expect(offersSharedAccess({ sharedBy: null }, () => true, 2)).toBe(false);
});
