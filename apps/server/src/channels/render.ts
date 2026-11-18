import type { Message } from "@sekai/shared";
import { truncate } from "../lib/text.ts";
import type { CommandOptions, CommandSpec, InboundMention } from "./types.ts";

export interface RenderOptions {
	/** Small print, e.g. Discord's "-# text". */
	subtext: (text: string) => string;
	/** A line above the reply: who's speaking when a bot posts for another agent, or "You, in Sekai". */
	header?: string | null;
	/** Agent names (lowercase) → the platform mention of their bot in this chat. */
	mentions?: Map<string, string>;
}

function escapeRe(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** "@Echo" → "<@123>" for agents whose bot is in this chat. Code spans and blocks are left alone. */
export function toPlatformMentions(text: string, mentions: Map<string, string> | undefined): string {
	if (!mentions?.size) return text;
	const names = [...mentions.keys()].sort((a, b) => b.length - a.length).map(escapeRe);
	const re = new RegExp(`(^|[^\\w@<])@(${names.join("|")})(?![\\w-])`, "gi");
	return text
		.split(/(```[\s\S]*?```|`[^`\n]*`)/)
		.map((piece, i) =>
			i % 2 === 1
				? piece
				: piece.replace(re, (all, pre: string, name: string) => {
						const token = mentions.get(name.toLowerCase());
						return token ? `${pre}${token}` : all;
					}),
		)
		.join("");
}

/**
 * Platform mention tokens → names Sekai understands. Mentions of agents' bots become @AgentName (so group
 * routing sees them), other people become @their name, and dropTokens (this bot, in its own chats) vanish.
 */
export function fromPlatformMentions(
	text: string,
	mentions: InboundMention[],
	agentNames: Map<string, string>,
	drop: Set<string> = new Set(),
): string {
	let out = text;
	for (const m of mentions) {
		const name = drop.has(m.id) ? "" : `@${agentNames.get(m.id) ?? m.name}`;
		for (const token of m.tokens) out = out.split(token).join(name);
	}
	return out.replace(/[ \t]{2,}/g, " ").trim();
}

/**
 * A finished Sekai message as one Markdown text for a chat platform: its text, and warnings and errors as small
 * print. Tool calls, reasoning and Sekai's own notes (saved to memory, a fallback model answered) stay in Sekai.
 * Empty means nothing to show.
 */
export function renderMessage(m: Message, opts: RenderOptions): string {
	const blocks: string[] = [];
	const onlyNotices = !m.parts.some((p) => p.type === "text" && p.text.trim());
	for (const p of m.parts) {
		if (p.type === "text" && p.text.trim()) blocks.push(toPlatformMentions(p.text.trim(), opts.mentions));
		else if (p.type === "notice" && p.text.trim() && p.level !== "info") {
			if (p.level === "error")
				blocks.push(onlyNotices ? `⚠️ ${p.text}` : opts.subtext(`⚠️ ${truncate(p.text, 300)}`));
			else blocks.push(opts.subtext(`⚠️ ${truncate(p.text, 300)}`));
		}
	}
	if (m.status === "error" && !m.parts.some((p) => p.type === "notice" && p.level === "error")) {
		blocks.push(`⚠️ I hit an error: ${truncate(m.error ?? "unknown", 300)}`);
	}
	if (m.status === "cancelled" && blocks.length > 0) blocks.push(opts.subtext("Stopped"));
	if (blocks.length === 0) return "";
	return `${opts.header ? `${opts.header}\n` : ""}${blocks.join("\n\n")}`;
}

// ---------------------------------------------------------------- typed commands

export interface ParsedCommand {
	name: string;
	sub: string | null;
	options: CommandOptions;
}

const TRUE = new Set(["true", "yes", "on", "1", "y"]);
const FALSE = new Set(["false", "no", "off", "0", "n"]);

/**
 * Parses a typed command with the same options as the slash command: "/retry gpt-6.1-sol erase",
 * "/memory add I like tea", "/mode mode:auto". Positional words fill options in order (the last text
 * option takes the rest); boolean options can be written as their name; key:value works for any option.
 */
export function parseTextCommand(text: string, specs: CommandSpec[]): ParsedCommand | null {
	const m = text.trim().match(/^\/([\w-]+)(?:@\S+)?(?:\s+([\s\S]*))?$/);
	if (!m?.[1]) return null;
	const name = m[1].toLowerCase();
	const spec = specs.find((s) => (s.kind ?? "chat") === "chat" && s.name === name);
	if (!spec) return null;
	let rest = (m[2] ?? "").trim();
	let sub: string | null = null;
	let optionSpecs = spec.options ?? [];
	if (spec.subcommands?.length) {
		const first = rest.split(/\s+/)[0]?.toLowerCase() ?? "";
		const found = spec.subcommands.find((s) => s.name === first);
		const chosen = found ?? spec.subcommands[0];
		if (found) rest = rest.slice(first.length).trim();
		sub = chosen?.name ?? null;
		optionSpecs = chosen?.options ?? [];
	}
	const options: CommandOptions = {};
	const positional: string[] = [];
	for (const token of rest ? rest.split(/\s+/) : []) {
		const kv = token.match(/^([\w-]+):(.*)$/);
		const keyed = kv?.[1] ? optionSpecs.find((o) => o.name === kv[1]?.toLowerCase()) : undefined;
		const flag = optionSpecs.find((o) => o.type === "boolean" && o.name === token.toLowerCase());
		if (keyed && kv) options[keyed.name] = kv[2] ?? "";
		else if (flag) options[flag.name] = true;
		else positional.push(token);
	}
	const fill = optionSpecs.filter((o) => o.type !== "boolean" && options[o.name] === undefined);
	fill.forEach((o, i) => {
		if (positional.length === 0) return;
		options[o.name] = i === fill.length - 1 ? positional.splice(0).join(" ") : positional.shift();
	});
	for (const o of optionSpecs) {
		const v = options[o.name];
		if (v === undefined) continue;
		const s = String(v);
		if (o.type === "boolean")
			options[o.name] = v === true || TRUE.has(s.toLowerCase()) || !FALSE.has(s.toLowerCase());
		else if (o.type === "integer") options[o.name] = Number.parseInt(s, 10);
		else if (o.choices) {
			const c = o.choices.find(
				(x) => x.value.toLowerCase() === s.toLowerCase() || x.name.toLowerCase() === s.toLowerCase(),
			);
			options[o.name] = c?.value ?? s;
		}
	}
	return { name, sub, options };
}
