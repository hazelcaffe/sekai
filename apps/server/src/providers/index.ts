import { isByosModel, parseByosModel } from "@sekai/shared";
import type { ToolCallEnv } from "../agent/loop.ts";
import type { BuiltPrompt } from "../agent/prompt.ts";
import { isSafetyError, looksLikeRefusal, RefusalError } from "../agent/refusal.ts";
import { modelName, runStrategy, type StrategyInput, type StrategyResult } from "../agent/strategies.ts";
import { errorMessage } from "../lib/errors.ts";
import { log } from "../lib/log.ts";
import { authenticateAcp, checkAcp, invalidateAcpHost, runAcpTurn, shutdownAcpHosts } from "./acp.ts";
import { checkClaude, runClaudeTurn } from "./claude.ts";
import { setAfterSignIn, shutdownSignInSessions } from "./signin.ts";
import {
	loadProviders,
	modelLabel,
	onProviderChange,
	providerStatus,
	requireProvider,
	setProviderStatus,
} from "./store.ts";
import { ExternalTurnError, runExternalTurn } from "./turn.ts";

export { handleBridgeRequest } from "./bridge.ts";
export { type SignInSocket, signInWebSocket, upgradeSignIn } from "./signin.ts";

function writtenSince(input: StrategyInput, start: number): string {
	return input.writer.parts
		.slice(start)
		.map((p) => (p.type === "text" ? p.text : ""))
		.join("")
		.trim();
}

function toolTitlesSince(input: StrategyInput, start: number): string[] {
	return input.writer.parts
		.slice(start)
		.flatMap((p) => (p.type === "tool" && p.status === "done" ? [p.title ?? p.name] : []));
}

const checking = new Map<string, Promise<void>>();

export async function initProviders(): Promise<void> {
	await loadProviders();
	onProviderChange((id) => void invalidateAcpHost(id));
	setAfterSignIn((id) => {
		void invalidateAcpHost(id);
		startCheck(id);
	});
}

export async function shutdownProviders(): Promise<void> {
	shutdownSignInSessions();
	await shutdownAcpHosts();
}

/** Starts the agent CLI, reads its models, reasoning levels and sign-in state. One check at a time. */
export function checkProvider(id: string): Promise<void> {
	const running = checking.get(id);
	if (running) return running;
	const job = (async () => {
		const provider = requireProvider(id);
		await setProviderStatus(id, { state: "checking", error: null });
		try {
			const result = provider.kind === "acp" ? await checkAcp(provider) : await checkClaude(provider);
			await setProviderStatus(id, { ...result, checkedAt: Date.now() });
		} catch (err) {
			log.warn(`check ${provider.title}: ${errorMessage(err)}`);
			await setProviderStatus(id, { state: "error", error: errorMessage(err), checkedAt: Date.now() });
		}
	})().finally(() => checking.delete(id));
	checking.set(id, job);
	return job;
}

export function startCheck(id: string): void {
	void checkProvider(id).catch(() => {});
}

/** Runs a sign-in method the agent offers (it may open a browser on this computer), then re-checks. */
export async function authenticateProvider(id: string, methodId: string): Promise<void> {
	const provider = requireProvider(id);
	if (provider.kind !== "acp") throw new Error("Sign in to Claude Code with `claude auth login` on this computer.");
	const method = providerStatus(id).authMethods.find((m) => m.id === methodId);
	if (method?.terminal) throw new Error(`Run this in a terminal on the computer running Sekai: ${method.terminal}`);
	await setProviderStatus(id, { state: "checking", error: null });
	try {
		await authenticateAcp(provider, methodId);
	} catch (err) {
		await setProviderStatus(id, { state: "auth_required", error: `Sign-in failed: ${errorMessage(err)}` });
		return;
	}
	await checkProvider(id);
}

/**
 * Writes the reply with the agent's subscription model. With a fallback strategy, a failure before anything
 * ran (no tool side effects) hands the reply to the next gateway model in the chain.
 */
export async function runByosReply(
	input: StrategyInput,
	extra: { prompt: BuiltPrompt; triggerText: string | null; restart?: boolean; before?: number },
): Promise<StrategyResult> {
	const byos = parseByosModel(input.primary.model);
	if (!byos) return runStrategy(input);
	const provider = requireProvider(byos.providerId);
	const env: ToolCallEnv = { ...input, priorActions: [] };
	const start = input.writer.parts.length;
	try {
		const result = await runExternalTurn({
			env,
			providerId: byos.providerId,
			model: byos.model,
			thinking: input.primary.thinking,
			prompt: extra.prompt,
			triggerText: extra.triggerText,
			restart: extra.restart,
			before: extra.before,
			runner: provider.kind === "acp" ? runAcpTurn : runClaudeTurn,
		});
		// A reply that reads like "I can't help with that" is checked, and handed on if it really is one.
		const retry = input.refusalRetry;
		const text = writtenSince(input, start);
		if (retry?.pick([input.primary.model]) && looksLikeRefusal(text)) {
			if (await retry.confirm(input.request, text, input.ctx.signal)) {
				throw new RefusalError(input.primary.model, "declined", text.slice(0, 300));
			}
		}
		return result;
	} catch (err) {
		if (input.ctx.signal.aborted) throw err;
		const refused =
			err instanceof RefusalError
				? err
				: isSafetyError(err)
					? new RefusalError(input.primary.model, "safety", errorMessage(err))
					: null;
		const next = refused ? input.refusalRetry?.pick([input.primary.model]) : null;
		if (refused && next) {
			input.writer.discardFrom(start);
			const name = modelLabel(input.primary.model);
			input.writer.notice(
				"info",
				`${name} ${refused.kind === "safety" ? "was stopped by a safety filter" : "declined"}, so ${await modelName(next.model)} answered instead.`,
			);
			// The next model starts from Sekai's history, so tell it what was already done this turn.
			const done = env.priorActions.length ? env.priorActions : toolTitlesSince(input, start);
			const r = await runStrategy({
				...input,
				primary: next,
				strategy: { type: "single" },
				messages: done.length
					? [
							...input.messages,
							{
								role: "system",
								content: `Earlier in this turn, before handing over to you, these actions were already done: ${done.join("; ")}. Don't repeat them.`,
							},
						]
					: input.messages,
			});
			return {
				...r,
				models: [input.primary.model, ...r.models],
				declined: [
					{ model: input.primary.model, reason: refused.kind === "safety" ? "safety filter" : "declined" },
					...(r.declined ?? []),
				],
			};
		}
		const fallbacks =
			input.strategy.type === "fallback" ? input.strategy.fallbacks.filter((f) => !isByosModel(f.model)) : [];
		const fallback = fallbacks[0];
		if (!fallback || (err instanceof ExternalTurnError && err.sideEffects)) throw err;
		input.writer.notice(
			"warning",
			`${modelLabel(input.primary.model)} failed (${errorMessage(err)}). Switching to ${fallback.model}.`,
		);
		const r = await runStrategy({
			...input,
			primary: fallback,
			strategy: { type: "fallback", fallbacks: fallbacks.slice(1) },
		});
		return { ...r, models: [input.primary.model, ...r.models] };
	}
}
