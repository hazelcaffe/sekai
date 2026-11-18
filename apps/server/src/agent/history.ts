import type { Agent, Attachment, Conversation, Message, ToolPart } from "@sekai/shared";
import { truncateMiddle } from "../lib/text.ts";
import type { ChatContentPart, ChatMessage, ChatToolCall } from "../llm/types.ts";
import { listMessages } from "../services/messages.ts";
import { isTextFile, readUploadBase64, readUploadText } from "../services/uploads.ts";

export interface HistoryOptions {
	agent: Agent;
	conversation: Conversation;
	agents: Map<string, Agent>;
	userName: string;
	/** The message being generated right now; never part of its own context. */
	excludeMessageId?: string;
	/** Retrying an earlier answer: only messages from before it count. */
	before?: number;
	/** Attach real images (vision models); otherwise images become placeholders. */
	vision: boolean;
	/** Only the most recent N messages with images carry pixel data. */
	maxImageMessages?: number;
}

export interface BuiltHistory {
	messages: ChatMessage[];
	tokens: number;
	count: number;
	hasImages: boolean;
}

/** Older tool output is trimmed so long sessions don't drown in stale results. */
const OLD_TOOL_RESULT_CHARS = 2_000;
const RECENT_TOOL_RESULT_CHARS = 20_000;

function textOf(m: Message): string {
	return m.parts
		.filter((p) => p.type === "text")
		.map((p) => (p.type === "text" ? p.text : ""))
		.join("")
		.trim();
}

async function attachmentParts(atts: Attachment[], withPixels: boolean): Promise<ChatContentPart[]> {
	const out: ChatContentPart[] = [];
	for (const a of atts) {
		try {
			if (a.kind === "image") {
				if (withPixels && a.mime !== "image/svg+xml") {
					const { mime, base64 } = await readUploadBase64(a.id);
					out.push({ type: "image_url", image_url: { url: `data:${mime};base64,${base64}` } });
				} else {
					out.push({ type: "text", text: `[Image attached: ${a.name}]` });
				}
			} else if (a.mime === "application/pdf") {
				if (withPixels) {
					const { base64 } = await readUploadBase64(a.id);
					out.push({
						type: "file",
						file: { filename: a.name, file_data: `data:application/pdf;base64,${base64}` },
					});
				} else {
					out.push({ type: "text", text: `[PDF attached: ${a.name}]` });
				}
			} else if (isTextFile(a)) {
				const text = await readUploadText(a.id);
				out.push({ type: "text", text: `[File: ${a.name}]\n\`\`\`\n${text}\n\`\`\`` });
			} else {
				out.push({ type: "text", text: `[File attached: ${a.name} (${a.mime}, ${a.size} bytes)]` });
			}
		} catch {
			out.push({ type: "text", text: `[Attachment unavailable: ${a.name}]` });
		}
	}
	return out;
}

/** Rebuilds an agent's own message as assistant turns, interleaving tool calls with their results. */
function ownMessageTurns(m: Message, recent: boolean): ChatMessage[] {
	const turns: ChatMessage[] = [];
	let text = "";
	let calls: ToolPart[] = [];
	const limit = recent ? RECENT_TOOL_RESULT_CHARS : OLD_TOOL_RESULT_CHARS;
	const flush = () => {
		if (calls.length > 0) {
			const toolCalls: ChatToolCall[] = calls.map((c) => ({
				id: c.id,
				type: "function",
				function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) },
			}));
			turns.push({ role: "assistant", content: text.trim() || null, tool_calls: toolCalls });
			for (const c of calls) {
				const content =
					c.status === "done"
						? (c.result ?? "ok")
						: c.status === "denied"
							? "The user denied this action."
							: `Error: ${c.error ?? "not completed"}`;
				turns.push({ role: "tool", tool_call_id: c.id, content: truncateMiddle(content, limit) });
			}
		} else if (text.trim()) {
			turns.push({ role: "assistant", content: text.trim() });
		}
		text = "";
		calls = [];
	};
	for (const p of m.parts) {
		if (p.type === "text") {
			if (calls.length > 0) flush();
			text += p.text;
		} else if (p.type === "tool") {
			calls.push(p);
		}
	}
	flush();
	if (turns.length === 0 && m.status === "error") return [];
	return turns;
}

function speakerName(m: Message, agents: Map<string, Agent>): string {
	if (m.sender === "agent" && m.agentId) return agents.get(m.agentId)?.name ?? "Former agent";
	return "System";
}

/** Merges consecutive messages of the same role so every provider accepts the sequence. */
function normalize(messages: ChatMessage[]): ChatMessage[] {
	const out: ChatMessage[] = [];
	for (const m of messages) {
		const prev = out.at(-1);
		if (prev && prev.role === "user" && m.role === "user") {
			const a = typeof prev.content === "string" ? [{ type: "text" as const, text: prev.content }] : prev.content;
			const b = typeof m.content === "string" ? [{ type: "text" as const, text: m.content }] : m.content;
			prev.content = [...a, ...b];
			continue;
		}
		if (prev && prev.role === "assistant" && m.role === "assistant" && !prev.tool_calls && !m.tool_calls) {
			prev.content = [prev.content, m.content].filter(Boolean).join("\n\n");
			continue;
		}
		out.push(m);
	}
	// Some providers require the first turn to be from the user.
	if (out[0] && out[0].role !== "user") out.unshift({ role: "user", content: "(conversation start)" });
	// Collapse single text arrays back to strings for compactness.
	for (const m of out) {
		if (m.role === "user" && Array.isArray(m.content) && m.content.every((p) => p.type === "text")) {
			m.content = m.content.map((p) => (p.type === "text" ? p.text : "")).join("\n\n");
		}
	}
	return out;
}

export async function buildHistory(opts: HistoryOptions): Promise<BuiltHistory> {
	const { agent, conversation, agents } = opts;
	const all = await listMessages(conversation.id, { after: conversation.summaryUntil ?? undefined });
	const messages = all.filter(
		(m) =>
			m.id !== opts.excludeMessageId &&
			m.status !== "streaming" &&
			(opts.before === undefined || m.createdAt < opts.before),
	);
	const isGroup = conversation.kind === "group";
	const userLabel = opts.userName || "User";

	// Decide which messages carry real image/PDF data.
	const maxImages = opts.maxImageMessages ?? 4;
	const pixelIds = new Set(
		messages
			.filter((m) => m.attachments.some((a) => a.kind === "image" || a.mime === "application/pdf"))
			.slice(-maxImages)
			.map((m) => m.id),
	);
	const recentFrom = Math.max(0, messages.length - 6);

	const out: ChatMessage[] = [];
	let hasImages = false;
	for (const [i, m] of messages.entries()) {
		if (m.sender === "user") {
			const text = textOf(m);
			const withPixels = opts.vision && pixelIds.has(m.id);
			const atts = await attachmentParts(m.attachments, withPixels);
			if (atts.some((p) => p.type !== "text")) hasImages = true;
			const prefix = isGroup ? `[${userLabel}]: ` : "";
			const content: ChatContentPart[] = [];
			if (text || atts.length === 0) content.push({ type: "text", text: `${prefix}${text}` });
			content.push(...atts);
			out.push({ role: "user", content });
			continue;
		}
		if (m.sender === "agent" && m.agentId === agent.id) {
			if (m.meta.triggerText) {
				const label = m.meta.trigger === "reminder" ? "Reminder" : "Scheduled routine";
				out.push({ role: "user", content: `[${label} fired]\n${m.meta.triggerText}` });
			}
			if (m.meta.trigger === "reminder") {
				out.push({ role: "assistant", content: `(Reminder delivered) ${textOf(m)}` });
				continue;
			}
			out.push(...ownMessageTurns(m, i >= recentFrom));
			continue;
		}
		// Another agent, or a system notice: the agent hears it as attributed input.
		const text = textOf(m);
		if (!text) continue;
		const name = speakerName(m, agents);
		const hint = m.meta.trigger === "handoff" ? " (handoff to you)" : "";
		out.push({ role: "user", content: `[${name}${hint}]: ${text}` });
	}

	const normalized = normalize(out);
	const tokens = normalized.reduce((sum, m) => {
		const c = m.content;
		const size = typeof c === "string" ? c.length : JSON.stringify(c ?? "").length;
		const images = Array.isArray(c) ? c.filter((p) => p.type !== "text").length * 4_000 : 0;
		const calls = m.role === "assistant" && m.tool_calls ? JSON.stringify(m.tool_calls).length : 0;
		return sum + Math.ceil((size + calls) / 4) + images;
	}, 0);
	return { messages: normalized, tokens, count: messages.length, hasImages };
}
