import {
	AgentAvatar,
	api,
	cn,
	dayLabel,
	GroupAvatar,
	shortTime,
	useAccess,
	useAgentMap,
	useConversation,
	useConversations,
	useMachines,
	useMessages,
	useSeats,
} from "@sekai/client";
import { type Agent, ApiError, type Conversation, channelTitle, type Message, type ModelRef } from "@sekai/shared";
import {
	Button,
	Confirm,
	Dialog,
	DropdownContent,
	DropdownEntries,
	DropdownMenu,
	DropdownTrigger,
	EmptyState,
	ErrorState,
	Fold,
	hasUnsavedChanges,
	IconButton,
	LeaveConfirm,
	List,
	Row,
	Sheet,
	SkeletonChat,
	SkeletonRows,
	usePlatform,
} from "@sekai/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
	ArrowDown,
	ArrowLeft,
	ChevronLeft,
	Eraser,
	History,
	Info,
	MessageSquarePlus,
	Monitor,
	MoreHorizontal,
	PanelRight,
	Phone,
	SlidersHorizontal,
	Trash2,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { ChatDetails } from "../components/chat/ChatDetails.tsx";
import { Composer } from "../components/chat/Composer.tsx";
import { MessageItem, TypingRow } from "../components/chat/MessageItem.tsx";
import { ComputerPanel } from "../components/computer/ComputerPanel.tsx";
import { availableScreens, offersSharedAccess } from "../components/computer/screens.ts";
import { useCallControls } from "../components/voice/CallProvider.tsx";
import { useBackLayer, useGoBack } from "../lib/back.ts";
import { useLayout, useStickToBottom, useToastLift, useWidth } from "../lib/hooks.ts";
import { type MessagingChat, useMessagingChat, useOpenAgent } from "../lib/navigation.ts";
import { useSeen } from "../stores/seen.ts";
import { useAgentPresence, useUi, useWorkingAgents } from "../stores/ui.ts";

const STARTERS = [
	"What can you help me with?",
	"What do you remember about me?",
	"Set up a short morning brief every weekday at 8am",
	"Remind me in 30 minutes to take a break",
];

/** The side panel's width when it docks beside a chat; it docks only while the chat keeps at least 560px. */
const PANEL_WIDTH = 400;
const CHAT_MIN = 560;

function ChatHeader({
	conversation,
	agent,
	members,
	onOpenDetails,
	onToggleDetails,
	onOpenComputer,
}: {
	conversation: Conversation;
	agent: Agent | null;
	members: Agent[];
	onOpenDetails: () => void;
	onToggleDetails: () => void;
	onOpenComputer: () => void;
}) {
	const { can } = useAccess();
	const owner = agent && !agent.sharedBy ? agent : null;
	const { data: machines = [] } = useMachines(owner?.id);
	// Its own machines, or a seat on one of yours (another bot's computer shared with it). For a bot shared with
	// you, only the seats you gave it: its owner's computer stays theirs.
	const { data: seats = [] } = useSeats(agent?.id ?? "", Boolean(agent));
	const hasMachine = owner
		? machines.length > 0 || seats.length > 0
		: Boolean(agent && availableScreens(agent, [], seats).length > 0);
	const sharedAccess = Boolean(agent && offersSharedAccess(agent, can, seats.length));
	const { phone } = useLayout();
	const platform = usePlatform();
	const navigate = useNavigate();
	const goBack = useGoBack();
	const history = useConversations();
	const [pastOpen, setPastOpen] = useState(false);
	const [confirm, setConfirm] = useState<"reset" | "delete" | null>(null);
	const threads = agent
		? (history.data ?? [])
				.filter((c) => c.kind === "direct" && c.agentId === agent.id && c.id !== conversation.id)
				.sort((a, b) => (b.lastMessageAt ?? b.createdAt) - (a.lastMessageAt ?? a.createdAt))
		: [];
	const newChat = useMutation({
		mutationFn: () => api.conversations.create({ kind: "direct", agentId: agent?.id ?? "" }),
		onSuccess: (c) => navigate(`/c/${c.id}`),
	});
	const reset = useMutation({ mutationFn: () => api.conversations.reset(conversation.id) });
	const del = useMutation({
		mutationFn: () => api.conversations.delete(conversation.id),
		onSuccess: () => {
			const next = threads[0];
			navigate(phone || !next ? "/" : `/c/${next.id}`, { replace: true });
		},
	});
	const presence = useAgentPresence(agent?.id, conversation.id);
	const { current: currentCall, startCall } = useCallControls();
	const inCall = currentCall?.conversationId === conversation.id;
	const groupBusy = useUi(
		useShallow((s) => {
			const run = Object.values(s.activeRuns).find((r) => r.conversationId === conversation.id);
			const who = run ? members.find((m) => m.id === run.agentId) : undefined;
			return run && who ? { name: who.name, label: s.runActivity[run.id]?.label ?? "Thinking" } : null;
		}),
	);
	const isGroup = conversation.kind === "group";
	const busy = groupBusy ? `${groupBusy.name}: ${groupBusy.label}…` : null;
	const messaging = useMessagingChat(conversation);
	const where = messaging
		? messaging.type === "email"
			? `Email · ${messaging.name}`
			: messaging.dm
				? `${channelTitle(messaging.type)} DM`
				: `${channelTitle(messaging.type)} · ${messaging.name}`
		: null;
	const subtitle = isGroup
		? (busy ?? members.map((m) => m.name).join(", "))
		: presence.state === "thinking" || presence.state === "working"
			? `${presence.label ?? "Working"}…`
			: presence.state === "waiting" || presence.state === "blocked"
				? presence.label
				: presence.computer
					? "Using its computer"
					: where || agent?.label || null;

	return (
		// The safe area goes above the bar, not inside its fixed height.
		<header className="shrink-0 border-b border-border bg-bg pt-safe px-safe">
			<div className="flex min-h-14 items-center gap-1 px-2 md:px-4">
				{phone && (
					<IconButton label="Back to chats" onClick={() => goBack("/")}>
						{platform === "android" ? <ArrowLeft /> : <ChevronLeft />}
					</IconButton>
				)}
				<button
					type="button"
					// A bot's name opens the bot; a group's opens its details.
					onClick={() => (agent && !isGroup ? navigate(`/bots/${agent.id}`) : onOpenDetails())}
					className="flex min-h-11 min-w-0 items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-surface-2/70"
				>
					{isGroup ? (
						<GroupAvatar avatars={members.map((m) => m.avatar)} size={30} />
					) : (
						agent && (
							<AgentAvatar
								avatar={agent.avatar}
								size={30}
								state={presence.state}
								alive
								title={presence.label ?? undefined}
							/>
						)
					)}
					<span className="min-w-0">
						<span className="block truncate text-heading font-semibold">
							{isGroup ? conversation.title : (agent?.name ?? "Bot")}
						</span>
						{subtitle && (
							<span
								className={cn(
									"block truncate text-small",
									busy || presence.state === "thinking" || presence.state === "working"
										? "shimmer-text"
										: presence.state === "waiting"
											? "text-warning-ink"
											: presence.state === "blocked"
												? "text-danger-ink"
												: "text-fg-subtle",
								)}
							>
								{subtitle}
							</span>
						)}
					</span>
				</button>
				<div className="ml-auto flex items-center gap-0.5">
					{!isGroup && agent && can("voice") && (
						<IconButton
							label={inCall ? `On a call with ${agent.name}` : `Call ${agent.name}`}
							onClick={() => startCall({ conversationId: conversation.id, agent })}
							className={cn(
								inCall && "bg-success-soft text-success-ink hover:bg-success/20 hover:text-success-ink",
							)}
						>
							<Phone />
						</IconButton>
					)}
					{hasMachine && (
						// Lit while the bot is working on its computer (Grok Bot's status level).
						<IconButton
							label={presence.computer ? "Using its computer" : "Computer"}
							onClick={onOpenComputer}
							className={cn(presence.computer && "bg-brand-soft text-brand-ink hover:bg-brand-soft")}
						>
							<Monitor />
						</IconButton>
					)}
					{!isGroup && agent && (
						<DropdownMenu>
							<DropdownTrigger asChild>
								<IconButton variant="ghost" size="icon" label="Chat menu">
									<MoreHorizontal />
								</IconButton>
							</DropdownTrigger>
							<DropdownContent className="w-64" align="end" title="Chat menu">
								<DropdownEntries
									entries={[
										{
											label: `New chat with ${agent.name}`,
											icon: <MessageSquarePlus />,
											onSelect: () => newChat.mutate(),
											disabled: newChat.isPending,
										},
										{ label: "Past chats", icon: <History />, onSelect: () => setPastOpen(true) },
										{ label: "Chat details", icon: <Info />, onSelect: onOpenDetails },
										{
											label: "Bot settings",
											icon: <SlidersHorizontal />,
											onSelect: () => navigate(`/bots/${agent.id}`),
										},
										Boolean(owner) &&
											!hasMachine &&
											can("computers") && {
												label: "Give it a computer",
												icon: <Monitor />,
												onSelect: () => navigate(`/bots/${agent.id}/computer`),
											},
										sharedAccess && {
											label: "Your shared access",
											icon: <Monitor />,
											onSelect: onOpenComputer,
										},
										{
											label: "Reset chat",
											icon: <Eraser />,
											danger: true,
											onSelect: () => setConfirm("reset"),
										},
										{
											label: "Delete chat",
											icon: <Trash2 />,
											danger: true,
											onSelect: () => setConfirm("delete"),
										},
									]}
								/>
							</DropdownContent>
						</DropdownMenu>
					)}
					{!phone && (
						<IconButton label="Chat details" shortcut="Ctrl ." onClick={onToggleDetails}>
							<PanelRight />
						</IconButton>
					)}
				</div>
			</div>
			<Dialog
				open={pastOpen}
				onOpenChange={setPastOpen}
				title="Past chats"
				description={`Other chats with ${agent?.name ?? "this bot"}.`}
				size="sm"
			>
				{history.isPending ? (
					<SkeletonRows count={3} />
				) : history.isError ? (
					<ErrorState title="Couldn't load past chats" onRetry={() => void history.refetch()} />
				) : threads.length === 0 ? (
					<EmptyState size="sm" title="No other chats yet." />
				) : (
					<List label="Past chats">
						{threads.map((t) => (
							<Row
								key={t.id}
								title={<span className="block truncate">{t.title}</span>}
								subtitle={shortTime(t.lastMessageAt ?? t.createdAt)}
								chevron
								onClick={() => {
									setPastOpen(false);
									navigate(`/c/${t.id}`);
								}}
							/>
						))}
					</List>
				)}
			</Dialog>
			<Confirm
				open={confirm === "reset"}
				onOpenChange={(o) => !o && setConfirm(null)}
				title="Reset this chat?"
				description="The conversation history starts over. Memory, notes, routines and settings are kept."
				confirmLabel="Reset"
				onConfirm={() => reset.mutate()}
			/>
			<Confirm
				open={confirm === "delete"}
				onOpenChange={(o) => !o && setConfirm(null)}
				title="Delete this chat?"
				description="Its messages are deleted. The bot's memory is kept."
				confirmLabel="Delete"
				danger
				onConfirm={() => del.mutate()}
			/>
		</header>
	);
}

function AgentIntro({ agent, onPick }: { agent: Agent; onPick: (text: string) => void }) {
	return (
		<div className="flex flex-1 flex-col items-center justify-center px-6 py-10 text-center">
			<AgentAvatar avatar={agent.avatar} size={88} />
			<h1 className="mt-4 text-title font-semibold tracking-tight">{agent.name}</h1>
			{agent.label && <p className="mt-1 text-body text-fg-muted">{agent.label}</p>}
			{agent.job && <p className="mt-3 line-clamp-3 max-w-md text-body text-fg-subtle">{agent.job}</p>}
			<Button className="mt-6" variant="secondary" onClick={() => onPick(STARTERS[0] ?? "")}>
				Ask what it can do
			</Button>
			<div className="mt-3 w-full max-w-sm text-left [&>div]:items-center">
				<Fold title="More prompts" variant="link">
					<List>
						{STARTERS.slice(1).map((s) => (
							<Row key={s} title={s} onClick={() => onPick(s)} />
						))}
					</List>
				</Fold>
			</div>
		</div>
	);
}

function GroupIntro({ conversation, members }: { conversation: Conversation; members: Agent[] }) {
	return (
		<div className="flex flex-1 flex-col items-center justify-center px-6 py-10 text-center">
			<GroupAvatar avatars={members.map((m) => m.avatar)} size={88} />
			<h1 className="mt-4 text-title font-semibold tracking-tight">{conversation.title}</h1>
			<p className="mt-2 max-w-md text-body text-fg-subtle">
				{conversation.settings.purpose || "Message the group, or use @name to choose who answers."}
			</p>
			<div className="mt-6 flex flex-wrap justify-center gap-2">
				{members.map((m) => (
					<span
						key={m.id}
						className="flex items-center gap-2 rounded-full border border-border py-1 pr-3 pl-1 text-small"
					>
						<AgentAvatar avatar={m.avatar} size={22} />
						{m.name}
					</span>
				))}
			</div>
		</div>
	);
}

/**
 * In a bot's Discord DM (or server channel) chat: say so, since the bot's own row opens its main chat. What you
 * type here stays in Sekai; it isn't sent to Discord.
 */
function MessagingNotice({ chat, agentName, agentId }: { chat: MessagingChat; agentName: string; agentId: string }) {
	const openAgent = useOpenAgent();
	const app = channelTitle(chat.type);
	return (
		<div className="mx-auto mb-2 flex w-full max-w-3xl items-center gap-2 rounded-lg bg-surface-2/70 px-3.5 py-2 text-small text-fg-subtle">
			<span className="min-w-0 flex-1">
				{chat.type === "email"
					? `${agentName}'s email thread with ${chat.name}.`
					: chat.dm
						? `Your ${app} DM with ${agentName}.`
						: `${agentName} in ${chat.name} on ${app}.`}{" "}
				What you type here stays in Sekai.
			</span>
			<button
				type="button"
				onClick={() => void openAgent(agentId)}
				className="shrink-0 font-medium text-fg-muted hover:text-fg"
			>
				Main chat →
			</button>
		</div>
	);
}

export function ConversationPage() {
	const { conversationId = "" } = useParams();
	const chat = useConversation(conversationId);
	const qc = useQueryClient();
	const { data: conversation, isLoading } = chat;
	const timeline = useMessages(conversationId);
	const { data: messages, isLoading: loadingMessages } = timeline;
	const navigate = useNavigate();
	const [highlighted, setHighlighted] = useState<string | null>(null);
	const agents = useAgentMap();
	const agent =
		conversation?.kind === "direct" && conversation.agentId ? (agents.get(conversation.agentId) ?? null) : null;
	const layout = useLayout();
	// Only what this reads: the whole store changes on every keystroke (drafts) and every step of a reply.
	const ui = useUi(
		useShallow((s) => ({
			closePanel: s.closePanel,
			openComputer: s.openComputer,
			openPanel: s.openPanel,
			panelOpen: s.panelOpen,
			panelView: s.panelView,
			setDraft: s.setDraft,
			setReplyTo: s.setReplyTo,
		})),
	);
	const markSeen = useSeen((s) => s.markSeen);
	const runs = useWorkingAgents(conversationId);
	const scrollRef = useRef<HTMLDivElement>(null);
	const [panelSheet, setPanelSheet] = useState(false);
	const [sheetView, setSheetView] = useState<"details" | "computer">("details");
	const [askToClose, setAskToClose] = useState(false);
	// The side panel docks beside the chat only while the chat keeps at least 560px; else it's a sheet over it.
	const [rootRef, width] = useWidth<HTMLDivElement>();
	const docked = !layout.phone && width >= CHAT_MIN + PANEL_WIDTH;
	// A bot shared with you shows what you lend it there (never its owner's computer).
	const canViewComputer = Boolean(agent);
	const dockOpen = docked && ui.panelOpen && (ui.panelView !== "computer" || canViewComputer);
	const dismissPanel = useCallback(() => {
		if (docked) ui.closePanel();
		else setPanelSheet(false);
	}, [docked, ui.closePanel]);
	const closePanel = useCallback(() => {
		if (conversation?.kind === "group" && hasUnsavedChanges()) setAskToClose(true);
		else dismissPanel();
	}, [conversation?.kind, dismissPanel]);
	useBackLayer(dockOpen, closePanel);
	// Phones: toasts sit above the composer.
	const composerRef = useToastLift<HTMLDivElement>(layout.phone);
	const composerNode = useRef<HTMLDivElement>(null);
	const bindComposer = useCallback(
		(node: HTMLDivElement | null) => {
			composerRef(node);
			composerNode.current = node;
		},
		[composerRef],
	);
	const setLastChat = useUi((s) => s.setLastChat);
	useEffect(() => {
		if (conversation) setLastChat(conversation.id);
	}, [conversation, setLastChat]);

	const members = useMemo(
		() => (conversation?.memberIds ?? []).flatMap((id) => agents.get(id) ?? []),
		[conversation?.memberIds, agents],
	);
	const list = messages ?? [];
	const lastText = list
		.at(-1)
		?.parts.map((p) => ("text" in p ? p.text.length : 0))
		.join(",");
	const { atBottom, scrollToBottom, attach } = useStickToBottom(scrollRef, [list.length, lastText, runs.length]);
	// Opened from search (?m=<message id>): scroll to that message and light it up for a moment.
	const [params, setParams] = useSearchParams();
	const target = params.get("m");
	useEffect(() => {
		if (!target || !messages) return;
		const t = setTimeout(() => {
			const el = scrollRef.current?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(target)}"]`);
			if (el) {
				el.scrollIntoView({ block: "center" });
				setHighlighted(target);
			} else {
				toast("That message is further back than this chat shows.");
			}
			setParams(
				(p) => {
					p.delete("m");
					return p;
				},
				{ replace: true },
			);
		}, 120);
		return () => clearTimeout(t);
	}, [target, messages, setParams]);
	useEffect(() => {
		if (!highlighted) return;
		const timer = setTimeout(() => setHighlighted(null), 2200);
		return () => clearTimeout(timer);
	}, [highlighted]);

	useEffect(() => {
		const last = list.at(-1);
		if (last && document.visibilityState === "visible") markSeen(conversationId, last.createdAt);
	}, [list, conversationId, markSeen]);

	// Jump to the bottom when switching chats.
	// biome-ignore lint/correctness/useExhaustiveDependencies: only on chat change / first load
	useEffect(() => {
		if (!target) requestAnimationFrame(() => scrollToBottom(false));
	}, [conversationId, loadingMessages]);

	const updateAgent = useMutation({
		mutationFn: (patch: Parameters<typeof api.agents.update>[1]) => api.agents.update(agent?.id ?? "", patch),
	});
	const messaging = useMessagingChat(conversation);

	if (isLoading) {
		return <SkeletonChat className="mx-auto w-full max-w-3xl" />;
	}
	if (!conversation) {
		return chat.error && !(chat.error instanceof ApiError && chat.error.status === 404) ? (
			<ErrorState
				title="Couldn't open this chat"
				onRetry={() => void qc.refetchQueries({ queryKey: ["conversation", conversationId] })}
				className="flex-1"
			/>
		) : (
			<EmptyState
				title="This chat isn't here."
				action={
					<Button variant="secondary" onClick={() => navigate("/", { replace: true })}>
						Back to chats
					</Button>
				}
				className="flex-1"
			/>
		);
	}

	const isGroup = conversation.kind === "group";
	const pendingTyping = runs.filter((r) => !r.messageId || !list.some((m) => m.id === r.messageId));
	const busy = runs.length > 0;
	const lastAgentMessageId = [...list].reverse().find((m) => m.sender === "agent")?.id;
	const byId = new Map(list.map((m) => [m.id, m]));

	const openDetails = () => {
		if (docked) ui.openPanel();
		else {
			setSheetView("details");
			setPanelSheet(true);
		}
	};
	const toggleDetails = () => {
		if (docked) {
			if (ui.panelOpen && ui.panelView === "details") closePanel();
			else ui.openPanel();
		} else openDetails();
	};
	const openComputer = () => {
		if (docked) ui.openComputer();
		else {
			setSheetView("computer");
			setPanelSheet(true);
		}
	};
	const view = canViewComputer ? (docked ? ui.panelView : sheetView) : "details";
	const computerTitle = agent?.sharedBy ? "Your shared access" : "Computer";

	const panel =
		agent && view === "computer" ? (
			<ComputerPanel agent={agent} onClose={closePanel} />
		) : (
			<ChatDetails
				key={conversation.id}
				conversation={conversation}
				agent={agent}
				members={members}
				onClose={closePanel}
			/>
		);

	const rows: { key: string; node: ReactNode }[] = [];
	let prev: Message | undefined;
	for (const m of list) {
		if (!prev || dayLabel(prev.createdAt) !== dayLabel(m.createdAt)) {
			rows.push({
				key: `day-${m.id}`,
				node: (
					<div className="flex justify-center py-3">
						<span className="px-3 py-1 text-caption font-medium text-fg-subtle">
							{dayLabel(m.createdAt)}
						</span>
					</div>
				),
			});
		}
		const showHeader =
			!prev ||
			prev.sender !== m.sender ||
			prev.agentId !== m.agentId ||
			m.createdAt - prev.createdAt > 5 * 60_000 ||
			Boolean(m.meta.trigger && m.meta.trigger !== "user" && m.meta.trigger !== "group");
		rows.push({
			key: m.id,
			node: (
				<MessageItem
					message={m}
					agents={agents}
					isGroup={isGroup}
					showHeader={showHeader}
					isLastAgentMessage={m.id === lastAgentMessageId}
					onReply={isGroup ? (msg) => ui.setReplyTo(conversationId, msg) : undefined}
					replyTarget={m.replyToId ? (byId.get(m.replyToId) ?? null) : null}
				/>
			),
		});
		prev = m;
	}

	return (
		<div ref={rootRef} className="flex min-h-0 flex-1">
			<div className="flex min-w-0 flex-1 flex-col">
				<ChatHeader
					key={conversation.id}
					conversation={conversation}
					agent={agent}
					members={members}
					onOpenDetails={openDetails}
					onToggleDetails={toggleDetails}
					onOpenComputer={openComputer}
				/>
				<section
					ref={attach}
					className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain scrollbar-thin"
					aria-label="Messages"
				>
					<div className="mx-auto flex min-h-full w-full max-w-3xl flex-col pb-4">
						{loadingMessages ? (
							<SkeletonChat />
						) : timeline.isError && !messages ? (
							<ErrorState
								title="Couldn't load messages"
								onRetry={() => void timeline.refetch()}
								className="flex-1"
							/>
						) : list.length === 0 && pendingTyping.length === 0 ? (
							isGroup ? (
								<GroupIntro conversation={conversation} members={members} />
							) : (
								agent && (
									<AgentIntro
										agent={agent}
										onPick={(t) => {
											const draft = useUi.getState().drafts[conversation.id];
											ui.setDraft(conversation.id, draft ? `${draft}\n\n${t}` : t);
											composerNode.current?.querySelector("textarea")?.focus();
										}}
									/>
								)
							)
						) : (
							<div className="pt-2">
								{rows.map((r) => (
									<div
										key={r.key}
										data-message-id={r.key}
										className={cn(
											"rounded-lg transition-colors duration-panel",
											highlighted === r.key && "bg-brand-soft",
										)}
									>
										{r.node}
									</div>
								))}
								{pendingTyping.map((r) => {
									const a = agents.get(r.agentId);
									return a ? (
										<TypingRow
											key={r.id}
											agent={a}
											label={
												r.status === "queued"
													? `${a.name} is up next`
													: `${a.name} is thinking…`
											}
										/>
									) : null;
								})}
							</div>
						)}
					</div>
				</section>
				<div ref={bindComposer} className="relative shrink-0">
					{!atBottom && (
						<IconButton
							label="Jump to latest"
							pill
							variant="outline"
							onClick={() => scrollToBottom(!matchMedia("(prefers-reduced-motion: reduce)").matches)}
							className="absolute -top-12 left-1/2 z-sticky -translate-x-1/2 bg-surface-raised"
						>
							<ArrowDown />
						</IconButton>
					)}
					{messaging && agent && (
						<MessagingNotice chat={messaging} agentName={agent.name} agentId={agent.id} />
					)}
					<Composer
						key={conversation.id}
						conversation={conversation}
						agent={agent}
						members={members}
						busy={busy}
						onUpdateAgentModel={(primary: ModelRef) =>
							agent && updateAgent.mutate({ models: { ...agent.models, primary } })
						}
					/>
				</div>
			</div>
			{dockOpen && (
				<aside
					aria-label={view === "computer" ? computerTitle : "Chat details"}
					className="flex w-[400px] shrink-0 flex-col border-l border-border bg-bg-subtle"
				>
					{panel}
				</aside>
			)}
			{!docked && (
				<Sheet
					open={panelSheet}
					onOpenChange={(open) => (open ? setPanelSheet(true) : closePanel())}
					title={view === "computer" ? computerTitle : isGroup ? "Group details" : "Chat details"}
				>
					{panel}
				</Sheet>
			)}
			<LeaveConfirm
				open={askToClose}
				onStay={() => setAskToClose(false)}
				onLeave={() => {
					setAskToClose(false);
					dismissPanel();
				}}
			/>
		</div>
	);
}
