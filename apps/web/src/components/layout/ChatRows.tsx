import { AgentAvatar, api, cn, GroupAvatar, shortTime } from "@sekai/client";
import { type Agent, CHANNEL_DEFINITIONS, type ChannelType, type Conversation } from "@sekai/shared";
import { ContextMenu, type MenuEntry, Row, StatusDot, Tooltip } from "@sekai/ui";
import { useMutation } from "@tanstack/react-query";
import {
	CheckCheck,
	ChevronDown,
	ChevronsDownUp,
	ChevronsUpDown,
	EyeOff,
	MailCheck,
	MessageSquareText,
	Pencil,
	Pin,
	PinOff,
	SlidersHorizontal,
	Trash2,
} from "lucide-react";
import { createContext, type ReactNode, useContext } from "react";
import { useLocation, useNavigate } from "react-router";
import { useShallow } from "zustand/react/shallow";
import { useOpenAgent } from "../../lib/navigation.ts";
import { type Presence, useAgentPresence, useUi } from "../../stores/ui.ts";
import { ChannelIcon } from "../channels/ChannelIcon.tsx";
import { chatPreview } from "../chat/chat-text.ts";

/*
 * The rows of the chat list (the sidebar, the phone's Chats screen and the collapsed rail): a bot (its latest chat),
 * a group or a chat linked to Discord or Slack, and their menus. ChatList.tsx decides which rows go where.
 */

export function useCurrentConversationId(): string | undefined {
	const { pathname } = useLocation();
	return pathname.match(/^\/c\/([^/]+)/)?.[1];
}

// ---------------------------------------------------------------- reading, sections and menus

/** Unread state and marking chats read, for the sidebar's menus. */
export interface SidebarActions {
	isUnread(c: Conversation | undefined): boolean;
	/** Anything in the sidebar is unread. */
	anyUnread: boolean;
	markRead(chats: (Conversation | undefined)[]): void;
	markAllRead(): void;
	/** A bot's own chats in the app (not its Discord ones). */
	chatsOf(agentId: string): Conversation[];
	/** The sections on screen, for collapse all / expand all. */
	sections: string[];
}

export const SidebarContext = createContext<SidebarActions | null>(null);

export function useSidebar(): SidebarActions {
	const ctx = useContext(SidebarContext);
	if (!ctx) throw new Error("useSidebar outside the sidebar");
	return ctx;
}

/** "Mark as read" for these chats, and "Mark all as read", at the top of a menu. */
export function readEntries(actions: SidebarActions, chats: (Conversation | undefined)[]): MenuEntry[] {
	return [
		{
			label: "Mark as read",
			icon: <CheckCheck />,
			disabled: !chats.some((c) => actions.isUnread(c)),
			onSelect: () => actions.markRead(chats),
		},
		{
			label: "Mark all as read",
			icon: <MailCheck />,
			disabled: !actions.anyUnread,
			onSelect: actions.markAllRead,
		},
		"-",
	];
}

/** Everything you can do with a bot, for its row's "…" menu, a right-click, or a long press. */
function useAgentMenu(agent: Agent): MenuEntry[] {
	const actions = useSidebar();
	const navigate = useNavigate();
	const update = useMutation({
		mutationFn: (patch: Parameters<typeof api.agents.update>[1]) => api.agents.update(agent.id, patch),
	});
	return [
		readEntries(actions, actions.chatsOf(agent.id))[0],
		{
			label: "Bot settings",
			icon: <SlidersHorizontal />,
			onSelect: () => {
				useUi.getState().setSidebarOpen(false);
				navigate(`/bots/${agent.id}`);
			},
		},
		// A bot shared with you is its owner's to change.
		...(agent.sharedBy
			? []
			: ([
					{
						label: agent.pinned ? "Unpin" : "Pin to top",
						icon: agent.pinned ? <PinOff /> : <Pin />,
						onSelect: () => update.mutate({ pinned: !agent.pinned }),
					},
					{
						label: agent.hidden ? "Show in Chats" : "Hide from Chats",
						icon: <EyeOff />,
						onSelect: () => update.mutate({ hidden: !agent.hidden }),
					},
				] satisfies MenuEntry[])),
	];
}

/** A group chat's or Discord chat's menu. */
export function useChatMenu(
	conversation: Conversation,
	{ onRename, onDelete, pinnable = true }: { onRename?: () => void; onDelete: () => void; pinnable?: boolean },
): MenuEntry[] {
	const actions = useSidebar();
	const update = useMutation({
		mutationFn: (patch: Parameters<typeof api.conversations.update>[1]) =>
			api.conversations.update(conversation.id, patch),
	});
	return [
		...readEntries(actions, [conversation]),
		pinnable && {
			label: conversation.pinned ? "Unpin" : "Pin to top",
			icon: conversation.pinned ? <PinOff /> : <Pin />,
			onSelect: () => update.mutate({ pinned: !conversation.pinned }),
		},
		onRename && { label: "Rename", icon: <Pencil />, onSelect: onRename },
		"-",
		{
			label: conversation.kind === "group" ? "Delete group" : "Delete chat",
			icon: <Trash2 />,
			danger: true,
			onSelect: onDelete,
		},
	];
}

// ---------------------------------------------------------------- rows

function StatusLine({ presence, fallback }: { presence: { state: Presence; label: string | null }; fallback: string }) {
	const { state, label } = presence;
	if (state === "thinking" || state === "working") {
		return <span className="shimmer-text block truncate">{label ? `${label}…` : "Working…"}</span>;
	}
	return (
		<span className="block truncate">
			{(state === "waiting" || state === "blocked") && label ? label : fallback}
		</span>
	);
}

/** A heading that folds its rows away (remembered across visits). Right-click it to mark its chats read. */
export function SidebarSection({
	id,
	title,
	count,
	chats,
	first,
	children,
}: {
	id: string;
	title: string;
	count: number;
	/** The chats its rows show, for its unread dot and "Mark as read". */
	chats: (Conversation | undefined)[];
	first?: boolean;
	children: ReactNode;
}) {
	const actions = useSidebar();
	const folded = useUi((s) => Boolean(s.foldedSections[id]));
	const allFolded = useUi((s) => actions.sections.every((x) => s.foldedSections[x]));
	const toggle = useUi((s) => s.toggleSection);
	const foldSections = useUi((s) => s.foldSections);
	if (count === 0) return null;
	const unread = chats.some((c) => actions.isUnread(c));
	const entries: MenuEntry[] = [
		...readEntries(actions, chats),
		{
			label: folded ? "Expand" : "Collapse",
			icon: <ChevronDown className={cn(folded && "-rotate-90")} />,
			onSelect: () => toggle(id),
		},
		allFolded
			? { label: "Expand all", icon: <ChevronsUpDown />, onSelect: () => foldSections(actions.sections, false) }
			: { label: "Collapse all", icon: <ChevronsDownUp />, onSelect: () => foldSections(actions.sections, true) },
	];
	return (
		<section className={cn(!first && "mt-2.5")} aria-label={title}>
			<ContextMenu entries={entries} label={title}>
				<button
					type="button"
					onClick={() => toggle(id)}
					aria-expanded={!folded}
					className="group/sec flex h-7 w-full items-center gap-1 rounded-md px-2 text-caption font-medium text-fg-subtle transition-colors hover:text-fg coarse:h-11"
				>
					<ChevronDown
						className={cn("size-4 shrink-0 transition-transform duration-200", folded && "-rotate-90")}
						aria-hidden
					/>
					<span className="truncate">{title}</span>
					{folded && (
						<span className="ml-1 font-medium tracking-normal normal-case tabular-nums">{count}</span>
					)}
					{folded && unread && <StatusDot className="ml-auto" tone="brand" label="Unread" />}
				</button>
			</ContextMenu>
			{!folded && <div className="flex flex-col gap-0.5">{children}</div>}
		</section>
	);
}

/** The platform's mark on a chat's picture (Discord channel, Discord DM). */
export function PlatformBadge({ type, children }: { type: ChannelType | "email"; children: ReactNode }) {
	return (
		<span className="relative shrink-0">
			{children}
			<ChannelIcon
				type={type}
				size={17}
				className="absolute -right-1 -bottom-1 rounded-full ring-2 ring-bg-subtle"
			/>
		</span>
	);
}

export function AgentRow({
	agent,
	conversation,
	active,
	unread,
}: {
	agent: Agent;
	conversation: Conversation | undefined;
	active: boolean;
	unread: boolean;
	onRename: () => void;
	onDelete: () => void;
}) {
	const openAgent = useOpenAgent();
	const presence = useAgentPresence(agent.id);
	const entries = useAgentMenu(agent);
	const fallback =
		agent.status === "paused" ? "Paused" : chatPreview(conversation?.lastMessagePreview) || agent.label || "Say hi";

	return (
		<ChatListRow
			title={agent.name}
			avatar={
				<AgentAvatar
					avatar={agent.avatar}
					size={36}
					state={presence.state === "done" ? "idle" : presence.state}
					statusDot
				/>
			}
			preview={<StatusLine presence={presence} fallback={fallback} />}
			lastMessageAt={conversation?.lastMessageAt}
			active={active}
			unread={unread}
			entries={entries}
			onOpen={() => void openAgent(agent.id)}
		/>
	);
}

export function GroupRow({
	conversation,
	agents,
	active,
	unread,
	onRename,
	onDelete,
	title,
	platform,
}: {
	conversation: Conversation;
	agents: Map<string, Agent>;
	active: boolean;
	unread: boolean;
	onRename: () => void;
	onDelete: () => void;
	/** Shown instead of the chat's title (a Discord channel's name). */
	title?: string;
	/** The chat comes from a messaging app: its mark goes on the picture. */
	platform?: ChannelType | "email";
}) {
	const busy = useUi(
		useShallow((s) => {
			const run = Object.values(s.activeRuns).find((r) => r.conversationId === conversation.id);
			return run ? { agentId: run.agentId, label: s.runActivity[run.id]?.label ?? "Thinking" } : null;
		}),
	);
	const navigate = useNavigate();
	const entries = useChatMenu(conversation, { onRename, onDelete });
	const members =
		conversation.kind === "direct"
			? [agents.get(conversation.agentId ?? "")].filter((a): a is Agent => Boolean(a))
			: conversation.memberIds.flatMap((id) => agents.get(id) ?? []);
	const picture =
		conversation.kind === "direct" && members[0] ? (
			<AgentAvatar avatar={members[0].avatar} size={38} />
		) : (
			<GroupAvatar avatars={members.map((m) => m.avatar)} size={38} />
		);
	const open = () => {
		useUi.getState().setSidebarOpen(false);
		navigate(`/c/${conversation.id}`);
	};
	return (
		<ChatListRow
			title={title ?? conversation.title}
			avatar={platform ? <PlatformBadge type={platform}>{picture}</PlatformBadge> : picture}
			preview={
				busy ? (
					<span className="shimmer-text">
						{agents.get(busy.agentId)?.name ?? "A bot"}: {busy.label}…
					</span>
				) : (
					chatPreview(conversation.lastMessagePreview) || members.map((m) => m.name).join(", ")
				)
			}
			lastMessageAt={conversation.lastMessageAt}
			active={active}
			unread={unread}
			entries={entries}
			onOpen={open}
		/>
	);
}

/** A direct message on a messaging app. It continues the bot's main chat, so it opens that. */
export function DmRow({
	agent,
	conversation,
	type,
	who,
	active,
	unread,
	onDelete,
}: {
	agent: Agent;
	conversation: Conversation;
	type: ChannelType | "email";
	who: string;
	active: boolean;
	unread: boolean;
	onDelete: () => void;
}) {
	const navigate = useNavigate();
	const openAgent = useOpenAgent();
	const chatMenu = useChatMenu(conversation, { onDelete, pinnable: false });
	const entries: MenuEntry[] = [
		...chatMenu.slice(0, 3),
		{ label: `${agent.name}'s main chat`, icon: <MessageSquareText />, onSelect: () => void openAgent(agent.id) },
		...chatMenu.slice(3),
	];
	const open = () => {
		useUi.getState().setSidebarOpen(false);
		navigate(`/c/${conversation.id}`);
	};
	return (
		<ChatListRow
			title={
				type === "email" ? conversation.title : `${agent.name} · ${CHANNEL_DEFINITIONS[type]?.title ?? type} DM`
			}
			avatar={
				<PlatformBadge type={type}>
					<AgentAvatar avatar={agent.avatar} size={36} />
				</PlatformBadge>
			}
			preview={chatPreview(conversation.lastMessagePreview) || `With ${who}`}
			lastMessageAt={conversation.lastMessageAt}
			active={active}
			unread={unread}
			entries={entries}
			onOpen={open}
		/>
	);
}

function ChatListRow({
	title,
	avatar,
	preview,
	lastMessageAt,
	active,
	unread,
	entries,
	onOpen,
}: {
	title: string;
	avatar: ReactNode;
	preview: ReactNode;
	lastMessageAt?: number | null;
	active: boolean;
	unread: boolean;
	entries: MenuEntry[];
	onOpen: () => void;
}) {
	return (
		<Row
			className="rounded-lg px-2 [&_button]:max-w-full"
			leading={avatar}
			title={<span className={cn("block truncate", unread && "font-semibold")}>{title}</span>}
			subtitle={<span className="block truncate text-fg-subtle">{preview}</span>}
			value={
				lastMessageAt ? (
					<span className="text-caption text-fg-subtle md:sr-only">{shortTime(lastMessageAt)}</span>
				) : undefined
			}
			badge={unread && <StatusDot tone="brand" label="Unread" />}
			menu={entries}
			menuLabel={`More for ${title}`}
			menuButton="hover"
			selected={active}
			onClick={onOpen}
		/>
	);
}

/** A bot on the collapsed sidebar: opens its chat; right-click or long-press for its menu. */
export function RailAgent({
	agent,
	active,
	unread,
}: {
	agent: Agent;
	active: boolean;
	unread: boolean;
	onRename: () => void;
	onDelete: () => void;
}) {
	const openAgent = useOpenAgent();
	const presence = useAgentPresence(agent.id);
	const entries = useAgentMenu(agent);
	return (
		<Tooltip content={presence.label ? `${agent.name} · ${presence.label}` : agent.name} side="right">
			<ContextMenu entries={entries} label={agent.name}>
				<button
					type="button"
					aria-label={agent.name}
					onClick={() => void openAgent(agent.id)}
					className={cn(
						"relative rounded-lg p-1 transition-colors",
						active ? "bg-selected" : "hover:bg-surface-2/60",
					)}
				>
					<AgentAvatar
						avatar={agent.avatar}
						size={36}
						state={presence.state === "done" ? "idle" : presence.state}
						statusDot
						alive
					/>
					{unread && (
						<StatusDot
							tone="brand"
							label="Unread"
							className="absolute top-0.5 right-0.5 ring-2 ring-bg-subtle"
						/>
					)}
				</button>
			</ContextMenu>
		</Tooltip>
	);
}

/** A group chat on the collapsed sidebar. */
export function RailGroup({
	conversation,
	agents,
	active,
	unread,
	onRename,
	onDelete,
}: {
	conversation: Conversation;
	agents: Map<string, Agent>;
	active: boolean;
	unread: boolean;
	onRename: () => void;
	onDelete: () => void;
}) {
	const navigate = useNavigate();
	const entries = useChatMenu(conversation, { onRename, onDelete });
	return (
		<Tooltip content={conversation.title} side="right">
			<ContextMenu entries={entries} label={conversation.title}>
				<button
					type="button"
					aria-label={conversation.title}
					onClick={() => navigate(`/c/${conversation.id}`)}
					className={cn("relative rounded-lg p-1", active ? "bg-selected" : "hover:bg-surface-2/60")}
				>
					<GroupAvatar
						avatars={conversation.memberIds.flatMap((id) => agents.get(id)?.avatar ?? [])}
						size={36}
					/>
					{unread && (
						<StatusDot
							tone="brand"
							label="Unread"
							className="absolute top-0.5 right-0.5 ring-2 ring-bg-subtle"
						/>
					)}
				</button>
			</ContextMenu>
		</Tooltip>
	);
}
