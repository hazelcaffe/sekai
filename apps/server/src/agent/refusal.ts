import { type Agent, isByosModel, type ModelInfo, type ModelRef, type Settings, type Usage } from "@sekai/shared";
import { errorMessage } from "../lib/errors.ts";
import { log } from "../lib/log.ts";
import { truncate } from "../lib/text.ts";
import { chat } from "../llm/gateway.ts";
import { EMPTY_USAGE } from "../llm/types.ts";
import { availableModels, fastModelFor, resolveModel } from "./models.ts";

/**
 * Refusals: a model declining the task, or a provider's safety filter stopping it. With refusal retry on,
 * another model answers the same turn and the refusal is left out of the conversation.
 */

export class RefusalError extends Error {
	constructor(
		readonly model: string,
		/** "safety": a filter or provider policy stopped it. "declined": the model said no. */
		readonly kind: "safety" | "declined",
		message: string,
		readonly usage: Usage = EMPTY_USAGE,
	) {
		super(message);
		this.name = "RefusalError";
	}
}

/** Finish reasons that mean a safety system stopped the reply (OpenAI, Anthropic, Gemini, xAI wordings). */
const SAFETY_FINISH = new Set([
	"content_filter",
	"refusal",
	"safety",
	"blocklist",
	"prohibited_content",
	"spii",
	"recitation",
	"image_safety",
]);

export function isSafetyFinish(reason: string | null | undefined): boolean {
	return Boolean(reason && SAFETY_FINISH.has(reason.toLowerCase()));
}

/** Gateway or provider errors that are a policy or safety block rather than an outage. */
const SAFETY_ERROR =
	/content[ _-]?(policy|filter|management)|safety (system|filter|settings|reasons)|flagged|moderation|harm_?category|prohibited content|responsible ai|usage polic(y|ies)|violat(es|ed|ion of) .{0,40}polic|invalid_prompt|data_inspection_failed|blocked (by|due|because)|output blocked|refus(al|ed to)\b(?! connect)/i;

export function isSafetyError(err: unknown): boolean {
	const msg = errorMessage(err);
	if (/ECONNREFUSED|connection refused/i.test(msg)) return false;
	return SAFETY_ERROR.test(msg);
}

/**
 * A short reply that reads like "I can't help with that". Only a hint: a classifier confirms it before any
 * retry, so ordinary answers that happen to start with "Sorry" aren't retried.
 */
const REFUSAL_OPENERS =
	/^\W*(i('m| am) (sorry|afraid|unable|not (able|comfortable|going))|i (can(no|')t|won't|will not|must decline|have to decline|need to decline|don't feel comfortable)|sorry,? (but )?i (can(no|')t|won't)|unfortunately,? i (can(no|')t|won't|am unable)|as an ai\b|i'm not in a position)/i;

export function looksLikeRefusal(text: string): boolean {
	const t = text.trim();
	if (!t || t.length > 1500) return false;
	return REFUSAL_OPENERS.test(t);
}

/** Asks the background model whether a reply refused the task. Errors count as "no" (never retry blindly). */
export async function confirmRefusal(opts: {
	request: string;
	reply: string;
	model: ModelRef;
	signal: AbortSignal;
}): Promise<boolean> {
	try {
		const result = await chat({
			model: opts.model.model,
			thinking: "default",
			maxTokens: 8,
			signal: AbortSignal.any([opts.signal, AbortSignal.timeout(20_000)]),
			messages: [
				{
					role: "system",
					content:
						"You check whether an AI assistant refused a request. Answer REFUSED if the reply declines to do what was asked (on policy, safety or capability grounds) instead of doing it. Answer OK if it does the task, partly does it, asks a genuine clarifying question, or explains a real limitation of its tools. Answer with one word.",
				},
				{
					role: "user",
					content: `Request:\n${truncate(opts.request || "(not shown)", 3000)}\n\nReply:\n${truncate(opts.reply, 3000)}`,
				},
			],
		});
		return /REFUSED/i.test(result.text);
	} catch (err) {
		log.warn(`refusal check failed: ${errorMessage(err)}`);
		return false;
	}
}

/**
 * Used after the models you picked: the default model, then the first model of every provider on offer (so a
 * refusal can always go to another provider, whatever the gateway serves).
 */
export function defaultRetryModels(catalog: ModelInfo[], defaultModel: ModelRef): ModelRef[] {
	const firsts = new Map<string, ModelRef>();
	for (const m of catalog) if (!firsts.has(m.provider)) firsts.set(m.provider, { model: m.id, thinking: "default" });
	return [resolveModel(defaultModel, catalog), ...firsts.values()];
}

/** The next candidate nobody has tried, preferring a provider that hasn't refused yet. */
export function nextRetryModel(
	candidates: ModelRef[],
	tried: string[],
	providerOf: (model: string) => string,
): ModelRef | null {
	const triedProviders = new Set(tried.map(providerOf));
	const fresh = candidates.filter((c) => !tried.includes(c.model));
	return fresh.find((c) => !triedProviders.has(providerOf(c.model))) ?? fresh[0] ?? null;
}

export interface RefusalRetry {
	/** The next model to try after these have refused, or null when there's none left. */
	pick(tried: string[]): ModelRef | null;
	/** Whether a reply that looks like a refusal really is one. */
	confirm(request: string, reply: string, signal: AbortSignal): Promise<boolean>;
	maxAttempts: number;
}

/**
 * The retry plan for an agent: your chosen retry models, then the agent's fallback chain, then the default model
 * and a model from every other provider. Only models on offer are tried, and a model from a different provider
 * than the one that refused goes first.
 */
export async function refusalRetryFor(agent: Agent, settings: Settings): Promise<RefusalRetry | undefined> {
	if (!settings.refusalRetry.enabled) return undefined;
	const catalog = await availableModels();
	if (!catalog?.length) return undefined;
	const byId = new Map(catalog.map((m) => [m.id, m]));
	const fallbacks = agent.models.strategy.type === "fallback" ? agent.models.strategy.fallbacks : [];
	const candidates: ModelRef[] = [
		...settings.refusalRetry.models,
		...fallbacks,
		...defaultRetryModels(catalog, settings.defaultModel),
	].filter((r) => !isByosModel(r.model) && byId.has(r.model));
	const providerOf = (id: string): string =>
		byId.get(id)?.provider ?? (isByosModel(id) ? "byos" : (id.split("-")[0] ?? id));
	return {
		maxAttempts: 2,
		pick: (tried) => nextRetryModel(candidates, tried, providerOf),
		confirm: async (request, reply, signal) =>
			confirmRefusal({ request, reply, model: await fastModelFor(agent, settings), signal }),
	};
}
