import { AgentAvatar, adminUrl, api, GroupAvatar, shortTime, useAgents, useConversations } from "@sekai/client";
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
	toggledTheme,
} from "@sekai/ui";
import { useQuery } from "@tanstack/react-query";
import {
	Activity,
	Blocks,
	FileUp,
	Inbox,
	KeyRound,
	Library,
	MailCheck,
	MessageSquareText,
	Moon,
	Plus,
	Settings,
	ShieldCheck,
	Users,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useOpenAgent } from "../../lib/navigation.ts";
import { useSeen } from "../../stores/seen.ts";
import { useUi } from "../../stores/ui.ts";

function Item({
	onSelect,
	icon,
	children,
	hint,
}: {
	onSelect: () => void;
	icon: ReactNode;
	children: ReactNode;
	hint?: string;
}) {
	return (
		<CommandItem onSelect={onSelect}>
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
		<span className="line-clamp-2 text-xs leading-5 text-fg-muted">
			{pieces.map((p, i) =>
				p.match ? (
					// biome-ignore lint/suspicious/noArrayIndexKey: pieces of one fixed string
					<mark key={i} className="rounded bg-brand/15 px-0.5 text-fg">
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

/** ⌘K: jump to any bot, chat or message, or run an action. */
export function CommandPalette() {
	const open = useUi((s) => s.paletteOpen);
	const setOpen = useUi((s) => s.setPaletteOpen);
	const ui = useUi();
	const navigate = useNavigate();
	const openAgent = useOpenAgent();
	const { data: agents = [] } = useAgents();
	const { data: conversations = [] } = useConversations();
	const agentMap = new Map(agents.map((a) => [a.id, a]));
	const groups = conversations.filter((c) => c.kind === "group");
	const threads = conversations.filter((c) => c.kind === "direct" && c.title !== "New chat").slice(0, 30);
	const markRead = useSeen((s) => s.markRead);
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
		enabled: open && debounced.length >= 2,
		staleTime: 10_000,
	});

	const run = (fn: () => void) => {
		setOpen(false);
		fn();
	};

	return (
		<CommandDialog open={open} onOpenChange={setOpen} description="Search bots, chats and actions">
			<Command loop>
				<CommandInput
					autoFocus
					value={query}
					onValueChange={setQuery}
					placeholder="Search bots, chats, messages and actions…"
				/>
				<CommandList>
					<CommandEmpty>No results</CommandEmpty>
					{agents.length > 0 && (
						<CommandGroup heading="Bots">
							{agents.map((a) => (
								<Item
									key={a.id}
									onSelect={() => run(() => void openAgent(a.id))}
									icon={<AgentAvatar avatar={a.avatar} size={24} />}
									hint={a.label}
								>
									{a.name}
								</Item>
							))}
						</CommandGroup>
					)}
					{groups.length > 0 && (
						<CommandGroup heading="Group chats">
							{groups.map((g) => (
								<Item
									key={g.id}
									onSelect={() => run(() => navigate(`/c/${g.id}`))}
									icon={
										<GroupAvatar
											avatars={g.memberIds.flatMap((id) => agentMap.get(id)?.avatar ?? [])}
											size={24}
										/>
									}
								>
									{g.title}
								</Item>
							))}
						</CommandGroup>
					)}
					{threads.length > 0 && (
						<CommandGroup heading="Chats">
							{threads.map((c) => {
								const a = c.agentId ? agentMap.get(c.agentId) : undefined;
								return (
									<Item
										key={c.id}
										onSelect={() => run(() => navigate(`/c/${c.id}`))}
										icon={a ? <AgentAvatar avatar={a.avatar} size={24} /> : <Users />}
										hint={a?.name}
									>
										{c.title}
									</Item>
								);
							})}
						</CommandGroup>
					)}
					{query.trim().length >= 2 && hits.length > 0 && (
						<CommandGroup heading="Messages">
							{hits.map((h) => {
								const a = h.agentId ? agentMap.get(h.agentId) : undefined;
								return (
									<CommandItem
										key={h.messageId}
										// Always matches what's typed: the server already searched.
										value={`message ${h.messageId} ${query}`}
										onSelect={() => run(() => navigate(`/c/${h.conversationId}?m=${h.messageId}`))}
									>
										{a ? <AgentAvatar avatar={a.avatar} size={24} /> : <MessageSquareText />}
										<span className="min-w-0 flex-1">
											<span className="flex items-baseline gap-2">
												<span className="truncate text-[13px] font-medium">
													{h.conversationTitle}
												</span>
												<span className="ml-auto shrink-0 text-[11px] text-fg-subtle">
													{h.sender === "user" ? "You" : (a?.name ?? "Bot")} ·{" "}
													{shortTime(h.createdAt)}
												</span>
											</span>
											<Snippet hit={h} />
										</span>
									</CommandItem>
								);
							})}
						</CommandGroup>
					)}
					<CommandGroup heading="Actions">
						<Item onSelect={() => run(() => ui.setNewAgentOpen(true))} icon={<Plus />}>
							New bot
						</Item>
						<Item onSelect={() => run(() => ui.setNewGroupOpen(true))} icon={<Users />}>
							New group chat
						</Item>
						<Item onSelect={() => run(() => ui.setImportBotOpen(true))} icon={<FileUp />}>
							Import a bot
						</Item>
						<Item onSelect={() => run(() => navigate("/library"))} icon={<Library />}>
							Library
						</Item>
						<Item onSelect={() => run(() => navigate("/inbox"))} icon={<Inbox />}>
							Needs you (approvals)
						</Item>
						<Item onSelect={() => run(() => markRead(conversations))} icon={<MailCheck />}>
							Mark all as read
						</Item>
						<Item onSelect={() => run(() => navigate("/activity"))} icon={<Activity />}>
							Activity and scheduled routines
						</Item>
						<Item onSelect={() => run(() => location.assign(adminUrl()))} icon={<ShieldCheck />}>
							Admin: models, approvals, security
						</Item>
						<Item onSelect={() => run(() => location.assign(adminUrl("apps")))} icon={<Blocks />}>
							Connect apps: skills and MCP servers
						</Item>
						<Item
							onSelect={() => run(() => location.assign(adminUrl("subscriptions")))}
							icon={<KeyRound />}
						>
							Subscriptions: use your own Codex, Claude, Grok, Gemini…
						</Item>
						<Item onSelect={() => run(() => navigate("/settings"))} icon={<Settings />}>
							Settings
						</Item>
						<Item onSelect={() => run(() => ui.setTheme(toggledTheme(ui.theme)))} icon={<Moon />}>
							Toggle dark mode
						</Item>
					</CommandGroup>
				</CommandList>
			</Command>
		</CommandDialog>
	);
}
