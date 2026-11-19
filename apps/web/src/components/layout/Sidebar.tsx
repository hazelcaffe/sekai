import {
	AgentAvatar,
	adminUrl,
	api,
	cn,
	GroupAvatar,
	isMac,
	sharedMachinesNote,
	shortTime,
	useAgents,
	useApprovals,
	useChannelLinks,
	useChannels,
	useConversations,
	useCredentialRequests,
	useMachineUsers,
	usePairings,
} from "@sekai/client";
import { type Agent, CHANNEL_DEFINITIONS, type ChannelType, type Conversation } from "@sekai/shared";
import {
	Button,
	Confirm,
	ContextMenu,
	Dialog,
	DropdownContent,
	DropdownEntries,
	DropdownItem,
	DropdownMenu,
	DropdownTrigger,
	IconButton,
	Input,
	Kbd,
	type MenuEntry,
	SekaiMark,
	Tooltip,
	toggledTheme,
} from "@sekai/ui";
import { useMutation } from "@tanstack/react-query";
import {
	Activity,
	Bot,
	CheckCheck,
	ChevronDown,
	ChevronsDownUp,
	ChevronsUpDown,
	Copy,
	Crown,
	EyeOff,
	FileUp,
	Inbox,
	Library,
	MailCheck,
	MessageSquareText,
	Moon,
	MoreHorizontal,
	PanelLeftClose,
	PanelLeftOpen,
	Pencil,
	Pin,
	PinOff,
	Plus,
	Search,
	Settings,
	ShieldCheck,
	Sun,
	Trash2,
	Users,
	X,
} from "lucide-react";
import { createContext, type ReactNode, useContext, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { useShallow } from "zustand/react/shallow";
import { latestDirectByAgent, messagingChats, useOpenAgent } from "../../lib/navigation.ts";
import { useSeen } from "../../stores/seen.ts";
import { type Presence, useAgentPresence, useUi } from "../../stores/ui.ts";
import { ChannelIcon } from "../channels/ChannelIcon.tsx";

const MOD = isMac ? "⌘" : "Ctrl";

function useCurrentConversationId(): string | undefined {
	const { pathname } = useLocation();
	return pathname.match(/^\/c\/([^/]+)/)?.[1];
}

// ---------------------------------------------------------------- reading, sections and menus

/** Unread state and marking chats read, for the sidebar's menus. */
interface SidebarActions {
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

const SidebarContext = createContext<SidebarActions | null>(null);

function useSidebar(): SidebarActions {
	const ctx = useContext(SidebarContext);
	if (!ctx) throw new Error("useSidebar outside the sidebar");
	return ctx;
}

/** "Mark as read" for these chats, and "Mark all as read", at the top of a menu. */
function readEntries(actions: SidebarActions, chats: (Conversation | undefined)[]): MenuEntry[] {
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
function useAgentMenu(
	agent: Agent,
	{ onRename, onDelete }: { onRename: () => void; onDelete: () => void },
): MenuEntry[] {
	const actions = useSidebar();
	const openAgent = useOpenAgent();
	const navigate = useNavigate();
	const update = useMutation({
		mutationFn: (patch: Parameters<typeof api.agents.update>[1]) => api.agents.update(agent.id, patch),
	});
	const duplicate = useMutation({
		mutationFn: () => api.agents.duplicate(agent.id),
		onSuccess: (copy) => void openAgent(copy.id),
	});
	const newChat = useMutation({
		mutationFn: () => api.conversations.create({ kind: "direct", agentId: agent.id }),
		onSuccess: (c) => {
			useUi.getState().setSidebarOpen(false);
			navigate(`/c/${c.id}`);
		},
	});
	return [
		...readEntries(actions, actions.chatsOf(agent.id)),
		{ label: "New chat", icon: <Plus />, onSelect: () => newChat.mutate() },
		{
			label: agent.pinned ? "Unpin" : "Pin to top",
			icon: agent.pinned ? <PinOff /> : <Pin />,
			onSelect: () => update.mutate({ pinned: !agent.pinned }),
		},
		{ label: "Rename", icon: <Pencil />, onSelect: onRename },
		!agent.isPrimary && {
			label: "Make primary",
			icon: <Crown />,
			onSelect: () => update.mutate({ isPrimary: true }),
		},
		{ label: "Duplicate", icon: <Copy />, onSelect: () => duplicate.mutate() },
		{
			label: agent.hidden ? "Show in sidebar" : "Hide from sidebar",
			icon: <EyeOff />,
			onSelect: () => update.mutate({ hidden: !agent.hidden }),
		},
		"-",
		{ label: "Delete", icon: <Trash2 />, danger: true, onSelect: onDelete },
	];
}

/** A group chat's or Discord chat's menu. */
function useChatMenu(
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

/** The "…" button on a row (pointer screens; touch screens long-press the row instead). */
function RowMenu({ entries, className }: { entries: MenuEntry[]; className?: string }) {
	return (
		<DropdownMenu>
			<DropdownTrigger asChild>
				<button
					type="button"
					aria-label="More"
					onClick={(e) => e.stopPropagation()}
					className={cn(
						"flex size-7 shrink-0 items-center justify-center rounded-lg text-fg-subtle hover:bg-surface-3 hover:text-fg",
						"opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 coarse:hidden",
						className,
					)}
				>
					<MoreHorizontal className="size-4" />
				</button>
			</DropdownTrigger>
			<DropdownContent align="start" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
				<DropdownEntries entries={entries} />
			</DropdownContent>
		</DropdownMenu>
	);
}

function StatusLine({
	presence,
	fallback,
	unread,
}: {
	presence: { state: Presence; label: string | null };
	fallback: string;
	unread: boolean;
}) {
	const { state, label } = presence;
	if (state === "thinking" || state === "working") {
		return <span className="shimmer-text truncate text-[13px]">{label ? `${label}…` : "Working…"}</span>;
	}
	if (state === "waiting") return <span className="truncate text-[13px] text-warning">{label}</span>;
	if (state === "blocked") return <span className="truncate text-[13px] text-danger">{label}</span>;
	return <span className={cn("truncate text-[13px]", unread ? "text-fg" : "text-fg-subtle")}>{fallback}</span>;
}

/** A heading that folds its rows away (remembered across visits). Right-click it to mark its chats read. */
function SidebarSection({
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
					className="group/sec flex h-7 w-full items-center gap-1 rounded-lg px-2 text-xs font-medium text-fg-subtle transition-colors hover:text-fg coarse:h-9"
				>
					<ChevronDown
						className={cn("size-3.5 shrink-0 transition-transform duration-200", folded && "-rotate-90")}
						aria-hidden
					/>
					<span className="truncate">{title}</span>
					{folded && (
						<span className="ml-1 font-medium tracking-normal normal-case tabular-nums">{count}</span>
					)}
					{folded && unread && (
						<span className="ml-auto size-2 shrink-0 rounded-full bg-info" role="img" aria-label="Unread" />
					)}
				</button>
			</ContextMenu>
			{!folded && <div className="flex flex-col gap-0.5">{children}</div>}
		</section>
	);
}

/** The platform's mark on a chat's picture (Discord channel, Discord DM). */
function PlatformBadge({ type, children }: { type: ChannelType; children: ReactNode }) {
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

function AgentRow({
	agent,
	conversation,
	active,
	unread,
	onRename,
	onDelete,
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
	const entries = useAgentMenu(agent, { onRename, onDelete });
	const fallback =
		agent.status === "paused" ? "Paused" : (conversation?.lastMessagePreview ?? agent.label) || "Say hi";

	return (
		<ContextMenu entries={entries}>
			{/* A div, not a <button>: the row contains its own menu button, and buttons can't nest. */}
			{/* biome-ignore lint/a11y/useSemanticElements: see above */}
			<div
				role="button"
				tabIndex={0}
				onClick={() => void openAgent(agent.id)}
				onKeyDown={(e) => e.key === "Enter" && e.target === e.currentTarget && void openAgent(agent.id)}
				className={cn(
					"group relative flex items-center gap-3 rounded-2xl px-2 py-2 text-left outline-none transition-colors coarse:py-2.5",
					active ? "bg-surface-2" : "hover:bg-surface-2/60",
				)}
			>
				<AgentAvatar
					avatar={agent.avatar}
					size={38}
					state={presence.state}
					alive
					title={presence.label ?? agent.name}
				/>
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-1.5">
						<span className={cn("truncate text-sm", unread ? "font-semibold" : "font-medium")}>
							{agent.name}
						</span>
						{agent.isPrimary && (
							<Tooltip content="Primary bot">
								<Crown
									className="size-3.5 shrink-0 fill-warning/25 text-warning"
									aria-label="Primary bot"
								/>
							</Tooltip>
						)}
						<span className="ml-auto shrink-0 text-[11px] text-fg-subtle group-hover:invisible coarse:group-hover:visible">
							{conversation?.lastMessageAt ? shortTime(conversation.lastMessageAt) : ""}
						</span>
					</div>
					<div className="mt-0.5 flex items-center gap-2">
						<StatusLine presence={presence} fallback={fallback} unread={unread} />
						{unread && presence.state === "idle" && (
							<span
								className="ml-auto size-2 shrink-0 rounded-full bg-info"
								role="img"
								aria-label="Unread"
							/>
						)}
					</div>
				</div>
				<RowMenu entries={entries} className="absolute top-2 right-1.5" />
			</div>
		</ContextMenu>
	);
}

function GroupRow({
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
	platform?: ChannelType;
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
		<ContextMenu entries={entries}>
			{/* biome-ignore lint/a11y/useSemanticElements: the row contains its own menu button, and buttons can't nest */}
			<div
				role="button"
				tabIndex={0}
				onClick={open}
				onKeyDown={(e) => e.key === "Enter" && e.target === e.currentTarget && open()}
				className={cn(
					"group relative flex items-center gap-3 rounded-2xl px-2 py-2 outline-none transition-colors coarse:py-2.5",
					active ? "bg-surface-2" : "hover:bg-surface-2/60",
				)}
			>
				{platform ? <PlatformBadge type={platform}>{picture}</PlatformBadge> : picture}
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-1.5">
						<span className={cn("truncate text-sm", unread ? "font-semibold" : "font-medium")}>
							{title ?? conversation.title}
						</span>
						<span className="ml-auto shrink-0 text-[11px] text-fg-subtle group-hover:invisible coarse:group-hover:visible">
							{conversation.lastMessageAt ? shortTime(conversation.lastMessageAt) : ""}
						</span>
					</div>
					<div className="mt-0.5 flex items-center gap-2">
						{busy ? (
							<span className="shimmer-text truncate text-[13px]">
								{agents.get(busy.agentId)?.name ?? "A bot"}: {busy.label}…
							</span>
						) : (
							<span className={cn("truncate text-[13px]", unread ? "text-fg" : "text-fg-subtle")}>
								{conversation.lastMessagePreview ?? members.map((m) => m.name).join(", ")}
							</span>
						)}
						{unread && !busy && <span className="ml-auto size-2 shrink-0 rounded-full bg-info" />}
					</div>
				</div>
				<RowMenu entries={entries} className="absolute top-2 right-1.5" />
			</div>
		</ContextMenu>
	);
}

/** A direct message on a messaging app. It continues the bot's main chat, so it opens that. */
function DmRow({
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
	type: ChannelType;
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
		<ContextMenu entries={entries}>
			<button
				type="button"
				onClick={open}
				className={cn(
					"group relative flex items-center gap-3 rounded-2xl px-2 py-2 text-left outline-none transition-colors coarse:py-2.5",
					active ? "bg-surface-2" : "hover:bg-surface-2/60",
				)}
			>
				<PlatformBadge type={type}>
					<AgentAvatar avatar={agent.avatar} size={38} />
				</PlatformBadge>
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-1.5">
						<span className={cn("truncate text-sm", unread ? "font-semibold" : "font-medium")}>
							{agent.name}
						</span>
						<span
							className="truncate text-xs text-fg-subtle"
							title={`Your DM with ${agent.name}'s bot (${who})`}
						>
							· {CHANNEL_DEFINITIONS[type]?.title ?? type} DM
						</span>
						<span className="ml-auto shrink-0 text-[11px] text-fg-subtle">
							{conversation.lastMessageAt ? shortTime(conversation.lastMessageAt) : ""}
						</span>
					</div>
					<div className="mt-0.5 flex items-center gap-2">
						<span className={cn("truncate text-[13px]", unread ? "text-fg" : "text-fg-subtle")}>
							{conversation.lastMessagePreview ?? `With ${who}`}
						</span>
						{unread && (
							<span
								className="ml-auto size-2 shrink-0 rounded-full bg-info"
								role="img"
								aria-label="Unread"
							/>
						)}
					</div>
				</div>
			</button>
		</ContextMenu>
	);
}

function NavItem({
	icon,
	label,
	to,
	badge,
	collapsed,
	external,
}: {
	icon: ReactNode;
	label: string;
	to: string;
	badge?: number;
	collapsed: boolean;
	/** Another app (the admin app): a full page load. */
	external?: boolean;
}) {
	const navigate = useNavigate();
	const { pathname } = useLocation();
	const active = !external && pathname.startsWith(to);
	const item = (
		<button
			type="button"
			onClick={() => {
				useUi.getState().setSidebarOpen(false);
				if (external) location.assign(to);
				else navigate(to);
			}}
			className={cn(
				"relative flex items-center gap-3 rounded-xl text-sm font-medium transition-colors [&_svg]:size-[18px]",
				collapsed ? "size-11 justify-center" : "h-9 px-2.5 coarse:h-11",
				active ? "bg-surface-2 text-fg" : "text-fg-muted hover:bg-surface-2/60 hover:text-fg",
			)}
		>
			{icon}
			{!collapsed && <span className="flex-1 text-left">{label}</span>}
			{badge ? (
				<span
					className={cn(
						"flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1.5 text-[11px] font-semibold text-white",
						collapsed && "absolute -top-0.5 -right-0.5",
					)}
				>
					{badge}
				</span>
			) : null}
		</button>
	);
	return collapsed ? (
		<Tooltip content={label} side="right">
			{item}
		</Tooltip>
	) : (
		item
	);
}

/** A bot on the collapsed sidebar: opens its chat; right-click or long-press for its menu. */
function RailAgent({
	agent,
	active,
	unread,
	onRename,
	onDelete,
}: {
	agent: Agent;
	active: boolean;
	unread: boolean;
	onRename: () => void;
	onDelete: () => void;
}) {
	const openAgent = useOpenAgent();
	const presence = useAgentPresence(agent.id);
	const entries = useAgentMenu(agent, { onRename, onDelete });
	return (
		<Tooltip content={agent.name} side="right">
			<ContextMenu entries={entries} label={agent.name}>
				<button
					type="button"
					aria-label={agent.name}
					onClick={() => void openAgent(agent.id)}
					className={cn(
						"relative rounded-2xl p-1 transition-colors",
						active ? "bg-surface-2" : "hover:bg-surface-2/60",
					)}
				>
					<AgentAvatar
						avatar={agent.avatar}
						size={36}
						state={presence.state}
						alive
						title={presence.label ?? undefined}
					/>
					{unread && (
						<span className="absolute top-0.5 right-0.5 size-2.5 rounded-full border-2 border-bg-subtle bg-info" />
					)}
				</button>
			</ContextMenu>
		</Tooltip>
	);
}

/** A group chat on the collapsed sidebar. */
function RailGroup({
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
					className={cn("relative rounded-2xl p-1", active ? "bg-surface-2" : "hover:bg-surface-2/60")}
				>
					<GroupAvatar
						avatars={conversation.memberIds.flatMap((id) => agents.get(id)?.avatar ?? [])}
						size={36}
					/>
					{unread && (
						<span className="absolute top-0.5 right-0.5 size-2.5 rounded-full border-2 border-bg-subtle bg-info" />
					)}
				</button>
			</ContextMenu>
		</Tooltip>
	);
}

function FooterLink({ icon, label, to, external }: { icon: ReactNode; label: string; to: string; external?: boolean }) {
	const navigate = useNavigate();
	const { pathname } = useLocation();
	return (
		<IconButton
			label={label}
			onClick={() => {
				useUi.getState().setSidebarOpen(false);
				if (external) location.assign(to);
				else navigate(to);
			}}
			className={cn(!external && pathname.startsWith(to) && "bg-surface-2 text-fg")}
		>
			{icon}
		</IconButton>
	);
}

// ---------------------------------------------------------------- sidebar

/**
 * - full: desktop sidebar (collapsible to the rail).
 * - rail: icon-only sidebar for tablets.
 * - drawer: phone slide-over (has a close button).
 * - pane: one screen of a dual-screen device.
 */
export function Sidebar({ variant }: { variant: "full" | "rail" | "drawer" | "pane" }) {
	const collapsed = variant === "rail";
	const { data: agents = [] } = useAgents();
	const { data: conversations = [] } = useConversations();
	const { data: approvals = [] } = useApprovals();
	const { data: pairings = [] } = usePairings();
	const { data: logins = [] } = useCredentialRequests();
	const needsYou = approvals.length + pairings.length + logins.length;
	const seen = useSeen((s) => s.seen);
	const markReadIn = useSeen((s) => s.markRead);
	const currentId = useCurrentConversationId();
	const navigate = useNavigate();
	const ui = useUi();
	const [showHidden, setShowHidden] = useState(false);
	const [renaming, setRenaming] = useState<{ kind: "agent" | "group"; id: string; name: string } | null>(null);
	const [deleting, setDeleting] = useState<{ kind: "agent" | "group"; id: string; name: string } | null>(null);

	const { data: links = [] } = useChannelLinks();
	const { data: channels = [] } = useChannels();
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
	// Bot-to-bot threads (agent_ask) stay out of the roster; they open from the chat that started them.
	const groups = conversations
		.filter((c) => c.kind === "group" && !c.archived && !c.settings.team && !channelChats.has(c.id))
		.sort(byRecent);
	const serverChats = conversations
		.filter((c) => channelChats.has(c.id) && !channelChats.get(c.id)?.dm && !c.archived)
		.sort(byRecent);
	const dms = conversations
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
	const pinnedAgents = visible.filter((a) => a.pinned);
	const pinnedChats = [...groups, ...serverChats].filter((c) => c.pinned);
	const platforms = [
		...new Set([...serverChats.map((c) => channelChats.get(c.id)?.type), ...dms.map((d) => d.type)]),
	].filter((t): t is ChannelType => Boolean(t));
	const isUnread = (c: Conversation | undefined) =>
		Boolean(c?.lastMessageAt && c.id !== currentId && c.lastMessageAt > (seen[c.id] ?? 0));
	const shown = [
		...visible.map((a) => latest.get(a.id)),
		...groups,
		...serverChats,
		...dms.map((d) => d.conversation),
	];
	const sectionIds = ["pinned", "bots", "groups", ...platforms.flatMap((t) => [`${t}-channels`, `${t}-dms`])];
	const actions: SidebarActions = {
		isUnread,
		anyUnread: shown.some(isUnread),
		markRead: (chats) => markReadIn(chats.filter((c): c is Conversation => Boolean(c))),
		markAllRead: () =>
			markReadIn(conversations.filter((c) => c.lastMessageAt && c.lastMessageAt > (seen[c.id] ?? 0))),
		chatsOf: (agentId) =>
			conversations.filter((c) => c.kind === "direct" && c.agentId === agentId && !channelChats.has(c.id)),
		sections: sectionIds,
	};

	const rename = useMutation({
		mutationFn: async (r: { kind: "agent" | "group"; id: string; name: string }) =>
			r.kind === "agent"
				? api.agents.update(r.id, { name: r.name })
				: api.conversations.update(r.id, { title: r.name }),
		onSuccess: () => setRenaming(null),
	});
	const machineUsers = useMachineUsers(deleting?.kind === "agent" ? deleting.id : null, deleting?.kind === "agent");
	const remove = useMutation({
		mutationFn: async (r: { kind: "agent" | "group"; id: string }) =>
			r.kind === "agent" ? api.agents.delete(r.id) : api.conversations.delete(r.id),
		onSuccess: (_d, r) => {
			setDeleting(null);
			const viewing = r.kind === "group" ? r.id === currentId : current?.agentId === r.id;
			if (viewing) navigate("/");
		},
	});

	// Light theme → Nightcord at 25:00, dark theme → Virtual Singers (Settings → Appearance has all six).
	const toggleTheme = () => ui.setTheme(toggledTheme(ui.theme));

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
							: "This chat and its messages are deleted from Sekai (not from Discord). The bot and its memory are kept."
				}
				confirmLabel="Delete"
				danger
				onConfirm={() => deleting && remove.mutate(deleting)}
			/>
		</>
	);

	if (collapsed) {
		return (
			<SidebarContext.Provider value={actions}>
				<nav className="flex h-full w-[68px] shrink-0 flex-col items-center gap-1 border-r border-border bg-bg-subtle py-3 pt-safe pb-safe">
					<IconButton
						label="Expand sidebar"
						tooltipSide="right"
						onClick={ui.toggleSidebarCollapsed}
						className="mb-1"
					>
						<PanelLeftOpen />
					</IconButton>
					<IconButton
						label="New bot"
						shortcut={`${MOD}N`}
						tooltipSide="right"
						onClick={() => ui.setNewAgentOpen(true)}
					>
						<Plus />
					</IconButton>
					<IconButton
						label="Search"
						shortcut={`${MOD}K`}
						tooltipSide="right"
						onClick={() => ui.setPaletteOpen(true)}
					>
						<Search />
					</IconButton>
					<div className="my-2 h-px w-8 bg-border" />
					<div className="flex min-h-0 w-full flex-1 flex-col items-center gap-1.5 overflow-y-auto scrollbar-none">
						{visible.map((a) => (
							<RailAgent
								key={a.id}
								agent={a}
								active={
									current?.kind === "direct" &&
									current.agentId === a.id &&
									!channelChats.has(current.id)
								}
								unread={isUnread(latest.get(a.id))}
								onRename={() => setRenaming({ kind: "agent", id: a.id, name: a.name })}
								onDelete={() => setDeleting({ kind: "agent", id: a.id, name: a.name })}
							/>
						))}
						{groups.map((g) => (
							<RailGroup
								key={g.id}
								conversation={g}
								agents={agentMap}
								active={g.id === currentId}
								unread={isUnread(g)}
								onRename={() => setRenaming({ kind: "group", id: g.id, name: g.title })}
								onDelete={() => setDeleting({ kind: "group", id: g.id, name: g.title })}
							/>
						))}
					</div>
					<div className="mt-2 flex flex-col items-center gap-1">
						<NavItem collapsed icon={<Inbox />} label="Needs you" to="/inbox" badge={needsYou} />
						<NavItem collapsed icon={<Activity />} label="Activity" to="/activity" />
						<NavItem collapsed icon={<Library />} label="Library" to="/library" />
						<NavItem collapsed icon={<ShieldCheck />} label="Admin" to={adminUrl()} external />
						<NavItem collapsed icon={<Settings />} label="Settings" to="/settings" />
					</div>
					{dialogs}
				</nav>
			</SidebarContext.Provider>
		);
	}

	return (
		<SidebarContext.Provider value={actions}>
			<nav
				className={cn(
					"flex h-full flex-col bg-bg-subtle pt-safe pb-safe",
					variant === "full" ? "w-[288px] shrink-0 border-r border-border" : "w-full",
				)}
			>
				<div className="flex items-center gap-1 px-3 pt-3 pb-2">
					<button
						type="button"
						onClick={() => navigate("/")}
						className="flex items-center gap-2 rounded-lg px-1.5 py-1"
					>
						<SekaiMark size={24} />
						<span className="text-[17px] font-semibold tracking-tight">sekai</span>
					</button>
					<div className="ml-auto flex items-center gap-0.5">
						<DropdownMenu>
							<DropdownTrigger asChild>
								<Button variant="ghost" size="icon" aria-label="New">
									<Plus />
								</Button>
							</DropdownTrigger>
							<DropdownContent align="end">
								<DropdownItem icon={<Bot />} onSelect={() => ui.setNewAgentOpen(true)}>
									New bot
									<span className="ml-auto pl-4 text-xs text-fg-subtle">{MOD}N</span>
								</DropdownItem>
								<DropdownItem
									icon={<Users />}
									disabled={agents.length < 2}
									onSelect={() => ui.setNewGroupOpen(true)}
								>
									New group chat
								</DropdownItem>
								<DropdownItem icon={<FileUp />} onSelect={() => ui.setImportBotOpen(true)}>
									Import a bot
								</DropdownItem>
							</DropdownContent>
						</DropdownMenu>
						{variant === "full" ? (
							<IconButton label="Collapse sidebar" onClick={ui.toggleSidebarCollapsed}>
								<PanelLeftClose />
							</IconButton>
						) : variant === "drawer" ? (
							<IconButton label="Close" onClick={() => ui.setSidebarOpen(false)}>
								<X />
							</IconButton>
						) : null}
					</div>
				</div>

				<div className="px-3 pb-1">
					<button
						type="button"
						onClick={() => ui.setPaletteOpen(true)}
						className="flex h-9 w-full items-center gap-2 rounded-xl bg-surface-2/70 px-3 text-sm text-fg-subtle transition-colors hover:bg-surface-2 coarse:h-11"
					>
						<Search className="size-4" />
						<span className="flex-1 text-left">Search</span>
						<Kbd>{MOD}K</Kbd>
					</button>
				</div>

				{needsYou > 0 && (
					<div className="px-3 pt-1">
						<NavItem collapsed={false} icon={<Inbox />} label="Needs you" to="/inbox" badge={needsYou} />
					</div>
				)}

				<div className="min-h-0 flex-1 overflow-y-auto px-3 pt-2 pb-3 scrollbar-thin">
					{visible.length === 0 && (
						<button
							type="button"
							onClick={() => ui.setNewAgentOpen(true)}
							className="w-full rounded-2xl border border-dashed border-border-strong px-3 py-4 text-sm text-fg-muted hover:bg-surface-2/50"
						>
							Create your first bot
						</button>
					)}
					{(() => {
						const agentRow = (a: Agent) => {
							const conv = latest.get(a.id);
							return (
								<AgentRow
									key={a.id}
									agent={a}
									conversation={conv}
									active={
										current?.kind === "direct" &&
										current.agentId === a.id &&
										!channelChats.has(current.id)
									}
									unread={isUnread(conv)}
									onRename={() => setRenaming({ kind: "agent", id: a.id, name: a.name })}
									onDelete={() => setDeleting({ kind: "agent", id: a.id, name: a.name })}
								/>
							);
						};
						const chatRow = (g: Conversation) => {
							const link = channelChats.get(g.id);
							return (
								<GroupRow
									key={g.id}
									conversation={g}
									agents={agentMap}
									active={g.id === currentId}
									unread={isUnread(g)}
									title={link?.name}
									platform={link?.type}
									onRename={() => setRenaming({ kind: "group", id: g.id, name: g.title })}
									onDelete={() =>
										setDeleting({ kind: "group", id: g.id, name: link?.name ?? g.title })
									}
								/>
							);
						};
						const rest = visible.filter((a) => !a.pinned);
						let first = true;
						const isFirst = (count: number) => {
							const was = first && count > 0;
							if (count > 0) first = false;
							return was;
						};
						return (
							<>
								<SidebarSection
									id="pinned"
									title="Pinned"
									count={pinnedAgents.length + pinnedChats.length}
									chats={[...pinnedAgents.map((a) => latest.get(a.id)), ...pinnedChats]}
									first={isFirst(pinnedAgents.length + pinnedChats.length)}
								>
									{pinnedAgents.map(agentRow)}
									{pinnedChats.map(chatRow)}
								</SidebarSection>
								<SidebarSection
									id="bots"
									title="Bots"
									count={rest.length}
									chats={rest.map((a) => latest.get(a.id))}
									first={isFirst(rest.length)}
								>
									{rest.map(agentRow)}
								</SidebarSection>
								<SidebarSection
									id="groups"
									title="Group chats"
									count={groups.filter((g) => !g.pinned).length}
									chats={groups.filter((g) => !g.pinned)}
									first={isFirst(groups.filter((g) => !g.pinned).length)}
								>
									{groups.filter((g) => !g.pinned).map(chatRow)}
								</SidebarSection>
								{platforms.map((type) => {
									const title = CHANNEL_DEFINITIONS[type]?.title ?? type;
									const chats = serverChats.filter(
										(c) => !c.pinned && channelChats.get(c.id)?.type === type,
									);
									const myDms = dms.filter((d) => d.type === type);
									return (
										<div key={type}>
											<SidebarSection
												id={`${type}-channels`}
												title={`${title} channels`}
												count={chats.length}
												chats={chats}
												first={isFirst(chats.length)}
											>
												{chats.map(chatRow)}
											</SidebarSection>
											<SidebarSection
												id={`${type}-dms`}
												title={`${title} DMs`}
												count={myDms.length}
												chats={myDms.map((d) => d.conversation)}
												first={isFirst(myDms.length)}
											>
												{myDms.map((d) => (
													<DmRow
														key={d.key}
														agent={d.agent}
														conversation={d.conversation}
														type={d.type}
														who={d.who}
														active={d.conversation.id === currentId}
														unread={isUnread(d.conversation)}
														onDelete={() =>
															setDeleting({
																kind: "group",
																id: d.conversation.id,
																name: `${d.agent.name} · ${CHANNEL_DEFINITIONS[d.type]?.title ?? d.type} DM`,
															})
														}
													/>
												))}
											</SidebarSection>
										</div>
									);
								})}
							</>
						);
					})()}

					{hidden.length > 0 && (
						<div className="pt-4">
							<button
								type="button"
								onClick={() => setShowHidden((v) => !v)}
								className="flex w-full items-center gap-1 px-2 pb-1.5 text-xs font-medium text-fg-subtle hover:text-fg"
							>
								Hidden bots ({hidden.length})
								<ChevronDown
									className={cn("size-3.5 transition-transform", showHidden && "rotate-180")}
								/>
							</button>
							{showHidden &&
								hidden.map((a) => (
									<AgentRow
										key={a.id}
										agent={a}
										conversation={latest.get(a.id)}
										active={current?.kind === "direct" && current.agentId === a.id}
										unread={false}
										onRename={() => setRenaming({ kind: "agent", id: a.id, name: a.name })}
										onDelete={() => setDeleting({ kind: "agent", id: a.id, name: a.name })}
									/>
								))}
						</div>
					)}
				</div>

				<div className="flex items-center gap-0.5 px-3 py-2">
					<NavItem collapsed={false} icon={<Settings />} label="Settings" to="/settings" />
					<div className="ml-auto flex items-center gap-0.5">
						<FooterLink icon={<Activity />} label="Activity" to="/activity" />
						<FooterLink icon={<Library />} label="Library" to="/library" />
						<FooterLink icon={<ShieldCheck />} label="Admin" to={adminUrl()} external />
						<IconButton label="Toggle theme" onClick={toggleTheme}>
							<Sun className="hidden dark:block" />
							<Moon className="dark:hidden" />
						</IconButton>
					</div>
				</div>

				{dialogs}
			</nav>
		</SidebarContext.Provider>
	);
}
