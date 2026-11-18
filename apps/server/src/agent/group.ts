import { type Agent, type Conversation, type Message, messageText } from "@sekai/shared";
import { errorMessage } from "../lib/errors.ts";
import { log } from "../lib/log.ts";
import { extractJson, truncate } from "../lib/text.ts";
import { chat } from "../llm/gateway.ts";
import { listMessages } from "../services/messages.ts";
import { getSettings } from "../services/settings.ts";
import { fastModelFor } from "./models.ts";

const EVERYONE = /(^|\s)@(everyone|all|here|team)\b/i;

function escapeRe(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Agents @mentioned in text, in the order they appear. Longer names win ("@Ada Lovelace" over "@Ada"). */
export function parseMentions(text: string, members: Agent[]): { ids: string[]; everyone: boolean } {
	const everyone = EVERYONE.test(text);
	const found: { id: string; at: number }[] = [];
	const taken: [number, number][] = [];
	for (const m of [...members].sort((a, b) => b.name.length - a.name.length)) {
		const re = new RegExp(`(^|[^\\w@])@${escapeRe(m.name)}(?![\\w-])`, "gi");
		for (const match of text.matchAll(re)) {
			const at = (match.index ?? 0) + (match[1]?.length ?? 0);
			if (taken.some(([s, e]) => at >= s && at < e)) continue;
			taken.push([at, at + m.name.length + 1]);
			if (!found.some((f) => f.id === m.id)) found.push({ id: m.id, at });
		}
	}
	return { ids: found.sort((a, b) => a.at - b.at).map((f) => f.id), everyone };
}

/** Decides which members answer a message in a group chat. */
export async function pickResponders(
	conversation: Conversation,
	message: Message,
	members: Agent[],
): Promise<string[]> {
	const active = members.filter((m) => m.status === "active");
	if (active.length === 0) return [];
	const text = messageText(message);

	const mentions = parseMentions(text, active);
	if (mentions.everyone) return active.map((m) => m.id);
	if (mentions.ids.length > 0) return mentions.ids;

	if (message.replyToId) {
		const thread = await listMessages(conversation.id, { limit: 200 });
		const target = thread.find((m) => m.id === message.replyToId);
		if (target?.agentId && active.some((a) => a.id === target.agentId)) return [target.agentId];
	}

	const first = active[0];
	if (active.length === 1 && first) return [first.id];
	return routeWithModel(conversation, message, active);
}

async function routeWithModel(conversation: Conversation, message: Message, members: Agent[]): Promise<string[]> {
	const fallback = members.find((m) => m.isPrimary) ?? members[0];
	const fallbackIds = fallback ? [fallback.id] : [];
	try {
		const settings = await getSettings();
		const recent = (await listMessages(conversation.id, { limit: 12 })).filter((m) => m.id !== message.id);
		const names = new Map(members.map((m) => [m.id, m.name]));
		const history = recent
			.map(
				(m) =>
					`${m.sender === "user" ? "User" : (names.get(m.agentId ?? "") ?? "Agent")}: ${truncate(messageText(m), 400)}`,
			)
			.join("\n");
		const roster = members
			.map(
				(m) =>
					`- ${m.name}${m.label ? ` (${m.label})` : ""}${m.isPrimary ? " [primary]" : ""}: ${truncate(m.job, 300) || "general assistant"}`,
			)
			.join("\n");
		const model = conversation.settings.routerModel ?? (await fastModelFor(fallback ?? null, settings));
		const result = await chat({
			model: model.model,
			thinking: model.thinking === "default" ? "low" : model.thinking,
			maxTokens: 400,
			messages: [
				{
					role: "system",
					content: `You route messages in a group chat between a user and AI agents. Pick who should reply to the user's latest message.
Usually pick exactly one agent: the one whose job fits best, or who was just talking with the user. Pick several only when the message clearly needs several perspectives or asks everyone. For greetings or general questions, pick the primary agent.
Members:
${roster}
${conversation.settings.purpose ? `Group purpose: ${conversation.settings.purpose}\n` : ""}Reply with JSON only: {"responders":["Name"]}`,
				},
				{
					role: "user",
					content: `${history ? `Recent messages:\n${history}\n\n` : ""}Latest message from the user:\n${truncate(messageText(message), 4000) || "(attachment)"}`,
				},
			],
		});
		const parsed = extractJson(result.text) as { responders?: unknown };
		const picked = Array.isArray(parsed.responders) ? parsed.responders.map(String) : [];
		const ids = picked
			.map((n) => members.find((m) => m.name.toLowerCase() === n.toLowerCase().replace(/^@/, ""))?.id)
			.filter((id): id is string => Boolean(id));
		return ids.length > 0 ? [...new Set(ids)] : fallbackIds;
	} catch (err) {
		log.warn(`group routing failed, using ${fallback?.name ?? "nobody"}: ${errorMessage(err)}`);
		return fallbackIds;
	}
}
