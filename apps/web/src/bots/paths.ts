/*
 * What a section's `rest` (the address after its own) means, for the sections with pages inside them. Pure, so the
 * addresses (and the old ones that still work) are tested.
 */

export type ChannelPlatform = "discord" | "slack";
export type SocialPlatform = "x" | "instagram" | "tiktok";

export type AccountsView =
	| { view: "home" }
	| { view: "platform"; platform: ChannelPlatform }
	| { view: "connect"; platform: ChannelPlatform }
	| { view: "account"; platform: ChannelPlatform; id: string }
	| { view: "social"; platform: SocialPlatform };

/**
 * /accounts, /accounts/discord, /accounts/discord/new, /accounts/discord/:accountId, /accounts/slack…,
 * /accounts/x|instagram|tiktok. The older /accounts/channels and /accounts/discord-user open Discord.
 */
export function accountsView(rest: string): AccountsView {
	const [first = "", second = ""] = rest.split("/");
	const platform: ChannelPlatform | null =
		first === "slack"
			? "slack"
			: first === "discord" || first === "channels" || first === "discord-user"
				? "discord"
				: null;
	if (platform) {
		if (second === "new") return { view: "connect", platform };
		if (second && first === platform) return { view: "account", platform, id: second };
		return { view: "platform", platform };
	}
	if (first === "x" || first === "instagram" || first === "tiktok") return { view: "social", platform: first };
	return { view: "home" };
}

export type MemoryView = { tab: "memories" | "notes" | "code" } | { tab: "note"; id: string };

/** /memory, /memory/notes, /memory/notes/:noteId (or "new"), /memory/code (only where there's a Code tab). */
export function memoryView(rest: string, hasCode: boolean): MemoryView {
	const [tab = "", id = ""] = rest.split("/");
	if (tab === "notes") return id ? { tab: "note", id } : { tab: "notes" };
	if (tab === "code" && hasCode) return { tab: "code" };
	return { tab: "memories" };
}
