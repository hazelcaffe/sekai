import { api, pluralize, sharedMachinesNote, useMachineUsers, useMemories, useNotes } from "@sekai/client";
import type { Agent } from "@sekai/shared";
import { Button, Checkbox, Confirm, Dialog, Field, Input, Section, Textarea, ToggleRow } from "@sekai/ui";
import { useMutation } from "@tanstack/react-query";
import { Copy, Download, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { useOpenAgent } from "../../lib/navigation.ts";
import { SharingSection } from "./SharingSection.tsx";

export function ProfileTab({ agent }: { agent: Agent }) {
	const [form, setForm] = useState({
		name: agent.name,
		label: agent.label,
		job: agent.job,
		personality: agent.personality,
		instructions: agent.instructions,
	});
	const [confirmDelete, setConfirmDelete] = useState(false);
	const [exporting, setExporting] = useState(false);
	const navigate = useNavigate();
	const openAgent = useOpenAgent();

	useEffect(() => {
		setForm({
			name: agent.name,
			label: agent.label,
			job: agent.job,
			personality: agent.personality,
			instructions: agent.instructions,
		});
	}, [agent.name, agent.label, agent.job, agent.personality, agent.instructions]);

	const dirty =
		form.name !== agent.name ||
		form.label !== agent.label ||
		form.job !== agent.job ||
		form.personality !== agent.personality ||
		form.instructions !== agent.instructions;

	const update = useMutation({
		mutationFn: (patch: Parameters<typeof api.agents.update>[1]) => api.agents.update(agent.id, patch),
	});
	const save = () =>
		update.mutate(
			{ ...form, name: form.name.trim() || agent.name },
			{ onSuccess: () => toast.success("Profile saved", { duration: 1500 }) },
		);
	const remove = useMutation({ mutationFn: () => api.agents.delete(agent.id), onSuccess: () => navigate("/") });
	const machineUsers = useMachineUsers(agent.sharedBy ? null : agent.id, confirmDelete);
	const duplicate = useMutation({
		mutationFn: () => api.agents.duplicate(agent.id),
		onSuccess: (a) => void openAgent(a.id),
	});

	return (
		<div className="flex flex-col gap-6">
			<Section title="Identity">
				<div className="grid gap-3 xs:grid-cols-2">
					<Field label="Name">
						<Input
							value={form.name}
							maxLength={60}
							onChange={(e) => setForm({ ...form, name: e.target.value })}
						/>
					</Field>
					<Field label="Label">
						<Input
							value={form.label}
							maxLength={80}
							placeholder="Research lead"
							onChange={(e) => setForm({ ...form, label: e.target.value })}
						/>
					</Field>
				</div>
				<Field label="Job" hint="One clear responsibility: what it owns, where it looks, what “done” means.">
					<Textarea
						value={form.job}
						onChange={(e) => setForm({ ...form, job: e.target.value })}
						placeholder="Tracks my reading list and sends a Friday digest of what's worth my time."
					/>
				</Field>
				<Field label="Personality">
					<Textarea
						value={form.personality}
						onChange={(e) => setForm({ ...form, personality: e.target.value })}
						placeholder="Dry wit, very concise, never uses emoji. Pushes back when I'm wrong."
					/>
				</Field>
				<Field
					label="Standing instructions"
					hint="Rules that always hold (it also learns rules into its memory)."
				>
					<Textarea
						value={form.instructions}
						onChange={(e) => setForm({ ...form, instructions: e.target.value })}
						placeholder={"Always ask before messaging anyone else.\nUse metric units."}
					/>
				</Field>
				{dirty && (
					<div className="sticky bottom-0 -mx-4 flex justify-end gap-2 border-t border-border bg-bg-subtle/95 px-4 py-3 backdrop-blur">
						<Button
							variant="secondary"
							size="sm"
							onClick={() =>
								setForm({
									name: agent.name,
									label: agent.label,
									job: agent.job,
									personality: agent.personality,
									instructions: agent.instructions,
								})
							}
						>
							Discard
						</Button>
						<Button variant="primary" size="sm" onClick={save} disabled={update.isPending}>
							Save changes
						</Button>
					</div>
				)}
			</Section>

			<Section title="Status">
				<div className="flex flex-col divide-y divide-border rounded-2xl border border-border bg-card">
					<ToggleRow
						className="px-4 py-3"
						title="Primary bot"
						description="Your main point of contact. It coordinates the other bots."
						checked={agent.isPrimary}
						onCheckedChange={(v) => v && update.mutate({ isPrimary: true })}
						disabled={agent.isPrimary}
					/>
					<ToggleRow
						className="px-4 py-3"
						title="Active"
						description="Paused bots don't reply and their routines don't run."
						checked={agent.status === "active"}
						onCheckedChange={(v) => update.mutate({ status: v ? "active" : "paused" })}
					/>
					<ToggleRow
						className="px-4 py-3"
						title="Pinned"
						checked={agent.pinned}
						onCheckedChange={(pinned) => update.mutate({ pinned })}
					/>
					<ToggleRow
						className="px-4 py-3"
						title="Hidden from sidebar"
						description="Hidden bots keep working and keep their history."
						checked={agent.hidden}
						onCheckedChange={(hidden) => update.mutate({ hidden })}
					/>
				</div>
			</Section>

			<SharingSection agent={agent} />

			<div className="flex flex-wrap gap-2">
				<Button
					variant="secondary"
					size="sm"
					title="Copies the profile, models, tools, skills and routines (paused), not chats or memory"
					onClick={() => duplicate.mutate()}
				>
					<Copy /> Duplicate
				</Button>
				<Button variant="secondary" size="sm" onClick={() => setExporting(true)}>
					<Download /> Export
				</Button>
				<Button variant="danger-ghost" size="sm" onClick={() => setConfirmDelete(true)}>
					<Trash2 /> Delete bot
				</Button>
			</div>
			<ExportDialog agent={agent} open={exporting} onOpenChange={setExporting} />

			<Confirm
				open={confirmDelete}
				onOpenChange={setConfirmDelete}
				title={`Delete ${agent.name}?`}
				description={[
					sharedMachinesNote(agent.name, machineUsers),
					"This erases its profile, chats, memory, notes and routines. It can't be undone.",
				]
					.filter(Boolean)
					.join(" ")}
				confirmLabel="Delete"
				danger
				onConfirm={() => remove.mutate()}
			/>
		</div>
	);
}

/** The bot as a file, to copy to another Sekai or share; its memory and notes only if you tick them. */
function ExportDialog({
	agent,
	open,
	onOpenChange,
}: {
	agent: Agent;
	open: boolean;
	onOpenChange: (o: boolean) => void;
}) {
	const { data: memories = [] } = useMemories(agent.id);
	const { data: notes = [] } = useNotes(agent.id);
	const [memory, setMemory] = useState(false);
	const [withNotes, setWithNotes] = useState(false);
	return (
		<Dialog
			open={open}
			onOpenChange={onOpenChange}
			title={`Export ${agent.name}`}
			description="Its profile, personality, models, tools, skills, apps and routines, in one file to import on any Sekai. Never its chats, accounts, computers or passwords."
			footer={
				<>
					<Button variant="secondary" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button variant="primary" asChild>
						<a
							href={api.agents.exportUrl(agent.id, { memory, notes: withNotes })}
							download
							onClick={() => setTimeout(() => onOpenChange(false), 300)}
						>
							<Download /> Download
						</a>
					</Button>
				</>
			}
		>
			<div className="flex flex-col gap-3">
				<Checkbox
					checked={memory}
					onCheckedChange={setMemory}
					label={`Include its memory (${pluralize(memories.length, "memory", "memories")})`}
					description="What it learned about you and its work. Anyone with the file can read it."
				/>
				<Checkbox
					checked={withNotes}
					onCheckedChange={setWithNotes}
					label={`Include its notes (${pluralize(notes.length, "note")})`}
				/>
			</div>
		</Dialog>
	);
}
