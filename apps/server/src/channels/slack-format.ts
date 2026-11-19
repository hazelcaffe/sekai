const escapeSlack = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Markdown to Slack mrkdwn. Protect code and links before changing emphasis or escaping markup. */
export function slackMrkdwn(text: string): string {
	const saved: string[] = [];
	const keep = (value: string) => `\uE000${saved.push(value) - 1}\uE000`;
	let out = text.replace(/\uE000/g, "");
	out = out.replace(
		/```[^\n`]*\n([\s\S]*?)```|`([^`\n]+)`/g,
		(_all, block: string | undefined, inline: string | undefined) =>
			keep(block !== undefined ? `\`\`\`\n${escapeSlack(block)}\`\`\`` : `\`${escapeSlack(inline ?? "")}\``),
	);
	out = out.replace(/^(\|?.+\|.+\n\|?\s*:?-{3,}[^\n]*\n(?:[^\n]*\|[^\n]*(?:\n|$))*)/gm, (table) =>
		keep(`\`\`\`\n${escapeSlack(table.trim())}\n\`\`\``),
	);
	out = out.replace(
		/!?\[([^\]\n]*)\]\(<?(https?:\/\/[^\s)>]+)>?(?:\s+"[^"]*")?\)|<(https?:\/\/[^>\s]+)>|<@([A-Z0-9]+)>/g,
		(
			_all,
			label: string | undefined,
			url: string | undefined,
			auto: string | undefined,
			user: string | undefined,
		) =>
			keep(
				user
					? `<@${user}>`
					: `<${escapeSlack(url ?? auto ?? "")}${label ? `|${escapeSlack(label).replace(/\|/g, "¦")}` : ""}>`,
			),
	);
	out = escapeSlack(out)
		// Headings become bold lines (Slack has no headings, and no emphasis inside bold).
		.replace(/^#{1,6}\s+(.+?)\s*#*$/gm, (_all, h: string) => keep(`*${h.replace(/\*+|__/g, "")}*`))
		.replace(/^-#\s+(.+)$/gm, "$1")
		.replace(/^(\s*)[-*+]\s+/gm, "$1• ")
		.replace(/~~([^~\n]+)~~/g, "~$1~")
		.replace(/\*\*\*(?=\S)([^*\n]*?\S)\*\*\*/g, (_all, t: string) => keep(`*_${t}_*`))
		.replace(
			/\*\*(?=\S)([^\n]*?\S)\*\*|__(?=\S)([^\n]*?\S)__/g,
			(_all, a: string | undefined, b: string | undefined) => keep(`*${a ?? b}*`),
		)
		// *italic* (not "a * b * c" or 2*3*4).
		.replace(/(^|[^\w*])\*(?=\S)([^*\n]*?\S)\*(?![\w*])/g, "$1_$2_")
		.replace(/^&gt; ?/gm, "> ");
	// Saved entries can contain other saved entries (headings with links, for example).
	for (let i = 0; i < 4; i++) out = out.replace(/\uE000(\d+)\uE000/g, (_all, n: string) => saved[Number(n)] ?? "");
	return out;
}

/**
 * Slack's markup as plain Markdown for the bot: links, channel and group mentions, dates and escaped punctuation.
 * Mentions of people stay as tokens; the manager turns them into names.
 */
export function fromSlack(text: string): string {
	return text
		.replace(/<(https?:\/\/[^>|]+)\|([^>]+)>/g, (_all, url: string, label: string) =>
			label === url ? url : `[${label}](${url})`,
		)
		.replace(/<(https?:\/\/[^>]+)>/g, "$1")
		.replace(/<mailto:([^>|]+)(?:\|[^>]+)?>/g, "$1")
		.replace(/<#[A-Z0-9]+\|([^>]*)>/g, (_all, n: string) => `#${n || "channel"}`)
		.replace(/<#[A-Z0-9]+>/g, "#channel")
		.replace(/<!subteam\^[A-Z0-9]+\|([^>]+)>/g, "$1")
		.replace(/<!date\^[^|>]+\|([^>]+)>/g, "$1")
		.replace(/<!(?:channel|here|everyone)(?:\|[^>]*)?>/g, "@everyone")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&amp;/g, "&");
}

/** Workspace-qualified chat ids prevent collisions with other platforms and workspaces. */
export function slackChat(team: string, channel: string, thread?: string): string {
	return `slack:${team}:${channel}${thread ? `:${thread}` : ""}`;
}

/** Unpacks only workspace-qualified Slack channel/thread addresses, never arbitrary URLs. */
export function slackRef(chatId: string): { team: string; channel: string; thread?: string } {
	const match = /^slack:([A-Z0-9]+):([A-Z0-9]+)(?::(\d+\.\d+))?$/.exec(chatId);
	if (!match?.[1] || !match[2]) throw new Error("That Slack chat address isn't valid.");
	return { team: match[1], channel: match[2], ...(match[3] ? { thread: match[3] } : {}) };
}
