import { api, Markdown, qk, timeAgo, useNotes } from "@sekai/client";
import type { Agent, Note } from "@sekai/shared";
import {
	Button,
	Confirm,
	EmptyState,
	ErrorState,
	Field,
	FormGroup,
	Input,
	List,
	type MenuEntry,
	Page,
	type PageBack,
	Row,
	Section,
	SkeletonRows,
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
	Textarea,
	useFormValues,
} from "@sekai/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { NotebookPen, Pencil, Pin, PinOff, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { botPath } from "../../bots/registry.tsx";
import { useAfterSave } from "../../lib/forms.ts";
import { MoreMenu } from "./MoreMenu.tsx";
import { snippet } from "./noteText.ts";

const notePath = (agentId: string, noteId: string) => botPath(agentId, "memory", `notes/${noteId}`);

/** Pin or unpin, and delete (after asking): shared by a note's row menu and its page. */
function useNoteActions(note: Note | null, onDeleted?: () => void) {
	const [confirming, setConfirming] = useState(false);
	const pin = useMutation({ mutationFn: () => api.notes.update(note?.id ?? "", { pinned: !note?.pinned }) });
	const del = useMutation({ mutationFn: () => api.notes.delete(note?.id ?? ""), onSuccess: onDeleted });
	const entries: MenuEntry[] = note
		? [
				{
					label: note.pinned ? "Unpin" : "Pin",
					icon: note.pinned ? <PinOff /> : <Pin />,
					onSelect: () => pin.mutate(),
				},
				{ label: "Delete", icon: <Trash2 />, danger: true, onSelect: () => setConfirming(true) },
			]
		: [];
	const confirm = (
		<Confirm
			open={confirming}
			onOpenChange={setConfirming}
			title={`Delete “${note?.title ?? "this note"}”?`}
			description="The note is deleted for good."
			confirmLabel="Delete"
			danger
			onConfirm={() => del.mutate()}
		/>
	);
	return { entries, confirm };
}

function NoteRow({ agent, note }: { agent: Agent; note: Note }) {
	const { entries, confirm } = useNoteActions(note);
	return (
		<>
			<Row
				href={notePath(agent.id, note.id)}
				icon={note.pinned ? <Pin /> : <NotebookPen />}
				iconTone={note.pinned ? "warning" : "neutral"}
				title={note.title}
				subtitle={
					<span className="line-clamp-2">{`${timeAgo(note.updatedAt)} · ${snippet(note) || "Empty"}`}</span>
				}
				menu={entries}
				menuLabel={`${note.title} actions`}
			/>
			{confirm}
		</>
	);
}

/** The bot's notes (for people it's shared with, their own notes of it). */
export function Notes({ agent }: { agent: Agent }) {
	const notes = useNotes(agent.id);
	const navigate = useNavigate();
	const list = notes.data ?? [];
	const start = () => navigate(notePath(agent.id, "new"));
	return (
		<Section
			title="Notes"
			description="Longer things it writes down. Pin one to keep it in mind."
			action={
				<Button variant="secondary" size="sm" onClick={start}>
					<Plus /> New note
				</Button>
			}
		>
			{notes.isLoading ? (
				<SkeletonRows count={3} />
			) : notes.isError ? (
				<ErrorState size="sm" error={notes.error} onRetry={() => void notes.refetch()} />
			) : list.length === 0 ? (
				<EmptyState
					size="sm"
					icon={<NotebookPen />}
					title="No notes yet"
					description="Bots write notes for longer material, or you can start one."
				/>
			) : (
				<List label="Notes">
					{list.map((n) => (
						<NoteRow key={n.id} agent={agent} note={n} />
					))}
				</List>
			)}
		</Section>
	);
}

/** Write a note in Markdown, with a preview of what you've typed. */
function NoteForm({
	note,
	onSubmit,
	onSaved,
	onCancel,
}: {
	note: Note | null;
	onSubmit: (v: { title: string; content: string }) => Promise<Note>;
	/** What comes next, once it's saved and the form is clean (leaving a dirty form asks first). */
	onSaved: (saved: Note) => void;
	onCancel?: () => void;
}) {
	const form = useFormValues({ title: note?.title ?? "", content: note?.content ?? "" });
	const after = useAfterSave();
	const { values } = form;
	return (
		<FormGroup
			dirty={form.dirty}
			onCancel={onCancel ?? (() => form.reset())}
			submitWhenClean={!note}
			onSubmit={async () => {
				const saved = await onSubmit({ title: values.title.trim() || "Untitled", content: values.content });
				form.reset(values);
				after(() => onSaved(saved));
			}}
		>
			<Field label="Title">
				<Input
					value={values.title}
					maxLength={200}
					autoFocus={!note}
					placeholder="e.g. Issue 04 checklist"
					onChange={(e) => form.set("title", e.target.value)}
				/>
			</Field>
			<Tabs defaultValue="write" className="flex flex-col gap-3">
				<TabsList>
					<TabsTrigger value="write">Write</TabsTrigger>
					<TabsTrigger value="preview">Preview</TabsTrigger>
				</TabsList>
				<TabsContent value="write">
					<Field label="Note" hint="Markdown works: lists, checklists (- [ ]), tables, headings.">
						<Textarea
							value={values.content}
							onChange={(e) => form.set("content", e.target.value)}
							className="min-h-[40dvh] font-mono"
						/>
					</Field>
				</TabsContent>
				<TabsContent value="preview" className="min-h-[40dvh]">
					{values.content.trim() ? (
						<Markdown text={values.content} className="text-body" />
					) : (
						<p className="text-body text-fg-subtle">Nothing to preview yet.</p>
					)}
				</TabsContent>
			</Tabs>
		</FormGroup>
	);
}

/** One note as a page: read it, edit it, or write a new one (`noteId` "new"). */
export function NotePage({
	agent,
	noteId,
	back,
	goBack,
}: {
	agent: Agent;
	noteId: string;
	back: PageBack;
	/** Back to the list, once a note is deleted or a new one is cancelled. */
	goBack: () => void;
}) {
	const notes = useNotes(agent.id);
	const navigate = useNavigate();
	const qc = useQueryClient();
	const creating = noteId === "new";
	const note = creating ? null : (notes.data?.find((n) => n.id === noteId) ?? null);
	const [editing, setEditing] = useState(false);
	const { entries, confirm } = useNoteActions(note, goBack);

	if (!creating && notes.isLoading) {
		return (
			<Page back={back} title="Note">
				<SkeletonRows count={3} leading={false} />
			</Page>
		);
	}
	if (!creating && notes.isError) {
		return (
			<Page back={back} title="Note">
				<ErrorState error={notes.error} onRetry={() => void notes.refetch()} />
			</Page>
		);
	}
	if (!creating && !note) {
		return (
			<Page back={back} title="Note">
				<EmptyState
					icon={<NotebookPen />}
					title="This note isn't here"
					description="It may have been deleted."
					action={
						<Button variant="secondary" onClick={goBack}>
							Back to notes
						</Button>
					}
				/>
			</Page>
		);
	}

	if (creating || editing) {
		return (
			<Page back={back} title={note?.title ?? "New note"}>
				<NoteForm
					note={note}
					onCancel={creating ? undefined : () => setEditing(false)}
					onSubmit={async (v) => {
						// The list learns of the change at once, so the page doesn't wait for the live update.
						const saved = note
							? await api.notes.update(note.id, v)
							: await api.notes.create({ agentId: agent.id, ...v });
						qc.setQueryData<Note[]>(qk.notes(agent.id), (list) =>
							list
								? list.some((x) => x.id === saved.id)
									? list.map((x) => (x.id === saved.id ? saved : x))
									: [saved, ...list]
								: [saved],
						);
						return saved;
					}}
					onSaved={(saved) => {
						if (note) setEditing(false);
						else navigate(notePath(agent.id, saved.id), { replace: true });
					}}
				/>
			</Page>
		);
	}

	return (
		<Page
			back={back}
			title={note?.title ?? "Note"}
			description={
				note
					? `${note.createdBy === "agent" ? "Written by the bot" : "Written by you"} · updated ${timeAgo(note.updatedAt)}`
					: undefined
			}
			actions={
				<>
					<Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
						<Pencil /> Edit
					</Button>
					<MoreMenu entries={entries} label="Note actions" />
				</>
			}
		>
			{note?.content ? (
				<Markdown text={note.content} className="text-body" />
			) : (
				<p className="text-body text-fg-subtle">This note is empty.</p>
			)}
			{confirm}
		</Page>
	);
}
