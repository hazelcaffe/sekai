import { type Agent, type Message, messageText } from "@sekai/shared";
import { errorMessage } from "../lib/errors.ts";
import { log } from "../lib/log.ts";
import { truncate } from "../lib/text.ts";
import { chat } from "../llm/gateway.ts";
import { getConversation, updateConversation } from "../services/conversations.ts";
import { getSettings } from "../services/settings.ts";
import { fastModelFor } from "./models.ts";

export async function generateTitle(conversationId: string, agent: Agent, messages: Message[]): Promise<void> {
	try {
		const settings = await getSettings();
		const transcript = messages
			.slice(0, 4)
			.map((m) => `${m.sender === "user" ? "User" : agent.name}: ${truncate(messageText(m), 1500)}`)
			.join("\n");
		if (!transcript.trim()) return;
		const model = await fastModelFor(agent, settings);
		const result = await chat({
			meter: { agentId: agent.id, purpose: "background" },
			model: model.model,
			thinking: "default",
			maxTokens: 200,
			messages: [
				{
					role: "system",
					content:
						"Write a short, specific title (2–6 words) for this conversation. No quotes, no trailing punctuation. Reply with the title only.",
				},
				{ role: "user", content: transcript },
			],
		});
		const title = result.text
			.trim()
			.replace(/^["'“”]+|["'“”.]+$/g, "")
			.slice(0, 80);
		const current = await getConversation(conversationId);
		if (title && current && current.title === "New chat") await updateConversation(conversationId, { title });
	} catch (err) {
		log.warn(`title generation failed: ${errorMessage(err)}`);
	}
}
