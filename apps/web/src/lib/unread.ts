/** What unread needs to know about a chat. */
export interface ChatSeenInfo {
	id: string;
	lastMessageAt?: number | null;
}

/**
 * A chat is unread when it has a message newer than the last time you saw it on this device, and newer than when
 * this device started keeping track (`since`: a new browser or phone doesn't light up every chat), unless it's the
 * one open now.
 */
export function isUnreadChat(
	chat: ChatSeenInfo | undefined,
	seen: Readonly<Record<string, number>>,
	since: number,
	openId?: string,
): boolean {
	if (!chat?.lastMessageAt || chat.id === openId) return false;
	return chat.lastMessageAt > Math.max(seen[chat.id] ?? 0, since);
}
