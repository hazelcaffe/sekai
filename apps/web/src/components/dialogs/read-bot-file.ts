import { BotFile } from "@sekai/shared";

/**
 * Reads an exported bot file the way the server will: its parts checked and filled in by BotFile (lists it left
 * out are empty), or what's wrong with it, in words.
 */
export function readBotFile(text: string): { file: BotFile; raw: unknown } | { error: string } {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		raw = null;
	}
	const format = (raw as { format?: unknown } | null)?.format;
	if (format !== "sekai-bot" && format !== "feesh-bot")
		return { error: "That isn't a Sekai bot file (a .sekai-bot.json exported from a bot's profile)." };
	const parsed = BotFile.safeParse(raw);
	if (!parsed.success)
		return { error: "This bot file can't be read: it may be damaged, or from a newer Sekai. Export it again." };
	return { file: parsed.data, raw };
}
