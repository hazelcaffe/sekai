import { type Agent, MEMORY_KINDS, type MemoryKind, type Message, messageText } from "@sekai/shared";
import { errorMessage } from "../lib/errors.ts";
import { log } from "../lib/log.ts";
import { extractJson, truncate } from "../lib/text.ts";
import { chat } from "../llm/gateway.ts";
import { createMemory, deleteMemory, getMemory, listMemories, updateMemory } from "../services/memories.ts";
import { getMessage, updateMessage } from "../services/messages.ts";
import { getSettings } from "../services/settings.ts";
import { fastModelFor } from "./models.ts";

/**
 * Auto-learn: after a reply, the fast model reads the exchange and keeps the agent's memory current,
 * the way a person jots down what they learned after a meeting. Usually it decides nothing is worth saving.
 */

interface ReflectionPlan {
	add?: { kind?: string; content?: string; shared?: boolean }[];
	update?: { id?: string; content?: string }[];
	remove?: string[];
}

const SYSTEM = `You maintain the long-term memory of an AI agent. Read the latest exchange and decide what, if anything,
is worth remembering for future conversations.

Save only durable information: facts about the user (name, location, time zone, work, people, projects),
stable preferences, lasting rules/boundaries the user set, important decisions, and notable completed work
(work_log: "YYYY-MM-DD: what was done → outcome"). Most exchanges contain nothing worth saving: return empty lists.

Never save: secrets (passwords, keys, card numbers), one-off task details, small talk, things the agent already saved
during this reply, or duplicates of existing memories. If an existing memory is now wrong or outdated, update it
(by id) instead of adding a new one; remove memories the user retracted.

kinds: ${MEMORY_KINDS.join(", ")}. shared=true only for about_user facts every agent should know.
Reply with JSON only: {"add":[{"kind":"...","content":"...","shared":false}],"update":[{"id":"...","content":"..."}],"remove":["id"]}`;

export async function reflect(agent: Agent, reply: Message, source: Message | null): Promise<void> {
	try {
		const settings = await getSettings();
		const replyText = messageText(reply);
		const sourceText = source ? messageText(source) : "";
		if (!replyText && !sourceText) return;
		const memories = await listMemories({ agentId: agent.id, includeShared: true, limit: 150 });
		const savedNow = reply.parts.flatMap((p) =>
			p.type === "tool" && p.name.startsWith("memory_") ? [`${p.name}: ${JSON.stringify(p.args)}`] : [],
		);
		const today = new Date().toISOString().slice(0, 10);
		const user = [
			`Agent: ${agent.name}${agent.label ? ` (${agent.label})` : ""}. User: ${settings.userName || "the user"}. Today: ${today}.`,
			`Existing memories:\n${memories.map((m) => `- [${m.id}] (${m.agentId ? m.kind : "shared"}) ${m.content}`).join("\n") || "(none)"}`,
			savedNow.length ? `Already saved by the agent during this reply:\n${savedNow.join("\n")}` : "",
			sourceText ? `Message to the agent:\n"""${truncate(sourceText, 6000)}"""` : "",
			`Agent's reply:\n"""${truncate(replyText, 6000)}"""`,
		]
			.filter(Boolean)
			.join("\n\n");
		const model = await fastModelFor(agent, settings);
		const result = await chat({
			meter: { agentId: agent.id, purpose: "background" },
			model: model.model,
			thinking: model.thinking === "default" ? "low" : model.thinking,
			maxTokens: 2000,
			messages: [
				{ role: "system", content: SYSTEM },
				{ role: "user", content: user },
			],
		});
		const plan = extractJson(result.text) as ReflectionPlan;
		const saved: string[] = [];
		for (const a of plan.add ?? []) {
			const kind = (MEMORY_KINDS as readonly string[]).includes(a.kind ?? "") ? (a.kind as MemoryKind) : "fact";
			const content = a.content?.trim();
			if (!content) continue;
			await createMemory({ agentId: a.shared && kind === "about_user" ? null : agent.id, kind, content }, "auto");
			saved.push(content);
		}
		for (const u of plan.update ?? []) {
			if (!u.id || !u.content?.trim()) continue;
			const m = await getMemory(u.id);
			if (!m || (m.agentId !== null && m.agentId !== agent.id)) continue;
			await updateMemory(u.id, { content: u.content.trim() });
			saved.push(u.content.trim());
		}
		let removed = 0;
		for (const id of plan.remove ?? []) {
			const m = await getMemory(id);
			if (!m || (m.agentId !== null && m.agentId !== agent.id)) continue;
			await deleteMemory(id);
			removed++;
		}
		if (saved.length === 0 && removed === 0) return;
		const current = await getMessage(reply.id);
		if (!current) return;
		const text = [
			saved.length ? `Saved to memory: ${saved.map((s) => truncate(s, 120)).join(" · ")}` : "",
			removed ? `Forgot ${removed} outdated ${removed === 1 ? "memory" : "memories"}` : "",
		]
			.filter(Boolean)
			.join(" · ");
		await updateMessage(reply.id, { parts: [...current.parts, { type: "notice", level: "info", text }] });
	} catch (err) {
		log.warn(`reflection failed for ${agent.name}: ${errorMessage(err)}`);
	}
}
