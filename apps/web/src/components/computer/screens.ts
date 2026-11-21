import type { Agent, Machine, MachineSeat, Permission } from "@sekai/shared";

/** A viewer may watch the borrowed bot's account on their own computer, never the owner's screen. */
export function availableScreens(agent: Pick<Agent, "id" | "sharedBy">, owned: Machine[], shared: MachineSeat[]) {
	const screens: { machine: Machine; bot?: string }[] = [];
	if (!agent.sharedBy)
		for (const machine of owned) {
			if (machine.kind === "computer" && machine.agentId === agent.id) screens.push({ machine });
		}
	for (const { machine, member } of shared) {
		if (machine.kind === "computer" && member.agentId === agent.id && member.available && member.status === "ready")
			screens.push({ machine, bot: member.agentId });
	}
	return screens;
}

/**
 * "Your shared access" in a shared bot's chat (what you lend it: your computers and browsers): when your role lets
 * you lend them, or you already do. Your own bots have their Computer section instead.
 */
export function offersSharedAccess(
	agent: Pick<Agent, "sharedBy">,
	can: (p: Permission) => boolean,
	lent: number,
): boolean {
	return Boolean(agent.sharedBy) && (can("computers") || can("browser") || lent > 0);
}
