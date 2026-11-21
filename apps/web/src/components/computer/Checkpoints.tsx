import { api, dateTime, formatBytes, useCheckpoints } from "@sekai/client";
import type { Checkpoint, Machine } from "@sekai/shared";
import { Button, Confirm, Field, Input, List, Row, SkeletonRows } from "@sekai/ui";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { LoadProblem } from "./LoadProblem.tsx";

export function Checkpoints({ machine }: { machine: Machine }) {
	const query = useCheckpoints(machine.id, true);
	const [label, setLabel] = useState("");
	const [decision, setDecision] = useState<{ cp: Checkpoint; action: "restore" | "delete" } | null>(null);
	const backup = query.data?.mode === "backup";
	const op = useMutation({
		mutationFn: async (action: "save" | "restore" | "delete") => {
			if (action === "save") {
				await api.machines.checkpoints.create(machine.id, label.trim());
				setLabel("");
			} else if (decision) await api.machines.checkpoints[action](machine.id, decision.cp.name);
		},
		onSuccess: () => void query.refetch(),
		onError: () => toast.error("Couldn’t change the checkpoint. Check the computer server and try again."),
	});
	if (query.isError) return <LoadProblem what="checkpoints" retry={query.refetch} />;
	if (!query.data) return <SkeletonRows count={2} />;
	return (
		<>
			<p className="text-small text-fg-muted">
				{backup
					? "Each checkpoint is a full backup and may take a few minutes."
					: "Sekai also keeps the last three automatic checkpoints from before risky commands."}
			</p>
			<Field label="Checkpoint name" optional>
				<Input value={label} maxLength={200} onChange={(e) => setLabel(e.target.value)} />
			</Field>
			<Button
				className="self-end"
				disabled={op.isPending}
				loading={op.isPending && op.variables === "save"}
				onClick={() => op.mutate("save")}
			>
				Save checkpoint
			</Button>
			{query.data.checkpoints.length ? (
				<List>
					{query.data.checkpoints.map((cp) => (
						<Row
							key={cp.name}
							title={cp.label}
							subtitle={[dateTime(cp.at), cp.auto && "Automatic", cp.size && formatBytes(cp.size)]
								.filter(Boolean)
								.join(" · ")}
							menuLabel={`Options for ${cp.label}`}
							menu={[
								{
									label: "Restore",
									disabled: op.isPending,
									onSelect: () => setDecision({ action: "restore", cp }),
								},
								{
									label: "Delete checkpoint",
									danger: true,
									disabled: op.isPending,
									onSelect: () => setDecision({ action: "delete", cp }),
								},
							]}
						/>
					))}
				</List>
			) : (
				<p className="text-small text-fg-muted">No checkpoints yet.</p>
			)}
			{op.isPending && op.variables !== "save" && (
				<p role="status">
					{op.variables === "restore" ? "Restoring the checkpoint…" : "Deleting the checkpoint…"}
				</p>
			)}
			<Confirm
				open={Boolean(decision)}
				onOpenChange={(on) => !on && setDecision(null)}
				title={`${decision?.action === "restore" ? "Restore" : "Delete"} ${decision?.cp.label ?? "this checkpoint"}?`}
				description={
					decision?.action === "restore"
						? `Changes to ${machine.name} since this checkpoint will be lost${machine.status === "running" ? ", and it will restart" : ""}.`
						: "You won’t be able to restore this checkpoint. The computer stays as it is."
				}
				danger
				confirmLabel={decision?.action === "restore" ? "Restore" : "Delete"}
				onConfirm={() => decision && op.mutate(decision.action)}
			/>
		</>
	);
}
