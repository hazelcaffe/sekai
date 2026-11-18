import { useAgentMap, useRoutines, useRuns } from "@sekai/client";
import { Button, EmptyState, Section, Spinner, Tabs, TabsContent, TabsList, TabsTrigger } from "@sekai/ui";
import { Plus } from "lucide-react";
import { useState } from "react";
import { RunRow } from "../components/agent/ActivityTab.tsx";
import { Page } from "../components/layout/PageHeader.tsx";
import { RoutineDialog } from "../components/routines/RoutineDialog.tsx";
import { RoutineRow } from "../components/routines/RoutineRow.tsx";
import { useWorkingAgents } from "../stores/ui.ts";

export function ActivityPage() {
	const live = useWorkingAgents();
	const { data: routines = [], isLoading: loadingRoutines } = useRoutines();
	const { data: runs = [], isLoading } = useRuns();
	const agents = useAgentMap();
	const [creating, setCreating] = useState(false);
	const completed = runs.filter((r) => !["queued", "running", "awaiting_approval"].includes(r.status));
	const scheduled = routines.filter((r) => r.enabled);
	const paused = routines.filter((r) => !r.enabled && r.schedule.type !== "once");

	return (
		<Page
			title="Activity"
			description="What your bots are doing, what's scheduled, and what they finished."
			actions={
				<Button variant="secondary" size="sm" onClick={() => setCreating(true)}>
					<Plus /> Routine
				</Button>
			}
		>
			<Tabs defaultValue={live.length > 0 ? "progress" : "scheduled"}>
				<TabsList className="mb-5">
					<TabsTrigger value="progress">In progress{live.length ? ` (${live.length})` : ""}</TabsTrigger>
					<TabsTrigger value="scheduled">
						Scheduled{scheduled.length ? ` (${scheduled.length})` : ""}
					</TabsTrigger>
					<TabsTrigger value="completed">Completed</TabsTrigger>
				</TabsList>
				<TabsContent value="progress">
					{live.length === 0 ? (
						<EmptyState title="All quiet" description="Nothing is running right now." />
					) : (
						<div className="flex flex-col">
							{live.map((r) => (
								<RunRow key={r.id} run={r} showAgent />
							))}
						</div>
					)}
				</TabsContent>
				<TabsContent value="scheduled" className="flex flex-col gap-6">
					{loadingRoutines ? (
						<Spinner />
					) : scheduled.length === 0 ? (
						<EmptyState
							title="Nothing scheduled"
							description="Ask a bot to do something every day, or add a routine."
						/>
					) : (
						<div className="flex flex-col gap-2">
							{scheduled.map((r) => (
								<RoutineRow key={r.id} routine={r} agent={agents.get(r.agentId)} />
							))}
						</div>
					)}
					{paused.length > 0 && (
						<Section title="Paused">
							{paused.map((r) => (
								<RoutineRow key={r.id} routine={r} agent={agents.get(r.agentId)} />
							))}
						</Section>
					)}
				</TabsContent>
				<TabsContent value="completed">
					{isLoading ? (
						<Spinner />
					) : completed.length === 0 ? (
						<EmptyState title="No activity yet" />
					) : (
						<div className="flex flex-col">
							{completed.map((r) => (
								<RunRow key={r.id} run={r} showAgent />
							))}
						</div>
					)}
				</TabsContent>
			</Tabs>
			<RoutineDialog open={creating} onOpenChange={setCreating} />
		</Page>
	);
}
