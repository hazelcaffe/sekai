import { and, eq } from "drizzle-orm";
import { executeToolCall, type ToolCallEnv } from "../agent/loop.ts";
import { ruleSets } from "../agent/permissions.ts";
import { type ResolvedTool, resolveToolset, type Toolset } from "../agent/tools/index.ts";
import { actorFor, runAs } from "../auth/actor.ts";
import { APP_VERSION, config } from "../config.ts";
import { db, schema } from "../db/index.ts";
import { conversationOwner } from "../events/scope.ts";
import { errorMessage } from "../lib/errors.ts";
import { newId } from "../lib/ids.ts";
import { log } from "../lib/log.ts";
import { getAgent } from "../services/agents.ts";
import { getConversation } from "../services/conversations.ts";
import { getSettings } from "../services/settings.ts";

/**
 * The Sekai tools bridge: a tiny MCP server (Streamable HTTP, JSON-RPC) that external agents connect to as
 * "sekai". It serves the agent's own Sekai toolset (memory, notes, routines, team, MCP apps…) and runs every
 * call through the same approval gate as gateway models. Each external session has its own capability URL.
 */

const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

/**
 * The Sekai tool an agent's tool-call label names, exactly: "mcp__sekai__memory_save" (Claude Code),
 * "sekai.memory_save" / "sekai/memory_save" / "Tool: sekai.memory_save" (Codex and others), or
 * "memory_save (sekai MCP Server)" (Gemini CLI). Only the label, never the call's input: a shell command that merely
 * mentions a tool name must not pass for that tool (it would skip its approval).
 */
function namedTool(label: string): string | null {
	const t = label.trim();
	const prefixed = t.match(/^(?:tool:\s*)?(?:mcp__sekai__|sekai(?:__|[./:]))([A-Za-z][A-Za-z0-9_]*)$/i);
	if (prefixed?.[1]) return prefixed[1];
	const suffixed = t.match(/^([A-Za-z][A-Za-z0-9_]*)\s*\(sekai\b[^)]*\)$/i);
	return suffixed?.[1] ?? null;
}

const LINK_WINDOW_MS = 60_000;

/**
 * Live state of one external turn. ACP agents report their MCP calls as tool calls too; the bridge renders
 * Sekai tools itself (with titles, risk and approvals), so the two reports are linked and shown once.
 */
export class ExternalTurnState {
	sideEffects = false;
	private readonly owned = new Set<string>();
	private external: { id: string; tool: string; at: number }[] = [];
	private bridged: { id: string; tool: string; at: number }[] = [];

	constructor(readonly env: ToolCallEnv) {}

	get toolset(): Toolset {
		return this.env.toolset;
	}

	/** The Sekai tool an agent-side tool call's label (its title or name) names exactly, if any. */
	sekaiToolIn(...labels: (string | null | undefined)[]): ResolvedTool | null {
		for (const label of labels) {
			const name = label ? namedTool(label) : null;
			const tool = name ? this.toolset.tools.find((t) => t.name === name) : undefined;
			if (tool) return tool;
		}
		return null;
	}

	/** Whether updates for this agent-side tool call should be ignored (the bridge owns its part). */
	isOwned(id: string): boolean {
		return this.owned.has(id);
	}

	/**
	 * An agent-side tool call appeared. Returns true when it's a Sekai tool the bridge already rendered, so
	 * the caller must not render it again.
	 */
	noteExternalCall(id: string, ...labels: (string | null | undefined)[]): boolean {
		const tool = this.sekaiToolIn(...labels);
		if (!tool) return false;
		const now = Date.now();
		const match = this.bridged.find((b) => b.tool === tool.name && now - b.at < LINK_WINDOW_MS);
		if (match) {
			this.bridged = this.bridged.filter((b) => b !== match);
			this.owned.add(id);
			return true;
		}
		this.external.push({ id, tool: tool.name, at: now });
		return false;
	}

	/** A bridge call arrived. Returns the agent-side part to reuse for it, or null to create a new one. */
	claimForBridge(toolName: string, partId: string): string | null {
		const now = Date.now();
		this.external = this.external.filter((e) => now - e.at < LINK_WINDOW_MS);
		const match = [...this.external].reverse().find((e) => e.tool === toolName);
		if (match) {
			this.external = this.external.filter((e) => e !== match);
			this.owned.add(match.id);
			return match.id;
		}
		this.bridged.push({ id: partId, tool: toolName, at: now });
		return null;
	}
}

const activeTurns = new Map<string, ExternalTurnState>();
const turnKey = (agentId: string, conversationId: string) => `${agentId}:${conversationId}`;

export function registerTurn(agentId: string, conversationId: string, state: ExternalTurnState): () => void {
	const key = turnKey(agentId, conversationId);
	activeTurns.set(key, state);
	return () => {
		if (activeTurns.get(key) === state) activeTurns.delete(key);
	};
}

/** Where external agents on this machine reach the bridge. */
export function bridgeUrl(token: string): string {
	const host = ["0.0.0.0", "::", ""].includes(config.host) ? "127.0.0.1" : config.host;
	const origin = host.includes(":") ? `[${host}]` : host;
	return `http://${origin}:${config.port}/api/bridge/${token}/mcp`;
}

export function newBridgeToken(): string {
	return newId("brg", 32);
}

// ---------------------------------------------------------------- JSON-RPC

interface RpcRequest {
	jsonrpc: "2.0";
	id: string | number;
	method: string;
	params?: Record<string, unknown>;
}

type RpcResponse =
	| { jsonrpc: "2.0"; id: string | number | null; result: unknown }
	| { jsonrpc: "2.0"; id: string | number | null; error: { code: number; message: string } };

function isRequest(m: unknown): m is RpcRequest {
	return (
		typeof m === "object" &&
		m !== null &&
		"method" in m &&
		"id" in m &&
		(typeof (m as RpcRequest).id === "string" || typeof (m as RpcRequest).id === "number")
	);
}

const rpcError = (id: string | number | null, code: number, message: string): RpcResponse => ({
	jsonrpc: "2.0",
	id,
	error: { code, message },
});

interface Binding {
	agentId: string;
	conversationId: string;
}

async function bindingFor(token: string): Promise<Binding | null> {
	const row = await db.query.externalSessions.findFirst({ where: eq(schema.externalSessions.token, token) });
	return row ? { agentId: row.agentId, conversationId: row.conversationId } : null;
}

async function toolsetFor(binding: Binding): Promise<Toolset | null> {
	const live = activeTurns.get(turnKey(binding.agentId, binding.conversationId));
	if (live) return live.toolset;
	const [agent, conversation, settings] = await Promise.all([
		getAgent(binding.agentId),
		getConversation(binding.conversationId),
		getSettings(),
	]);
	if (!agent || !conversation) return null;
	return resolveToolset(agent, ruleSets(agent, conversation, settings));
}

function describe(t: ResolvedTool) {
	return {
		name: t.name,
		title: t.title({}),
		description: t.description,
		inputSchema: t.parameters,
		annotations: {
			readOnlyHint: t.risk === "read",
			destructiveHint: t.risk === "destructive",
			openWorldHint: t.risk === "external",
		},
	};
}

async function callTool(binding: Binding, params: Record<string, unknown>): Promise<unknown> {
	const text = (t: string, isError: boolean) => ({ content: [{ type: "text", text: t }], isError });
	const turn = activeTurns.get(turnKey(binding.agentId, binding.conversationId));
	if (!turn) return text("Sekai tools only work while you're replying to a message in Sekai.", true);
	const name = String(params.name ?? "");
	const raw = params.arguments ?? {};
	const args =
		typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
	const tool = turn.toolset.byName.get(name);
	const fresh = `sekai_${newId("call", 12)}`;
	const reused = tool ? turn.claimForBridge(name, fresh) : null;
	const id = reused ?? fresh;
	const part = {
		name,
		title: tool ? tool.title(args ?? {}) : name,
		source: tool?.source ?? ("builtin" as const),
		category: tool?.category,
		risk: tool?.risk,
		args: args ?? {},
		status: "pending" as const,
		startedAt: Date.now(),
	};
	if (reused) turn.env.writer.updateTool(id, part);
	else turn.env.writer.addTool({ id, ...part });
	try {
		const result = await executeToolCall(turn.env, { id, name }, tool, args);
		if (result.ran && tool?.risk !== "read") turn.sideEffects = true;
		const reply = text(result.content, result.failed);
		// Screenshots go to the agent as MCP image content.
		for (const img of result.images) {
			(reply.content as unknown[]).push({
				type: "image",
				data: Buffer.from(img.data).toString("base64"),
				mimeType: img.mime,
			});
		}
		return reply;
	} catch (err) {
		if (turn.env.ctx.signal.aborted) return text("The turn was cancelled.", true);
		log.warn(`bridge ${name} failed: ${errorMessage(err)}`);
		return text(`Error: ${errorMessage(err)}`, true);
	}
}

async function handle(binding: Binding, m: RpcRequest): Promise<RpcResponse> {
	const params = m.params ?? {};
	log.debug(`bridge ${binding.agentId}: ${m.method}${m.method === "tools/call" ? ` ${String(params.name)}` : ""}`);
	try {
		switch (m.method) {
			case "initialize": {
				const asked = String(params.protocolVersion ?? "");
				return {
					jsonrpc: "2.0",
					id: m.id,
					result: {
						protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[1],
						capabilities: { tools: { listChanged: false } },
						serverInfo: { name: "sekai", title: "Sekai", version: APP_VERSION },
						instructions:
							"Sekai tools for this agent: memory, notes, routines and reminders, skills, teammates, web and the user's connected apps. Use them whenever your instructions mention a Sekai tool.",
					},
				};
			}
			case "ping":
				return { jsonrpc: "2.0", id: m.id, result: {} };
			case "tools/list": {
				const toolset = await toolsetFor(binding);
				if (!toolset) return rpcError(m.id, -32001, "This Sekai session no longer exists");
				return { jsonrpc: "2.0", id: m.id, result: { tools: toolset.tools.map(describe) } };
			}
			case "tools/call":
				return { jsonrpc: "2.0", id: m.id, result: await callTool(binding, params) };
			case "resources/list":
				return { jsonrpc: "2.0", id: m.id, result: { resources: [] } };
			case "resources/templates/list":
				return { jsonrpc: "2.0", id: m.id, result: { resourceTemplates: [] } };
			case "prompts/list":
				return { jsonrpc: "2.0", id: m.id, result: { prompts: [] } };
			default:
				return rpcError(m.id, -32601, `Method not found: ${m.method}`);
		}
	} catch (err) {
		return rpcError(m.id, -32603, errorMessage(err));
	}
}

/** POST /api/bridge/:token/mcp. Public route: the token in the URL is the credential. */
export async function handleBridgeRequest(token: string, req: Request): Promise<Response> {
	if (req.method === "DELETE") return new Response(null, { status: 204 });
	if (req.method !== "POST") return new Response("Use POST", { status: 405, headers: { allow: "POST, DELETE" } });
	const binding = await bindingFor(token);
	if (!binding) return Response.json(rpcError(null, -32001, "Unknown Sekai session"), { status: 404 });

	let payload: unknown;
	try {
		payload = await req.json();
	} catch {
		return Response.json(rpcError(null, -32700, "Parse error"), { status: 400 });
	}
	const batch = Array.isArray(payload);
	const requests = (batch ? (payload as unknown[]) : [payload]).filter(isRequest);
	// Notifications (initialized, cancelled…) need no answer.
	if (requests.length === 0) return new Response(null, { status: 202 });

	// The tools act as the person whose chat it is (their bots, memory and limits), like the turn itself.
	const ownerId = await conversationOwner(binding.conversationId);
	const actor = ownerId ? await actorFor(ownerId).catch(() => null) : null;
	if (!actor) return Response.json(rpcError(null, -32001, "This Sekai session no longer exists"), { status: 404 });
	const work = runAs(actor, () => Promise.all(requests.map((r) => handle(binding, r))));
	const slow = requests.some((r) => r.method === "tools/call");
	if (!slow || !(req.headers.get("accept") ?? "").includes("text/event-stream")) {
		const results = await work;
		return Response.json(batch ? results : results[0]);
	}

	// Tool calls can wait minutes for your approval: answer over SSE with keepalives so nothing times out.
	const encoder = new TextEncoder();
	let ping: ReturnType<typeof setInterval> | null = null;
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			ping = setInterval(() => {
				try {
					controller.enqueue(encoder.encode(": keepalive\n\n"));
				} catch {
					if (ping) clearInterval(ping);
				}
			}, 15_000);
			void work.then((results) => {
				if (ping) clearInterval(ping);
				try {
					for (const r of results)
						controller.enqueue(encoder.encode(`event: message\ndata: ${JSON.stringify(r)}\n\n`));
					controller.close();
				} catch {
					// The client went away; the tool still ran and its result is in the chat.
				}
			});
		},
		cancel() {
			if (ping) clearInterval(ping);
		},
	});
	return new Response(stream, {
		headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" },
	});
}

/** Drops a conversation's external sessions (after a reset, the agents start over). */
export async function forgetExternalSessions(conversationId: string, agentId?: string): Promise<void> {
	await db
		.delete(schema.externalSessions)
		.where(
			agentId
				? and(
						eq(schema.externalSessions.conversationId, conversationId),
						eq(schema.externalSessions.agentId, agentId),
					)
				: eq(schema.externalSessions.conversationId, conversationId),
		);
}
