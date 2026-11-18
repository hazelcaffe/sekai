import { AgentAvatar, api, cn, dateTime, timeAgo, useRoutineRuns } from "@sekai/client";
import type { Agent, Routine } from "@sekai/shared";
import { Badge, Button, Confirm, Switch } from "@sekai/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
	Bell,
	ChevronRight,
	CircleAlert,
	CircleCheck,
	Clock,
	FlaskConical,
	Loader2,
	Pencil,
	Trash2,
	Zap,
} from "lucide-react";
import { useState } from "react";
import { CopyAddress, hookUrl, RoutineDialog } from "./RoutineDialog.tsx";

export function useScheduleText(routine: Routine): string {
	const { data } = useQuery({
		queryKey: ["schedulePreview", routine.schedule, routine.timezone],
		queryFn: () => api.routines.preview({ schedule: routine.schedule, timezone: routine.timezone }),
		staleTime: 5 * 60_000,
	});
	return data?.description ?? "…";
}

export function RoutineRow({ routine, agent }: { routine: Routine; agent?: Agent }) {
	const [open, setOpen] = useState(false);
	const [editing, setEditing] = useState(false);
	const [confirm, setConfirm] = useState(false);
	const when = useScheduleText(routine);
	const runs = useRoutineRuns(open ? routine.id : null);
	const toggle = useMutation({ mutationFn: (enabled: boolean) => api.routines.update(routine.id, { enabled }) });
	const test = useMutation({ mutationFn: () => api.routines.test(routine.id) });
	const del = useMutation({ mutationFn: () => api.routines.delete(routine.id) });
	const finished = routine.schedule.type === "once" && !routine.enabled && routine.runCount > 0;

	return (
		<div className="rounded-2xl border border-border">
			<div className="flex items-center gap-3 px-3.5 py-3">
				<button
					type="button"
					onClick={() => setOpen((o) => !o)}
					className="flex min-w-0 flex-1 items-center gap-3 text-left"
				>
					{agent ? (
						<AgentAvatar avatar={agent.avatar} size={28} />
					) : (
						<span className="flex size-7 items-center justify-center rounded-lg bg-surface-2 text-fg-subtle">
							{routine.action === "notify" ? (
								<Bell className="size-3.5" />
							) : routine.schedule.type === "event" ? (
								<Zap className="size-3.5" />
							) : (
								<Clock className="size-3.5" />
							)}
						</span>
					)}
					<span className="min-w-0 flex-1">
						<span className="flex items-center gap-2">
							<span className="truncate text-sm font-medium">{routine.name}</span>
							{routine.action === "notify" && <Badge>reminder</Badge>}
							{routine.lastStatus === "failed" && (
								<CircleAlert className="size-3.5 shrink-0 text-danger" />
							)}
						</span>
						<span className="block truncate text-xs text-fg-subtle">
							{finished
								? `Done · ${routine.lastRunAt ? timeAgo(routine.lastRunAt) : ""}`
								: routine.enabled
									? `${when}${routine.nextRunAt ? ` · next ${timeAgo(routine.nextRunAt)}` : ""}`
									: `Paused · ${when}`}
						</span>
					</span>
					<ChevronRight
						className={cn("size-4 shrink-0 text-fg-subtle transition-transform", open && "rotate-90")}
					/>
				</button>
				{!finished && (
					<Switch checked={routine.enabled} onCheckedChange={(v) => toggle.mutate(v)} label="Enabled" />
				)}
			</div>
			{open && (
				<div className="flex flex-col gap-3 border-t border-border px-3.5 py-3">
					<p className="text-[13px] leading-5 whitespace-pre-wrap text-fg-muted">{routine.instruction}</p>
					{routine.schedule.type === "event" &&
						routine.schedule.event.kind === "webhook" &&
						routine.schedule.event.token && <CopyAddress value={hookUrl(routine.schedule.event.token)} />}
					<div className="text-xs text-fg-subtle">
						{routine.nextRunAt && routine.enabled && <div>Next run: {dateTime(routine.nextRunAt)}</div>}
						<div>
							Ran {routine.runCount} {routine.runCount === 1 ? "time" : "times"}
							{routine.lastRunAt && ` · last ${timeAgo(routine.lastRunAt)}`} · created by{" "}
							{routine.createdBy === "agent" ? "the bot" : "you"}
						</div>
					</div>
					{runs.data && runs.data.length > 0 && (
						<div className="flex flex-col gap-1">
							<div className="text-xs font-medium text-fg-subtle">Run history</div>
							{runs.data.slice(0, 8).map((r) => (
								<div key={r.id} className="flex items-center gap-2 text-xs">
									{r.status === "running" ? (
										<Loader2 className="size-3.5 animate-spin text-fg-subtle" />
									) : r.status === "succeeded" ? (
										<CircleCheck className="size-3.5 text-success" />
									) : (
										<CircleAlert className="size-3.5 text-danger" />
									)}
									<span className="text-fg-muted">{dateTime(r.startedAt)}</span>
									{r.error && <span className="truncate text-danger">{r.error}</span>}
								</div>
							))}
						</div>
					)}
					<div className="flex flex-wrap gap-1.5">
						<Button variant="secondary" size="xs" onClick={() => test.mutate()} disabled={test.isPending}>
							<FlaskConical /> Test now
						</Button>
						<Button variant="secondary" size="xs" onClick={() => setEditing(true)}>
							<Pencil /> Edit
						</Button>
						<Button variant="danger-ghost" size="xs" onClick={() => setConfirm(true)}>
							<Trash2 /> Delete
						</Button>
					</div>
					{test.isSuccess && (
						<p className="text-xs text-fg-subtle">
							Test started. The result appears in the bot's chat. A test does real work.
						</p>
					)}
				</div>
			)}
			<RoutineDialog open={editing} onOpenChange={setEditing} routine={routine} />
			<Confirm
				open={confirm}
				onOpenChange={setConfirm}
				title={`Delete “${routine.name}”?`}
				description="Its future runs stop. This can't be undone."
				confirmLabel="Delete"
				danger
				onConfirm={() => del.mutate()}
			/>
		</div>
	);
}
