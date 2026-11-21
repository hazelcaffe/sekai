import { api, timeAgo, useMemories, useSharedMemories } from "@sekai/client";
import { type Agent, MEMORY_KIND_LABELS, MEMORY_KINDS, type Memory, type MemoryKind } from "@sekai/shared";
import {
	Button,
	Confirm,
	Dialog,
	EmptyState,
	ErrorState,
	Field,
	Fold,
	List,
	type MenuEntry,
	Row,
	SaveState,
	Section,
	Select,
	SkeletonRows,
	Textarea,
	ToggleRow,
	useAutosave,
} from "@sekai/ui";
import { useMutation } from "@tanstack/react-query";
import { Brain, ListChecks, Pencil, Pin, PinOff, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useAgentUpdate } from "../../bots/useAgentUpdate.ts";
import { MoreMenu } from "./MoreMenu.tsx";

const SOURCE = { auto: "Learned", agent: "Saved by the bot", user: "Added by you" } as const;

/** Add a memory, or change one. `agentId` null: a fact about you that every bot knows. */
function MemoryDialog({
	open,
	onOpenChange,
	agentId,
	memory,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	agentId: string | null;
	memory?: Memory | null;
}) {
	const shared = agentId === null;
	const [kind, setKind] = useState<MemoryKind>("fact");
	const [text, setText] = useState("");
	const [seen, setSeen] = useState<string | null>(null);
	// Each time it opens it starts from the memory as it is now (the bot may have changed it since).
	const key = open ? (memory?.id ?? "new") : null;
	if (key !== seen) {
		setSeen(key);
		if (key) {
			setText(memory?.content ?? "");
			setKind(memory?.kind ?? (shared ? "about_user" : "fact"));
		}
	}
	const save = useMutation({
		mutationFn: () =>
			memory
				? api.memories.update(memory.id, { content: text.trim() })
				: api.memories.create({ agentId, kind: shared ? "about_user" : kind, content: text.trim() }),
		onSuccess: () => onOpenChange(false),
	});
	return (
		<Dialog
			open={open}
			onOpenChange={onOpenChange}
			title={memory ? "Edit memory" : shared ? "Add a fact about you" : "Add a memory"}
			description={shared ? "Every bot of yours will know it." : undefined}
			footer={
				<>
					<Button variant="secondary" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button
						variant="primary"
						disabled={!text.trim()}
						loading={save.isPending}
						onClick={() => save.mutate()}
					>
						{memory ? "Save" : "Add"}
					</Button>
				</>
			}
		>
			<form
				className="flex flex-col gap-4"
				onSubmit={(e) => {
					e.preventDefault();
					if (text.trim() && !save.isPending) save.mutate();
				}}
			>
				<Field label={shared ? "What should every bot know?" : "What should it remember?"}>
					<Textarea
						autoFocus
						value={text}
						onChange={(e) => setText(e.target.value)}
						placeholder={
							shared
								? "e.g. I'm based in Toronto and work on infra."
								: "e.g. Always reply in bullet points."
						}
					/>
				</Field>
				{!shared && !memory && (
					<Field label="Kind">
						<Select
							value={kind}
							onValueChange={(v) => setKind(v as MemoryKind)}
							options={MEMORY_KINDS.map((k) => ({ value: k, label: MEMORY_KIND_LABELS[k] }))}
						/>
					</Field>
				)}
			</form>
		</Dialog>
	);
}

/** One memory: what it says, where it came from, and its menu (pin, edit, forget). */
function MemoryRow({ memory, onEdit, onForget }: { memory: Memory; onEdit: () => void; onForget: () => void }) {
	const pin = useMutation({
		mutationFn: () => api.memories.update(memory.id, { pinned: !memory.pinned }),
	});
	const menu: MenuEntry[] = [
		{
			label: memory.pinned ? "Unpin" : "Pin",
			icon: memory.pinned ? <PinOff /> : <Pin />,
			onSelect: () => pin.mutate(),
		},
		{ label: "Edit", icon: <Pencil />, onSelect: onEdit },
		{ label: "Forget", icon: <Trash2 />, danger: true, onSelect: onForget },
	];
	return (
		<Row
			title={<span className="font-normal break-words whitespace-pre-wrap">{memory.content}</span>}
			subtitle={`${memory.pinned ? "Pinned · " : ""}${SOURCE[memory.source as keyof typeof SOURCE] ?? "Saved"} · ${timeAgo(memory.updatedAt)}`}
			menu={menu}
			menuLabel="Memory actions"
		/>
	);
}

/** What the bot remembers, grouped by kind. */
function MemoryList({
	memories,
	onEdit,
	onForget,
}: {
	memories: Memory[];
	onEdit: (m: Memory) => void;
	onForget: (m: Memory) => void;
}) {
	return (
		<div className="flex flex-col gap-4">
			{MEMORY_KINDS.filter((k) => memories.some((m) => m.kind === k)).map((kind) => (
				<div key={kind} className="flex flex-col gap-1.5">
					<div className="px-1 text-caption font-medium text-fg-subtle">{MEMORY_KIND_LABELS[kind]}</div>
					<List label={MEMORY_KIND_LABELS[kind]}>
						{memories
							.filter((m) => m.kind === kind)
							.map((m) => (
								<MemoryRow
									key={m.id}
									memory={m}
									onEdit={() => onEdit(m)}
									onForget={() => onForget(m)}
								/>
							))}
					</List>
				</div>
			))}
		</div>
	);
}

/** What it remembers, what it knows about you, and the one switch that lets it learn on its own. */
export function Memories({ agent, viewer }: { agent: Agent; viewer: boolean }) {
	const memories = useMemories(agent.id);
	const shared = useSharedMemories();
	const update = useAgentUpdate(agent);
	const learn = useAutosave((autoLearn: boolean) => update({ capabilities: { ...agent.capabilities, autoLearn } }));
	const [dialog, setDialog] = useState<{ agentId: string | null; memory?: Memory } | null>(null);
	const [forgetting, setForgetting] = useState<Memory | null>(null);
	const [clearing, setClearing] = useState(false);
	const forget = useMutation({ mutationFn: (m: Memory) => api.memories.delete(m.id) });
	const clear = useMutation({ mutationFn: () => api.memories.clear({ agentId: agent.id }) });
	const checkup = useMutation({
		mutationFn: () => api.memories.checkup(agent.id),
		onSuccess: (r) =>
			r.posted
				? toast.success(`${agent.name} posted what it tidied and asked in its chat.`)
				: toast(
						(memories.data?.length ?? 0) < 6
							? "Not enough memories to tidy yet."
							: "All tidy. Nothing to change or ask.",
					),
	});
	const list = memories.data ?? [];
	const own = !viewer;

	return (
		<>
			{own && (
				<Section title="Learning" saveState={learn.status !== "idle" ? <SaveState state={learn} /> : undefined}>
					<List label="Learning">
						<ToggleRow
							title="Learns as it goes"
							description="After each reply, it saves lasting facts and corrections."
							checked={agent.capabilities.autoLearn}
							onCheckedChange={(on) => learn.save(on)}
						/>
					</List>
				</Section>
			)}

			<Section
				title="What it remembers"
				description={
					viewer
						? `What ${agent.name} remembers about you from your chats.`
						: "What it keeps across chats. It saves things on its own, and you can edit anything."
				}
				action={
					<>
						<Button variant="secondary" size="sm" onClick={() => setDialog({ agentId: agent.id })}>
							<Plus /> Add memory
						</Button>
						{list.length > 0 && (
							<MoreMenu
								label="Memory actions"
								entries={[
									{
										label: checkup.isPending ? "Checking…" : "Check up",
										icon: <ListChecks />,
										disabled: checkup.isPending,
										onSelect: () => checkup.mutate(),
									},
									{
										label: "Clear all",
										icon: <Trash2 />,
										danger: true,
										onSelect: () => setClearing(true),
									},
								]}
							/>
						)}
					</>
				}
			>
				{memories.isLoading ? (
					<SkeletonRows count={3} leading={false} />
				) : memories.isError ? (
					<ErrorState size="sm" error={memories.error} onRetry={() => void memories.refetch()} />
				) : list.length === 0 ? (
					<EmptyState
						size="sm"
						icon={<Brain />}
						title="No memories yet"
						description="Tell it something to remember, or add one here."
					/>
				) : (
					<MemoryList
						memories={list}
						onEdit={(memory) => setDialog({ agentId: agent.id, memory })}
						onForget={setForgetting}
					/>
				)}
				{list.length >= 6 && (
					<Fold variant="link" title="About check-ups">
						A check-up merges duplicates, drops what a newer memory replaced, and asks you in chat about
						things that may have changed. Find it in the ⋯ menu above.
					</Fold>
				)}
			</Section>

			<Section
				title="What it knows about you"
				description="Facts every one of your bots knows, like your name and time zone."
				action={
					<Button variant="secondary" size="sm" onClick={() => setDialog({ agentId: null })}>
						<Plus /> Add a fact
					</Button>
				}
			>
				{shared.isLoading ? (
					<SkeletonRows count={2} leading={false} />
				) : shared.isError ? (
					<ErrorState size="sm" error={shared.error} onRetry={() => void shared.refetch()} />
				) : (shared.data ?? []).length === 0 ? (
					<p className="px-1 text-small text-fg-subtle">
						Nothing yet. Add what every bot should know about you.
					</p>
				) : (
					<List label="What every bot knows about you">
						{(shared.data ?? []).map((m) => (
							<MemoryRow
								key={m.id}
								memory={m}
								onEdit={() => setDialog({ agentId: null, memory: m })}
								onForget={() => setForgetting(m)}
							/>
						))}
					</List>
				)}
			</Section>

			<MemoryDialog
				open={dialog !== null}
				onOpenChange={(o) => !o && setDialog(null)}
				agentId={dialog?.agentId ?? null}
				memory={dialog?.memory}
			/>
			<Confirm
				open={forgetting !== null}
				onOpenChange={(o) => !o && setForgetting(null)}
				title="Forget this?"
				description={
					forgetting
						? forgetting.agentId === null
							? `“${forgetting.content.slice(0, 120)}” will be deleted, and none of your bots will know it anymore.`
							: `“${forgetting.content.slice(0, 120)}” will be deleted, and ${agent.name} won't remember it anymore.`
						: undefined
				}
				confirmLabel="Forget"
				danger
				onConfirm={() => forgetting && forget.mutate(forgetting)}
			/>
			<Confirm
				open={clearing}
				onOpenChange={setClearing}
				title={viewer ? `Clear what ${agent.name} remembers about you?` : `Clear ${agent.name}'s memory?`}
				description={
					viewer
						? `Everything ${agent.name} remembers from your chats is deleted. Its owner's memories aren't touched.`
						: "Every memory this bot saved is deleted. Facts about you that all your bots know are kept."
				}
				confirmLabel="Clear memory"
				danger
				onConfirm={() => clear.mutate()}
			/>
		</>
	);
}
