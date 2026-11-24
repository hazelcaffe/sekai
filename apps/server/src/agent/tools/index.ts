import type { Agent, AgentContextTool, McpToolInfo, Permission, ToolRisk } from "@sekai/shared";
import { z } from "zod";
import { can, currentActor } from "../../auth/actor.ts";
import { errorMessage } from "../../lib/errors.ts";
import { log } from "../../lib/log.ts";
import { truncateMiddle } from "../../lib/text.ts";
import type { ChatTool } from "../../llm/types.ts";
import { callTool, getServer, globalServers, serverUsableBy, toolsFor } from "../../mcp/manager.ts";
import { matchRule, type RuleSets } from "../permissions.ts";
import { agentTools } from "./agents.ts";
import { browserTools } from "./browser.ts";
import { codeTools } from "./code.ts";
import { computerTools } from "./computer.ts";
import { contactTools } from "./contact.ts";
import { discordUserTools } from "./discord-user.ts";
import { emailTools } from "./email.ts";
import { extensionTools } from "./extension.ts";
import { hostTools } from "./hosts.ts";
import { jobTools } from "./jobs.ts";
import { libraryTools } from "./library.ts";
import { machineTools } from "./machines.ts";
import { mediaTools } from "./media.ts";
import { memoryTools } from "./memory.ts";
import { noteTools } from "./notes.ts";
import { routineTools } from "./routines.ts";
import { skillTools } from "./skills.ts";
import { socialTools } from "./social.ts";
import { systemTools } from "./system.ts";
import {
	TOOL_CATEGORIES,
	type ToolAttachment,
	type ToolContext,
	type ToolDefinition,
	ToolError,
	type ToolImage,
	ToolOutput,
} from "./types.ts";
import { webTools } from "./web.ts";
import { xTools } from "./x.ts";

export { TOOL_CATEGORIES, type ToolAttachment, type ToolContext, type ToolImage, ToolOutput } from "./types.ts";

/**
 * Every built-in tool. To add one, define it with defineTool() in a module here and add it to this list;
 * approvals, the chat details and the model's tool list pick it up automatically.
 */
export const BUILTIN_TOOLS: ToolDefinition[] = [
	...memoryTools,
	...noteTools,
	...routineTools,
	...skillTools,
	...agentTools,
	...webTools,
	...browserTools,
	...extensionTools,
	...discordUserTools,
	...socialTools,
	...computerTools,
	...machineTools,
	...hostTools,
	...codeTools,
	...libraryTools,
	...jobTools,
	...mediaTools,
	...contactTools,
	...emailTools,
	...xTools,
	...systemTools,
];

const MAX_RESULT_CHARS = 40_000;

export interface ResolvedTool {
	name: string;
	description: string;
	category: string;
	source: "builtin" | "mcp";
	risk: ToolRisk;
	parameters: Record<string, unknown>;
	title(args: Record<string, unknown>): string;
	run(args: Record<string, unknown>, ctx: ToolContext): Promise<string | ToolOutput>;
	askFirst?(args: Record<string, unknown>, ctx: ToolContext): string | null | Promise<string | null>;
	riskFor?(args: Record<string, unknown>, ctx: ToolContext): ToolRisk | Promise<ToolRisk>;
}

/** A tool's result as text plus any images. */
export function toolOutput(result: string | ToolOutput): {
	content: string;
	images: ToolImage[];
	attachments: ToolAttachment[];
} {
	return typeof result === "string"
		? { content: result, images: [], attachments: [] }
		: { content: result.content, images: result.images, attachments: result.attachments };
}

export interface Toolset {
	tools: ResolvedTool[];
	byName: Map<string, ResolvedTool>;
	chatTools: ChatTool[];
	rules: RuleSets;
}

function jsonSchema(schema: z.ZodType): Record<string, unknown> {
	const out = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
	delete out.$schema;
	if (out.type !== "object") return { type: "object", properties: {} };
	if (!out.properties) out.properties = {};
	return out;
}

function stringify(result: unknown): string {
	if (typeof result === "string") return result;
	if (result === undefined || result === null) return "ok";
	return JSON.stringify(result, null, 2);
}

function builtin(def: ToolDefinition): ResolvedTool {
	return {
		name: def.name,
		description: def.description,
		category: def.category,
		source: "builtin",
		risk: def.risk,
		parameters: jsonSchema(def.parameters),
		title: (args) => {
			try {
				return def.title(args as never);
			} catch {
				return def.name;
			}
		},
		async run(args, ctx) {
			const parsed = def.parameters.safeParse(args);
			if (!parsed.success) {
				const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "args"}: ${i.message}`);
				return `Error: invalid arguments. ${issues.join("; ")}`;
			}
			try {
				const result = await def.execute(parsed.data, ctx);
				if (result instanceof ToolOutput) {
					return new ToolOutput(
						truncateMiddle(result.content, MAX_RESULT_CHARS),
						result.images,
						result.attachments,
					);
				}
				return truncateMiddle(stringify(result), MAX_RESULT_CHARS);
			} catch (err) {
				if (err instanceof ToolError) return `Error: ${err.message}`;
				throw err;
			}
		},
		askFirst: def.askFirst
			? (args, ctx) => {
					const parsed = def.parameters.safeParse(args);
					return parsed.success ? (def.askFirst?.(parsed.data, ctx) ?? null) : null;
				}
			: undefined,
		riskFor: def.riskFor
			? (args, ctx) => {
					const parsed = def.parameters.safeParse(args);
					return parsed.success ? (def.riskFor?.(parsed.data, ctx) ?? def.risk) : def.risk;
				}
			: undefined,
	};
}

/** Tool names must match ^[a-zA-Z0-9_-]{1,64}$ for every provider. */
export function mcpToolName(serverName: string, toolName: string): string {
	const clean = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "_");
	const full = `mcp__${clean(serverName)}__${clean(toolName)}`;
	if (full.length <= 64) return full;
	let h = 0;
	for (const ch of full) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0;
	return `${full.slice(0, 56)}_${(h >>> 0).toString(36).slice(0, 7)}`;
}

/** Without annotations an MCP tool is assumed to reach the outside world. */
export function mcpRisk(t: Pick<McpToolInfo, "annotations">): ToolRisk {
	if (t.annotations.readOnlyHint) return "read";
	if (t.annotations.destructiveHint) return "destructive";
	return "external";
}

/** Features of a role that tools need (tools not listed come with every chat). Your devices are admins'. */
const TOOL_PERMISSION: Record<string, Permission> = {
	agent_create: "bots",
	voice_message: "voice",
	call_user: "voice",
	discord_voice: "voice",
	browser_social: "channels",
	instagram_dm: "channels",
	instagram_post: "channels",
	browser_account: "channels",
	discord: "channels",
	hosts_list: "admin",
	host_request_access: "admin",
	host_run: "admin",
	host_grant: "admin",
	host_revoke: "admin",
};
const CATEGORY_PERMISSION: Partial<Record<string, Permission>> = {
	jobs: "subscriptions",
	routines: "routines",
	web: "web",
	browser: "browser",
	computer: "computers",
	machines: "computers",
	code: "code",
	library: "library",
	x: "channels",
	email: "channels",
};
/**
 * What a bot shared with you can do in your chats: think with you, remember you, read the web and your library.
 * Its owner's computer, browser sign-ins, accounts, devices and apps stay theirs.
 */
const SHARED_CATEGORIES = new Set(["memory", "notes", "web", "media", "library", "routines", "skills", "system"]);
const SHARED_TOOLS = new Set(["message_user"]);

/**
 * What's shared with a bot that it may use in a run for someone other than its owner (see mayUseShared): a seat
 * on a machine (commands and files there), a screen, a browser. Not its owner's own browser, accounts or devices.
 */
export interface SharedReach {
	machines: boolean;
	screens: boolean;
	browsers: boolean;
}
const SEAT_TOOLS = new Set([
	"computer_status",
	"machine_credentials",
	"run_command",
	"read_file",
	"write_file",
	"edit_file",
]);
const SCREEN_TOOLS = new Set(computerTools.map((t) => t.name));
const BROWSER_TOOLS = new Set(browserTools.map((t) => t.name));

function reaches(name: string, reach: SharedReach | undefined): boolean {
	if (!reach) return false;
	if (SEAT_TOOLS.has(name)) return reach.machines;
	if (SCREEN_TOOLS.has(name)) return reach.screens;
	if (BROWSER_TOOLS.has(name)) return reach.browsers;
	return false;
}

/** What's shared with the bot that it may use in this run. */
export async function sharedReach(agentId: string): Promise<SharedReach> {
	const { machinesForBot } = await import("../../machines/seats.ts");
	const { browsersForBot } = await import("../../browser/shared.ts");
	const machines = await machinesForBot(agentId);
	const screens = machines.some((m) => m.kind === "computer");
	return {
		machines: machines.length > 0,
		screens,
		browsers: screens || (await browsersForBot(agentId)).length > 0,
	};
}

/**
 * Whether the person Sekai acts for may have this tool: their role's features, and whose bot it is. Someone else's
 * bot (or your bot in a chat of someone it's shared with) keeps to what's shared (reach).
 */
export function toolAllowed(
	def: { name: string; category: string },
	agent: Pick<Agent, "userId">,
	reach?: SharedReach,
): boolean {
	const actor = currentActor();
	if (!actor) return true;
	if (
		agent.userId !== actor.userId &&
		!SHARED_CATEGORIES.has(def.category) &&
		!SHARED_TOOLS.has(def.name) &&
		!reaches(def.name, reach)
	) {
		return false;
	}
	const needs = TOOL_PERMISSION[def.name] ?? CATEGORY_PERMISSION[def.category];
	return !needs || can(needs, actor);
}

/**
 * The agent's toolset: built-ins plus tools from its MCP servers, minus anything a rule turned off, the acting
 * person's role leaves out, or (a bot shared with them) belongs to the bot's owner.
 */
export async function resolveToolset(agent: Agent, rules: RuleSets): Promise<Toolset> {
	const tools: ResolvedTool[] = [];
	const isOff = (name: string, category: string) => matchRule(rules, name, category)?.permission === "off";
	const actor = currentActor();
	const shared = Boolean(actor && agent.userId !== actor.userId);
	const reach = shared ? await sharedReach(agent.id) : undefined;

	for (const def of BUILTIN_TOOLS) {
		if (isOff(def.name, def.category)) continue;
		if (!toolAllowed(def, agent, reach)) continue;
		if (def.available && !(await Promise.resolve(def.available(agent)).catch(() => false))) continue;
		tools.push(builtin(def));
	}

	// The bot's own servers (not when it's someone else's bot: those sign in as its owner), plus the ones every
	// bot of the person has.
	const bindings = shared ? [] : [...agent.mcp];
	for (const g of await globalServers()) {
		if (!bindings.some((b) => b.serverId === g.id)) bindings.push({ serverId: g.id, tools: null });
	}
	for (const binding of bindings) {
		const server = await getServer(binding.serverId);
		if (!server?.enabled || !serverUsableBy(server, actor)) continue;
		let serverTools: McpToolInfo[] = [];
		try {
			serverTools = await toolsFor(server.id);
		} catch (err) {
			log.warn(`mcp ${server.name}: tools unavailable: ${errorMessage(err)}`);
		}
		for (const t of serverTools) {
			if (binding.tools && !binding.tools.includes(t.name)) continue;
			const name = mcpToolName(server.name, t.name);
			const category = `mcp:${server.name}`;
			if (isOff(name, category)) continue;
			const schema = { ...t.inputSchema };
			delete schema.$schema;
			tools.push({
				name,
				description: `[${server.title}] ${t.description}`.slice(0, 1024),
				category,
				source: "mcp",
				risk: mcpRisk(t),
				parameters: schema.type === "object" ? schema : { type: "object", properties: {} },
				title: () => `${server.title}: ${t.annotations.title ?? t.name}`,
				async run(args, ctx) {
					const result = await callTool(server.id, t.name, args, ctx.signal);
					const text = truncateMiddle(result.text, MAX_RESULT_CHARS);
					return result.isError ? `Error from ${server.title}: ${text}` : text;
				},
			});
		}
	}

	return {
		tools,
		byName: new Map(tools.map((t) => [t.name, t])),
		chatTools: tools.map((t) => ({
			type: "function",
			function: { name: t.name, description: t.description, parameters: t.parameters },
		})),
		rules,
	};
}

export function describeTool(
	t: { name: string; description: string; source: "builtin" | "mcp"; category: string; risk: ToolRisk },
	rules: RuleSets,
): AgentContextTool {
	const rule = matchRule(rules, t.name, t.category);
	return {
		name: t.name,
		description: t.description,
		source: t.source,
		category: t.category,
		risk: t.risk,
		rule: rule?.permission ?? null,
		ruleSource: rule?.source ?? null,
	};
}

/** Every built-in tool with the rule that applies to it, for the permissions UI (includes tools turned off). */
export function builtinCatalog(rules: RuleSets): AgentContextTool[] {
	return BUILTIN_TOOLS.map((def) => describeTool({ ...def, source: "builtin" }, rules));
}

/** The tools whose rules a person can set for their bot: the ones their role leaves them (no code search without it). */
export function ruleCatalog(agent: Pick<Agent, "userId">, rules: RuleSets): AgentContextTool[] {
	return builtinCatalog(rules).filter((t) => toolAllowed(t, agent));
}

export const CATEGORY_LABELS: Record<string, string> = TOOL_CATEGORIES;
