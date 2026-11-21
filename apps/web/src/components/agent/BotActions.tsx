import { api, pluralize, sharedMachinesNote, useAccess, useMachineUsers, useMemories, useNotes } from "@sekai/client";
import type { Agent } from "@sekai/shared";
import { Button, Checkbox, Confirm, Dialog, List, Row, Section } from "@sekai/ui";
import { useMutation } from "@tanstack/react-query";
import { Copy, Download, Trash2 } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { useOpenAgent } from "../../lib/navigation.ts";

/** Duplicate, export and delete, at the bottom of the bot's Profile. */
export function BotActions({ agent }: { agent: Agent }) {
	const { can } = useAccess();
	const navigate = useNavigate();
	const openAgent = useOpenAgent();
	const [exporting, setExporting] = useState(false);
	const [deleting, setDeleting] = useState(false);
	const machineUsers = useMachineUsers(agent.id, deleting);
	const duplicate = useMutation({
		mutationFn: () => api.agents.duplicate(agent.id),
		onSuccess: (copy) => void openAgent(copy.id),
	});
	const remove = useMutation({ mutationFn: () => api.agents.delete(agent.id), onSuccess: () => navigate("/") });

	return (
		<Section title="Manage">
			<List label={`Manage ${agent.name}`}>
				{can("bots") && (
					<Row
						icon={<Copy />}
						title="Duplicate"
						subtitle="Copies its profile, models, tools, skills and routines (paused), not chats or memory."
						disabled={duplicate.isPending}
						onClick={() => duplicate.mutate()}
					/>
				)}
				<Row
					icon={<Download />}
					title="Export"
					subtitle="Saves it as a file to import on any Sekai."
					onClick={() => setExporting(true)}
				/>
				<Row
					icon={<Trash2 />}
					iconTone="danger"
					title="Delete bot"
					subtitle="Erases its profile, chats, memory, notes and routines."
					danger
					onClick={() => setDeleting(true)}
				/>
			</List>
			<ExportDialog agent={agent} open={exporting} onOpenChange={setExporting} />
			<Confirm
				open={deleting}
				onOpenChange={setDeleting}
				title={`Delete ${agent.name}?`}
				description={[
					sharedMachinesNote(agent.name, machineUsers),
					`${agent.name}'s profile, chats, memory, notes and routines will be erased. This can't be undone.`,
				]
					.filter(Boolean)
					.join(" ")}
				confirmLabel="Delete"
				danger
				onConfirm={() => remove.mutate()}
			/>
		</Section>
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
			description="One file with its profile, models, tools, skills, apps and routines. Never chats, accounts or passwords."
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
