import { expect, test } from "bun:test";
import { readBotFile } from "../src/components/dialogs/read-bot-file.ts";

const minimal = { format: "sekai-bot", version: 1, exportedAt: 1, app: "sekai", bot: { name: "Juniper" } };

test("a bot file the server accepts previews, with the lists it left out empty", () => {
	const read = readBotFile(JSON.stringify(minimal));
	if ("error" in read) throw new Error(read.error);
	expect(read.file.bot.name).toBe("Juniper");
	expect(read.file.skills).toEqual([]);
	expect(read.file.routines).toEqual([]);
	expect(read.file.memories).toEqual([]);
	expect(read.raw).toEqual(minimal);
});

test("anything else says what's wrong instead of breaking the preview", () => {
	expect(readBotFile("not json")).toEqual({
		error: "That isn't a Sekai bot file (a .sekai-bot.json exported from a bot's profile).",
	});
	expect("error" in readBotFile(JSON.stringify({ format: "other" }))).toBe(true);
	const broken = readBotFile(JSON.stringify({ ...minimal, skills: "lots" }));
	expect("error" in broken && broken.error).toStartWith("This bot file can't be read");
	expect("error" in readBotFile(JSON.stringify({ ...minimal, bot: { name: "" } }))).toBe(true);
});
