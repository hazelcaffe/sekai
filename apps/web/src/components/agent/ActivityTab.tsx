import { AgentAvatar, api, formatTokens, timeAgo, useAgentMap, useRoutines, useRuns } from "@sekai/client";
import type { Agent, Run } from "@sekai/shared";
import { EmptyState, IconButton, Section, Spinner } from "@sekai/ui";
import { useMutation } from "@tanstack/react-query";
import { CircleAlert, CircleCheck, CircleSlash, Loader2, ShieldAlert, Square } from "lucide-react";
import { useNavigate } from "react-router";
import { useWorkingAgents } from "../../stores/ui.ts";
import { RoutineRow } from "../routines/RoutineRow.tsx";

function statusIcon(run: Run) {
	switch (run.status) {
		case "queued":
		case "running":
			return <Loader2 className="size-4 animate-spin text-fg-subtle" />;
		case "awaiting_approval":
			return <ShieldAlert className="size-4 text-warning" />;
		case "done":
			return <CircleCheck className="size-4 text-success" />;
		case "error":
			return <CircleAlert className="size-4 text-danger" />;
		case "cancelled":
			return <CircleSlash className="size-4 text-fg-subtle" />;
	}
}

export function RunRow({ run, showAgent }: { run: Run; showAgent?: boolean }) {
	const navigate = useNavigate();
	const agents = useAgentMap();
	const agent = agents.get(run.agentId);
	const cancel = useMutation({ mutationFn: () => api.runs.cancel(run.id) });
	const active = run.status === "queued" || run.status === "running" || run.status === "awaiting_approval";
	return (
		<div className="flex items-center gap-3 rounded-xl px-2.5 py-2 hover:bg-surface-2/50">
			{showAgent && agent ? <AgentAvatar avatar={agent.avatar} size={28} working={active} /> : statusIcon(run)}
			<button
				type="button"
				onClick={() => navigate(`/c/${run.conversationId}`)}
				className="min-w-0 flex-1 text-left"
			>
				<div className="flex items-center gap-2">
					<span className="truncate text-[13px] font-medium">{run.title}</span>
					{showAgent && statusIcon(run)}
				</div>
				<div className="truncate text-xs text-fg-subtle">
					{run.status === "awaiting_approval" ? "Waiting for your approval · " : ""}
					{timeAgo(run.startedAt ?? run.createdAt)}
					{run.model ? ` · ${run.model}` : ""}
					{run.usage ? ` · ${formatTokens(run.usage.inputTokens + run.usage.outputTokens)} tokens` : ""}
					{run.error ? ` · ${run.error}` : ""}
				</div>
			</button>
			{active && (
				<IconButton label="Stop" size="icon-sm" onClick={() => cancel.mutate()}>
					<Square />
				</IconButton>
			)}
		</div>
	);
}

/** Dots-style activity: In progress, Scheduled, Completed. */
export function ActivityTab({ agent }: { agent: Agent }) {
	const { data: runs = [], isLoading } = useRuns(agent.id);
	const { data: routines = [] } = useRoutines(agent.id);
	const live = useWorkingAgents().filter((r) => r.agentId === agent.id);
	const completed = runs.filter((r) => !["queued", "running", "awaiting_approval"].includes(r.status));
	const scheduled = routines.filter((r) => r.enabled);

	return (
		<div className="flex flex-col gap-6">
			<Section title="In progress">
				{live.length === 0 ? (
					<p className="px-2.5 text-[13px] text-fg-subtle">Idle.</p>
				) : (
					live.map((r) => <RunRow key={r.id} run={r} />)
				)}
			</Section>
			<Section title="Scheduled">
				{scheduled.length === 0 ? (
					<p className="px-2.5 text-[13px] text-fg-subtle">No active routines.</p>
				) : (
					scheduled.map((r) => <RoutineRow key={r.id} routine={r} />)
				)}
			</Section>
			<Section title="Completed">
				{isLoading ? (
					<Spinner />
				) : completed.length === 0 ? (
					<EmptyState title="No activity yet" className="py-6" />
				) : (
					<div className="flex flex-col">
						{completed.slice(0, 40).map((r) => (
							<RunRow key={r.id} run={r} />
						))}
					</div>
				)}
			</Section>
		</div>
	);
}
