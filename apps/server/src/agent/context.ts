import type {
	Agent,
	AgentContext,
	ApprovalMode,
	ChannelOrigin,
	Conversation,
	RunTrigger,
	Settings,
} from "@sekai/shared";
import { estimateTokens } from "../lib/text.ts";
import { getModelInfo } from "../llm/catalog.ts";
import type { ChatMessage } from "../llm/types.ts";
import { listAgents } from "../services/agents.ts";
import { getDirectConversation, requireConversation } from "../services/conversations.ts";
import { listMessages } from "../services/messages.ts";
import { effectiveTimezone, getSettings } from "../services/settings.ts";
import { buildHistory } from "./history.ts";
import { resolveApprovalMode, ruleSets } from "./permissions.ts";
import { type BuiltPrompt, buildSystemPrompt } from "./prompt.ts";
import { describeTool, resolveToolset, type Toolset } from "./tools/index.ts";

export interface PreparedContext {
	settings: Settings;
	timezone: string;
	agents: Agent[];
	approvalMode: ApprovalMode;
	toolset: Toolset;
	prompt: BuiltPrompt;
	messages: ChatMessage[];
	historyTokens: number;
	historyCount: number;
	hasImages: boolean;
	vision: boolean;
}

/** Everything one turn needs: the system prompt, history and tools, from this agent's point of view. */
export async function prepareContext(opts: {
	agent: Agent;
	conversation: Conversation;
	trigger: RunTrigger;
	excludeMessageId?: string;
	/** Only history from before this time (retrying an earlier answer). */
	before?: number;
	model: string;
	/** The messaging channel this turn came in on, if any. */
	channel?: ChannelOrigin | null;
	/** Said on a call: answer like a phone call. */
	voiceCall?: boolean;
	/** A mention on X from this handle: the reply is posted there. */
	xFrom?: string;
}): Promise<PreparedContext> {
	const { agent, conversation } = opts;
	const [settings, agents, modelInfo] = await Promise.all([getSettings(), listAgents(), getModelInfo(opts.model)]);
	const timezone = await effectiveTimezone();
	const approvalMode = resolveApprovalMode(settings, agent, conversation);
	const toolset = await resolveToolset(agent, ruleSets(agent, conversation, settings));
	const vision = modelInfo?.vision ?? true;
	const history = await buildHistory({
		agent,
		conversation,
		agents: new Map(agents.map((a) => [a.id, a])),
		userName: settings.userName,
		excludeMessageId: opts.excludeMessageId,
		before: opts.before,
		vision,
	});
	const prompt = await buildSystemPrompt({
		agent,
		conversation,
		agents,
		userName: settings.userName,
		timezone,
		trigger: opts.trigger,
		webSearch: agent.capabilities.webSearch,
		hasMcpTools: toolset.tools.some((t) => t.source === "mcp"),
		hasLibrary: toolset.tools.some((t) => t.name === "library_search"),
		webTools: toolset.tools.filter((t) => t.category === "web").map((t) => t.name),
		approvalMode,
		channel: opts.channel ?? null,
		voiceCall: opts.voiceCall,
		xFrom: opts.xFrom,
	});
	return {
		settings,
		timezone,
		agents,
		approvalMode,
		toolset,
		prompt,
		messages: [{ role: "system", content: prompt.text }, ...history.messages],
		historyTokens: history.tokens,
		historyCount: history.count,
		hasImages: history.hasImages,
		vision,
	};
}

/** The Brain view: exactly what the agent would see if you messaged it now. */
export async function buildAgentContext(agent: Agent, conversationId?: string): Promise<AgentContext> {
	const conversation = conversationId
		? await requireConversation(conversationId)
		: await getDirectConversation(agent.id);
	const ctx = await prepareContext({ agent, conversation, trigger: "user", model: agent.models.primary.model });
	const info = await getModelInfo(agent.models.primary.model);
	const summarized = conversation.summaryUntil
		? (await listMessages(conversation.id)).filter((m) => m.createdAt <= (conversation.summaryUntil ?? 0)).length
		: 0;
	const toolTokens = estimateTokens(JSON.stringify(ctx.toolset.chatTools));
	const promptTokens = ctx.prompt.sections.reduce((n, s) => n + s.tokens, 0);
	return {
		agentId: agent.id,
		conversationId: conversation.id,
		model: agent.models.primary.model,
		approvalMode: ctx.approvalMode,
		contextWindow: info?.contextWindow ?? 200_000,
		systemPrompt: ctx.prompt.text,
		sections: [
			...ctx.prompt.sections,
			{
				id: "tools",
				title: "Tool definitions",
				content: ctx.toolset.tools.map((t) => `${t.name}: ${t.description}`).join("\n"),
				tokens: toolTokens,
			},
		],
		tools: ctx.toolset.tools.map((t) => describeTool(t, ctx.toolset.rules)),
		history: {
			messages: ctx.historyCount,
			tokens: ctx.historyTokens,
			summary: conversation.summary,
			summarizedMessages: summarized,
		},
		totalTokens: promptTokens + toolTokens + ctx.historyTokens,
	};
}
