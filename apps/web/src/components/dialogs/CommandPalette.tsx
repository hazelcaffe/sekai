import {
	AgentAvatar,
	api,
	GroupAvatar,
	mobile,
	shortTime,
	useAccess,
	useAgents,
	useConversations,
} from "@sekai/client";
import type { MessageSearchHit } from "@sekai/shared";
import {
	Command,
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandShortcut,
} from "@sekai/ui";
import { useQuery } from "@tanstack/react-query";
import {
	Activity,
	FileUp,
	Inbox,
	Library,
	MailCheck,
	MessageSquarePlus,
	MessageSquareText,
	Plus,
	Settings,
	Users,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useOpenAgent } from "../../lib/navigation.ts";
import { MESSAGE_SCORE, ranked } from "../../lib/search.ts";
import { signOut } from "../../lib/session.ts";
import { useViewer } from "../../lib/viewer.ts";
import { scoredSections, sectionPath } from "../../settings/registry.tsx";
import { useSeen } from "../../stores/seen.ts";
import { useUi } from "../../stores/ui.ts";

function Item({
	onSelect,
	icon,
	children,
	hint,
	value,
}: {
	onSelect: () => void;
	icon: ReactNode;
	children: ReactNode;
	hint?: string;
	/** Its key in the list (the palette matches what's typed itself). */
	value: string;
}) {
	return (
		<CommandItem onSelect={onSelect} value={value}>
			{icon}
			<span className="flex-1 truncate">{children}</span>
			{hint && <CommandShortcut>{hint}</CommandShortcut>}
		</CommandItem>
	);
}

/** The words around a match, the matched ones in bold (the server marks them with \u0001 … \u0002). */
function Snippet({ hit }: { hit: MessageSearchHit }) {
	const pieces: { text: string; match: boolean }[] = [];
	for (const [i, chunk] of hit.snippet.split("\u0001").entries()) {
		if (i === 0) {
			pieces.push({ text: chunk, match: false });
			continue;
		}
		const [match = "", ...rest] = chunk.split("\u0002");
		pieces.push({ text: match, match: true }, { text: rest.join(""), match: false });
	}
	return (
		<span className="line-clamp-2 text-small text-fg-muted">
			{pieces.map((p, i) =>
				p.match ? (
					// biome-ignore lint/suspicious/noArrayIndexKey: pieces of one fixed string
					<mark key={i} className="rounded-sm bg-brand-soft px-0.5 text-fg">
						{p.text}
					</mark>
				) : (
					// biome-ignore lint/suspicious/noArrayIndexKey: pieces of one fixed string
					<span key={i}>{p.text}</span>
				),
			)}
		</span>
	);
}

interface Hit {
	key: string;
	score: number;
	node: ReactNode;
}

/**
 * ⌘K: jump to any bot (hidden ones too), chat, message or Settings section, or run an action. What's typed is
 * matched here, by title first (an exact or starting match beats one inside a word, which beats other words and
 * fuzzy letters), and each group sits by its best match, so "people" opens with People, not message snippets.
 * Opened from Settings on a phone it looks through Settings alone.
 */
export function CommandPalette() {
	const open = useUi((s) => s.paletteOpen);
	const scope = useUi((s) => s.paletteScope);
	const setOpen = useUi((s) => s.setPaletteOpen);
	const ui = useUi();
	const navigate = useNavigate();
	const openAgent = useOpenAgent();
	const { can } = useAccess();
	const { data: agents = [] } = useAgents();
	const { data: conversations = [] } = useConversations();
	const agentMap = new Map(agents.map((a) => [a.id, a]));
	const groups = conversations.filter((c) => c.kind === "group");
	const threads = conversations.filter((c) => c.kind === "direct" && c.title !== "New chat");
	const markRead = useSeen((s) => s.markRead);
	const viewer = useViewer();
	const settingsOnly = scope === "settings";
	// Messages from every chat, searched on the server as you type (a moment after you pause).
	const [query, setQuery] = useState("");
	const [debounced, setDebounced] = useState("");
	useEffect(() => {
		const t = setTimeout(() => setDebounced(query.trim()), 200);
		return () => clearTimeout(t);
	}, [query]);
	useEffect(() => {
		if (!open) setQuery("");
	}, [open]);
	const { data: hits = [] } = useQuery({
		queryKey: ["search", "messages", debounced],
		queryFn: () => api.search.messages(debounced, 20),
		enabled: open && !settingsOnly && debounced.length >= 2,
		staleTime: 10_000,
	});

	const run = (fn: () => void) => {
		setOpen(false);
		fn();
	};
	const q = query.trim();
	// Everything when nothing's typed (recent chats only); else what matches, best first.
	const pick = <T,>(
		items: T[],
		fields: (item: T) => [string, string?],
		empty = items,
	): { item: T; score: number }[] => (q ? ranked(q, items, fields) : empty.map((item) => ({ item, score: 0 })));

	const bots: Hit[] = pick(agents, (a) => [a.name, a.label]).map(({ item: a, score }) => ({
		key: `bot:${a.id}`,
		score,
		node: (
			<Item
				key={a.id}
				value={`bot:${a.id}`}
				onSelect={() => run(() => void openAgent(a.id))}
				icon={<AgentAvatar avatar={a.avatar} size={24} />}
				hint={a.hidden ? "Hidden" : a.label}
			>
				{a.name}
			</Item>
		),
	}));
	const groupHits: Hit[] = pick(groups, (g) => [g.title]).map(({ item: g, score }) => ({
		key: `group:${g.id}`,
		score,
		node: (
			<Item
				key={g.id}
				value={`group:${g.id}`}
				onSelect={() => run(() => navigate(`/c/${g.id}`))}
				icon={<GroupAvatar avatars={g.memberIds.flatMap((id) => agentMap.get(id)?.avatar ?? [])} size={24} />}
			>
				{g.title}
			</Item>
		),
	}));
	const chatHits: Hit[] = pick(threads, (c) => [c.title, agentMap.get(c.agentId ?? "")?.name], threads.slice(0, 30))
		.slice(0, 30)
		.map(({ item: c, score }) => {
			const a = c.agentId ? agentMap.get(c.agentId) : undefined;
			return {
				key: `chat:${c.id}`,
				score,
				node: (
					<Item
						key={c.id}
						value={`chat:${c.id}`}
						onSelect={() => run(() => navigate(`/c/${c.id}`))}
						icon={a ? <AgentAvatar avatar={a.avatar} size={24} /> : <Users />}
						hint={a?.name}
					>
						{c.title}
					</Item>
				),
			};
		});
	const messageHits: Hit[] =
		q.length >= 2
			? hits.map((h) => {
					const a = h.agentId ? agentMap.get(h.agentId) : undefined;
					return {
						key: `message:${h.messageId}`,
						score: MESSAGE_SCORE,
						node: (
							<CommandItem
								key={h.messageId}
								value={`message:${h.messageId}`}
								onSelect={() => run(() => navigate(`/c/${h.conversationId}?m=${h.messageId}`))}
							>
								{a ? <AgentAvatar avatar={a.avatar} size={24} /> : <MessageSquareText />}
								<span className="min-w-0 flex-1">
									<span className="flex items-baseline gap-2">
										<span className="truncate text-body font-medium">{h.conversationTitle}</span>
										<span className="ml-auto shrink-0 text-caption text-fg-subtle">
											{h.sender === "user" ? "You" : (a?.name ?? "Bot")} ·{" "}
											{shortTime(h.createdAt)}
										</span>
									</span>
									<Snippet hit={h} />
								</span>
							</CommandItem>
						),
					};
				})
			: [];
	const settingsHits: Hit[] =
		q || settingsOnly
			? scoredSections(q, viewer).map(({ item: sec, score }) => ({
					key: `settings:${sec.id}`,
					score,
					node: (
						<Item
							key={sec.id}
							value={`settings:${sec.id}`}
							icon={sec.icon}
							onSelect={() =>
								run(() =>
									sec.action === "sign-out"
										? void signOut()
										: sec.action === "phone-server"
											? mobile?.openSettings()
											: sec.action === "get-apps"
												? ui.setGetAppsOpen(true)
												: navigate(sectionPath(sec.id)),
								)
							}
						>
							{sec.title}
						</Item>
					),
				}))
			: [];
	// Only actions that can work for you now (DESIGN: never a live control that will fail).
	const actions: { id: string; title: string; words?: string; icon: ReactNode; onSelect: () => void }[] = [
		...(agents.length > 0
			? [
					{
						id: "new-chat",
						title: "New chat",
						icon: <MessageSquarePlus />,
						onSelect: () => ui.setNewChatOpen(true),
					},
				]
			: []),
		{
			id: "new-bot",
			title: "New bot",
			words: "create make",
			icon: <Plus />,
			onSelect: () => ui.setNewAgentOpen(true),
		},
		...(agents.length >= 2
			? [{ id: "new-group", title: "New group", icon: <Users />, onSelect: () => ui.setNewGroupOpen(true) }]
			: []),
		...(can("bots")
			? [
					{
						id: "import",
						title: "Import a bot",
						words: "file upload",
						icon: <FileUp />,
						onSelect: () => ui.setImportBotOpen(true),
					},
				]
			: []),
		{
			id: "library",
			title: "Library",
			words: "documents files",
			icon: <Library />,
			onSelect: () => navigate("/library"),
		},
		{
			id: "inbox",
			title: "Needs you",
			words: "approvals inbox requests",
			icon: <Inbox />,
			onSelect: () => navigate("/inbox"),
		},
		{ id: "read", title: "Mark all as read", icon: <MailCheck />, onSelect: () => markRead(conversations) },
		{
			id: "activity",
			title: "Activity",
			words: "scheduled routines log runs",
			icon: <Activity />,
			onSelect: () => navigate("/activity"),
		},
		{ id: "settings", title: "Settings", icon: <Settings />, onSelect: () => navigate("/settings") },
	];
	const actionHits: Hit[] = pick(actions, (x) => [x.title, x.words]).map(({ item: x, score }) => ({
		key: `action:${x.id}`,
		score,
		node: (
			<Item key={x.id} value={`action:${x.id}`} onSelect={() => run(x.onSelect)} icon={x.icon}>
				{x.title}
			</Item>
		),
	}));

	const sections = (
		settingsOnly
			? [{ heading: "Settings", hits: settingsHits }]
			: [
					{ heading: "Bots", hits: bots },
					{ heading: "Group chats", hits: groupHits },
					{ heading: "Chats", hits: chatHits },
					{ heading: "Messages", hits: messageHits },
					{ heading: "Settings", hits: settingsHits },
					{ heading: "Actions", hits: actionHits },
				]
	)
		.filter((g) => g.hits.length > 0)
		.map((g, i) => ({ ...g, best: Math.max(...g.hits.map((h) => h.score)), i }))
		// Typing: the group with the best match first (the order above breaks ties).
		.sort((a, b) => (q ? b.best - a.best || a.i - b.i : a.i - b.i));

	return (
		<CommandDialog
			open={open}
			onOpenChange={setOpen}
			description={settingsOnly ? "Search settings" : "Search bots, chats, settings and actions"}
		>
			<Command loop shouldFilter={false}>
				<CommandInput
					autoFocus
					value={query}
					onValueChange={setQuery}
					placeholder={settingsOnly ? "Search settings…" : "Search bots, chats, messages and settings…"}
				/>
				<CommandList>
					<CommandEmpty>No results</CommandEmpty>
					{sections.map((g) => (
						<CommandGroup key={g.heading} heading={g.heading}>
							{g.hits.map((h) => h.node)}
						</CommandGroup>
					))}
				</CommandList>
			</Command>
		</CommandDialog>
	);
}
