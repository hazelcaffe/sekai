import { z } from "zod";
import { AgentVoice } from "./voice.ts";

/** Every reasoning level any gateway model understands. Each model supports a subset (see ModelInfo). */
export const THINKING_LEVELS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export const ThinkingLevel = z.enum(THINKING_LEVELS);
export type ThinkingLevel = z.infer<typeof ThinkingLevel>;

/** "default" leaves the choice to the model. */
export const ThinkingSetting = z.union([ThinkingLevel, z.literal("default")]);
export type ThinkingSetting = z.infer<typeof ThinkingSetting>;

export const ModelRef = z.object({
	model: z.string().min(1),
	thinking: ThinkingSetting.default("default"),
});
export type ModelRef = z.infer<typeof ModelRef>;

/**
 * How an agent combines models for one reply.
 * - single: the primary model does everything.
 * - planner: a planner model thinks the request through first; the primary model executes with that plan.
 * - council: advisor models answer in parallel; the primary model synthesizes the final reply.
 * - fallback: the primary model runs; on failure the fallbacks are tried in order.
 */
export const STRATEGY_TYPES = ["single", "planner", "council", "fallback"] as const;
export type StrategyType = (typeof STRATEGY_TYPES)[number];

export const ModelStrategy = z.discriminatedUnion("type", [
	z.object({ type: z.literal("single") }),
	z.object({ type: z.literal("planner"), planner: ModelRef }),
	z.object({ type: z.literal("council"), advisors: z.array(ModelRef).min(1).max(4) }),
	z.object({ type: z.literal("fallback"), fallbacks: z.array(ModelRef).min(1).max(4) }),
]);
export type ModelStrategy = z.infer<typeof ModelStrategy>;

export const AgentModels = z.object({
	/** Talks to you and uses tools. */
	primary: ModelRef,
	/** Background work: titles, memory reflection, group routing, context compaction. Defaults to the primary model. */
	fast: ModelRef.nullable().default(null),
	/** Used instead of the primary model when a message has images and the primary model has no vision. */
	vision: ModelRef.nullable().default(null),
	strategy: ModelStrategy.default({ type: "single" }),
	/** Maximum model calls (tool-loop steps) per reply. */
	maxSteps: z.number().int().min(1).max(100).default(24),
	maxOutputTokens: z.number().int().positive().nullable().default(null),
	temperature: z.number().min(0).max(2).nullable().default(null),
	/** How it sounds and listens on calls, reading aloud and dictation. Empty fields use Admin → Voice. */
	voice: AgentVoice.prefault({}),
});
export type AgentModels = z.infer<typeof AgentModels>;
export type AgentModelsInput = z.input<typeof AgentModels>;

/** A model from the gateway catalog. */
export interface ModelInfo {
	id: string;
	name: string;
	provider: string;
	contextWindow: number;
	maxOutputTokens: number;
	thinkingLevels: ThinkingLevel[];
	vision: boolean;
	/** Set for models that run through one of your own subscriptions (an agent CLI) instead of the gateway. */
	byos?: { providerId: string; providerTitle: string; preset: string };
	/** Set for models from an API provider you added (OpenAI-, Anthropic- or Gemini-compatible). */
	api?: { providerId: string; providerName: string };
}

export const STRATEGY_LABELS: Record<StrategyType, { title: string; description: string }> = {
	single: { title: "Single model", description: "One model does the thinking, talking and tool use." },
	planner: {
		title: "Planner + executor",
		description: "A planner model thinks the request through first, then the primary model carries out the plan.",
	},
	council: {
		title: "Council",
		description: "Advisor models answer in parallel, then the primary model weighs their views and replies.",
	},
	fallback: {
		title: "Fallback chain",
		description: "If the primary model fails, the next model in the chain takes over.",
	},
};

export const THINKING_LABELS: Record<ThinkingSetting, string> = {
	default: "Auto",
	none: "Off",
	minimal: "Minimal",
	low: "Low",
	medium: "Medium",
	high: "High",
	xhigh: "Extra high",
	max: "Max",
};
