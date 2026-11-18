import {
	AgentAvatar,
	api,
	timeAgo,
	useAgentMap,
	useApprovals,
	useCredentialRequests,
	usePairings,
} from "@sekai/client";
import { channelTitle, type PendingApproval, type ToolPart } from "@sekai/shared";
import { Button, EmptyState, IconButton, Spinner } from "@sekai/ui";
import { useMutation } from "@tanstack/react-query";
import { Check, Inbox, X } from "lucide-react";
import { useNavigate } from "react-router";
import { ChannelIcon } from "../components/channels/ChannelIcon.tsx";
import { ApprovalCard } from "../components/chat/Parts.tsx";
import { LoginForm } from "../components/computer/CredentialPrompt.tsx";
import { Page } from "../components/layout/PageHeader.tsx";

function toPart(a: PendingApproval): ToolPart {
	return {
		type: "tool",
		id: a.toolCallId,
		name: a.toolName,
		title: a.title,
		source: a.category.startsWith("mcp:") ? "mcp" : a.category === "external" ? "external" : "builtin",
		category: a.category,
		risk: a.risk,
		args: a.args,
		status: "awaiting_approval",
		reason: a.reason,
	};
}

/** Everything waiting on you, across all bots and chats. */
export function InboxPage() {
	const { data: approvals = [], isLoading } = useApprovals();
	const { data: pairings = [] } = usePairings();
	const { data: logins = [], refetch: refetchLogins } = useCredentialRequests();
	const agents = useAgentMap();
	const navigate = useNavigate();
	const decide = useMutation({
		mutationFn: (p: { code: string; approve: boolean }) => api.channels.decidePairing(p.code, p.approve),
	});
	return (
		<Page title="Needs you" description="Actions your bots want to take, and people asking to talk to them.">
			{logins.length > 0 && (
				<div className="mb-8 flex flex-col gap-3">
					<h2 className="text-[13px] font-semibold">Sign-in requests</h2>
					{logins.map((r) => (
						<div key={r.id} className="rounded-2xl border border-border p-4">
							<LoginForm request={r} onDone={() => void refetchLogins()} />
						</div>
					))}
				</div>
			)}
			{pairings.length > 0 && (
				<div className="mb-8 flex flex-col gap-2">
					<h2 className="text-[13px] font-semibold">Pairing requests</h2>
					{pairings.map((p) => {
						const agent = agents.get(p.agentId);
						return (
							<div
								key={p.code}
								className="flex items-center gap-3 rounded-2xl border border-border px-4 py-3"
							>
								<ChannelIcon type={p.type} size={32} />
								<div className="min-w-0 flex-1">
									<div className="truncate text-sm font-medium">
										{p.senderName} → {agent?.name ?? "bot"}
									</div>
									<div className="text-xs text-fg-subtle">
										{channelTitle(p.type)} · code{" "}
										<span className="font-mono font-semibold text-fg">{p.code}</span> ·{" "}
										{timeAgo(p.createdAt)}
									</div>
								</div>
								<Button
									variant="primary"
									size="sm"
									onClick={() => decide.mutate({ code: p.code, approve: true })}
								>
									<Check /> Approve
								</Button>
								<IconButton
									label="Reject"
									size="icon-sm"
									onClick={() => decide.mutate({ code: p.code, approve: false })}
								>
									<X />
								</IconButton>
							</div>
						);
					})}
					<p className="text-xs text-fg-subtle">
						Only approve codes you requested yourself: an approved sender can use the bot with your tools
						and memory.
					</p>
				</div>
			)}
			{isLoading ? (
				<Spinner />
			) : approvals.length === 0 && pairings.length === 0 && logins.length === 0 ? (
				<EmptyState
					icon={<Inbox />}
					title="You're all caught up"
					description="Approval requests show up here and in the chat that asked."
				/>
			) : (
				<div className="flex flex-col gap-5">
					{approvals.map((a) => {
						const agent = agents.get(a.agentId);
						return (
							<div key={a.toolCallId}>
								<button
									type="button"
									onClick={() => navigate(`/c/${a.conversationId}`)}
									className="mb-1 flex items-center gap-2 text-[13px] hover:underline"
								>
									{agent && <AgentAvatar avatar={agent.avatar} size={22} />}
									<span className="font-medium">{agent?.name ?? "Bot"}</span>
									<span className="text-fg-subtle">· {timeAgo(a.createdAt)}</span>
									{a.expiresAt && (
										<span className="text-fg-subtle">· expires {timeAgo(a.expiresAt)}</span>
									)}
								</button>
								<ApprovalCard part={toPart(a)} conversationId={a.conversationId} />
							</div>
						);
					})}
				</div>
			)}
		</Page>
	);
}
