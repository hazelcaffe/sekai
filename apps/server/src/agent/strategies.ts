import type { ModelRef, ModelStrategy, Usage } from "@sekai/shared";
import { errorMessage } from "../lib/errors.ts";
import { getModelInfo } from "../llm/catalog.ts";
import { chat } from "../llm/gateway.ts";
import { addUsage, type ChatMessage, EMPTY_USAGE } from "../llm/types.ts";
import { type LoopInput, type LoopResult, runToolLoop } from "./loop.ts";
import { isSafetyError, RefusalError, type RefusalRetry } from "./refusal.ts";

/**
 * Model-combination strategies. Each one decides which models see the conversation and in what order;
 * the primary model always produces the final reply (with tools). Add a strategy by extending
 * ModelStrategy in @sekai/shared and adding a case here.
 */

export interface StrategyInput extends Omit<LoopInput, "model"> {
	primary: ModelRef;
	strategy: ModelStrategy;
	agentName: string;
	/** Another model takes over when one refuses (unset: refusals are final). */
	refusalRetry?: RefusalRetry;
}

export interface Declined {
	model: string;
	reason: string;
}

export interface StrategyResult {
	usage: Usage;
	steps: number;
	/** The model that wrote the final reply. */
	model: string;
	/** Every model that contributed. */
	models: string[];
	/** Models that refused this turn before another answered. */
	declined?: Declined[];
}

export async function modelName(id: string): Promise<string> {
	return (await getModelInfo(id))?.name ?? id;
}

/**
 * Runs the tool loop with one model; if it refuses (a safety stop or a confirmed "I can't help with that"),
 * the refusal is blanked out and the next retry model carries on with the same turn, tool results included.
 */
async function guardedLoop(
	input: StrategyInput,
	first: ModelRef,
	messages: ChatMessage[],
): Promise<LoopResult & { model: ModelRef; declined: Declined[] }> {
	const declined: Declined[] = [];
	const tried: string[] = [];
	const retry = input.refusalRetry;
	let model = first;
	let usage = EMPTY_USAGE;
	for (;;) {
		tried.push(model.model);
		const start = input.writer.parts.length;
		const next = retry && declined.length < retry.maxAttempts ? retry.pick(tried) : null;
		try {
			const r = await runToolLoop({
				...input,
				messages,
				model,
				checkRefusal:
					next && retry ? (reply) => retry.confirm(input.request, reply, input.ctx.signal) : undefined,
			});
			return { ...r, usage: addUsage(usage, r.usage), model, declined };
		} catch (err) {
			if (input.ctx.signal.aborted) throw err;
			const refusal =
				err instanceof RefusalError
					? err
					: isSafetyError(err)
						? new RefusalError(model.model, "safety", errorMessage(err))
						: null;
			if (!refusal) throw err;
			usage = addUsage(usage, refusal.usage);
			const name = await modelName(model.model);
			if (!next) {
				throw new Error(
					refusal.kind === "safety"
						? `${name} was stopped by a safety filter (${refusal.message}).`
						: `${name} declined: ${refusal.message}`,
				);
			}
			input.writer.discardFrom(start);
			input.writer.notice(
				"info",
				`${name} ${refusal.kind === "safety" ? "was stopped by a safety filter" : "declined"}, so ${await modelName(next.model)} answered instead.`,
			);
			declined.push({ model: model.model, reason: refusal.kind === "safety" ? "safety filter" : "declined" });
			model = next;
		}
	}
}

function tried(r: { model: ModelRef; declined: Declined[] }): string[] {
	return [...r.declined.map((d) => d.model), r.model.model];
}

function withSystemNote(messages: ChatMessage[], note: string): ChatMessage[] {
	const [first, ...rest] = messages;
	if (first?.role !== "system") return [{ role: "system", content: note }, ...messages];
	return [{ role: "system", content: `${first.content}\n\n${note}` }, ...rest];
}

/** Streams a tools-free consultation into an advisor part. */
async function consult(
	input: StrategyInput,
	ref: ModelRef,
	role: "planner" | "advisor",
	note: string,
): Promise<{ text: string; usage: Usage }> {
	const index = input.writer.addAdvisor({ role, model: ref.model, text: "", status: "running" });
	try {
		const result = await chat(
			{
				model: ref.model,
				thinking: ref.thinking,
				messages: withSystemNote(input.messages, note),
				maxTokens: 4000,
				signal: input.ctx.signal,
				meter: { agentId: input.ctx.agent.id, purpose: "reply", runId: input.ctx.runId },
			},
			(ev) => {
				if (ev.type === "text") input.writer.appendAdvisor(index, ev.delta);
			},
		);
		input.writer.updateAdvisor(index, { status: "done", text: result.text });
		return { text: result.text, usage: result.usage };
	} catch (err) {
		if (input.ctx.signal.aborted) throw err;
		input.writer.updateAdvisor(index, { status: "error", text: `Failed: ${errorMessage(err)}` });
		return { text: "", usage: EMPTY_USAGE };
	}
}

function toolNames(input: StrategyInput): string {
	return input.toolset.tools.map((t) => t.name).join(", ");
}

export async function runStrategy(input: StrategyInput): Promise<StrategyResult> {
	const { strategy } = input;
	switch (strategy.type) {
		case "single": {
			const r = await guardedLoop(input, input.primary, input.messages);
			return { usage: r.usage, steps: r.steps, model: r.model.model, models: tried(r), declined: r.declined };
		}

		case "planner": {
			const plan = await consult(
				input,
				strategy.planner,
				"planner",
				`# Your role this turn: planner
You are planning for ${input.agentName}; another model will carry out your plan and write the reply.
Don't reply to the user. Think the request through and output a concise, numbered plan: the goal, the steps
(name the tools to use where relevant; available: ${toolNames(input)}), pitfalls, and what the final reply
should contain. Keep it under 250 words.`,
			);
			const messages = plan.text
				? withSystemNote(
						input.messages,
						`# Plan from your planner (${strategy.planner.model})\n${plan.text}\n\nFollow this plan unless it's clearly wrong. Don't mention the planner.`,
					)
				: input.messages;
			const r = await guardedLoop(input, input.primary, messages);
			return {
				usage: addUsage(plan.usage, r.usage),
				steps: r.steps,
				model: r.model.model,
				models: [strategy.planner.model, ...tried(r)],
				declined: r.declined,
			};
		}

		case "council": {
			const views = await Promise.all(
				strategy.advisors.map((ref) =>
					consult(
						input,
						ref,
						"advisor",
						`# Your role this turn: advisor
You are one of several advisors to ${input.agentName}, who will write the final reply. You can't use tools.
Give your independent take on the latest message: the answer you'd give, key considerations, and anything
others might miss. Be direct; under 200 words.`,
					).then((v) => ({ ...v, model: ref.model })),
				),
			);
			const usable = views.filter((v) => v.text.trim());
			const messages = usable.length
				? withSystemNote(
						input.messages,
						`# Your council's views\n${usable.map((v) => `## ${v.model}\n${v.text}`).join("\n\n")}\n\nWeigh these views, resolve disagreements with your own judgment, and reply in your own voice. Don't mention the council unless it helps the user.`,
					)
				: input.messages;
			const r = await guardedLoop(input, input.primary, messages);
			return {
				usage: views.reduce((u, v) => addUsage(u, v.usage), r.usage),
				steps: r.steps,
				model: r.model.model,
				models: [...strategy.advisors.map((a) => a.model), ...tried(r)],
				declined: r.declined,
			};
		}

		case "fallback": {
			const chain = [input.primary, ...strategy.fallbacks];
			let usage = EMPTY_USAGE;
			const tried: string[] = [];
			for (const [i, ref] of chain.entries()) {
				tried.push(ref.model);
				const before = input.messages.length;
				try {
					const r = await guardedLoop(input, ref, input.messages);
					return {
						usage: addUsage(usage, r.usage),
						steps: r.steps,
						model: r.model.model,
						models: [...tried.slice(0, -1), ...r.declined.map((d) => d.model), r.model.model],
						declined: r.declined,
					};
				} catch (err) {
					if (input.ctx.signal.aborted) throw err;
					const next = chain[i + 1];
					// Never retry after tools have run: a second model would repeat their side effects.
					const ranTools = input.messages.slice(before).some((m) => m.role === "tool");
					if (!next || ranTools) throw err;
					input.messages.length = before;
					input.writer.notice(
						"warning",
						`${ref.model} failed (${errorMessage(err)}). Switching to ${next.model}.`,
					);
					usage = addUsage(usage, EMPTY_USAGE);
				}
			}
			throw new Error("No model in the fallback chain succeeded");
		}
	}
}
