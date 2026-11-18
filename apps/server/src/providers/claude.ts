import {
	type CanUseTool,
	type Options,
	query,
	type SDKMessage,
	type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { byosModelId, type Provider, type ProviderStatus, type ThinkingSetting, type Usage } from "@sekai/shared";
import { authorizeToolCall } from "../agent/loop.ts";
import { RefusalError } from "../agent/refusal.ts";
import { errorMessage } from "../lib/errors.ts";
import { truncate, truncateMiddle } from "../lib/text.ts";
import { EMPTY_USAGE } from "../llm/types.ts";
import { claudeToolKind, claudeToolTitle, gatedExternalTool } from "./kinds.ts";
import { agentEnv, checkDir, OutputTail, withTimeout } from "./process.ts";
import { setProviderStatus } from "./store.ts";
import type { RunnerInput, RunnerResult, TurnBlock } from "./turn.ts";

/**
 * Claude through the Claude Agent SDK. Sekai drives the Claude Code that's installed and signed in on this
 * computer (or an ANTHROPIC_API_KEY you set). It never offers a claude.ai login of its own: Anthropic's
 * terms don't allow third-party apps to. Sessions are Claude Code's own and are resumed each turn.
 */

const SEKAI_TOOLS = "mcp__sekai__";

type Effort = NonNullable<Options["effort"]>;

function effortFor(thinking: ThinkingSetting): Effort | undefined {
	switch (thinking) {
		case "default":
			return undefined;
		case "none":
		case "minimal":
		case "low":
			return "low";
		default:
			return thinking;
	}
}

function baseOptions(provider: Provider, tail: OutputTail): Options {
	return {
		env: agentEnv(provider.env),
		// Your own Claude Code settings, hooks and CLAUDE.md files stay out of Sekai's agents.
		settingSources: [],
		stderr: (d) => tail.push(d),
		...(provider.command ? { pathToClaudeCodeExecutable: provider.command } : {}),
	};
}

const AUTH_ERROR = /authentication|invalid api key|\/login|not logged in|oauth|unauthorized|401|credential/i;

export async function checkClaude(provider: Provider): Promise<Partial<ProviderStatus>> {
	const tail = new OutputTail();
	const abort = new AbortController();
	let release: () => void = () => {};
	const hold = new Promise<void>((r) => {
		release = r;
	});
	// No prompt is sent: the check only starts Claude Code and reads what it reports.
	// biome-ignore lint/correctness/useYield: an input stream that stays open without sending anything
	async function* idle(): AsyncGenerator<SDKUserMessage> {
		await hold;
	}
	const q = query({
		prompt: idle(),
		options: {
			...baseOptions(provider, tail),
			cwd: checkDir(),
			abortController: abort,
			canUseTool: async () => ({ behavior: "deny", message: "Sekai is only checking the setup." }),
		},
	});
	try {
		const init = await withTimeout(q.initializationResult(), 90_000, "Starting Claude Code");
		const models = init.models
			.filter((m) => m.value !== "default")
			.map((m) => ({ id: m.value, name: m.displayName, description: m.description || null }));
		const efforts = [...new Set(init.models.flatMap((m) => m.supportedEffortLevels ?? []))];
		const a = init.account;
		const source = a.apiKeySource ?? a.tokenSource ?? null;
		const account = a.email
			? `${a.email}${a.subscriptionType ? ` (${a.subscriptionType})` : ""}`
			: source && source !== "none"
				? `signed in via ${source}`
				: null;
		return {
			state: "ready",
			error: null,
			agentName: "Claude Code",
			agentVersion: init.claude_code_version ?? null,
			models,
			thinking: efforts.length ? efforts : ["low", "medium", "high", "xhigh", "max"],
			account,
			vision: true,
			authMethods: [],
		};
	} catch (err) {
		const detail = tail.last();
		throw new Error(`${errorMessage(err)}${detail ? `\n${detail}` : ""}`);
	} finally {
		release();
		abort.abort();
		q.close();
	}
}

// ---------------------------------------------------------------- turn

interface StreamEvent {
	type: string;
	index?: number;
	content_block?: { type: string; id?: string; name?: string };
	delta?: { type: string; text?: string; thinking?: string; partial_json?: string };
}

interface ContentBlockLike {
	type: string;
	id?: string;
	name?: string;
	text?: string;
	thinking?: string;
	input?: unknown;
	tool_use_id?: string;
	is_error?: boolean;
	content?: unknown;
}

function resultText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return (content as ContentBlockLike[])
		.map((c) => (c.type === "text" ? (c.text ?? "") : c.type === "image" ? "[image]" : ""))
		.join("\n");
}

function toClaudeContent(blocks: TurnBlock[]): unknown[] {
	return blocks.map((b) =>
		b.type === "text"
			? { type: "text", text: b.text }
			: { type: "image", source: { type: "base64", media_type: b.mime, data: b.data } },
	);
}

function usageOf(u: Record<string, unknown> | undefined): Usage {
	if (!u) return EMPTY_USAGE;
	const n = (k: string) => (typeof u[k] === "number" ? (u[k] as number) : 0);
	return {
		inputTokens: n("input_tokens") + n("cache_read_input_tokens") + n("cache_creation_input_tokens"),
		outputTokens: n("output_tokens"),
		reasoningTokens: 0,
		cachedTokens: n("cache_read_input_tokens"),
	};
}

/** Maps Claude Code's message stream onto Sekai message parts. */
class ClaudeTurn {
	private readonly blocks = new Map<number, { id: string; name: string; json: string }>();
	private readonly skipped = new Set<number>();
	private readonly denied = new Set<string>();
	private readonly seen = new Set<string>();
	private streamed = false;
	private retried = false;
	lastError: string | null = null;

	constructor(private readonly r: RunnerInput) {}

	private get writer() {
		return this.r.env.writer;
	}

	ensureTool(id: string, name: string, input: Record<string, unknown>): void {
		if (this.seen.has(id)) {
			this.writer.updateTool(id, { args: input, title: claudeToolTitle(name, input) });
			return;
		}
		this.seen.add(id);
		const kind = claudeToolKind(name);
		this.writer.addTool({
			id,
			name,
			title: claudeToolTitle(name, input),
			source: "external",
			category: "external",
			risk: gatedExternalTool(kind, this.r.provider.title, null).risk,
			args: input,
			status: "pending",
			startedAt: Date.now(),
		});
	}

	readonly canUseTool: CanUseTool = async (name, input, opts) => {
		if (name.startsWith(SEKAI_TOOLS)) return { behavior: "allow", updatedInput: input };
		if (name === "AskUserQuestion") {
			return {
				behavior: "deny",
				message:
					"You can't ask questions mid-reply here. Ask the user in your reply; they'll answer in their next message.",
			};
		}
		const id = opts.toolUseID;
		this.ensureTool(id, name, input);
		const kind = claudeToolKind(name);
		const tool = gatedExternalTool(kind, this.r.provider.title, claudeToolTitle(name, input));
		try {
			const auth = await authorizeToolCall(this.r.env, id, tool, input);
			if (auth.allowed) {
				this.writer.updateTool(id, { status: "running", approval: auth.approval, reason: undefined });
				if (tool.risk !== "read") this.r.state.sideEffects = true;
				return { behavior: "allow", updatedInput: input };
			}
			this.denied.add(id);
			this.writer.updateTool(id, {
				status: "denied",
				error: auth.content,
				approval: auth.approval,
				reason: undefined,
				endedAt: Date.now(),
			});
			return { behavior: "deny", message: auth.content };
		} catch (err) {
			if (this.r.env.ctx.signal.aborted) return { behavior: "deny", message: "Cancelled", interrupt: true };
			throw err;
		}
	};

	private stream(ev: StreamEvent): void {
		this.streamed = true;
		switch (ev.type) {
			case "message_start":
				this.blocks.clear();
				this.skipped.clear();
				break;
			case "content_block_start": {
				const cb = ev.content_block;
				const index = ev.index ?? -1;
				if (
					cb &&
					(cb.type === "tool_use" || cb.type === "server_tool_use" || cb.type === "mcp_tool_use") &&
					cb.id
				) {
					const name = cb.name ?? "tool";
					// Sekai tools are shown (and gated) by the bridge when they run.
					if (name.startsWith(SEKAI_TOOLS)) this.skipped.add(index);
					else {
						this.blocks.set(index, { id: cb.id, name, json: "" });
						this.ensureTool(cb.id, name, {});
					}
				}
				break;
			}
			case "content_block_delta": {
				const d = ev.delta;
				if (!d) break;
				if (d.type === "text_delta" && d.text) this.writer.appendText(d.text);
				else if (d.type === "thinking_delta" && d.thinking) this.writer.appendReasoning(d.thinking);
				else if (d.type === "input_json_delta" && d.partial_json) {
					const b = this.blocks.get(ev.index ?? -1);
					if (b) b.json += d.partial_json;
				}
				break;
			}
			case "content_block_stop": {
				const b = this.blocks.get(ev.index ?? -1);
				if (b?.json) {
					try {
						const input = JSON.parse(b.json) as Record<string, unknown>;
						if (!this.denied.has(b.id))
							this.writer.updateTool(b.id, { args: input, title: claudeToolTitle(b.name, input) });
					} catch {
						// Partial JSON that never completed; the permission prompt carries the full input.
					}
				}
				break;
			}
			case "message_stop":
				this.writer.closeReasoning();
				break;
		}
	}

	handle(m: SDKMessage): void {
		switch (m.type) {
			case "stream_event":
				if (m.parent_tool_use_id === null) this.stream(m.event as StreamEvent);
				break;
			case "assistant": {
				if (m.error) this.lastError = m.error;
				const content = (m.message as { content?: ContentBlockLike[] }).content ?? [];
				for (const c of content) {
					if (c.type === "tool_use" && c.id && c.name && !c.name.startsWith(SEKAI_TOOLS)) {
						this.ensureTool(c.id, c.name, (c.input as Record<string, unknown>) ?? {});
					} else if (!this.streamed && m.parent_tool_use_id === null) {
						if (c.type === "text" && c.text) this.writer.appendText(c.text);
						if (c.type === "thinking" && c.thinking) this.writer.appendReasoning(c.thinking);
					}
				}
				break;
			}
			case "user": {
				const content = (m.message as { content?: unknown }).content;
				if (!Array.isArray(content)) break;
				for (const c of content as ContentBlockLike[]) {
					if (c.type !== "tool_result" || !c.tool_use_id || !this.seen.has(c.tool_use_id)) continue;
					if (this.denied.has(c.tool_use_id)) continue;
					const text = truncateMiddle(resultText(c.content), 8000);
					this.writer.updateTool(c.tool_use_id, {
						status: c.is_error ? "error" : "done",
						...(c.is_error ? { error: text || "Failed" } : { result: text || "Done" }),
						endedAt: Date.now(),
					});
				}
				break;
			}
			case "system":
				if (m.subtype === "api_retry" && !this.retried) {
					this.retried = true;
					this.writer.notice("warning", `Claude is retrying after an API error (${m.error}).`);
				} else if (m.subtype === "compact_boundary") {
					this.writer.notice("info", "Claude compacted its context.");
				}
				break;
			default:
				break;
		}
	}
}

async function attempt(r: RunnerInput, resume: string | null): Promise<RunnerResult> {
	const composed = await r.compose({ fresh: !resume, instructions: "never", images: true });
	const tail = new OutputTail();
	const abort = new AbortController();
	const signal = r.env.ctx.signal;
	// Stopped while the turn was being put together: don't start it.
	if (signal.aborted) throw signal.reason ?? new DOMException("Cancelled", "AbortError");
	const onAbort = () => abort.abort();
	signal.addEventListener("abort", onAbort, { once: true });

	let done: () => void = () => {};
	const finished = new Promise<void>((res) => {
		done = res;
	});
	// Streaming input stays open until the result arrives, so permission and MCP control messages keep flowing.
	async function* input(): AsyncGenerator<SDKUserMessage> {
		yield {
			type: "user",
			message: { role: "user", content: toClaudeContent(composed.blocks) } as SDKUserMessage["message"],
			parent_tool_use_id: null,
		};
		await finished;
	}

	const turn = new ClaudeTurn(r);
	const q = query({
		prompt: input(),
		options: {
			...baseOptions(r.provider, tail),
			cwd: r.cwd,
			abortController: abort,
			...(resume ? { resume } : {}),
			...(r.model ? { model: r.model } : {}),
			...(effortFor(r.thinking) ? { effort: effortFor(r.thinking) } : {}),
			systemPrompt: { type: "preset", preset: "claude_code", append: r.system },
			includePartialMessages: true,
			mcpServers: { sekai: { type: "http", url: r.mcpUrl } },
			allowedTools: ["mcp__sekai"],
			permissionMode: "default",
			canUseTool: turn.canUseTool,
		},
	});

	let sessionId = resume;
	let usage = EMPTY_USAGE;
	try {
		for await (const m of q) {
			if ("session_id" in m && m.session_id && m.session_id !== sessionId) {
				sessionId = m.session_id;
				await r.onSession(sessionId);
			}
			if (m.type === "result") {
				done();
				usage = usageOf(m.usage as unknown as Record<string, unknown>);
				if (m.subtype !== "success") throw new Error(m.errors.join("\n") || `Claude stopped (${m.subtype})`);
				if (m.is_error) throw new Error(m.result || turn.lastError || "Claude returned an error");
				if (m.stop_reason === "refusal") {
					throw new RefusalError(byosModelId(r.provider.id, r.model), "declined", "declined to continue");
				}
				continue;
			}
			turn.handle(m);
		}
	} catch (err) {
		if (signal.aborted) throw signal.reason ?? err;
		if (err instanceof RefusalError) throw err;
		const detail = tail.last(3);
		const message = `${errorMessage(err)}${detail && !errorMessage(err).includes(detail) ? `\n${detail}` : ""}`;
		throw new Error(message);
	} finally {
		done();
		signal.removeEventListener("abort", onAbort);
		q.close();
	}
	r.env.writer.closeReasoning();
	if (!sessionId) throw new Error("Claude Code didn't report a session");
	return { sessionId, usage, composed };
}

export async function runClaudeTurn(r: RunnerInput): Promise<RunnerResult> {
	try {
		try {
			return await attempt(r, r.session.sessionId);
		} catch (err) {
			// Claude Code's session files can be cleared; start over with the conversation so far.
			if (r.session.sessionId && /no conversation found|session.*not found/i.test(errorMessage(err))) {
				return await attempt(r, null);
			}
			throw err;
		}
	} catch (err) {
		if (r.env.ctx.signal.aborted || err instanceof RefusalError) throw err;
		const message = errorMessage(err);
		if (AUTH_ERROR.test(message)) {
			await setProviderStatus(r.provider.id, { state: "auth_required", error: truncate(message, 300) });
			throw new Error(
				`Claude Code isn't signed in (${truncate(message, 200)}). Run \`claude auth login\` on the computer running Sekai, or add ANTHROPIC_API_KEY in Connect apps → Subscriptions.`,
			);
		}
		throw err;
	}
}
