import type { ChatMessage } from "../llm/types.ts";

/**
 * Keeping a long reply going. A bot works until it's done (with a generous safety limit on steps); these notice when
 * it's going in circles, and keep its context within the model's window as tool results pile up.
 */

/** Steps that called the same tools with the same arguments and got the same results, in a row. */
export class RepeatWatch {
	private last = "";
	private count = 0;

	/** Records a step; returns how many identical steps in a row that makes (1 for a new one). */
	step(signature: string): number {
		if (signature === this.last) this.count++;
		else {
			this.last = signature;
			this.count = 1;
		}
		return this.count;
	}
}

/** One step's fingerprint: its calls (name and arguments) and what came back (text, and each image's bytes). */
export function stepSignature(
	calls: { name: string; args: string }[],
	results: { content: string; images: { data: Uint8Array }[] }[],
): string {
	const parts = calls.map((c, i) => {
		const r = results[i];
		const images = r ? r.images.map((img) => Bun.hash(img.data).toString(36)).join(",") : "";
		return `${c.name}\u0000${c.args}\u0000${r ? Bun.hash(r.content).toString(36) : ""}\u0000${images}`;
	});
	return parts.join("\u0001");
}

/** After this many identical steps the bot is told to change course; after STOP_AFTER it stops. */
export const NUDGE_AFTER = 3;
export const STOP_AFTER = 5;

export const NUDGE_TEXT =
	"You've now done exactly the same thing several times and got the same result each time. Don't repeat it: try a different approach, or stop and tell the user what's blocking you.";

/** A rough token count: about four characters a token, and a fixed amount per image. */
export function estimateTokens(messages: ChatMessage[]): number {
	let chars = 0;
	let images = 0;
	for (const m of messages) {
		const content = (m as { content?: unknown }).content;
		if (typeof content === "string") chars += content.length;
		else if (Array.isArray(content)) {
			for (const p of content as { type: string; text?: string }[]) {
				if (p.type === "text") chars += p.text?.length ?? 0;
				else images++;
			}
		}
		const calls = (m as { tool_calls?: { function: { arguments: string } }[] }).tool_calls;
		if (calls) for (const c of calls) chars += c.function.arguments.length;
	}
	return Math.ceil(chars / 4) + images * 1600;
}

const TRIMMED = "… [an older result, shortened to save room]";
const KEEP_RECENT_RESULTS = 8;
const KEEP_CHARS = 400;

/**
 * When the messages come near the model's window, older tool results are shortened (the newest few stay whole), so
 * a long task never runs out of room. Returns how many were shortened.
 */
export function trimOldResults(messages: ChatMessage[], contextWindow: number, share = 0.6): number {
	if (estimateTokens(messages) < contextWindow * share) return 0;
	const results = messages
		.map((m, i) => ({ m, i }))
		.filter(({ m }) => m.role === "tool" && typeof m.content === "string");
	let trimmed = 0;
	for (const { m, i } of results.slice(0, Math.max(0, results.length - KEEP_RECENT_RESULTS))) {
		const content = m.content as string;
		if (content.length <= KEEP_CHARS + TRIMMED.length || content.endsWith(TRIMMED)) continue;
		messages[i] = { ...m, content: `${content.slice(0, KEEP_CHARS)}${TRIMMED}` } as ChatMessage;
		trimmed++;
		if (estimateTokens(messages) < contextWindow * share * 0.8) break;
	}
	return trimmed;
}
