import { type CompareEvent, CompareRequest, isByosModel } from "@sekai/shared";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { badRequest, errorMessage } from "../lib/errors.ts";
import { streamChat } from "../llm/gateway.ts";
import { modelPrices } from "../services/usage.ts";
import { body } from "./util.ts";

/**
 * Compare models: the same prompt to up to four models at once, streamed side by side (server-sent events, each
 * data line one CompareEvent), with timing, tokens and cost. Counted in usage as background work.
 */
export const compareRoutes = new Hono().post("/", async (c) => {
	const req = await body(c, CompareRequest);
	const models = [...new Set(req.models)];
	if (models.some(isByosModel)) {
		throw badRequest("Subscription models only run as a bot's brain, so they can't be compared here.");
	}
	const prices = await modelPrices();
	return streamSSE(c, async (stream) => {
		const stop = new AbortController();
		stream.onAbort(() => stop.abort());
		const send = (ev: CompareEvent) => stream.writeSSE({ data: JSON.stringify(ev) });
		const messages = [
			...(req.system.trim() ? [{ role: "system" as const, content: req.system }] : []),
			{ role: "user" as const, content: req.prompt },
		];
		await Promise.all(
			models.map(async (model) => {
				const started = Date.now();
				let firstMs: number | null = null;
				let usage = { inputTokens: 0, outputTokens: 0 };
				try {
					for await (const ev of streamChat({
						model,
						messages,
						thinking: req.thinking,
						maxTokens: req.maxTokens,
						signal: stop.signal,
						meter: { agentId: null, purpose: "background" },
					})) {
						if (ev.type === "text" && ev.delta) {
							firstMs ??= Date.now() - started;
							await send({ type: "text", model, delta: ev.delta });
						} else if (ev.type === "reasoning" && ev.delta) {
							await send({ type: "reasoning", model, delta: ev.delta });
						} else if (ev.type === "usage") {
							usage = ev.usage;
						}
					}
					const p = prices[model];
					await send({
						type: "done",
						model,
						ms: Date.now() - started,
						firstMs,
						inputTokens: usage.inputTokens,
						outputTokens: usage.outputTokens,
						cost: p ? (usage.inputTokens * p.input + usage.outputTokens * p.output) / 1_000_000 : null,
					});
				} catch (err) {
					if (!stop.signal.aborted) await send({ type: "error", model, error: errorMessage(err) });
				}
			}),
		);
		await send({ type: "end" });
	});
});
