import { z } from "zod";
import { ThinkingSetting } from "./models.ts";

/** One prompt to several models at once, to see how they answer and what each costs. */
export const CompareRequest = z.object({
	prompt: z.string().trim().min(1).max(50_000),
	system: z.string().max(10_000).default(""),
	models: z.array(z.string().min(1).max(200)).min(1).max(4),
	thinking: ThinkingSetting.default("default"),
	maxTokens: z.number().int().min(16).max(16_000).default(2000),
});
export type CompareRequest = z.input<typeof CompareRequest>;

export type CompareEvent =
	| { type: "text"; model: string; delta: string }
	| { type: "reasoning"; model: string; delta: string }
	| {
			type: "done";
			model: string;
			/** From sending to the last word, and to the first. */
			ms: number;
			firstMs: number | null;
			inputTokens: number;
			outputTokens: number;
			/** US dollars at the price you set for the model; null when it has none. */
			cost: number | null;
	  }
	| { type: "error"; model: string; error: string }
	| { type: "end" };
