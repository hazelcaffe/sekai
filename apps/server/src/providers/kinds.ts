import type { ToolRisk } from "@sekai/shared";
import type { GatedTool } from "../agent/loop.ts";

/**
 * External agents' own tools (shell, file edits, web fetches) are gated by kind, using ACP's tool kinds for
 * every provider. Rules apply per kind, e.g. "external_execute: allow" or "category:external: ask".
 */
export const TOOL_KINDS = [
	"read",
	"edit",
	"delete",
	"move",
	"search",
	"execute",
	"think",
	"fetch",
	"switch_mode",
	"other",
] as const;
export type ToolKind = (typeof TOOL_KINDS)[number];

const RISK: Record<ToolKind, ToolRisk> = {
	read: "read",
	search: "read",
	think: "read",
	fetch: "read",
	edit: "write",
	move: "write",
	switch_mode: "write",
	delete: "destructive",
	execute: "external",
	other: "external",
};

export const KIND_LABELS: Record<ToolKind, string> = {
	read: "Read files",
	search: "Search files",
	think: "Think",
	fetch: "Fetch from the web",
	edit: "Edit files",
	move: "Move files",
	switch_mode: "Switch mode",
	delete: "Delete files",
	execute: "Run a command",
	other: "Use a tool",
};

export function asKind(kind: unknown): ToolKind {
	return (TOOL_KINDS as readonly string[]).includes(String(kind)) ? (kind as ToolKind) : "other";
}

export function kindRisk(kind: ToolKind): ToolRisk {
	return RISK[kind];
}

export function gatedExternalTool(kind: ToolKind, providerTitle: string, title: string | null | undefined): GatedTool {
	return {
		name: `external_${kind}`,
		category: "external",
		risk: kindRisk(kind),
		description: `${providerTitle}'s own tool: ${KIND_LABELS[kind].toLowerCase()} in the agent's workspace or on this computer.`,
		title: title?.trim() || KIND_LABELS[kind],
	};
}

/** Claude Code's built-in tools, by kind. */
export function claudeToolKind(name: string): ToolKind {
	switch (name) {
		case "Read":
		case "NotebookRead":
		case "LS":
			return "read";
		case "Glob":
		case "Grep":
		case "ToolSearch":
			return "search";
		case "Write":
		case "Edit":
		case "MultiEdit":
		case "NotebookEdit":
			return "edit";
		case "Bash":
		case "BashOutput":
		case "KillShell":
		case "KillBash":
		case "PowerShell":
			return "execute";
		case "WebFetch":
		case "WebSearch":
			return "fetch";
		case "TodoWrite":
		case "Task":
		case "Agent":
			return "think";
		case "ExitPlanMode":
		case "EnterPlanMode":
			return "switch_mode";
		default:
			return "other";
	}
}

function str(v: unknown): string {
	return typeof v === "string" ? v : "";
}

function file(v: unknown): string {
	const s = str(v);
	return s.split(/[\\/]/).pop() || s;
}

/** A readable title for a Claude Code tool call, like the ones ACP agents send. */
export function claudeToolTitle(name: string, input: Record<string, unknown>): string {
	const cut = (s: string, n = 80) => (s.length > n ? `${s.slice(0, n)}…` : s);
	switch (name) {
		case "Bash":
			return input.command ? `Ran \`${cut(str(input.command).split("\n")[0] ?? "")}\`` : "Ran a command";
		case "Read":
			return input.file_path ? `Read ${file(input.file_path)}` : "Read a file";
		case "Write":
			return input.file_path ? `Wrote ${file(input.file_path)}` : "Wrote a file";
		case "Edit":
		case "MultiEdit":
			return input.file_path ? `Edited ${file(input.file_path)}` : "Edited a file";
		case "Glob":
		case "Grep":
			return input.pattern ? `Searched for \`${cut(str(input.pattern), 60)}\`` : "Searched files";
		case "WebFetch":
			try {
				return `Fetched ${new URL(str(input.url)).host}`;
			} catch {
				return "Fetched a page";
			}
		case "WebSearch":
			return input.query ? `Searched the web for “${cut(str(input.query), 60)}”` : "Searched the web";
		case "TodoWrite":
			return "Updated its to-do list";
		case "Task":
		case "Agent":
			return input.description ? `Delegated: ${cut(str(input.description), 60)}` : "Delegated a task";
		default:
			return name;
	}
}
