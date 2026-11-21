import { useAccess, useRoutines } from "@sekai/client";
import type { Agent, Conversation } from "@sekai/shared";
import { Button, EmptyState, ErrorState, Fold, Section, SkeletonRows } from "@sekai/ui";
import { CalendarClock, Plus } from "lucide-react";
import { useState } from "react";
import { RoutineDialog } from "../routines/RoutineDialog.tsx";
import { RoutineList } from "../routines/RoutineRow.tsx";

/** The bot's routines and reminders. New ones report in `conversation` (the bot's main chat when there's none). */
export function RoutinesList({ agent, conversation }: { agent: Agent; conversation?: Conversation | null }) {
	const routines = useRoutines(agent.id);
	const { can } = useAccess();
	const [creating, setCreating] = useState(false);
	const list = routines.data ?? [];
	const active = list.filter((r) => r.enabled || r.schedule.type !== "once");
	const done = list.filter((r) => !r.enabled && r.schedule.type === "once");
	const mayCreate = can("routines");
	const create = (
		<Button variant="secondary" size="sm" onClick={() => setCreating(true)}>
			<Plus /> New routine
		</Button>
	);

	return (
		<>
			<Section
				title="Scheduled"
				description={`Or ask ${agent.name} in chat: “every weekday at 8, brief me”.`}
				action={mayCreate && active.length > 0 ? create : undefined}
			>
				{routines.isLoading ? (
					<SkeletonRows count={3} />
				) : routines.isError ? (
					<ErrorState size="sm" error={routines.error} onRetry={() => void routines.refetch()} />
				) : active.length === 0 ? (
					<EmptyState
						size="sm"
						icon={<CalendarClock />}
						title="Nothing scheduled"
						description={
							mayCreate
								? "Routines run even when you're away."
								: "Routines aren't part of your role. Ask an admin if you'd like them."
						}
						action={
							mayCreate ? (
								<Button variant="secondary" onClick={() => setCreating(true)}>
									<Plus /> New routine
								</Button>
							) : undefined
						}
					/>
				) : (
					<RoutineList routines={active} label={`${agent.name}'s routines`} />
				)}
			</Section>
			{done.length > 0 && (
				<Fold title="Finished reminders" summary={`${done.length} done`}>
					<RoutineList routines={done.slice(0, 10)} label="Finished reminders" />
				</Fold>
			)}
			<RoutineDialog
				open={creating}
				onOpenChange={setCreating}
				agent={agent}
				conversationId={conversation?.id ?? null}
			/>
		</>
	);
}
