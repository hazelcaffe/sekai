import type { Agent, Conversation, Message, Settings } from "@sekai/shared";
import { errorMessage } from "../lib/errors.ts";
import { log } from "../lib/log.ts";
import { truncate } from "../lib/text.ts";
import { chat } from "../llm/gateway.ts";
import { getAgent, listAgents } from "../services/agents.ts";
import { requireConversation, setConversationSummary } from "../services/conversations.ts";
import { listMessages } from "../services/messages.ts";
import { getSettings } from "../services/settings.ts";
import { fastModelFor } from "./models.ts";

const KEEP_RECENT = 16;

function transcript(messages: Message[], names: Map<string, string>, userName: string): string {
	return messages
		.map((m) => {
			const who =
				m.sender === "user" ? userName || "User" : m.agentId ? (names.get(m.agentId) ?? "Agent") : "System";
			const text = m.parts
				.filter((p) => p.type === "text")
				.map((p) => (p.type === "text" ? p.text : ""))
				.join("")
				.trim();
			const tools = m.parts.flatMap((p) => (p.type === "tool" ? [p.title ?? p.name] : []));
			const files = m.attachments.map((a) => a.name);
			const extra = [
				tools.length ? `(actions: ${tools.join("; ")})` : "",
				files.length ? `(files: ${files.join(", ")})` : "",
			]
				.filter(Boolean)
				.join(" ");
			return `${who}: ${truncate(text, 3000)}${extra ? ` ${extra}` : ""}`;
		})
		.join("\n\n");
}

/** Folds older messages into the conversation's rolling summary, keeping the most recent ones verbatim. */
export async function compactConversation(
	conversationId: string,
	opts: { agent?: Agent | null; keepRecent?: number } = {},
): Promise<Conversation> {
	const conversation = await requireConversation(conversationId);
	const settings = await getSettings();
	const keep = opts.keepRecent ?? KEEP_RECENT;
	const messages = (await listMessages(conversationId, { after: conversation.summaryUntil ?? undefined })).filter(
		(m) => m.status !== "streaming",
	);
	if (messages.length <= keep) return conversation;
	const older = messages.slice(0, messages.length - keep);
	const last = older.at(-1);
	if (!last) return conversation;

	const agent = opts.agent ?? (conversation.agentId ? await getAgent(conversation.agentId) : null) ?? null;
	const names = new Map((await listAgents()).map((a) => [a.id, a.name]));
	const model = await fastModelFor(agent, settings);
	const result = await chat({
		meter: { agentId: agent?.id ?? null, purpose: "background" },
		model: model.model,
		thinking: model.thinking,
		maxTokens: 4000,
		// It runs before the reply starts: a stalled model mustn't hold the chat (and Stop) hostage.
		signal: AbortSignal.timeout(120_000),
		messages: [
			{
				role: "system",
				content:
					"You maintain a running summary of a conversation between a user and AI agents, so the agents can keep working after older messages are dropped from their context. Write in the third person, past tense. Keep: decisions, commitments and open tasks (who owns them), facts and numbers that matter, files/links mentioned, preferences expressed, and where things were left. Drop small talk. Use short Markdown sections. Max ~500 words.",
			},
			{
				role: "user",
				content: `${conversation.summary ? `Existing summary:\n${conversation.summary}\n\n` : ""}New messages to fold in:\n\n${transcript(older, names, settings.userName)}\n\nWrite the updated summary.`,
			},
		],
	});
	const summary = result.text.trim();
	if (!summary) return conversation;
	log.info(`compacted ${older.length} messages in ${conversationId}`);
	return setConversationSummary(conversationId, summary, last.createdAt);
}

/** Compacts when the verbatim history is too long for the model or past the message limit. */
export async function maybeCompact(
	conversation: Conversation,
	agent: Agent,
	settings: Settings,
	contextWindow: number,
): Promise<Conversation> {
	try {
		const messages = await listMessages(conversation.id, { after: conversation.summaryUntil ?? undefined });
		const chars = messages.reduce((n, m) => n + JSON.stringify(m.parts).length, 0);
		const tokens = Math.ceil(chars / 4);
		const overTokens = tokens > contextWindow * settings.compactionThreshold;
		const overCount = messages.length > settings.contextMessageLimit;
		if (!overTokens && !overCount) return conversation;
		return await compactConversation(conversation.id, { agent });
	} catch (err) {
		log.warn(`compaction failed for ${conversation.id}: ${errorMessage(err)}`);
		return conversation;
	}
}
