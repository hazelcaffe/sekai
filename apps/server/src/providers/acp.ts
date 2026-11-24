import { join } from "node:path";
import {
	type ToolCallStatus as AcpToolStatus,
	type ClientConnection,
	type ContentBlock,
	client,
	type InitializeResponse,
	type McpServer,
	ndJsonStream,
	type PlanEntry,
	PROTOCOL_VERSION,
	RequestError,
	type RequestPermissionRequest,
	type RequestPermissionResponse,
	type SessionConfigOption,
	type SessionConfigSelectGroup,
	type SessionConfigSelectOption,
	type SessionModeState,
	type SessionUpdate,
	type StopReason,
	type ToolCallContent,
} from "@agentclientprotocol/sdk";
import {
	byosModelId,
	type Provider,
	type ProviderModel,
	type ProviderStatus,
	type ToolPart,
	type Usage,
} from "@sekai/shared";
import { authorizeToolCall } from "../agent/loop.ts";
import { RefusalError } from "../agent/refusal.ts";
import { APP_VERSION, config } from "../config.ts";
import { errorMessage } from "../lib/errors.ts";
import { log } from "../lib/log.ts";
import { truncate, truncateMiddle } from "../lib/text.ts";
import { EMPTY_USAGE } from "../llm/types.ts";
import type { JobClient } from "./job-client.ts";
import { asKind, gatedExternalTool, KIND_LABELS, type ToolKind } from "./kinds.ts";
import { acpEnv, checkDir, OutputTail, pipeText, withTimeout } from "./process.ts";
import { setProviderStatus } from "./store.ts";
import type { RunnerInput, RunnerResult, TurnBlock } from "./turn.ts";

/** Kinds of tool call that are the agent's own actions (never a Sekai tool, whatever the title says). */
const AGENT_OWN_KINDS = new Set(["read", "edit", "delete", "move", "search", "execute", "fetch"]);

/**
 * Agent Client Protocol (agentclientprotocol.com) client. Sekai plays the editor: it starts the agent CLI
 * you installed (codex-acp, opencode acp, pi-acp, devin acp…) over stdio, opens one session per agent and
 * conversation, streams its replies into the chat and answers its permission requests with Sekai's
 * approval gate. Sekai offers no file-system or terminal capabilities; the agent works in its own folder.
 */

const AUTH_REQUIRED = -32000;
const IDLE_MS = 10 * 60_000;
const START_TIMEOUT_MS = 180_000;
const SESSION_TIMEOUT_MS = 120_000;

export function isAuthRequired(err: unknown): boolean {
	return err instanceof RequestError && err.code === AUTH_REQUIRED;
}

interface Listener {
	onUpdate(update: SessionUpdate): void;
	onPermission(req: RequestPermissionRequest): Promise<RequestPermissionResponse>;
}

interface SelectValue {
	value: string;
	name: string;
	description: string | null;
}

interface SessionState {
	config: SessionConfigOption[];
	/** Pre-config-option agents report models and modes separately (unstable ACP). */
	legacyModels: { current: string | null; available: SelectValue[] } | null;
	modes: SessionModeState | null;
	/** The mode the session started in, to restore after a read-only turn. */
	initialMode: string | null;
}

type SessionSetup = {
	configOptions?: SessionConfigOption[] | null;
	modes?: SessionModeState | null;
	models?: {
		currentModelId?: string;
		availableModels?: { modelId: string; name: string; description?: string | null }[];
	} | null;
};

function selectValues(opt: SessionConfigOption | undefined): SelectValue[] {
	if (opt?.type !== "select") return [];
	const out: SelectValue[] = [];
	for (const o of opt.options as (SessionConfigSelectOption | SessionConfigSelectGroup)[]) {
		const items = "group" in o ? o.options : [o];
		for (const i of items) out.push({ value: i.value, name: i.name, description: i.description ?? null });
	}
	return out;
}

function sessionState(res: SessionSetup): SessionState {
	const config = res.configOptions ?? [];
	const modeOption = config.find((o) => o.category === "mode");
	return {
		config,
		legacyModels: res.models?.availableModels
			? {
					current: res.models.currentModelId ?? null,
					available: res.models.availableModels.map((m) => ({
						value: m.modelId,
						name: m.name,
						description: m.description ?? null,
					})),
				}
			: null,
		modes: res.modes ?? null,
		initialMode: modeOption?.type === "select" ? modeOption.currentValue : (res.modes?.currentModeId ?? null),
	};
}

function modelsOf(s: SessionState): ProviderModel[] {
	const fromConfig = selectValues(s.config.find((o) => o.category === "model"));
	const list = fromConfig.length ? fromConfig : (s.legacyModels?.available ?? []);
	return list.map((m) => ({ id: m.value, name: m.name, description: m.description }));
}

function thinkingOf(s: SessionState): string[] {
	return selectValues(s.config.find((o) => o.category === "thought_level")).map((v) => v.value);
}

const LEVELS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];

/** The agent's closest reasoning level to the one you picked. */
export function pickLevel(wanted: string, available: { value: string; name: string }[]): string | null {
	const exact = available.find((v) => v.value.toLowerCase() === wanted || v.name.toLowerCase() === wanted);
	if (exact) return exact.value;
	const w = LEVELS.indexOf(wanted);
	const ranked = available
		.map((v) => ({ v, i: LEVELS.indexOf(v.value.toLowerCase()) }))
		.filter((x) => x.i >= 0)
		.sort((a, b) => Math.abs(a.i - w) - Math.abs(b.i - w) || b.i - a.i);
	return ranked[0]?.v.value ?? null;
}

const READ_ONLY_MODE = /read[\s_-]?only|^plan$|^ask$/i;

/** Token usage, when the agent reports it (ACP v2 preview adds usage to the prompt response). */
function usageOf(res: unknown): Usage {
	const u = (res as { usage?: Record<string, unknown> } | null)?.usage;
	if (!u) return EMPTY_USAGE;
	const n = (k: string) => (typeof u[k] === "number" ? (u[k] as number) : 0);
	return {
		inputTokens: n("inputTokens"),
		outputTokens: n("outputTokens"),
		reasoningTokens: n("thoughtTokens"),
		cachedTokens: n("cachedReadTokens"),
	};
}

// ---------------------------------------------------------------- process

/** npx isn't in every image (the Docker one is Bun-only); `bun x` runs the same packages. */
function resolveCommand(provider: Provider): string[] {
	if (provider.command === "npx" && !Bun.which("npx")) {
		return [process.execPath, "x", ...provider.args.filter((a) => a !== "-y" && a !== "--yes")];
	}
	return [provider.command, ...provider.args];
}

export class AcpHost {
	init!: InitializeResponse;
	readonly sessions = new Map<string, SessionState>();
	exited = false;
	stale = false;
	private active = 0;
	private idleTimer: ReturnType<typeof setTimeout> | null = null;
	private readonly listeners = new Map<string, Listener>();
	private readonly tail = new OutputTail();
	private readonly died: Promise<never>;
	private conn!: ClientConnection;

	private constructor(
		readonly provider: Provider,
		private readonly proc: Bun.Subprocess<"pipe", "pipe", "pipe">,
		private readonly onDispose: () => void,
	) {
		void pipeText(proc.stderr, (t) => this.tail.push(t));
		this.died = proc.exited.then((code) => {
			this.exited = true;
			this.onDispose();
			throw new Error(this.exitMessage(code));
		});
		this.died.catch(() => {});
	}

	static async start(
		provider: Provider,
		cwd: string,
		onDispose: () => void = () => {},
		job?: JobClient,
		signal?: AbortSignal,
	): Promise<AcpHost> {
		const env = acpEnv(provider);
		let proc: Bun.Subprocess<"pipe", "pipe", "pipe">;
		try {
			proc = Bun.spawn(resolveCommand(provider), {
				signal,
				cwd,
				env,
				stdin: "pipe",
				stdout: "pipe",
				stderr: "pipe",
			});
		} catch (err) {
			throw new Error(
				`Couldn't run "${provider.command}" (${errorMessage(err)}). Install ${provider.title}, or set the full path to it in Settings → Subscriptions.`,
			);
		}
		const host = new AcpHost(provider, proc, onDispose);
		const stdin = proc.stdin;
		const writable = new WritableStream<Uint8Array>({
			async write(chunk) {
				stdin.write(chunk);
				await stdin.flush();
			},
			close() {
				stdin.end();
			},
			abort() {
				stdin.end();
			},
		});
		const app = client({ name: "sekai" })
			.onRequest("session/request_permission", async ({ params }) => {
				const l = host.listeners.get(params.sessionId);
				return l ? l.onPermission(params) : { outcome: { outcome: "cancelled" } };
			})
			.onNotification("session/update", ({ params }) => {
				host.listeners.get(params.sessionId)?.onUpdate(params.update);
			});
		if (job) {
			app.onRequest("fs/read_text_file", ({ params: p }) => job.read(p.sessionId, p.path, p.line, p.limit))
				.onRequest("fs/write_text_file", ({ params: p }) => job.write(p.sessionId, p.path, p.content))
				.onRequest("terminal/create", ({ params: p }) => job.create(p.sessionId, p.command, p.args, p.cwd))
				.onRequest("terminal/output", ({ params: p }) => {
					const t = job.terminal(p.sessionId, p.terminalId);
					return {
						output: t.output,
						truncated: false,
						exitStatus: t.code === null ? null : { exitCode: t.code },
					};
				})
				.onRequest("terminal/wait_for_exit", async ({ params: p }) => {
					const t = job.terminal(p.sessionId, p.terminalId);
					await t.done;
					return { exitCode: t.code };
				})
				.onRequest("terminal/kill", ({ params: p }) => {
					job.terminal(p.sessionId, p.terminalId).abort.abort();
					return {};
				})
				.onRequest("terminal/release", ({ params: p }) => job.release(p.sessionId, p.terminalId));
		}
		host.conn = app.connect(ndJsonStream(writable, proc.stdout));
		try {
			host.init = await host.request(
				"initialize",
				{
					protocolVersion: PROTOCOL_VERSION,
					clientCapabilities: {
						fs: { readTextFile: Boolean(job), writeTextFile: Boolean(job) },
						terminal: Boolean(job),
					},
					clientInfo: { name: "sekai", title: "Sekai", version: APP_VERSION },
				},
				START_TIMEOUT_MS,
				`Starting ${provider.title}`,
			);
		} catch (err) {
			host.dispose();
			throw err;
		}
		return host;
	}

	private exitMessage(code: number | null): string {
		const tail = this.tail.last();
		return `${this.provider.title} stopped${code === null ? "" : ` (exit code ${code})`}${tail ? `:\n${tail}` : "."}`;
	}

	/** An agent request that fails fast if the process dies, with an optional timeout. */
	async request<T>(method: string, params: unknown, timeoutMs?: number, what?: string): Promise<T> {
		const call = this.conn.agent.request<T, unknown>(method, params);
		const raced = Promise.race([call, this.died]);
		return timeoutMs ? withTimeout(raced, timeoutMs, what ?? method) : raced;
	}

	notify(method: string, params: unknown): void {
		void this.conn.agent.notify(method, params).catch(() => {});
	}

	listen(sessionId: string, listener: Listener): () => void {
		this.listeners.set(sessionId, listener);
		return () => {
			if (this.listeners.get(sessionId) === listener) this.listeners.delete(sessionId);
		};
	}

	get supportsImages(): boolean {
		return Boolean(this.init.agentCapabilities?.promptCapabilities?.image);
	}

	get takesSystemPrompt(): boolean {
		return Boolean(this.init.agentCapabilities?.sessionCapabilities?.systemPrompt);
	}

	/** HTTP when the agent supports it; otherwise a stdio proxy (stdio is the one transport every agent has). */
	mcpServer(url: string): McpServer {
		if (this.init.agentCapabilities?.mcpCapabilities?.http)
			return { type: "http", name: "sekai", url, headers: [] };
		return {
			name: "sekai",
			command: process.execPath,
			args: [join(import.meta.dir, "mcp-stdio.ts"), url],
			env: [],
		};
	}

	retain(): void {
		this.active++;
		if (this.idleTimer) clearTimeout(this.idleTimer);
		this.idleTimer = null;
	}

	release(): void {
		this.active = Math.max(0, this.active - 1);
		if (this.active > 0) return;
		if (this.stale) {
			this.dispose();
			return;
		}
		this.idleTimer = setTimeout(() => this.dispose(), IDLE_MS);
	}

	get busy(): boolean {
		return this.active > 0;
	}

	dispose(): void {
		if (this.idleTimer) clearTimeout(this.idleTimer);
		this.onDispose();
		try {
			this.conn?.close();
		} catch {
			// Already closed.
		}
		if (!this.exited) {
			this.proc.kill();
			setTimeout(() => {
				if (!this.exited) this.proc.kill(9);
			}, 3000);
		}
	}
}

// ---------------------------------------------------------------- pool

const pool = new Map<string, Promise<AcpHost>>();

/** pi-acp closes other sessions in the same process on session/new or session/load. */
function hostKey(provider: Provider, session: RunnerInput["session"]): string {
	return provider.preset === "pi" ? `${provider.id}:${session.id}` : provider.id;
}

async function acquire(provider: Provider, session: RunnerInput["session"]): Promise<AcpHost> {
	const key = hostKey(provider, session);
	const existing = pool.get(key);
	if (existing) {
		const host = await existing.catch(() => null);
		if (host && !host.exited && !host.stale) {
			host.retain();
			return host;
		}
		if (pool.get(key) === existing) pool.delete(key);
	}
	const root = join(config.dataDir, "workspaces");
	const starting = AcpHost.start(provider, root, () => {
		if (pool.get(key) === starting) pool.delete(key);
	});
	pool.set(key, starting);
	try {
		const host = await starting;
		host.retain();
		return host;
	} catch (err) {
		if (pool.get(key) === starting) pool.delete(key);
		throw err;
	}
}

/** Settings changed or the provider was removed: restart its process once the current turn is done. */
export async function invalidateAcpHost(providerId: string): Promise<void> {
	const hosts = [...pool].filter(([key]) => key === providerId || key.startsWith(`${providerId}:`));
	for (const [key] of hosts) pool.delete(key);
	await Promise.all(
		hosts.map(async ([, pending]) => {
			const host = await pending.catch(() => null);
			if (!host) return;
			host.stale = true;
			if (!host.busy) host.dispose();
		}),
	);
}

export async function shutdownAcpHosts(): Promise<void> {
	const hosts = await Promise.all([...pool.values()].map((p) => p.catch(() => null)));
	pool.clear();
	for (const h of hosts) h?.dispose();
}

// ---------------------------------------------------------------- check + sign-in

export async function checkAcp(provider: Provider): Promise<Partial<ProviderStatus>> {
	const host = await AcpHost.start(provider, checkDir());
	try {
		const init = host.init;
		const base: Partial<ProviderStatus> = {
			agentName: init.agentInfo?.title || init.agentInfo?.name || provider.title,
			agentVersion: init.agentInfo?.version ?? null,
			vision: host.supportsImages,
			authMethods: (init.authMethods ?? []).map((m) => {
				const isTerm = "type" in m && m.type === "terminal";
				const args = isTerm && "args" in m && Array.isArray(m.args) ? m.args.map(String) : undefined;
				const env =
					isTerm && "env" in m && m.env && typeof m.env === "object"
						? Object.fromEntries(
								Object.entries(m.env as Record<string, unknown>).map(([k, v]) => [k, String(v)]),
							)
						: undefined;
				return {
					id: m.id,
					name: m.name,
					description: m.description ?? null,
					terminal: isTerm ? [provider.command, ...(args ?? provider.args)].join(" ") : null,
					...(args ? { args } : {}),
					...(env ? { env } : {}),
				};
			}),
		};
		try {
			const res = await host.request<SessionSetup & { sessionId: string }>(
				"session/new",
				{ cwd: checkDir(), mcpServers: [] },
				SESSION_TIMEOUT_MS,
				"Opening a session",
			);
			const s = sessionState(res);
			if (init.agentCapabilities?.sessionCapabilities?.close) {
				await host.request("session/close", { sessionId: res.sessionId }, 10_000).catch(() => {});
			}
			return { ...base, state: "ready", error: null, models: modelsOf(s), thinking: thinkingOf(s) };
		} catch (err) {
			if (isAuthRequired(err)) {
				return { ...base, state: "auth_required", error: `${provider.title} needs you to sign in.` };
			}
			throw err;
		}
	} finally {
		host.dispose();
	}
}

/** Runs an agent-handled sign-in method (for example, opening the browser on this computer). */
export async function authenticateAcp(provider: Provider, methodId: string): Promise<void> {
	const host = await AcpHost.start(provider, checkDir());
	try {
		await host.request("authenticate", { methodId }, 10 * 60_000, "Signing in");
	} finally {
		host.dispose();
	}
}

// ---------------------------------------------------------------- turn

const STATUS: Record<AcpToolStatus, ToolPart["status"]> = {
	pending: "pending",
	in_progress: "running",
	completed: "done",
	failed: "error",
};

function argsOf(raw: unknown): Record<string, unknown> {
	if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
	return raw === undefined || raw === null ? {} : { input: raw };
}

function json(v: unknown): string {
	try {
		return typeof v === "string" ? v : JSON.stringify(v);
	} catch {
		return "";
	}
}

function summarize(content: ToolCallContent[] | null | undefined, raw: unknown): string | undefined {
	const out: string[] = [];
	for (const c of content ?? []) {
		if (c.type === "content") {
			if (c.content.type === "text") out.push(c.content.text);
			else if (c.content.type === "resource_link") out.push(c.content.uri);
		} else if (c.type === "diff") {
			const before = c.oldText ? c.oldText.split("\n").length : 0;
			const after = c.newText.split("\n").length;
			out.push(
				c.oldText == null
					? `Created ${c.path} (${after} lines)`
					: `Edited ${c.path} (${before} → ${after} lines)`,
			);
		} else if (c.type === "terminal") {
			out.push("(terminal output)");
		}
	}
	if (out.length === 0 && raw !== undefined && raw !== null)
		out.push(typeof raw === "string" ? raw : JSON.stringify(raw, null, 2));
	return out.length ? truncateMiddle(out.join("\n\n"), 8000) : undefined;
}

function planText(entries: PlanEntry[]): string {
	return entries
		.map(
			(e) =>
				`- [${e.status === "completed" ? "x" : " "}] ${e.status === "in_progress" ? `**${e.content}**` : e.content}`,
		)
		.join("\n");
}

function toAcpBlocks(blocks: TurnBlock[], images: boolean): ContentBlock[] {
	return blocks.flatMap((b): ContentBlock[] => {
		if (b.type === "text") return [{ type: "text", text: b.text }];
		return images ? [{ type: "image", data: b.data, mimeType: b.mime }] : [];
	});
}

/** Turns one session's updates into Sekai message parts and answers its permission requests. */
class AcpTurn implements Listener {
	private readonly known = new Map<string, { kind: ToolKind; title: string; text: string }>();
	private readonly denied = new Set<string>();
	private planIndex: number | null = null;

	constructor(private readonly r: RunnerInput) {}

	private get writer() {
		return this.r.env.writer;
	}

	private content(block: ContentBlock, into: "text" | "reasoning"): void {
		let text = "";
		if (block.type === "text") text = block.text;
		else if (block.type === "resource_link") text = `[${block.title ?? block.name}](${block.uri})`;
		if (!text) return;
		if (into === "text") this.writer.appendText(text);
		else this.writer.appendReasoning(text);
	}

	private addCall(u: {
		toolCallId: string;
		title?: string | null;
		name?: string | null;
		kind?: string | null;
		status?: AcpToolStatus | null;
		rawInput?: unknown;
		content?: ToolCallContent[] | null;
		rawOutput?: unknown;
	}): void {
		const kind = asKind(u.kind);
		const title = u.title?.trim() || KIND_LABELS[kind];
		const text = `${title} ${u.name ?? ""} ${json(u.rawInput)}`;
		this.known.set(u.toolCallId, { kind, title, text });
		// Sekai tools reach the bridge too; whichever report arrives second joins the first.
		if (!AGENT_OWN_KINDS.has(kind) && this.r.state.noteExternalCall(u.toolCallId, u.title, u.name)) return;
		this.writer.addTool({
			id: u.toolCallId,
			name: u.name || `external_${kind}`,
			title,
			source: "external",
			category: "external",
			risk: gatedExternalTool(kind, this.r.provider.title, title).risk,
			args: argsOf(u.rawInput),
			status: STATUS[u.status ?? "pending"],
			startedAt: Date.now(),
		});
		if (u.status === "completed" || u.status === "failed") this.updateCall(u);
	}

	private updateCall(u: {
		toolCallId: string;
		title?: string | null;
		kind?: string | null;
		status?: AcpToolStatus | null;
		rawInput?: unknown;
		content?: ToolCallContent[] | null;
		rawOutput?: unknown;
	}): void {
		const id = u.toolCallId;
		if (this.r.state.isOwned(id) || this.denied.has(id)) return;
		const known = this.known.get(id);
		if (!known) {
			this.addCall(u);
			return;
		}
		const patch: Partial<ToolPart> = {};
		if (u.title?.trim()) patch.title = u.title.trim();
		if (u.rawInput !== undefined) patch.args = argsOf(u.rawInput);
		const part = this.writer.parts.find((p) => p.type === "tool" && p.id === id);
		const waiting = part?.type === "tool" && part.status === "awaiting_approval";
		if (u.status === "completed" || u.status === "failed") {
			const text = summarize(u.content, u.rawOutput);
			patch.status = STATUS[u.status];
			patch.endedAt = Date.now();
			if (u.status === "completed") patch.result = text ?? "Done";
			else patch.error = text ?? "Failed";
			const kind = asKind(u.kind ?? known.kind);
			if (u.status === "completed" && ["edit", "delete", "move", "execute"].includes(kind))
				this.r.state.sideEffects = true;
		} else if (u.status && !waiting) {
			patch.status = STATUS[u.status];
		}
		this.writer.updateTool(id, patch);
	}

	onUpdate(u: SessionUpdate): void {
		switch (u.sessionUpdate) {
			case "agent_message_chunk":
				this.content(u.content, "text");
				break;
			case "agent_thought_chunk":
				this.content(u.content, "reasoning");
				break;
			case "tool_call":
				if (this.known.has(u.toolCallId)) this.updateCall(u);
				else this.addCall(u);
				break;
			case "tool_call_update":
				this.updateCall(u);
				break;
			case "plan": {
				const text = planText(u.entries);
				if (this.planIndex === null) {
					this.planIndex = this.writer.addAdvisor({
						role: "planner",
						model: this.r.provider.title,
						text,
						status: "running",
					});
				} else {
					this.writer.updateAdvisor(this.planIndex, { text });
				}
				break;
			}
			case "notice":
				this.writer.notice(
					u.severity === "error" ? "error" : u.severity === "warning" ? "warning" : "info",
					[u.title, u.description].filter(Boolean).join(": "),
				);
				break;
			case "compaction_update":
				if (u.status === "completed")
					this.writer.notice("info", `${this.r.provider.title} compacted its context.`);
				break;
			default:
				break;
		}
	}

	async onPermission(req: RequestPermissionRequest): Promise<RequestPermissionResponse> {
		const pick = (kinds: string[]) => {
			for (const k of kinds) {
				const o = req.options.find((x) => x.kind === k);
				if (o) return { outcome: { outcome: "selected" as const, optionId: o.optionId } };
			}
			return { outcome: { outcome: "cancelled" as const } };
		};
		const allow = () => pick(["allow_once", "allow_always"]);
		const reject = () => pick(["reject_once", "reject_always"]);

		const call = req.toolCall;
		const known = this.known.get(call.toolCallId);
		const title = call.title?.trim() || known?.title;
		const kind = asKind(call.kind ?? known?.kind);
		// Sekai tools are gated by the bridge when they run; don't ask twice. Only a call that is exactly a Sekai
		// tool (by its label, and not a file/shell/fetch action) counts; anything unclear is gated here.
		const sekai =
			this.r.state.isOwned(call.toolCallId) ||
			(!AGENT_OWN_KINDS.has(kind) && this.r.state.sekaiToolIn(call.title, known?.title));
		if (sekai) return allow();

		if (!known) this.addCall({ ...call, status: "pending" });
		const tool = gatedExternalTool(kind, this.r.provider.title, title);
		const part = this.writer.parts.find((p) => p.type === "tool" && p.id === call.toolCallId);
		const args = argsOf(call.rawInput ?? (part?.type === "tool" ? part.args : undefined));
		try {
			const auth = await authorizeToolCall(this.r.env, call.toolCallId, tool, args);
			if (auth.allowed) {
				this.writer.updateTool(call.toolCallId, {
					status: "running",
					approval: auth.approval,
					reason: undefined,
				});
				if (tool.risk !== "read") this.r.state.sideEffects = true;
				return allow();
			}
			this.denied.add(call.toolCallId);
			this.writer.updateTool(call.toolCallId, {
				status: "denied",
				error: auth.content,
				approval: auth.approval,
				reason: undefined,
				endedAt: Date.now(),
			});
			return reject();
		} catch (err) {
			if (this.r.env.ctx.signal.aborted) return { outcome: { outcome: "cancelled" } };
			throw err;
		}
	}

	finish(stop: StopReason): void {
		this.writer.closeReasoning();
		if (this.planIndex !== null) this.writer.updateAdvisor(this.planIndex, { status: "done" });
		if (stop === "max_tokens") this.writer.notice("warning", "The reply hit the length limit.");
		if (stop === "max_turn_requests")
			this.writer.notice("warning", `${this.r.provider.title} stopped after too many steps.`);
		if (stop === "refusal") {
			throw new RefusalError(byosModelId(this.r.provider.id, this.r.model), "declined", "declined to continue");
		}
	}
}

const MUTED: Listener = {
	onUpdate() {},
	onPermission: async () => ({ outcome: { outcome: "cancelled" } }),
};

async function applyConfig(host: AcpHost, sessionId: string, r: RunnerInput): Promise<void> {
	const s = host.sessions.get(sessionId);
	if (!s) return;
	const set = async (configId: string, value: string) => {
		const res = await host.request<{ configOptions?: SessionConfigOption[] }>(
			"session/set_config_option",
			{ sessionId, configId, value },
			30_000,
		);
		if (res.configOptions) s.config = res.configOptions;
	};
	const option = (category: string) => s.config.find((o) => o.category === category && o.type === "select");

	if (r.model) {
		const opt = option("model");
		const values = selectValues(opt);
		if (opt?.type === "select" && values.length) {
			if (values.some((v) => v.value === r.model)) {
				if (opt.currentValue !== r.model) await set(opt.id, r.model);
			} else {
				const current = values.find((v) => v.value === opt.currentValue)?.name ?? opt.currentValue;
				r.env.writer.notice("warning", `${r.provider.title} doesn't offer ${r.model}; using ${current}.`);
			}
		} else if (s.legacyModels?.available.some((m) => m.value === r.model) && s.legacyModels.current !== r.model) {
			await host.request("session/set_model", { sessionId, modelId: r.model }, 30_000);
			s.legacyModels.current = r.model;
		}
	}

	if (r.thinking !== "default") {
		const opt = option("thought_level");
		const value = pickLevel(r.thinking, selectValues(opt));
		if (opt?.type === "select" && value && opt.currentValue !== value) await set(opt.id, value);
	}

	// Read-only in Sekai: switch the agent to its own read-only/plan mode when it has one.
	const readonly = r.env.ctx.approvalMode === "readonly";
	const modeOpt = option("mode");
	const modes =
		modeOpt?.type === "select"
			? selectValues(modeOpt).map((v) => ({ id: v.value, name: v.name }))
			: (s.modes?.availableModes ?? []);
	const currentMode = modeOpt?.type === "select" ? modeOpt.currentValue : (s.modes?.currentModeId ?? null);
	const target = readonly
		? modes.find((m) => READ_ONLY_MODE.test(m.id) || READ_ONLY_MODE.test(m.name))?.id
		: currentMode && READ_ONLY_MODE.test(currentMode) && s.initialMode && !READ_ONLY_MODE.test(s.initialMode)
			? s.initialMode
			: undefined;
	if (target && target !== currentMode) {
		if (modeOpt) await set(modeOpt.id, target);
		else {
			await host.request("session/set_mode", { sessionId, modeId: target }, 30_000);
			if (s.modes) s.modes = { ...s.modes, currentModeId: target };
		}
	}
}

export async function runAcpTurn(r: RunnerInput): Promise<RunnerResult> {
	const host = await acquire(r.provider, r.session);
	try {
		const mcpServers = r.provider.preset === "pi" ? [] : [host.mcpServer(r.mcpUrl)];
		const caps = host.init.agentCapabilities;
		let usage = EMPTY_USAGE;
		let sessionId = r.session.sessionId && host.sessions.has(r.session.sessionId) ? r.session.sessionId : null;
		let fresh = false;
		let delivered = false;

		// A session from before this process started: reload it if the agent can, so it keeps its memory.
		const previous = r.session.sessionId;
		if (!sessionId && previous && (caps?.loadSession || caps?.sessionCapabilities?.resume)) {
			const unmute = host.listen(previous, MUTED);
			try {
				const method = caps?.sessionCapabilities?.resume ? "session/resume" : "session/load";
				const res = await host.request<SessionSetup | null>(
					method,
					{ sessionId: previous, cwd: r.cwd, mcpServers },
					SESSION_TIMEOUT_MS,
					"Reopening the session",
				);
				host.sessions.set(previous, sessionState(res ?? {}));
				sessionId = previous;
			} catch (err) {
				if (isAuthRequired(err)) throw err;
				log.info(
					`${r.provider.title}: couldn't reopen session ${previous} (${errorMessage(err)}); starting a new one`,
				);
			} finally {
				unmute();
			}
		}

		if (!sessionId) {
			delivered = host.takesSystemPrompt;
			const res = await host.request<SessionSetup & { sessionId: string }>(
				"session/new",
				{
					cwd: r.cwd,
					mcpServers,
					...(delivered
						? { systemPrompt: { mode: "append", content: [{ type: "text", text: r.system }] } }
						: {}),
				},
				SESSION_TIMEOUT_MS,
				"Opening a session",
			);
			sessionId = res.sessionId;
			fresh = true;
			host.sessions.set(sessionId, sessionState(res));
			await r.onSession(sessionId);
		}

		await applyConfig(host, sessionId, r);
		const composed = await r.compose({
			fresh,
			instructions: fresh && !delivered ? "full" : "changes",
			images: host.supportsImages,
		});

		const signal = r.env.ctx.signal;
		// Stopped while the agent was starting or the turn was being put together: don't send it at all.
		if (signal.aborted) throw signal.reason ?? new DOMException("Cancelled", "AbortError");
		const turn = new AcpTurn(r);
		const unlisten = host.listen(sessionId, turn);
		const id = sessionId;
		// On cancel: tell the agent, give it a moment to wind down, then stop waiting.
		let grace: ReturnType<typeof setTimeout> | null = null;
		let giveUp: (reason: unknown) => void = () => {};
		const cancelled = new Promise<never>((_, reject) => {
			giveUp = reject;
		});
		cancelled.catch(() => {});
		const onAbort = () => {
			host.notify("session/cancel", { sessionId: id });
			grace = setTimeout(() => giveUp(signal.reason), 10_000);
		};
		signal.addEventListener("abort", onAbort, { once: true });
		try {
			const prompt = host.request<{ stopReason: StopReason }>("session/prompt", {
				sessionId,
				prompt: toAcpBlocks(composed.blocks, host.supportsImages),
			});
			const res = await Promise.race([prompt, cancelled]);
			if (signal.aborted || res.stopReason === "cancelled") {
				throw signal.reason ?? new DOMException("Cancelled", "AbortError");
			}
			turn.finish(res.stopReason);
			usage = usageOf(res);
		} finally {
			if (grace) clearTimeout(grace);
			unlisten();
			signal.removeEventListener("abort", onAbort);
		}
		return { sessionId, usage, composed };
	} catch (err) {
		if (err instanceof RefusalError) throw err;
		if (isAuthRequired(err)) {
			await setProviderStatus(r.provider.id, {
				state: "auth_required",
				error: `${r.provider.title} needs you to sign in.`,
			});
			throw new Error(`${r.provider.title} needs you to sign in. Open Settings → Subscriptions to see how.`);
		}
		if (err instanceof RequestError) throw new Error(`${r.provider.title}: ${truncate(err.message, 1000)}`);
		throw err;
	} finally {
		host.release();
	}
}
