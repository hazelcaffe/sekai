import { api, Markdown, timeAgo, useNotes } from "@sekai/client";
import type { Agent, Note } from "@sekai/shared";
import { Button, Confirm, EmptyState, IconButton, Input, Spinner, Textarea } from "@sekai/ui";
import { useMutation } from "@tanstack/react-query";
import { ArrowLeft, Eye, NotebookPen, Pencil, Pin, PinOff, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

function NoteEditor({ note, agentId, onBack }: { note: Note | null; agentId: string; onBack: () => void }) {
	const [title, setTitle] = useState(note?.title ?? "");
	const [content, setContent] = useState(note?.content ?? "");
	const [preview, setPreview] = useState(Boolean(note));
	const [confirm, setConfirm] = useState(false);
	useEffect(() => {
		setTitle(note?.title ?? "");
		setContent(note?.content ?? "");
	}, [note?.title, note?.content]);
	const save = useMutation({
		mutationFn: () =>
			note
				? api.notes.update(note.id, { title: title.trim() || "Untitled", content })
				: api.notes.create({ agentId, title: title.trim() || "Untitled", content }),
		onSuccess: () => (note ? setPreview(true) : onBack()),
	});
	const del = useMutation({ mutationFn: () => api.notes.delete(note?.id ?? ""), onSuccess: onBack });
	const dirty = title !== (note?.title ?? "") || content !== (note?.content ?? "");

	return (
		<div className="flex flex-col gap-3">
			<div className="flex items-center gap-1">
				<IconButton label="Back" onClick={onBack} size="icon-sm">
					<ArrowLeft />
				</IconButton>
				<div className="ml-auto flex items-center gap-1">
					{note && (
						<>
							<IconButton
								label={preview ? "Edit" : "Preview"}
								size="icon-sm"
								onClick={() => setPreview((p) => !p)}
							>
								{preview ? <Pencil /> : <Eye />}
							</IconButton>
							<IconButton label="Delete" size="icon-sm" onClick={() => setConfirm(true)}>
								<Trash2 />
							</IconButton>
						</>
					)}
				</div>
			</div>
			{preview && note ? (
				<>
					<h3 className="text-lg font-semibold tracking-tight">{note.title}</h3>
					<p className="-mt-2 text-xs text-fg-subtle">
						{note.createdBy === "agent" ? "Written by the bot" : "Written by you"} · updated{" "}
						{timeAgo(note.updatedAt)}
					</p>
					{note.content ? (
						<Markdown text={note.content} className="text-sm" />
					) : (
						<p className="text-sm text-fg-subtle">Empty note</p>
					)}
				</>
			) : (
				<>
					<Input
						value={title}
						onChange={(e) => setTitle(e.target.value)}
						placeholder="Title"
						autoFocus={!note}
					/>
					<Textarea
						value={content}
						onChange={(e) => setContent(e.target.value)}
						placeholder="Markdown supported: checklists (- [ ]), tables, headings…"
						className="min-h-[40dvh] font-mono text-[13px]"
					/>
					<div className="flex justify-end gap-2">
						<Button variant="secondary" size="sm" onClick={() => (note ? setPreview(true) : onBack())}>
							Cancel
						</Button>
						<Button
							variant="primary"
							size="sm"
							disabled={!dirty || save.isPending}
							onClick={() => save.mutate()}
						>
							Save
						</Button>
					</div>
				</>
			)}
			<Confirm
				open={confirm}
				onOpenChange={setConfirm}
				title="Delete this note?"
				confirmLabel="Delete"
				danger
				onConfirm={() => del.mutate()}
			/>
		</div>
	);
}

export function NotesTab({ agent }: { agent: Agent }) {
	const { data: notes = [], isLoading } = useNotes(agent.id);
	const [openId, setOpenId] = useState<string | "new" | null>(null);
	const pin = useMutation({ mutationFn: (n: Note) => api.notes.update(n.id, { pinned: !n.pinned }) });

	if (openId) {
		return (
			<NoteEditor
				note={notes.find((n) => n.id === openId) ?? null}
				agentId={agent.id}
				onBack={() => setOpenId(null)}
			/>
		);
	}

	return (
		<div className="flex flex-col gap-3">
			<div className="flex items-center justify-between">
				<p className="text-xs leading-5 text-fg-subtle">
					{agent.name}'s documents: trackers, drafts, research. Pinned notes are in its context every turn.
				</p>
				<Button variant="secondary" size="xs" onClick={() => setOpenId("new")} className="shrink-0">
					<Plus /> New
				</Button>
			</div>
			{isLoading ? (
				<Spinner />
			) : notes.length === 0 ? (
				<EmptyState
					icon={<NotebookPen />}
					title="No notes yet"
					description="Bots write notes for longer material."
					className="py-8"
				/>
			) : (
				notes.map((n) => (
					<div
						key={n.id}
						className="group flex items-center gap-2 rounded-2xl border border-border px-3.5 py-3 hover:bg-surface-2/40"
					>
						<button type="button" onClick={() => setOpenId(n.id)} className="min-w-0 flex-1 text-left">
							<div className="flex items-center gap-1.5">
								{n.pinned && <Pin className="size-3 shrink-0 text-warning" />}
								<span className="truncate text-sm font-medium">{n.title}</span>
							</div>
							<div className="mt-0.5 truncate text-xs text-fg-subtle">
								{n.content.replace(/[#*`>-]/g, "").slice(0, 100) || "Empty"} · {timeAgo(n.updatedAt)}
							</div>
						</button>
						<IconButton label={n.pinned ? "Unpin" : "Pin"} size="icon-sm" onClick={() => pin.mutate(n)}>
							{n.pinned ? <PinOff /> : <Pin />}
						</IconButton>
					</div>
				))
			)}
		</div>
	);
}
