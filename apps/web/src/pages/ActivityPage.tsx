import { useAccess, useAgentMap, useAgents, useRoutines, useRuns } from "@sekai/client";
import {
	Button,
	EmptyState,
	ErrorState,
	Fold,
	List,
	Page,
	Section,
	Select,
	SkeletonRows,
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@sekai/ui";
import { Activity, CalendarClock, CircleCheck, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { RunRow } from "../components/activity/RunRow.tsx";
import { RoutineDialog } from "../components/routines/RoutineDialog.tsx";
import { RoutineList } from "../components/routines/RoutineRow.tsx";
import { useWorkingAgents } from "../stores/ui.ts";
import { ActivityLog } from "./activity/ActivityLog.tsx";

const VIEWS = ["working", "scheduled", "done", "log"] as const;
type View = (typeof VIEWS)[number];
const ACTIVE_STATUSES = new Set(["queued", "running", "awaiting_approval"]);

/**
 * /activity: what bots are doing (Working), will do (Scheduled), did (Done) and every action they took (Log).
 * `?view=` picks the tab and `?bot=` filters to one bot across every tab.
 */
export function ActivityPage() {
	const [params, setParams] = useSearchParams();
	const { can } = useAccess();
	const canCreateRoutine = can("routines");

	const botId = params.get("bot");
	const { data: agentList = [] } = useAgents();
	const agents = useAgentMap();
	const bot = botId ? agents.get(botId) : undefined;
	const mine = <T extends { agentId: string }>(list: T[]) => (botId ? list.filter((x) => x.agentId === botId) : list);

	const liveStore = useWorkingAgents();
	const {
		data: allRoutines = [],
		isLoading: loadingRoutines,
		isError: routinesError,
		error: routinesErr,
		refetch: refetchRoutines,
	} = useRoutines();
	const {
		data: allRuns = [],
		isLoading: loadingRuns,
		isError: runsError,
		error: runsErr,
		refetch: refetchRuns,
	} = useRuns();

	// Merge live SSE runs with active server runs so a fresh page load shows active work immediately.
	const live = useMemo(() => {
		const map = new Map(liveStore.map((r) => [r.id, r]));
		for (const r of allRuns) {
			if (ACTIVE_STATUSES.has(r.status) && !map.has(r.id)) map.set(r.id, r);
		}
		const merged = [...map.values()].sort((a, b) => (b.startedAt ?? b.createdAt) - (a.startedAt ?? a.createdAt));
		return botId ? merged.filter((x) => x.agentId === botId) : merged;
	}, [liveStore, allRuns, botId]);

	const routines = mine(allRoutines);
	const runs = mine(allRuns);
	const [creating, setCreating] = useState(false);

	const completed = runs.filter((r) => !ACTIVE_STATUSES.has(r.status));
	const scheduled = routines.filter((r) => r.enabled);
	const paused = routines.filter((r) => !r.enabled && r.schedule.type !== "once");
	const finishedReminders = routines.filter((r) => !r.enabled && r.schedule.type === "once");
	const noRoutines = !loadingRoutines && !routinesError && routines.length === 0;

	const asked = params.get("view");
	const view: View = (VIEWS as readonly string[]).includes(asked ?? "")
		? (asked as View)
		: live.length > 0
			? "working"
			: "scheduled";

	const setView = (v: string) =>
		setParams(
			(p) => {
				p.set("view", v);
				return p;
			},
			{ replace: true },
		);

	const setBot = (next: string) =>
		setParams(
			(p) => {
				if (next === "all") p.delete("bot");
				else p.set("bot", next);
				return p;
			},
			{ replace: true },
		);

	const botOptions = useMemo(() => {
		const opts = [{ value: "all", label: "Every bot" }, ...agentList.map((a) => ({ value: a.id, label: a.name }))];
		if (botId && !opts.some((o) => o.value === botId)) {
			opts.push({ value: botId, label: bot?.name ?? "Selected bot" });
		}
		return opts;
	}, [agentList, botId, bot]);

	return (
		<Page
			title="Activity"
			description="What your bots are doing, scheduled to do, and finished."
			width="wide"
			actions={
				// An empty Scheduled tab offers New routine itself: one primary action per view.
				canCreateRoutine && !(view === "scheduled" && noRoutines) ? (
					<Button variant="primary" size="sm" onClick={() => setCreating(true)}>
						<Plus /> New routine
					</Button>
				) : undefined
			}
		>
			<Tabs value={view} onValueChange={setView}>
				<div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:border-b sm:border-border">
					<TabsList className="sm:border-b-0">
						<TabsTrigger value="working">Working{live.length ? ` (${live.length})` : ""}</TabsTrigger>
						<TabsTrigger value="scheduled">
							Scheduled{scheduled.length ? ` (${scheduled.length})` : ""}
						</TabsTrigger>
						<TabsTrigger value="done">Done</TabsTrigger>
						<TabsTrigger value="log">Log</TabsTrigger>
					</TabsList>
					{botOptions.length > 1 && (
						<div className="sm:pb-1.5">
							<Select
								size="sm"
								label="Filter by bot"
								value={botId ?? "all"}
								onValueChange={setBot}
								options={botOptions}
								className="w-full sm:w-44"
							/>
						</div>
					)}
				</div>

				<TabsContent value="working">
					{loadingRuns && live.length === 0 ? (
						<SkeletonRows count={2} />
					) : runsError && live.length === 0 ? (
						<ErrorState
							title="Active work didn't load"
							error={runsErr}
							onRetry={() => void refetchRuns()}
						/>
					) : live.length === 0 ? (
						<EmptyState
							icon={<Activity />}
							title="Nothing running right now"
							description="Replies and routines in progress show up here."
						/>
					) : (
						<List label="Working runs">
							{live.map((r) => (
								<RunRow key={r.id} run={r} showAgent={!bot} />
							))}
						</List>
					)}
				</TabsContent>

				<TabsContent value="scheduled" className="flex flex-col gap-6">
					{loadingRoutines ? (
						<SkeletonRows count={3} />
					) : routinesError ? (
						<ErrorState
							title="Routines didn't load"
							error={routinesErr}
							onRetry={() => void refetchRoutines()}
						/>
					) : noRoutines ? (
						<EmptyState
							icon={<CalendarClock />}
							title="Nothing scheduled"
							description="Ask a bot to do something on a schedule, or create a routine."
							action={
								canCreateRoutine ? (
									<Button variant="primary" onClick={() => setCreating(true)}>
										<Plus /> New routine
									</Button>
								) : undefined
							}
						/>
					) : (
						<>
							{scheduled.length === 0 ? (
								<EmptyState
									size="sm"
									icon={<CalendarClock />}
									title="No active routines"
									description="Turn a paused routine back on below, or make a new one."
								/>
							) : (
								<RoutineList routines={scheduled} agents={bot ? undefined : agents} label="Scheduled" />
							)}
							{paused.length > 0 && (
								<Section title="Paused">
									<RoutineList routines={paused} agents={bot ? undefined : agents} label="Paused" />
								</Section>
							)}
							{finishedReminders.length > 0 && (
								<Fold title="Finished reminders" summary={String(finishedReminders.length)}>
									<RoutineList
										routines={finishedReminders.slice(0, 10)}
										agents={bot ? undefined : agents}
										label="Finished reminders"
									/>
								</Fold>
							)}
						</>
					)}
				</TabsContent>

				<TabsContent value="done">
					{loadingRuns ? (
						<SkeletonRows count={5} />
					) : runsError ? (
						<ErrorState
							title="Finished work didn't load"
							error={runsErr}
							onRetry={() => void refetchRuns()}
						/>
					) : completed.length === 0 ? (
						<EmptyState
							icon={<CircleCheck />}
							title="No finished work yet"
							description="Completed replies and routine runs appear here."
						/>
					) : (
						<List label="Completed runs">
							{completed.map((r) => (
								<RunRow key={r.id} run={r} showAgent={!bot} />
							))}
						</List>
					)}
				</TabsContent>

				<TabsContent value="log">
					<ActivityLog agentId={botId ?? undefined} />
				</TabsContent>
			</Tabs>
			{canCreateRoutine && <RoutineDialog open={creating} onOpenChange={setCreating} agent={bot ?? null} />}
		</Page>
	);
}
