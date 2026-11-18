import { useRoutines } from "@sekai/client";
import type { Agent, Conversation } from "@sekai/shared";
import { Button, EmptyState, Section, Spinner } from "@sekai/ui";
import { CalendarClock, Plus } from "lucide-react";
import { useState } from "react";
import { RoutineDialog } from "../routines/RoutineDialog.tsx";
import { RoutineRow } from "../routines/RoutineRow.tsx";

export function RoutinesTab({ agent, conversation }: { agent: Agent; conversation: Conversation }) {
	const { data: routines = [], isLoading } = useRoutines(agent.id);
	const [creating, setCreating] = useState(false);
	const active = routines.filter((r) => r.enabled || r.schedule.type !== "once");
	const done = routines.filter((r) => !r.enabled && r.schedule.type === "once");

	return (
		<div className="flex flex-col gap-5">
			<Section
				title="Routines and reminders"
				description={`Ask ${agent.name} in chat (“every weekday at 8, brief me”), or add one here.`}
				action={
					<Button variant="secondary" size="xs" onClick={() => setCreating(true)}>
						<Plus /> New
					</Button>
				}
			>
				{isLoading ? (
					<Spinner />
				) : active.length === 0 ? (
					<EmptyState
						icon={<CalendarClock />}
						title="Nothing scheduled"
						description="Routines run even when you're away."
						className="py-8"
					/>
				) : (
					active.map((r) => <RoutineRow key={r.id} routine={r} />)
				)}
			</Section>
			{done.length > 0 && (
				<Section title="Finished reminders">
					{done.slice(0, 10).map((r) => (
						<RoutineRow key={r.id} routine={r} />
					))}
				</Section>
			)}
			<RoutineDialog open={creating} onOpenChange={setCreating} agent={agent} conversationId={conversation.id} />
		</div>
	);
}
