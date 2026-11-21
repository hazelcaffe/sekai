import { useConversations } from "@sekai/client";
import { Page } from "@sekai/ui";
import { useMemo } from "react";
import { RoutinesList } from "../../components/agent/RoutinesList.tsx";
import { latestDirectByAgent } from "../../lib/navigation.ts";
import type { BotSectionProps } from "../section.ts";

/** Its routines and reminders (the same list and editor as Activity → Scheduled, for this bot). */
export function RoutinesSection({ agent, back }: BotSectionProps) {
	const { data: conversations } = useConversations();
	// New routines report in its main chat.
	const main = useMemo(() => latestDirectByAgent(conversations).get(agent.id) ?? null, [conversations, agent.id]);
	return (
		<Page
			back={back}
			title="Routines"
			description={`What ${agent.name} does on a schedule, or when something happens.`}
		>
			<RoutinesList agent={agent} conversation={main} />
		</Page>
	);
}
