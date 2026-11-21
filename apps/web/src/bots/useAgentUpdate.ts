import { api, qk } from "@sekai/client";
import type { Agent, AgentUpdate } from "@sekai/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

/**
 * Saves a change to the bot and puts the answer in the cache at once, so the next change starts from it (the live
 * event that says the same thing follows a moment later).
 */
export function useAgentUpdate(agent: Pick<Agent, "id">): (patch: AgentUpdate) => Promise<Agent> {
	const qc = useQueryClient();
	return useCallback(
		async (patch) => {
			const next = await api.agents.update(agent.id, patch);
			qc.setQueryData<Agent[]>(qk.agents, (list) => list?.map((a) => (a.id === next.id ? next : a)));
			return next;
		},
		[agent.id, qc],
	);
}
