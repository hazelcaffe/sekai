import { api, qk, useChannelLinks, useChannels } from "@sekai/client";
import {
	CHANNEL_DEFINITIONS,
	type Channel,
	type ChannelBinding,
	type ChannelType,
	type Conversation,
} from "@sekai/shared";
import { errorMessage } from "@sekai/ui";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { useUi } from "../stores/ui.ts";

export interface MessagingChat {
	type: ChannelType;
	/** The platform's name for the chat ("DM with sam", "#general (server)"). */
	name: string;
	dm: boolean;
}

/**
 * Chats that belong to a messaging app (a Discord DM or server channel), by conversation id. A conversation counts
 * when it's linked to a platform chat and was made for it ("Discord: …"), or is a linked group chat; older DMs that
 * shared the bot's main chat don't, so the main chat stays the main chat.
 */
export function messagingChats(
	conversations: Conversation[],
	links: ChannelBinding[],
	channels: Pick<Channel, "id" | "type">[],
): Map<string, MessagingChat> {
	const platformOf = new Map(channels.map((c) => [c.id, c.type]));
	const byId = new Map(conversations.map((c) => [c.id, c]));
	const out = new Map<string, MessagingChat>();
	for (const l of links) {
		const type = platformOf.get(l.channelId);
		if (!type || out.has(l.conversationId)) continue;
		const c = byId.get(l.conversationId);
		const own = c?.title.startsWith(`${CHANNEL_DEFINITIONS[type]?.title ?? type}: `);
		if (l.isGroup || own) out.set(l.conversationId, { type, name: l.chatName, dm: !l.isGroup });
	}
	return out;
}

/** This chat's messaging app, if it belongs to one. */
export function useMessagingChat(conversation: Conversation | undefined): MessagingChat | null {
	const { data: links = [] } = useChannelLinks();
	const { data: channels = [] } = useChannels();
	return useMemo(
		() => (conversation ? (messagingChats([conversation], links, channels).get(conversation.id) ?? null) : null),
		[conversation, links, channels],
	);
}

/**
 * A bot's main chat: its latest direct chat in the app (not a Discord DM or channel, which are listed on their own),
 * else a new one from the server (which also says when the bot isn't there for you: a 404).
 */
export async function mainChatOf(qc: QueryClient, agentId: string): Promise<Conversation> {
	const list = qc.getQueryData<Conversation[]>(qk.conversations) ?? [];
	const inChannels = messagingChats(
		list,
		qc.getQueryData<ChannelBinding[]>(qk.channelLinks) ?? [],
		qc.getQueryData<Channel[]>(qk.channels()) ?? [],
	);
	const latest = list
		.filter((c) => c.kind === "direct" && c.agentId === agentId && !c.archived && !inChannels.has(c.id))
		.sort((a, b) => (b.lastMessageAt ?? b.createdAt) - (a.lastMessageAt ?? a.createdAt))[0];
	if (latest) return latest;
	const conversation = await api.agents.directConversation(agentId);
	qc.setQueryData<Conversation[]>(qk.conversations, (l) =>
		l && !l.some((c) => c.id === conversation.id) ? [...l, conversation] : l,
	);
	return conversation;
}

/** Where the app is now (to tell whether someone moved on while a chat was opening). */
const here = () => `${location.pathname}${location.search}${location.hash}`;

/**
 * Opens a bot's main chat. `replace` for redirects ("/", /bot/:id), so back doesn't land on them again. If it has
 * to ask the server and you've gone somewhere else meanwhile, it stays where you are; if that fails, it says so in
 * a toast. Resolves to whether it opened the chat.
 */
export function useOpenAgent() {
	const navigate = useNavigate();
	const qc = useQueryClient();
	return useCallback(
		async (agentId: string, { replace = false }: { replace?: boolean } = {}): Promise<boolean> => {
			useUi.getState().setSidebarOpen(false);
			const from = here();
			try {
				const chat = await mainChatOf(qc, agentId);
				if (here() !== from) return false;
				navigate(`/c/${chat.id}`, { replace });
				return true;
			} catch (err) {
				if (here() === from) toast.error(errorMessage(err));
				return false;
			}
		},
		[navigate, qc],
	);
}

/** The most recent direct conversation per agent. */
export function latestDirectByAgent(conversations: Conversation[] | undefined): Map<string, Conversation> {
	const map = new Map<string, Conversation>();
	for (const c of conversations ?? []) {
		if (c.kind !== "direct" || !c.agentId || c.archived) continue;
		const prev = map.get(c.agentId);
		const t = c.lastMessageAt ?? c.createdAt;
		if (!prev || t > (prev.lastMessageAt ?? prev.createdAt)) map.set(c.agentId, c);
	}
	return map;
}
