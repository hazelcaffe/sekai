import {
	AgentAvatar,
	api,
	cn,
	dayLabel,
	GroupAvatar,
	shortTime,
	useAgentMap,
	useConversation,
	useConversations,
	useMachines,
	useMessages,
	useSettings,
} from "@sekai/client";
import { type Agent, avatarColor, type Conversation, channelTitle, type Message, type ModelRef } from "@sekai/shared";
import {
	Button,
	Confirm,
	DropdownContent,
	DropdownItem,
	DropdownLabel,
	DropdownMenu,
	DropdownSeparator,
	DropdownTrigger,
	EmptyState,
	IconButton,
	Sheet,
	Spinner,
} from "@sekai/ui";
import { useMutation } from "@tanstack/react-query";
import {
	ArrowDown,
	Eraser,
	Menu,
	MessageSquarePlus,
	Monitor,
	MoreHorizontal,
	PanelRight,
	Phone,
	Trash2,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { AgentPanel } from "../components/agent/AgentPanel.tsx";
import { Composer, type PendingFile } from "../components/chat/Composer.tsx";
import { MessageItem, TypingRow } from "../components/chat/MessageItem.tsx";
import { ComputerPanel } from "../components/computer/ComputerPanel.tsx";
import { GroupPanel } from "../components/group/GroupPanel.tsx";
import { useCallControls } from "../components/voice/CallProvider.tsx";
import { useLayout, useStickToBottom } from "../lib/hooks.ts";
import { type MessagingChat, useMessagingChat, useOpenAgent } from "../lib/navigation.ts";
import { useSeen } from "../stores/seen.ts";
import { useAgentPresence, useUi, useWorkingAgents } from "../stores/ui.ts";

const STARTERS = [
	"What can you help me with?",
	"What do you remember about me?",
	"Set up a short morning brief every weekday at 8am",
	"Remind me in 30 minutes to take a break",
];

function ChatHeader({
	conversation,
	agent,
	members,
	onOpenPanel,
	onOpenComputer,
}: {
	conversation: Conversation;
	agent: Agent | null;
	members: Agent[];
	onOpenPanel: () => void;
	onOpenComputer: () => void;
}) {
	const { data: machines = [] } = useMachines(agent?.id);
	const hasMachine = Boolean(agent) && machines.length > 0;
	const { phone, wide } = useLayout();
	const navigate = useNavigate();
	const ui = useUi();
	const { data: conversations = [] } = useConversations();
	const [confirm, setConfirm] = useState<"reset" | "delete" | null>(null);
	const threads = agent
		? conversations
				.filter((c) => c.kind === "direct" && c.agentId === agent.id)
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
			const next = threads.find((t) => t.id !== conversation.id);
			navigate(next ? `/c/${next.id}` : "/");
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
		? messaging.dm
			? `${channelTitle(messaging.type)} DM`
			: `${channelTitle(messaging.type)} · ${messaging.name}`
		: null;
	const subtitle = isGroup
		? (busy ?? members.map((m) => m.name).join(", "))
		: presence.state === "thinking" || presence.state === "working"
			? `${presence.label ?? "Working"}…`
			: presence.state === "waiting" || presence.state === "blocked"
				? presence.label
				: where || agent?.label || (phone ? "Tap for details" : null);

	return (
		<header className="flex h-14 shrink-0 items-center gap-1 px-2 pt-safe md:px-3">
			{phone && (
				<IconButton label="Menu" onClick={() => ui.setSidebarOpen(true)}>
					<Menu />
				</IconButton>
			)}
			<button
				type="button"
				onClick={onOpenPanel}
				className="flex min-w-0 items-center gap-2.5 rounded-xl px-2 py-1.5 text-left hover:bg-surface-2/70"
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
					<span className="flex items-center gap-1 truncate text-[15px] font-semibold leading-5">
						{isGroup ? conversation.title : (agent?.name ?? "Bot")}
					</span>
					{subtitle && (
						<span
							className={cn(
								"block truncate text-xs leading-4",
								busy || presence.state === "thinking" || presence.state === "working"
									? "shimmer-text"
									: presence.state === "waiting"
										? "text-warning"
										: presence.state === "blocked"
											? "text-danger"
											: "text-fg-subtle",
							)}
						>
							{subtitle}
						</span>
					)}
				</span>
			</button>
			<div className="ml-auto flex items-center gap-0.5">
				{!isGroup && agent && (
					<IconButton
						label={inCall ? `On a call with ${agent.name}` : `Call ${agent.name}`}
						onClick={() => startCall({ conversationId: conversation.id, agent })}
						className={cn(inCall && "bg-success/15 text-success hover:bg-success/20 hover:text-success")}
					>
						<Phone />
					</IconButton>
				)}
				{hasMachine && (
					// Lit while the bot is working on its computer (Grok Bot's status level).
					<IconButton
						label={presence.computer ? `${agent?.name} is using its computer` : "Computer"}
						onClick={onOpenComputer}
						className={cn(presence.computer && "bg-violet-500/15 text-violet-500 hover:bg-violet-500/20")}
					>
						<Monitor />
					</IconButton>
				)}
				{!isGroup && agent && (
					<DropdownMenu>
						<DropdownTrigger asChild>
							<Button variant="ghost" size="icon" aria-label="Chats">
								<MoreHorizontal />
							</Button>
						</DropdownTrigger>
						<DropdownContent className="w-72" align="end">
							<DropdownItem icon={<MessageSquarePlus />} onSelect={() => newChat.mutate()}>
								New chat
							</DropdownItem>
							<DropdownItem icon={<Monitor />} onSelect={onOpenComputer}>
								{hasMachine ? `${agent.name}'s computer` : "Give it a computer"}
							</DropdownItem>
							<DropdownSeparator />
							<DropdownLabel>Chats with {agent.name}</DropdownLabel>
							<div className="max-h-72 overflow-y-auto scrollbar-thin">
								{threads.map((t) => (
									<DropdownItem
										key={t.id}
										onSelect={() => navigate(`/c/${t.id}`)}
										className={cn(t.id === conversation.id && "bg-surface-2")}
									>
										<span className="flex w-full items-center gap-2">
											<span className="min-w-0 flex-1 truncate">{t.title}</span>
											<span className="text-xs text-fg-subtle">
												{shortTime(t.lastMessageAt ?? t.createdAt)}
											</span>
										</span>
									</DropdownItem>
								))}
							</div>
							<DropdownSeparator />
							<DropdownItem icon={<Eraser />} onSelect={() => setConfirm("reset")}>
								Reset this chat
							</DropdownItem>
							<DropdownItem danger icon={<Trash2 />} onSelect={() => setConfirm("delete")}>
								Delete this chat
							</DropdownItem>
						</DropdownContent>
					</DropdownMenu>
				)}
				{!phone && (
					<IconButton
						label={wide ? "Toggle details" : "Details"}
						shortcut="Ctrl ."
						onClick={() => (wide ? ui.togglePanel() : onOpenPanel())}
					>
						<PanelRight />
					</IconButton>
				)}
			</div>
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
			<h1 className="mt-4 text-2xl font-semibold tracking-tight">{agent.name}</h1>
			{agent.label && <p className="mt-1 text-sm text-fg-muted">{agent.label}</p>}
			{agent.job && <p className="mt-3 line-clamp-3 max-w-md text-sm leading-6 text-fg-subtle">{agent.job}</p>}
			<div className="mt-7 grid w-full max-w-lg grid-cols-1 gap-2 xs:grid-cols-2">
				{STARTERS.map((s) => (
					<button
						key={s}
						type="button"
						onClick={() => onPick(s)}
						className="rounded-2xl border border-border px-4 py-3 text-left text-[13px] leading-5 text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
					>
						{s}
					</button>
				))}
			</div>
		</div>
	);
}

function GroupIntro({ conversation, members }: { conversation: Conversation; members: Agent[] }) {
	return (
		<div className="flex flex-1 flex-col items-center justify-center px-6 py-10 text-center">
			<GroupAvatar avatars={members.map((m) => m.avatar)} size={88} />
			<h1 className="mt-4 text-2xl font-semibold tracking-tight">{conversation.title}</h1>
			<p className="mt-2 max-w-md text-sm leading-6 text-fg-subtle">
				{conversation.settings.purpose ||
					"Write normally and the right bot answers. Use @Name to address someone, or @everyone for all. Bots can @mention each other to hand off work."}
			</p>
			<div className="mt-6 flex flex-wrap justify-center gap-2">
				{members.map((m) => (
					<span
						key={m.id}
						className="flex items-center gap-2 rounded-full border border-border py-1 pr-3 pl-1 text-[13px]"
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
		<div className="mx-auto mb-2 flex w-full max-w-3xl items-center gap-2 rounded-2xl bg-surface-2/70 px-3.5 py-2 text-xs text-fg-subtle">
			<span className="min-w-0 flex-1">
				{chat.dm ? `Your ${app} DM with ${agentName}.` : `${agentName} in ${chat.name} on ${app}.`} What you
				type here stays in Sekai.
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
	const { data: conversation, isLoading } = useConversation(conversationId);
	const { data: messages, isLoading: loadingMessages } = useMessages(conversationId);
	const { data: settings } = useSettings();
	const agents = useAgentMap();
	const layout = useLayout();
	const ui = useUi();
	const markSeen = useSeen((s) => s.markSeen);
	const runs = useWorkingAgents(conversationId);
	const scrollRef = useRef<HTMLDivElement>(null);
	const [files, setFiles] = useState<PendingFile[]>([]);
	// Attachments belong to the chat they were added in: switching chats starts empty.
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset when the chat changes
	useEffect(() => setFiles([]), [conversationId]);
	const [panelSheet, setPanelSheet] = useState(false);
	const [sheetView, setSheetView] = useState<"details" | "computer">("details");

	const agent =
		conversation?.kind === "direct" && conversation.agentId ? (agents.get(conversation.agentId) ?? null) : null;
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
				el.classList.add("bg-brand/10", "rounded-2xl", "transition-colors", "duration-700");
				setTimeout(() => el.classList.remove("bg-brand/10"), 2200);
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
		const last = list.at(-1);
		if (last && document.visibilityState === "visible") markSeen(conversationId, last.createdAt);
	}, [list, conversationId, markSeen]);

	// Jump to the bottom when switching chats.
	// biome-ignore lint/correctness/useExhaustiveDependencies: only on chat change / first load
	useEffect(() => {
		requestAnimationFrame(() => scrollToBottom(false));
	}, [conversationId, loadingMessages]);

	const updateAgent = useMutation({
		mutationFn: (patch: Parameters<typeof api.agents.update>[1]) => api.agents.update(agent?.id ?? "", patch),
	});
	const send = useMutation({ mutationFn: (text: string) => api.conversations.send(conversationId, { text }) });
	const messaging = useMessagingChat(conversation);

	if (isLoading) {
		return (
			<div className="flex flex-1 items-center justify-center">
				<Spinner className="size-6" />
			</div>
		);
	}
	if (!conversation) {
		return <EmptyState title="Chat not found" description="It may have been deleted." className="flex-1" />;
	}

	const isGroup = conversation.kind === "group";
	const inheritedMode =
		(agent && agent.capabilities.approvalMode !== "inherit"
			? agent.capabilities.approvalMode
			: settings?.approvalMode) ?? "auto";
	const pendingTyping = runs.filter((r) => !r.messageId || !list.some((m) => m.id === r.messageId));
	const busy = runs.length > 0;
	const lastAgentMessageId = [...list].reverse().find((m) => m.sender === "agent")?.id;
	const byId = new Map(list.map((m) => [m.id, m]));

	const openPanel = () => {
		if (layout.wide) ui.openPanel();
		else {
			setSheetView("details");
			setPanelSheet(true);
		}
	};
	const openComputer = () => {
		if (layout.wide) ui.openComputer();
		else {
			setSheetView("computer");
			setPanelSheet(true);
		}
	};
	const view = layout.wide ? ui.panelView : sheetView;

	const panel =
		agent && view === "computer" ? (
			<ComputerPanel agent={agent} onClose={() => (layout.wide ? ui.closePanel() : setPanelSheet(false))} />
		) : isGroup ? (
			<GroupPanel
				conversation={conversation}
				members={members}
				onClose={() => (layout.wide ? ui.closePanel() : setPanelSheet(false))}
			/>
		) : agent ? (
			<AgentPanel
				agent={agent}
				conversation={conversation}
				onClose={() => (layout.wide ? ui.closePanel() : setPanelSheet(false))}
			/>
		) : null;

	// Your messages take the bot's color in its chats (Grok Bot style); groups stay neutral.
	const tint = !isGroup && agent ? avatarColor(agent.avatar) : undefined;
	const rows: { key: string; node: ReactNode }[] = [];
	let prev: Message | undefined;
	for (const m of list) {
		if (!prev || dayLabel(prev.createdAt) !== dayLabel(m.createdAt)) {
			rows.push({
				key: `day-${m.id}`,
				node: (
					<div className="flex justify-center py-3">
						<span className="px-3 py-1 text-[11px] font-medium text-fg-subtle">
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
					tint={tint}
				/>
			),
		});
		prev = m;
	}

	return (
		<div className="flex min-h-0 flex-1">
			<div className="flex min-w-0 flex-1 flex-col">
				<ChatHeader
					conversation={conversation}
					agent={agent}
					members={members}
					onOpenPanel={openPanel}
					onOpenComputer={openComputer}
				/>
				<div
					ref={attach}
					className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain scrollbar-thin [mask-image:linear-gradient(to_bottom,transparent,black_18px)]"
				>
					<div className="mx-auto flex min-h-full w-full max-w-3xl flex-col pb-4">
						{loadingMessages ? (
							<div className="flex flex-1 items-center justify-center">
								<Spinner />
							</div>
						) : list.length === 0 && pendingTyping.length === 0 ? (
							isGroup ? (
								<GroupIntro conversation={conversation} members={members} />
							) : (
								agent && <AgentIntro agent={agent} onPick={(t) => send.mutate(t)} />
							)
						) : (
							<div className="pt-2">
								{rows.map((r) => (
									<div key={r.key} data-message-id={r.key}>
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
				</div>
				<div className="relative shrink-0">
					{!atBottom && (
						<button
							type="button"
							onClick={() => scrollToBottom()}
							aria-label="Scroll to bottom"
							className="absolute -top-12 left-1/2 z-10 flex size-9 -translate-x-1/2 items-center justify-center rounded-full border border-border bg-surface shadow-soft hover:bg-surface-2"
						>
							<ArrowDown className="size-4" />
						</button>
					)}
					{messaging && agent && (
						<MessagingNotice chat={messaging} agentName={agent.name} agentId={agent.id} />
					)}
					<Composer
						conversation={conversation}
						agent={agent}
						members={members}
						busy={busy}
						inheritedMode={inheritedMode}
						onUpdateAgentModel={(primary: ModelRef) =>
							agent && updateAgent.mutate({ models: { ...agent.models, primary } })
						}
						onToggleWebSearch={() =>
							agent &&
							updateAgent.mutate({
								capabilities: { ...agent.capabilities, webSearch: !agent.capabilities.webSearch },
							})
						}
						files={files}
						setFiles={setFiles}
					/>
				</div>
			</div>
			{layout.wide && ui.panelOpen && panel && (
				<aside className="flex w-[400px] shrink-0 flex-col border-l border-border bg-bg-subtle 2xl:w-[440px]">
					{panel}
				</aside>
			)}
			{!layout.wide && panel && (
				<Sheet
					open={panelSheet}
					onOpenChange={setPanelSheet}
					title={view === "computer" ? "Computer" : isGroup ? "Group details" : "Bot details"}
				>
					{panel}
				</Sheet>
			)}
		</div>
	);
}
