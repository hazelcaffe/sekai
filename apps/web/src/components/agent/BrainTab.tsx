import { api, cn, formatTokens, timeAgo, useAgentContext, useMemories, useSharedMemories } from "@sekai/client";
import {
	type Agent,
	type Conversation,
	MEMORY_KIND_LABELS,
	MEMORY_KINDS,
	type Memory,
	type MemoryKind,
} from "@sekai/shared";
import {
	Badge,
	Button,
	Confirm,
	EmptyState,
	IconButton,
	Section,
	Select,
	Spinner,
	Textarea,
	ToggleRow,
} from "@sekai/ui";
import { useMutation } from "@tanstack/react-query";
import {
	Check,
	ChevronRight,
	Eraser,
	ListChecks,
	Pencil,
	Pin,
	PinOff,
	Plus,
	RefreshCw,
	Shrink,
	Trash2,
	Users,
	X,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

function MemoryRow({ memory }: { memory: Memory }) {
	const [editing, setEditing] = useState(false);
	const [text, setText] = useState(memory.content);
	const update = useMutation({
		mutationFn: (patch: Parameters<typeof api.memories.update>[1]) => api.memories.update(memory.id, patch),
		onSuccess: () => setEditing(false),
	});
	const del = useMutation({ mutationFn: () => api.memories.delete(memory.id) });
	if (editing) {
		return (
			<div className="flex flex-col gap-2 rounded-xl bg-surface-2/60 p-2.5">
				<Textarea
					value={text}
					onChange={(e) => setText(e.target.value)}
					className="min-h-16 text-[13px]"
					autoFocus
				/>
				<div className="flex justify-end gap-1.5">
					<Button variant="ghost" size="xs" onClick={() => setEditing(false)}>
						<X /> Cancel
					</Button>
					<Button
						variant="primary"
						size="xs"
						disabled={!text.trim()}
						onClick={() => update.mutate({ content: text })}
					>
						<Check /> Save
					</Button>
				</div>
			</div>
		);
	}
	return (
		<div className="group flex items-start gap-2 rounded-xl px-2.5 py-2 hover:bg-surface-2/60">
			<div className="min-w-0 flex-1">
				<p className="text-[13px] leading-5 break-words">{memory.content}</p>
				<p className="mt-0.5 text-[11px] text-fg-subtle">
					{memory.source === "auto" ? "Learned" : memory.source === "agent" ? "Saved by bot" : "Added by you"}{" "}
					· {timeAgo(memory.updatedAt)}
					{memory.pinned && " · pinned"}
				</p>
			</div>
			<div className="flex shrink-0 opacity-0 transition-opacity group-hover:opacity-100 coarse:opacity-100">
				<IconButton
					label={memory.pinned ? "Unpin" : "Pin"}
					size="icon-sm"
					onClick={() => update.mutate({ pinned: !memory.pinned })}
				>
					{memory.pinned ? <PinOff /> : <Pin />}
				</IconButton>
				<IconButton
					label="Edit"
					size="icon-sm"
					onClick={() => {
						// Start from the memory as it is now (the bot may have changed it since this opened).
						setText(memory.content);
						setEditing(true);
					}}
				>
					<Pencil />
				</IconButton>
				<IconButton label="Forget" size="icon-sm" onClick={() => del.mutate()}>
					<Trash2 />
				</IconButton>
			</div>
		</div>
	);
}

function AddMemory({ agentId, shared }: { agentId: string | null; shared?: boolean }) {
	const [open, setOpen] = useState(false);
	const [kind, setKind] = useState<MemoryKind>(shared ? "about_user" : "fact");
	const [text, setText] = useState("");
	const create = useMutation({
		mutationFn: () => api.memories.create({ agentId, kind, content: text.trim() }),
		onSuccess: () => {
			setText("");
			setOpen(false);
		},
	});
	if (!open) {
		return (
			<Button variant="ghost" size="sm" className="self-start" onClick={() => setOpen(true)}>
				<Plus /> {shared ? "Add a fact about you" : "Add memory"}
			</Button>
		);
	}
	return (
		<div className="flex flex-col gap-2 rounded-2xl border border-border p-3">
			{!shared && (
				<Select
					size="sm"
					value={kind}
					onValueChange={(v) => setKind(v as MemoryKind)}
					options={MEMORY_KINDS.map((k) => ({ value: k, label: MEMORY_KIND_LABELS[k] }))}
				/>
			)}
			<Textarea
				autoFocus
				value={text}
				onChange={(e) => setText(e.target.value)}
				placeholder={shared ? "I'm based in Toronto and work on infra." : "Always reply in bullet points."}
				className="min-h-16 text-[13px]"
			/>
			<div className="flex justify-end gap-1.5">
				<Button variant="ghost" size="xs" onClick={() => setOpen(false)}>
					Cancel
				</Button>
				<Button
					variant="primary"
					size="xs"
					disabled={!text.trim() || create.isPending}
					onClick={() => create.mutate()}
				>
					Save
				</Button>
			</div>
		</div>
	);
}

function ContextMeter({ agent, conversation }: { agent: Agent; conversation: Conversation }) {
	const { data: ctx, isLoading, refetch, isFetching } = useAgentContext(agent.id, conversation.id);
	const [showPrompt, setShowPrompt] = useState(false);
	const [confirmReset, setConfirmReset] = useState(false);
	const compact = useMutation({
		mutationFn: () => api.conversations.compact(conversation.id),
		onSuccess: () => void refetch(),
	});
	const clearSummary = useMutation({
		mutationFn: () => api.conversations.clearSummary(conversation.id),
		onSuccess: () => void refetch(),
	});
	const reset = useMutation({
		mutationFn: () => api.conversations.reset(conversation.id),
		onSuccess: () => void refetch(),
	});

	if (isLoading || !ctx) {
		return (
			<div className="flex justify-center py-6">
				<Spinner />
			</div>
		);
	}
	const pct = Math.min(100, (ctx.totalTokens / ctx.contextWindow) * 100);
	const segments = [
		...ctx.sections.map((s) => ({ id: s.id, title: s.title, tokens: s.tokens })),
		{ id: "history", title: "Conversation history", tokens: ctx.history.tokens },
	].filter((s) => s.tokens > 0);
	const colors = [
		"#7c6cff",
		"#4cc9f0",
		"#3ddc97",
		"#ffcd3c",
		"#ff9f43",
		"#ff7eb6",
		"#b388ff",
		"#2ec4b6",
		"#94a3b8",
		"#4f8cff",
		"#ff7a6b",
	];

	return (
		<div className="flex flex-col gap-3">
			<div className="flex items-end justify-between gap-2">
				<div>
					<div className="text-2xl font-semibold tracking-tight">{formatTokens(ctx.totalTokens)}</div>
					<div className="text-xs text-fg-subtle">
						of {formatTokens(ctx.contextWindow)} tokens on {ctx.model} ({pct.toFixed(pct < 1 ? 2 : 1)}%)
					</div>
				</div>
				<IconButton label="Refresh" size="icon-sm" onClick={() => void refetch()}>
					<RefreshCw className={cn(isFetching && "animate-spin")} />
				</IconButton>
			</div>
			<div className="flex h-2.5 overflow-hidden rounded-full bg-surface-2">
				{segments.map((s, i) => (
					<div
						key={s.id}
						title={`${s.title}: ${formatTokens(s.tokens)}`}
						style={{
							width: `${(s.tokens / ctx.contextWindow) * 100}%`,
							background: colors[i % colors.length],
							minWidth: 2,
						}}
					/>
				))}
			</div>
			<div className="grid grid-cols-1 gap-x-4 gap-y-1 xs:grid-cols-2">
				{segments.map((s, i) => (
					<div key={s.id} className="flex items-center gap-2 text-xs">
						<span
							className="size-2 shrink-0 rounded-full"
							style={{ background: colors[i % colors.length] }}
						/>
						<span className="min-w-0 flex-1 truncate text-fg-muted">{s.title}</span>
						<span className="text-fg-subtle tabular-nums">{formatTokens(s.tokens)}</span>
					</div>
				))}
			</div>

			<div className="rounded-2xl border border-border p-3.5">
				<div className="flex items-center justify-between gap-2">
					<div className="text-[13px] font-medium">This chat</div>
					<span className="text-xs text-fg-subtle">
						{ctx.history.messages} messages in context
						{ctx.history.summarizedMessages > 0 && ` · ${ctx.history.summarizedMessages} summarized`}
					</span>
				</div>
				{ctx.history.summary && (
					<div className="mt-2 max-h-40 overflow-y-auto rounded-xl bg-surface-2/60 p-2.5 text-xs leading-5 whitespace-pre-wrap text-fg-muted scrollbar-thin">
						{ctx.history.summary}
					</div>
				)}
				<div className="mt-3 flex flex-wrap gap-1.5">
					<Button variant="secondary" size="xs" onClick={() => compact.mutate()} disabled={compact.isPending}>
						{compact.isPending ? <Spinner /> : <Shrink />} Compact now
					</Button>
					{ctx.history.summary && (
						<Button variant="secondary" size="xs" onClick={() => clearSummary.mutate()}>
							<Eraser /> Clear summary
						</Button>
					)}
					<Button variant="danger-ghost" size="xs" onClick={() => setConfirmReset(true)}>
						<Trash2 /> Reset chat
					</Button>
				</div>
			</div>

			<button
				type="button"
				onClick={() => setShowPrompt((s) => !s)}
				className="flex items-center gap-1 text-[13px] font-medium text-fg-muted hover:text-fg"
			>
				<ChevronRight className={cn("size-4 transition-transform", showPrompt && "rotate-90")} />
				View full system prompt ({ctx.tools.length} tools)
			</button>
			{showPrompt && (
				<pre className="max-h-[50dvh] overflow-auto rounded-2xl border border-border bg-bg p-3 font-mono text-[11px] leading-5 whitespace-pre-wrap text-fg-muted scrollbar-thin">
					{ctx.systemPrompt}
				</pre>
			)}
			<Confirm
				open={confirmReset}
				onOpenChange={setConfirmReset}
				title="Reset this chat?"
				description="Clears the conversation history and its summary. Memory and notes are kept."
				confirmLabel="Reset"
				onConfirm={() => reset.mutate()}
			/>
		</div>
	);
}

/** shared: a bot someone shared with you (its context and settings are its owner's). */
export function BrainTab({
	agent,
	conversation,
	shared: sharedBot = false,
}: {
	agent: Agent;
	conversation: Conversation;
	shared?: boolean;
}) {
	const { data: memories = [], isLoading } = useMemories(agent.id);
	const { data: shared = [] } = useSharedMemories();
	const [clearOpen, setClearOpen] = useState(false);
	const clear = useMutation({ mutationFn: () => api.memories.clear({ agentId: agent.id }) });
	const checkup = useMutation({
		mutationFn: () => api.memories.checkup(agent.id),
		onSuccess: (r) =>
			r.posted
				? toast.success(`${agent.name} posted what it tidied and asked in its chat`)
				: toast(memories.length < 6 ? "Not enough memories to tidy yet" : "All tidy: nothing to change or ask"),
		onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
	});
	const update = useMutation({
		mutationFn: (patch: Parameters<typeof api.agents.update>[1]) => api.agents.update(agent.id, patch),
	});

	return (
		<div className="flex flex-col gap-7">
			{!sharedBot && (
				<Section title="Context" description="Exactly what the bot reads on its next turn.">
					<ContextMeter agent={agent} conversation={conversation} />
				</Section>
			)}

			<Section
				title="Memory"
				description="What this bot keeps across chats. It saves things on its own; you can edit anything."
				action={
					memories.length > 0 && (
						<div className="flex gap-1">
							<Button
								variant="ghost"
								size="xs"
								onClick={() => checkup.mutate()}
								disabled={checkup.isPending}
								title="Merge duplicates, drop what a newer memory replaced, and ask you about things that may have changed"
							>
								{checkup.isPending ? <Spinner /> : <ListChecks />} Check up
							</Button>
							<Button variant="danger-ghost" size="xs" onClick={() => setClearOpen(true)}>
								Clear all
							</Button>
						</div>
					)
				}
			>
				{!sharedBot && (
					<ToggleRow
						title="Auto-learn"
						description="After each reply, a background model saves lasting facts and corrections."
						checked={agent.capabilities.autoLearn}
						onCheckedChange={(autoLearn) =>
							update.mutate({ capabilities: { ...agent.capabilities, autoLearn } })
						}
					/>
				)}
				{isLoading ? (
					<Spinner />
				) : memories.length === 0 ? (
					<EmptyState
						title="No memories yet"
						description="Tell it something to remember, or add one here."
						className="py-6"
					/>
				) : (
					MEMORY_KINDS.filter((k) => memories.some((m) => m.kind === k)).map((kind) => (
						<div key={kind} className="flex flex-col">
							<div className="flex items-center gap-2 px-2.5 pb-1">
								<span className="text-xs font-medium text-fg-subtle">{MEMORY_KIND_LABELS[kind]}</span>
								<Badge>{memories.filter((m) => m.kind === kind).length}</Badge>
							</div>
							{memories
								.filter((m) => m.kind === kind)
								.map((m) => (
									<MemoryRow key={m.id} memory={m} />
								))}
						</div>
					))
				)}
				<AddMemory agentId={agent.id} />
			</Section>

			<Section
				title={
					<span className="flex items-center gap-1.5">
						<Users className="size-3.5" /> Shared with every bot
					</span>
				}
				description="Facts about you that all your bots know, like your name and time zone."
			>
				{shared.length === 0 ? (
					<p className="px-2.5 text-[13px] text-fg-subtle">Nothing shared yet.</p>
				) : (
					shared.map((m) => <MemoryRow key={m.id} memory={m} />)
				)}
				<AddMemory agentId={null} shared />
			</Section>

			<Confirm
				open={clearOpen}
				onOpenChange={setClearOpen}
				title={`Clear ${agent.name}'s memory?`}
				description="Deletes every memory this bot saved. Shared facts about you are kept."
				confirmLabel="Clear memory"
				danger
				onConfirm={() => clear.mutate()}
			/>
		</div>
	);
}
