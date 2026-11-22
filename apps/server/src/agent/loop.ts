import type { ApprovalScope, ModelRef, RunStatus, ToolApproval, ToolRisk, Usage } from "@sekai/shared";
import { bus } from "../events/bus.ts";
import { errorMessage, isAbortError } from "../lib/errors.ts";
import { imageMime } from "../lib/mime.ts";
import { truncate } from "../lib/text.ts";
import { getModelInfo } from "../llm/catalog.ts";
import { streamChat } from "../llm/gateway.ts";
import { addUsage, type ChatMessage, type ChatToolCall, EMPTY_USAGE } from "../llm/types.ts";
import { saveUpload } from "../services/uploads.ts";
import { requestApproval } from "./approvals.ts";
import { gateFor, type RuleSets } from "./permissions.ts";
import { isSafetyError, isSafetyFinish, looksLikeRefusal, RefusalError } from "./refusal.ts";
import { reviewAsPrimary, reviewToolCall } from "./review.ts";
import { type ResolvedTool, type ToolContext, type ToolImage, type Toolset, toolOutput } from "./tools/index.ts";
import type { MessageWriter } from "./writer.ts";

export interface LoopInput {
	model: ModelRef;
	/** System prompt + history. Extended in place with this turn's assistant/tool messages. */
	messages: ChatMessage[];
	toolset: Toolset;
	ctx: ToolContext;
	writer: MessageWriter;
	maxSteps: number;
	maxTokens: number | null;
	temperature: number | null;
	webSearch: boolean;
	/** Model for auto-mode reviews. */
	reviewModel: ModelRef;
	/** What the user asked this turn, for the reviewer. */
	request: string;
	userName: string;
	approvalTimeoutMs: number;
	onStatus: (status: RunStatus) => void;
	/** Set when another model could take over: confirms whether a final reply that reads like a refusal is one. */
	checkRefusal?: (reply: string) => Promise<boolean>;
}

export interface LoopResult {
	usage: Usage;
	steps: number;
	/** Whether any tool actually ran (fallback strategies must not retry after side effects). */
	sideEffects: boolean;
}

interface PendingCall {
	id: string;
	name: string;
	args: string;
}

function parseArgs(raw: string): Record<string, unknown> | null {
	if (!raw.trim()) return {};
	try {
		const v = JSON.parse(raw) as unknown;
		return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}

/** Screenshot messages added during a turn; only the newest few are kept, older ones become a placeholder. */
const SCREENSHOTS = new WeakSet<ChatMessage>();
const KEEP_SCREENSHOTS = 2;

function forgetOldScreenshots(messages: ChatMessage[], keep: number): void {
	const shots = messages.filter((m) => SCREENSHOTS.has(m));
	for (const m of shots.slice(0, Math.max(0, shots.length - keep))) {
		const i = messages.indexOf(m);
		if (i >= 0) {
			messages[i] = { role: "user", content: "(An earlier screenshot was here; it was removed to save room.)" };
		}
		SCREENSHOTS.delete(m);
	}
}

async function canSee(model: string): Promise<boolean> {
	return (await getModelInfo(model))?.vision ?? false;
}

export async function runToolLoop(input: LoopInput): Promise<LoopResult> {
	const { writer, toolset, ctx } = input;
	let usage = EMPTY_USAGE;
	let sideEffects = false;
	const env: ToolCallEnv = { ...input, priorActions: [] };

	for (let step = 1; step <= input.maxSteps; step++) {
		const calls = new Map<number, PendingCall>();
		let stepText = "";
		let finishReason: string | null = null;
		const stream = streamChat({
			model: input.model.model,
			messages: input.messages,
			tools: toolset.chatTools,
			thinking: input.model.thinking,
			maxTokens: input.maxTokens,
			temperature: input.temperature,
			webSearch: input.webSearch,
			signal: ctx.signal,
			meter: { agentId: ctx.agent.id, purpose: "reply", runId: ctx.runId },
		});
		try {
			for await (const ev of stream) {
				switch (ev.type) {
					case "text":
						stepText += ev.delta;
						writer.appendText(ev.delta);
						break;
					case "reasoning":
						writer.appendReasoning(ev.delta);
						break;
					case "tool_call": {
						let call = calls.get(ev.index);
						if (!call) {
							call = { id: ev.id ?? `call_${step}_${ev.index}_${Date.now()}`, name: "", args: "" };
							calls.set(ev.index, call);
						}
						if (ev.id) call.id = ev.id;
						if (ev.name) call.name += ev.name;
						call.args += ev.argsDelta;
						break;
					}
					case "usage":
						usage = addUsage(usage, ev.usage);
						break;
					case "finish":
						finishReason = ev.reason;
						break;
				}
			}
		} catch (err) {
			// A provider's safety block (prompt or output flagged) is a refusal, not an outage.
			if (!isAbortError(err) && !ctx.signal.aborted && isSafetyError(err)) {
				throw new RefusalError(input.model.model, "safety", errorMessage(err), usage);
			}
			throw err;
		}
		writer.closeReasoning();
		if (isSafetyFinish(finishReason)) {
			throw new RefusalError(input.model.model, "safety", `stopped by a safety filter (${finishReason})`, usage);
		}

		const ordered = [...calls.entries()].sort((a, b) => a[0] - b[0]).map(([, c]) => c);
		if (ordered.length === 0) {
			if (input.checkRefusal && looksLikeRefusal(stepText) && (await input.checkRefusal(stepText))) {
				throw new RefusalError(input.model.model, "declined", truncate(stepText, 300), usage);
			}
			return { usage, steps: step, sideEffects };
		}

		const toolCalls: ChatToolCall[] = ordered.map((c) => ({
			id: c.id,
			type: "function",
			function: { name: c.name, arguments: c.args || "{}" },
		}));
		input.messages.push({ role: "assistant", content: stepText.trim() || null, tool_calls: toolCalls });

		const shots: { title: string; images: ToolImage[] }[] = [];
		for (const call of ordered) {
			const tool = toolset.byName.get(call.name);
			const args = parseArgs(call.args);
			writer.addTool({
				id: call.id,
				name: call.name,
				title: tool ? tool.title(args ?? {}) : call.name,
				source: tool?.source ?? "builtin",
				category: tool?.category,
				risk: tool?.risk,
				args: args ?? {},
				status: "pending",
				startedAt: Date.now(),
			});
			const result = await executeToolCall(env, call, tool, args);
			if (result.ran) sideEffects = sideEffects || tool?.risk !== "read";
			input.messages.push({ role: "tool", tool_call_id: call.id, content: result.content });
			if (result.images.length)
				shots.push({ title: tool?.title(args ?? {}) ?? call.name, images: result.images });
		}
		// Tool messages carry text only, so screenshots follow as one image message the model can look at.
		if (shots.length && (await canSee(input.model.model))) {
			const message: ChatMessage = {
				role: "user",
				content: [
					{ type: "text", text: "Screenshots from the tools you just used:" },
					...shots.flatMap((s) => [
						{ type: "text" as const, text: s.title },
						...s.images.map((img) => ({
							type: "image_url" as const,
							image_url: {
								url: `data:${imageMime(img.data, img.mime)};base64,${Buffer.from(img.data).toString("base64")}`,
							},
						})),
					]),
				],
			};
			SCREENSHOTS.add(message);
			input.messages.push(message);
			forgetOldScreenshots(input.messages, KEEP_SCREENSHOTS);
		}
	}

	writer.notice("warning", `Stopped after ${input.maxSteps} steps. Say "continue" to let me keep going.`);
	return { usage, steps: input.maxSteps, sideEffects };
}

/** What a tool call needs from its surroundings. The gateway loop and the BYOS tools bridge both provide it. */
export interface ToolCallEnv {
	toolset: Toolset;
	ctx: ToolContext;
	writer: MessageWriter;
	reviewModel: ModelRef;
	request: string;
	userName: string;
	approvalTimeoutMs: number;
	onStatus: (status: RunStatus) => void;
	/** Titles of tool calls made earlier this turn, for the reviewer. */
	priorActions: string[];
}

/** The parts of a tool the approval gate looks at. External agents' own tools (shell, edits) fit this too. */
export interface GatedTool {
	name: string;
	category: string;
	risk: ToolRisk;
	description: string;
	title: string;
	/** Always ask, with this reason (unless a rule allows the tool). */
	askFirst?: string | null;
}

export type Authorization =
	| { allowed: true; approval: ToolApproval }
	| { allowed: false; approval: ToolApproval; content: string };

/** Mirrors a remembered decision into this turn's rules, so it applies to the very next call too. */
function remember(rules: RuleSets, scope: ApprovalScope, approve: boolean, tool: GatedTool): void {
	const permission = approve ? "allow" : "off";
	const byKind = `category:${tool.category}`;
	switch (scope) {
		case "conversation":
			rules.conversation = { ...rules.conversation, [tool.name]: permission };
			break;
		case "agent_tool":
			rules.agent = { ...rules.agent, [tool.name]: permission };
			break;
		case "agent_category":
			rules.agent = { ...rules.agent, [byKind]: permission };
			break;
		case "global_tool":
			rules.global = { ...rules.global, [tool.name]: permission };
			break;
		case "global_category":
			rules.global = { ...rules.global, [byKind]: permission };
			break;
	}
}

/**
 * Decides whether a call may run: rules and the approval mode first, then the reviewer (auto mode) or you
 * (ask). Updates the call's tool part while it waits. The part must already exist in the writer.
 */
export async function authorizeToolCall(
	env: ToolCallEnv,
	callId: string,
	tool: GatedTool,
	args: Record<string, unknown>,
): Promise<Authorization> {
	const { writer, ctx } = env;
	let approval: ToolApproval | undefined;
	let gate = gateFor(tool, ctx.approvalMode, env.toolset.rules);

	if (gate.action === "review") {
		// "Primary bot decides": a teammate's action goes to the primary bot (the primary's own go to the reviewer).
		const { listAgents } = await import("../services/agents.ts");
		const primary =
			ctx.approvalMode === "primary"
				? (await listAgents()).find((a) => a.isPrimary && a.id !== ctx.agent.id && a.status === "active")
				: undefined;
		writer.updateTool(callId, {
			status: "pending",
			reason: primary ? `Checking with ${primary.name}…` : "Checking with the reviewer…",
		});
		const reviewInput = {
			agentName: ctx.agent.name,
			userName: env.userName,
			request: env.request,
			toolName: tool.name,
			toolTitle: tool.title,
			toolDescription: tool.description,
			risk: tool.risk,
			args,
			priorActions: env.priorActions,
			signal: ctx.signal,
		};
		const review = primary
			? await reviewAsPrimary(primary, reviewInput)
			: await reviewToolCall({ ...reviewInput, model: env.reviewModel });
		if (review.decision === "approve") {
			approval = { decision: "approved", by: primary ? "primary" : "reviewer", note: review.reason };
			gate = { action: "run", by: "mode" };
		} else {
			gate = { action: "ask", by: "mode", reason: review.reason };
		}
	}

	if (gate.action === "deny") {
		return {
			allowed: false,
			approval: { decision: "denied", by: gate.by, note: gate.reason },
			content: `Not allowed: ${gate.reason}`,
		};
	}

	if (gate.action === "ask") {
		const alwaysAsk = gate.alwaysAsk === true;
		writer.updateTool(callId, { status: "awaiting_approval", reason: gate.reason, alwaysAsk });
		env.onStatus("awaiting_approval");
		bus.emit({
			type: "notification",
			title: `${ctx.agent.name} needs your approval`,
			body: `${tool.title}. ${gate.reason}`,
			agentId: ctx.agent.id,
			conversationId: ctx.conversation.id,
			approval: { toolCallId: callId, alwaysAsk },
		});
		const outcome = await requestApproval(
			{
				toolCallId: callId,
				runId: ctx.runId,
				agentId: ctx.agent.id,
				conversationId: ctx.conversation.id,
				messageId: ctx.messageId,
				toolName: tool.name,
				title: tool.title,
				category: tool.category,
				risk: tool.risk,
				args,
				reason: gate.reason,
				alwaysAsk,
			},
			env.approvalTimeoutMs,
			ctx.signal,
		);
		env.onStatus("running");
		if (outcome.scope !== "once" && !alwaysAsk) remember(env.toolset.rules, outcome.scope, outcome.approve, tool);
		if (!outcome.approve) {
			const why =
				outcome.by === "timeout" ? "No response in time, so it was skipped." : "The user denied this action.";
			return {
				allowed: false,
				approval: { decision: "denied", by: outcome.by, note: why },
				content: `${why} Don't retry it; continue without it or ask the user.`,
			};
		}
		approval = {
			decision: "approved",
			by: "user",
			note: outcome.scope === "once" ? undefined : `Remembered (${outcome.scope})`,
		};
	} else if (!approval) {
		approval = { decision: "approved", by: gate.by, note: gate.action === "run" ? gate.note : undefined };
	}
	return { allowed: true, approval };
}

/** Screenshots tools took earlier in this reply (oldest first). */
function recentImages(writer: MessageWriter): string[] {
	return writer.parts.flatMap((p) => (p.type === "tool" ? (p.images ?? []) : []));
}

/** Gates and runs one Sekai tool call, recording the outcome on its tool part (which must already exist). */
export async function executeToolCall(
	env: ToolCallEnv,
	call: { id: string; name: string },
	tool: ResolvedTool | undefined,
	args: Record<string, unknown> | null,
): Promise<{ content: string; images: ToolImage[]; ran: boolean; failed: boolean }> {
	const { writer, ctx } = env;
	const finish = (
		status: "done" | "error" | "denied",
		content: string,
		approval?: ToolApproval,
		images: ToolImage[] = [],
		imageUrls?: string[],
	) => {
		writer.updateTool(call.id, {
			status,
			result: status === "done" ? content : undefined,
			error: status !== "done" ? content : undefined,
			approval,
			images: imageUrls,
			endedAt: Date.now(),
		});
		return { content, images, ran: status === "done", failed: status !== "done" };
	};

	if (!tool) return finish("error", `Error: unknown tool "${call.name}"`);
	if (!args) return finish("error", "Error: the arguments were not valid JSON. Try again.");

	const title = tool.title(args);
	const askFirst = tool.askFirst ? await tool.askFirst(args, ctx) : null;
	const risk = tool.riskFor ? await tool.riskFor(args, ctx) : tool.risk;
	if (risk !== tool.risk) writer.updateTool(call.id, { risk });
	const auth = await authorizeToolCall(env, call.id, { ...tool, title, askFirst, risk }, args);
	if (!auth.allowed) return finish("denied", auth.content, auth.approval);

	writer.updateTool(call.id, { status: "running", approval: auth.approval, reason: undefined });
	try {
		const { content, images, attachments } = toolOutput(
			await tool.run(args, { ...ctx, recentImages: () => recentImages(writer) }),
		);
		const failed = content.startsWith("Error");
		// Images for you go in the reply, right after the call that attached them.
		for (const a of attachments)
			writer.addPart({
				type: "image",
				alt: a.alt,
				url: a.url,
				name: a.name,
				width: a.width,
				height: a.height,
				source: a.source,
			});
		env.priorActions.push(`${title}${failed ? " (failed)" : ""}`);
		// Keep screenshots so you can see them in the chat too.
		const urls: string[] = [];
		for (const [i, img] of images.entries()) {
			const ext = img.mime === "image/jpeg" ? "jpg" : "png";
			const saved = await saveUpload(img.data, `${tool.name}-${i + 1}.${ext}`, img.mime).catch(() => null);
			if (saved) urls.push(saved.url);
		}
		return finish(failed ? "error" : "done", content, auth.approval, images, urls.length ? urls : undefined);
	} catch (err) {
		if (ctx.signal.aborted) throw err;
		env.priorActions.push(`${title} (failed)`);
		return finish("error", `Error: ${truncate(errorMessage(err), 2000)}`, auth.approval);
	}
}
