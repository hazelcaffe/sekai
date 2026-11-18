import type { ApprovalScope, PendingApproval, ToolPermission } from "@sekai/shared";
import { currentActor } from "../auth/actor.ts";
import { bus } from "../events/bus.ts";
import { getAgent, updateAgent } from "../services/agents.ts";
import { getConversation, updateConversation } from "../services/conversations.ts";
import { getSettings, updateSettings } from "../services/settings.ts";

export interface ApprovalOutcome {
	approve: boolean;
	by: "user" | "timeout";
	scope: ApprovalScope;
}

interface Pending {
	info: PendingApproval;
	/** Whose chat it's in: only they see and decide it. */
	userId: string | null;
	resolve: (outcome: ApprovalOutcome) => void;
	timer: ReturnType<typeof setTimeout> | null;
}

const pending = new Map<string, Pending>();

function changed(userId: string | null): void {
	const count = [...pending.values()].filter((p) => p.userId === userId).length;
	bus.emit({ type: "approvals.changed", pending: count }, { to: userId ? [userId] : "admins" });
}

/** The acting person's requests waiting for a decision (everyone's for Sekai itself). */
export function listPendingApprovals(): PendingApproval[] {
	const me = currentActor()?.userId;
	return [...pending.values()]
		.filter((p) => !me || p.userId === me)
		.map((p) => p.info)
		.sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * Pauses a tool call until you decide, the request times out (→ denied), or the run is cancelled (→ rejects).
 */
export function requestApproval(
	info: Omit<PendingApproval, "createdAt" | "expiresAt">,
	timeoutMs: number,
	signal: AbortSignal,
): Promise<ApprovalOutcome> {
	return new Promise((resolve, reject) => {
		if (signal.aborted) {
			reject(signal.reason);
			return;
		}
		const createdAt = Date.now();
		const userId = currentActor()?.userId ?? null;
		const entry: Pending = {
			userId,
			info: { ...info, createdAt, expiresAt: timeoutMs > 0 ? createdAt + timeoutMs : null },
			resolve: () => {},
			timer: null,
		};
		const cleanup = () => {
			if (entry.timer) clearTimeout(entry.timer);
			signal.removeEventListener("abort", onAbort);
			pending.delete(info.toolCallId);
			changed(userId);
		};
		const onAbort = () => {
			cleanup();
			reject(signal.reason);
		};
		entry.resolve = (outcome) => {
			cleanup();
			resolve(outcome);
		};
		if (timeoutMs > 0) {
			entry.timer = setTimeout(() => entry.resolve({ approve: false, by: "timeout", scope: "once" }), timeoutMs);
		}
		signal.addEventListener("abort", onAbort, { once: true });
		pending.set(info.toolCallId, entry);
		changed(userId);
	});
}

/** Records the decision as a rule when the scope reaches beyond this one call. */
async function applyScope(info: PendingApproval, approve: boolean, scope: ApprovalScope): Promise<void> {
	const permission: ToolPermission = approve ? "allow" : "off";
	const categoryKey = `category:${info.category}`;
	switch (scope) {
		case "once":
			return;
		case "conversation": {
			const c = await getConversation(info.conversationId);
			if (!c) return;
			await updateConversation(c.id, {
				settings: { toolRules: { ...c.settings.toolRules, [info.toolName]: permission } },
			});
			return;
		}
		case "agent_tool":
		case "agent_category": {
			const agent = await getAgent(info.agentId);
			// A bot shared with you is its owner's to change: the decision holds for this call only.
			if (!agent || agent.sharedBy) return;
			const key = scope === "agent_tool" ? info.toolName : categoryKey;
			await updateAgent(agent.id, {
				capabilities: { ...agent.capabilities, tools: { ...agent.capabilities.tools, [key]: permission } },
			});
			return;
		}
		case "global_tool":
		case "global_category": {
			const settings = await getSettings();
			const key = scope === "global_tool" ? info.toolName : categoryKey;
			await updateSettings({ toolRules: { ...settings.toolRules, [key]: permission } });
			return;
		}
	}
}

/** Whether a decision made for `decided` with `scope` also covers another pending call. */
function covers(decided: PendingApproval, scope: ApprovalScope, other: PendingApproval): boolean {
	// Requests that always need you (root…) are decided one by one.
	if (other.alwaysAsk) return false;
	switch (scope) {
		case "once":
			return false;
		case "conversation":
			return other.conversationId === decided.conversationId && other.toolName === decided.toolName;
		case "agent_tool":
			return other.agentId === decided.agentId && other.toolName === decided.toolName;
		case "agent_category":
			return other.agentId === decided.agentId && other.category === decided.category;
		case "global_tool":
			return other.toolName === decided.toolName;
		case "global_category":
			return other.category === decided.category;
	}
}

export async function decideApproval(
	toolCallId: string,
	decision: { approve: boolean; scope: ApprovalScope },
): Promise<boolean> {
	const entry = pending.get(toolCallId);
	if (!entry) return false;
	const me = currentActor()?.userId;
	if (me && entry.userId !== me) return false;
	// An always-ask request is approved (or denied) for this one call only, whatever scope came with it.
	const scope: ApprovalScope = entry.info.alwaysAsk ? "once" : decision.scope;
	await applyScope(entry.info, decision.approve, scope);
	const outcome: ApprovalOutcome = { approve: decision.approve, by: "user", scope };
	entry.resolve(outcome);
	for (const other of [...pending.values()]) {
		if (other.userId === entry.userId && covers(entry.info, scope, other.info)) other.resolve(outcome);
	}
	return true;
}
