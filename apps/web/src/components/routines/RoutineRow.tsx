import { AgentAvatar, api, dateTime, timeAgo, useAccess, useRoutineRuns } from "@sekai/client";
import type { Agent, Routine } from "@sekai/shared";
import { Button, Confirm, CopyField, Dialog, List, Row, Switch } from "@sekai/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Bell, CircleAlert, CircleCheck, Clock, FlaskConical, Loader2, Pencil, Trash2, Zap } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { hookUrl, RoutineDialog } from "./RoutineDialog.tsx";

export function useScheduleText(routine: Routine): string {
	const { data } = useQuery({
		queryKey: ["schedulePreview", routine.schedule, routine.timezone],
		queryFn: () => api.routines.preview({ schedule: routine.schedule, timezone: routine.timezone }),
		staleTime: 5 * 60_000,
	});
	return data?.description ?? "…";
}

/** Everything about one routine: what it does, when it runs, and how its last runs went. */
function RoutineDetails({
	routine,
	onClose,
	onEdit,
	onTest,
	onDelete,
	testing,
	mayRun,
}: {
	routine: Routine;
	onClose: () => void;
	onEdit: () => void;
	onTest: () => void;
	onDelete: () => void;
	testing: boolean;
	/** Your role includes routines (without it they don't run, so there's nothing to test or change). */
	mayRun: boolean;
}) {
	const when = useScheduleText(routine);
	const runs = useRoutineRuns(routine.id);
	const webhook =
		routine.schedule.type === "event" && routine.schedule.event.kind === "webhook" && routine.schedule.event.token;
	return (
		<Dialog
			open
			onOpenChange={(o) => !o && onClose()}
			size="lg"
			title={routine.name}
			description={when}
			footer={
				<>
					<Button variant="danger-ghost" className="sm:mr-auto" onClick={onDelete}>
						<Trash2 /> Delete
					</Button>
					{mayRun && (
						<>
							<Button variant="secondary" loading={testing} onClick={onTest}>
								<FlaskConical /> Test now
							</Button>
							<Button variant="primary" onClick={onEdit}>
								<Pencil /> Edit
							</Button>
						</>
					)}
				</>
			}
		>
			<div className="flex flex-col gap-4">
				{!mayRun && (
					<p className="text-small text-fg-muted">
						Your role doesn't include routines, so it doesn't run. Ask an admin if you need it.
					</p>
				)}
				<p className="text-body whitespace-pre-wrap text-fg-muted">{routine.instruction}</p>
				{webhook && <CopyField label="webhook address" value={hookUrl(webhook)} />}
				<p className="text-small text-fg-subtle">
					{routine.nextRunAt && routine.enabled ? `Next run ${dateTime(routine.nextRunAt)}. ` : ""}
					Ran {routine.runCount} {routine.runCount === 1 ? "time" : "times"}
					{routine.lastRunAt && `, last ${timeAgo(routine.lastRunAt)}`}. Made by{" "}
					{routine.createdBy === "agent" ? "the bot" : "you"}.
				</p>
				{runs.data && runs.data.length > 0 && (
					<div className="flex flex-col gap-1.5">
						<div className="text-caption font-medium text-fg-subtle">Recent runs</div>
						<List label="Recent runs">
							{runs.data.slice(0, 8).map((r) => (
								<Row
									key={r.id}
									icon={
										r.status === "running" ? (
											<Loader2 className="animate-spin" />
										) : r.status === "succeeded" ? (
											<CircleCheck />
										) : (
											<CircleAlert />
										)
									}
									iconTone={
										r.status === "succeeded"
											? "success"
											: r.status === "running"
												? "neutral"
												: "danger"
									}
									title={<span className="font-normal">{dateTime(r.startedAt)}</span>}
									subtitle={r.error ? <span className="text-danger-ink">{r.error}</span> : undefined}
								/>
							))}
						</List>
					</div>
				)}
			</div>
		</Dialog>
	);
}

/**
 * One routine in a List (RoutineList, or your own): its name, when it runs and a switch; open it for the details
 * (test, edit, delete), which its menu also has (on hover, or touch and hold). `agent`: show whose it is (the list of
 * every bot's).
 */
export function RoutineRow({ routine, agent }: { routine: Routine; agent?: Agent }) {
	const [open, setOpen] = useState(false);
	const [editing, setEditing] = useState(false);
	const [confirm, setConfirm] = useState(false);
	const when = useScheduleText(routine);
	const { can } = useAccess();
	// Without routines in your role they don't run: only deleting is left.
	const mayRun = can("routines");
	const toggle = useMutation({ mutationFn: (enabled: boolean) => api.routines.update(routine.id, { enabled }) });
	const test = useMutation({
		mutationFn: () => api.routines.test(routine.id),
		onSuccess: () => toast("Test started. The result shows up in the bot's chat. A test does real work."),
	});
	const del = useMutation({ mutationFn: () => api.routines.delete(routine.id) });
	const finished = routine.schedule.type === "once" && !routine.enabled && routine.runCount > 0;

	return (
		<>
			<Row
				leading={agent ? <AgentAvatar avatar={agent.avatar} size={28} /> : undefined}
				icon={
					agent ? undefined : routine.action === "notify" ? (
						<Bell />
					) : routine.schedule.type === "event" ? (
						<Zap />
					) : (
						<Clock />
					)
				}
				title={routine.name}
				subtitle={
					<>
						{routine.lastStatus === "failed" && (
							<span className="text-danger-ink">Failed last time · </span>
						)}
						{routine.action === "notify" && "Reminder · "}
						{finished
							? `Done${routine.lastRunAt ? ` · ${timeAgo(routine.lastRunAt)}` : ""}`
							: !mayRun
								? `Not running · ${when}`
								: routine.enabled
									? `${when}${routine.nextRunAt ? ` · next ${timeAgo(routine.nextRunAt)}` : ""}`
									: when}
					</>
				}
				trailing={
					finished || !mayRun ? undefined : (
						<Switch
							checked={routine.enabled}
							onCheckedChange={(v) => toggle.mutate(v)}
							label={`${routine.name} is on`}
						/>
					)
				}
				onClick={() => setOpen(true)}
				menu={[
					mayRun && { label: "Edit", icon: <Pencil />, onSelect: () => setEditing(true) },
					mayRun && { label: "Test now", icon: <FlaskConical />, onSelect: () => test.mutate() },
					{ label: "Delete", icon: <Trash2 />, danger: true, onSelect: () => setConfirm(true) },
				]}
				menuLabel={`${routine.name} actions`}
				menuButton="hover"
			/>
			{open && (
				<RoutineDetails
					routine={routine}
					onClose={() => setOpen(false)}
					onEdit={() => {
						setOpen(false);
						setEditing(true);
					}}
					onTest={() => test.mutate()}
					onDelete={() => {
						setOpen(false);
						setConfirm(true);
					}}
					testing={test.isPending}
					mayRun={mayRun}
				/>
			)}
			{mayRun && <RoutineDialog open={editing} onOpenChange={setEditing} routine={routine} />}
			<Confirm
				open={confirm}
				onOpenChange={setConfirm}
				title={`Delete “${routine.name}”?`}
				description="It stops running, and its history goes with it."
				confirmLabel="Delete"
				danger
				onConfirm={() => del.mutate()}
			/>
		</>
	);
}

/** Routines as one group; `agents` (by id) show whose each one is, for a list across bots. */
export function RoutineList({
	routines,
	agents,
	label = "Routines",
}: {
	routines: Routine[];
	agents?: Map<string, Agent>;
	label?: string;
}) {
	return (
		<List label={label}>
			{routines.map((r) => (
				<RoutineRow key={r.id} routine={r} agent={agents?.get(r.agentId)} />
			))}
		</List>
	);
}
