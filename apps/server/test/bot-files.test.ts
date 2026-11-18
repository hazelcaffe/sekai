import { describe, expect, test } from "bun:test";
import { BotFile } from "@sekai/shared";

describe("bot files", () => {
	test("a minimal file fills in defaults; nonsense is refused", () => {
		const f = BotFile.parse({
			format: "sekai-bot",
			version: 1,
			exportedAt: 1,
			app: "0.1.0",
			bot: { name: "nene" },
		});
		expect(f.skills).toEqual([]);
		expect(f.routines).toEqual([]);
		expect(f.bot.personality).toBe("");
		expect(
			BotFile.safeParse({ format: "sekai-bot", version: 2, exportedAt: 1, app: "x", bot: { name: "a" } }).success,
		).toBe(false);
		expect(
			BotFile.safeParse({
				format: "sekai-bot",
				version: 1,
				exportedAt: 1,
				app: "x",
				bot: { name: "a", avatarImage: { mime: "text/html", base64: "PGI+" } },
			}).success,
		).toBe(false);
	});
});
