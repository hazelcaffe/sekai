import {
	api,
	cn,
	sharedMachinesNote,
	useAccess,
	useAgents,
	useChannelLinks,
	useChannels,
	useConversations,
	useMachineUsers,
} from "@sekai/client";
import { type Agent, type Conversation, channelTitle } from "@sekai/shared";
import { Button, Confirm, Dialog, Input } from "@sekai/ui";
import { useMutation } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useShallow } from "zustand/react/shallow";
import { latestDirectByAgent, type MessagingChat, messagingChats } from "../../lib/navigation.ts";
import { isUnreadChat } from "../../lib/unread.ts";
import { useSeen } from "../../stores/seen.ts";
import { useUi } from "../../stores/ui.ts";
import {
	AgentRow,
	DmRow,
	GroupRow,
	RailAgent,
	RailGroup,
	type SidebarActions,
	SidebarContext,
	SidebarSection,
	useCurrentConversationId,
} from "./ChatRows.tsx";

/*
 * The chat list, shared by the sidebar (desktop and tablet), its collapsed rail and the phone's Chats screen:
 * pinned chats first, then one row per bot (its latest chat), then groups, then chats linked to Discord or Slack
 * (with the platform's mark). Hidden bots fold away at the bottom (and stay findable in search).
 */

type Target = { kind: "agent" | "group"; id: string; name: string };

interface Dm {
	key: string;
	agent: Agent;
	conversation: Conversation;
	type: MessagingChat["type"];
	who: string;
}

/** Everything the list shows, worked out once. */
function useChatListData() {
	const { data: agents = [] } = useAgents();
	const { data: conversations = [] } = useConversations();
	const { data: links = [] } = useChannelLinks();
	const { data: channels = [] } = useChannels();
	const seen = useSeen((s) => s.seen);
	const since = useSeen((s) => s.since) ?? Date.now();
	const markReadIn = useSeen((s) => s.markRead);
	const currentId = useCurrentConversationId();

	// Chats that belong to a messaging app: server channels, and DMs (older DMs shared the bot's main chat).
	const channelChats = useMemo(
		() => messagingChats(conversations, links, channels),
		[conversations, links, channels],
	);
	const latest = useMemo(
		() => latestDirectByAgent(conversations.filter((c) => !channelChats.has(c.id))),
		[conversations, channelChats],
	);
	const agentMap = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
	const current = conversations.find((c) => c.id === currentId);
	// The primary bot first, then your order (the cache isn't re-sorted when you pin one).
	const visible = agents
		.filter((a) => !a.hidden)
		.sort(
			(a, b) =>
				Number(b.isPrimary) - Number(a.isPrimary) ||
				Number(b.pinned) - Number(a.pinned) ||
				a.sortOrder - b.sortOrder ||
				a.createdAt - b.createdAt,
		);
	const hidden = agents.filter((a) => a.hidden);
	const byRecent = (a: Conversation, b: Conversation) =>
		(b.lastMessageAt ?? b.createdAt) - (a.lastMessageAt ?? a.createdAt);
	// Bot-to-bot threads (agent_ask) stay out of the list; they open from the chat that started them.
	const groups = conversations
		.filter((c) => c.kind === "group" && !c.archived && !c.settings.team && !channelChats.has(c.id))
		.sort(byRecent);
	const serverChats = conversations
		.filter((c) => channelChats.has(c.id) && !channelChats.get(c.id)?.dm && !c.archived)
		.sort(byRecent);
	const dms: Dm[] = conversations
		.filter((c) => channelChats.get(c.id)?.dm && !c.archived && c.agentId && !agentMap.get(c.agentId)?.hidden)
		.sort(byRecent)
		.flatMap((conversation) => {
			const agent = agentMap.get(conversation.agentId ?? "");
			const link = channelChats.get(conversation.id);
			return agent && link
				? [
						{
							key: conversation.id,
							agent,
							conversation,
							type: link.type,
							who: link.name.replace(/^DM with /, ""),
						},
					]
				: [];
		});
	const isUnread = (c: Conversation | undefined) => isUnreadChat(c, seen, since, currentId);
	const shown = [
		...visible.map((a) => latest.get(a.id)),
		...groups,
		...serverChats,
		...dms.map((d) => d.conversation),
	];
	const actions: SidebarActions = {
		isUnread,
		anyUnread: shown.some(isUnread),
		markRead: (chats) => markReadIn(chats.filter((c): c is Conversation => Boolean(c))),
		markAllRead: () => markReadIn(conversations.filter((c) => isUnreadChat(c, seen, since))),
		chatsOf: (agentId) =>
			conversations.filter((c) => c.kind === "direct" && c.agentId === agentId && !channelChats.has(c.id)),
		sections: ["pinned", "bots", "groups", "linked"],
	};
	return {
		agents,
		conversations,
		visible,
		hidden,
		groups,
		serverChats,
		dms,
		latest,
		agentMap,
		channelChats,
		current,
		currentId,
		isUnread,
		actions,
	};
}

/** Renaming and deleting a bot or a chat from its row's menu. */
function useRowDialogs(conversations: Conversation[], current: Conversation | undefined, currentId?: string) {
	const navigate = useNavigate();
	const [renaming, setRenaming] = useState<Target | null>(null);
	const [deleting, setDeleting] = useState<Target | null>(null);
	const rename = useMutation({
		mutationFn: async (r: Target) =>
			r.kind === "agent"
				? api.agents.update(r.id, { name: r.name })
				: api.conversations.update(r.id, { title: r.name }),
		onSuccess: () => setRenaming(null),
	});
	const machineUsers = useMachineUsers(deleting?.kind === "agent" ? deleting.id : null, deleting?.kind === "agent");
	const remove = useMutation({
		mutationFn: async (r: Target) =>
			r.kind === "agent" ? api.agents.delete(r.id) : api.conversations.delete(r.id),
		onSuccess: (_d, r) => {
			setDeleting(null);
			const viewing = r.kind === "group" ? r.id === currentId : current?.agentId === r.id;
			if (viewing) navigate("/");
		},
	});
	const dialogs = (
		<>
			<Dialog
				open={Boolean(renaming)}
				onOpenChange={(o) => !o && setRenaming(null)}
				title={renaming?.kind === "agent" ? "Rename bot" : "Rename group"}
				size="sm"
				footer={
					<>
						<Button variant="secondary" onClick={() => setRenaming(null)}>
							Cancel
						</Button>
						<Button
							variant="primary"
							disabled={!renaming?.name.trim() || rename.isPending}
							onClick={() => renaming && rename.mutate(renaming)}
						>
							Save
						</Button>
					</>
				}
			>
				<form
					onSubmit={(e) => {
						e.preventDefault();
						if (renaming?.name.trim()) rename.mutate(renaming);
					}}
				>
					<Input
						autoFocus
						aria-label="Name"
						value={renaming?.name ?? ""}
						onChange={(e) => setRenaming((r) => (r ? { ...r, name: e.target.value } : r))}
						maxLength={renaming?.kind === "agent" ? 60 : 200}
					/>
				</form>
			</Dialog>
			<Confirm
				open={Boolean(deleting)}
				onOpenChange={(o) => !o && setDeleting(null)}
				title={deleting?.kind === "agent" ? `Delete ${deleting.name}?` : `Delete “${deleting?.name}”?`}
				description={
					deleting?.kind === "agent"
						? [
								sharedMachinesNote(deleting.name, machineUsers),
								"This erases its profile, chats, memory, notes and routines. It can't be undone. To keep its work, hide it instead.",
							]
								.filter(Boolean)
								.join(" ")
						: conversations.find((c) => c.id === deleting?.id)?.kind === "group"
							? "The group and its messages will be deleted. The bots and their memory are kept."
							: "This chat and its messages are deleted from Sekai (not from Discord, Slack or Signal). The bot and its memory are kept."
				}
				confirmLabel="Delete"
				danger
				onConfirm={() => deleting && remove.mutate(deleting)}
			/>
		</>
	);
	return { setRenaming, setDeleting, dialogs };
}

/** "Discord", "Slack", or "Discord and Slack": the platforms linked chats come from. */
function linkedTitle(types: MessagingChat["type"][]): string {
	const names = [...new Set(types.map((t) => (t === "email" ? "Email" : channelTitle(t))))];
	return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : (names[0] ?? "Linked chats");
}

/** The chat list's sections (the sidebar and the phone's Chats screen). */
export function ChatList({ empty, className }: { empty?: ReactNode; className?: string }) {
	const d = useChatListData();
	// Only what this reads: the whole store changes on every keystroke (drafts) and every step of a reply.
	const ui = useUi(useShallow((s) => ({ setNewAgentOpen: s.setNewAgentOpen })));
	const { can } = useAccess();
	const [showHidden, setShowHidden] = useState(false);
	const { setRenaming, setDeleting, dialogs } = useRowDialogs(d.conversations, d.current, d.currentId);

	const agentRow = (a: Agent) => {
		const conv = d.latest.get(a.id);
		return (
			<AgentRow
				key={a.id}
				agent={a}
				conversation={conv}
				active={d.current?.kind === "direct" && d.current.agentId === a.id && !d.channelChats.has(d.current.id)}
				unread={d.isUnread(conv)}
				onRename={() => setRenaming({ kind: "agent", id: a.id, name: a.name })}
				onDelete={() => setDeleting({ kind: "agent", id: a.id, name: a.name })}
			/>
		);
	};
	const chatRow = (g: Conversation) => {
		const link: MessagingChat | undefined = d.channelChats.get(g.id);
		return (
			<GroupRow
				key={g.id}
				conversation={g}
				agents={d.agentMap}
				active={g.id === d.currentId}
				unread={d.isUnread(g)}
				title={link?.name}
				platform={link?.type}
				onRename={() => setRenaming({ kind: "group", id: g.id, name: g.title })}
				onDelete={() => setDeleting({ kind: "group", id: g.id, name: link?.name ?? g.title })}
			/>
		);
	};
	const dmRow = (dm: Dm) => (
		<DmRow
			key={dm.key}
			agent={dm.agent}
			conversation={dm.conversation}
			type={dm.type}
			who={dm.who}
			active={dm.conversation.id === d.currentId}
			unread={d.isUnread(dm.conversation)}
			onDelete={() =>
				setDeleting({
					kind: "group",
					id: dm.conversation.id,
					name:
						dm.type === "email" ? dm.conversation.title : `${dm.agent.name} · ${channelTitle(dm.type)} DM`,
				})
			}
		/>
	);

	const pinnedAgents = d.visible.filter((a) => a.pinned);
	const pinnedChats = [...d.groups, ...d.serverChats].filter((c) => c.pinned);
	const rest = d.visible.filter((a) => !a.pinned);
	const groups = d.groups.filter((g) => !g.pinned);
	// Linked chats (Discord or Slack channels and DMs), most recent first, each with its platform's mark.
	const linked = [
		...d.serverChats.filter((c) => !c.pinned).map((c) => ({ at: c.lastMessageAt ?? c.createdAt, row: chatRow(c) })),
		...d.dms.map((dm) => ({ at: dm.conversation.lastMessageAt ?? dm.conversation.createdAt, row: dmRow(dm) })),
	].sort((a, b) => b.at - a.at);
	const linkedTypes = [
		...d.serverChats.flatMap((c) => d.channelChats.get(c.id)?.type ?? []),
		...d.dms.map((dm) => dm.type),
	];
	let first = true;
	const isFirst = (count: number) => {
		const was = first && count > 0;
		if (count > 0) first = false;
		return was;
	};

	return (
		<SidebarContext.Provider value={d.actions}>
			<div className={cn("flex flex-col", className)}>
				{d.visible.length === 0 &&
					d.hidden.length === 0 &&
					(empty ??
						(can("bots") ? (
							<button
								type="button"
								onClick={() => ui.setNewAgentOpen(true)}
								className="w-full rounded-lg border border-dashed border-border-strong px-3 py-4 text-body text-fg-muted hover:bg-surface-2/50"
							>
								Create your first bot
							</button>
						) : (
							<p className="px-3 py-4 text-small text-fg-subtle">Bots shared with you show up here.</p>
						)))}
				<SidebarSection
					id="pinned"
					title="Pinned"
					count={pinnedAgents.length + pinnedChats.length}
					chats={[...pinnedAgents.map((a) => d.latest.get(a.id)), ...pinnedChats]}
					first={isFirst(pinnedAgents.length + pinnedChats.length)}
				>
					{pinnedAgents.map(agentRow)}
					{pinnedChats.map(chatRow)}
				</SidebarSection>
				<SidebarSection
					id="bots"
					title="Bots"
					count={rest.length}
					chats={rest.map((a) => d.latest.get(a.id))}
					first={isFirst(rest.length)}
				>
					{rest.map(agentRow)}
				</SidebarSection>
				<SidebarSection
					id="groups"
					title="Groups"
					count={groups.length}
					chats={groups}
					first={isFirst(groups.length)}
				>
					{groups.map(chatRow)}
				</SidebarSection>
				<SidebarSection
					id="linked"
					title={linkedTitle(linkedTypes)}
					count={linked.length}
					chats={[...d.serverChats.filter((c) => !c.pinned), ...d.dms.map((dm) => dm.conversation)]}
					first={isFirst(linked.length)}
				>
					{linked.map((l) => l.row)}
				</SidebarSection>

				{d.hidden.length > 0 && (
					<div className="pt-4">
						<button
							type="button"
							onClick={() => setShowHidden((v) => !v)}
							aria-expanded={showHidden}
							className="flex h-7 w-full items-center gap-1 px-2 text-caption font-medium text-fg-subtle hover:text-fg coarse:h-9"
						>
							Hidden bots ({d.hidden.length})
							<ChevronDown className={cn("size-4 transition-transform", showHidden && "rotate-180")} />
						</button>
						{showHidden &&
							d.hidden.map((a) => (
								<AgentRow
									key={a.id}
									agent={a}
									conversation={d.latest.get(a.id)}
									active={d.current?.kind === "direct" && d.current.agentId === a.id}
									unread={false}
									onRename={() => setRenaming({ kind: "agent", id: a.id, name: a.name })}
									onDelete={() => setDeleting({ kind: "agent", id: a.id, name: a.name })}
								/>
							))}
					</div>
				)}
			</div>
			{dialogs}
		</SidebarContext.Provider>
	);
}

/** The collapsed sidebar's bots and groups: an avatar each. */
export function RailChats() {
	const d = useChatListData();
	const { setRenaming, setDeleting, dialogs } = useRowDialogs(d.conversations, d.current, d.currentId);
	return (
		<SidebarContext.Provider value={d.actions}>
			{d.visible.map((a) => (
				<RailAgent
					key={a.id}
					agent={a}
					active={
						d.current?.kind === "direct" && d.current.agentId === a.id && !d.channelChats.has(d.current.id)
					}
					unread={d.isUnread(d.latest.get(a.id))}
					onRename={() => setRenaming({ kind: "agent", id: a.id, name: a.name })}
					onDelete={() => setDeleting({ kind: "agent", id: a.id, name: a.name })}
				/>
			))}
			{d.groups.map((g) => (
				<RailGroup
					key={g.id}
					conversation={g}
					agents={d.agentMap}
					active={g.id === d.currentId}
					unread={d.isUnread(g)}
					onRename={() => setRenaming({ kind: "group", id: g.id, name: g.title })}
					onDelete={() => setDeleting({ kind: "group", id: g.id, name: g.title })}
				/>
			))}
			{dialogs}
		</SidebarContext.Provider>
	);
}
