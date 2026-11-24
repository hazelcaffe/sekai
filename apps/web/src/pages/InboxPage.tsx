import {
	AgentAvatar,
	api,
	haptic,
	qk,
	timeAgo,
	useAccess,
	useAgentMap,
	useApprovals,
	useCredentialRequests,
	useEmailSenders,
	usePairings,
} from "@sekai/client";
import { type CredentialRequest, channelTitle } from "@sekai/shared";
import { Button, Dialog, EmptyState, ErrorState, List, Page, Row, Section, SkeletonRows } from "@sekai/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Inbox } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { ChannelIcon } from "../components/channels/ChannelIcon.tsx";
import { approvalPart } from "../components/chat/approval-part.ts";
import { ApprovalCard } from "../components/chat/Parts.tsx";
import { LoginForm } from "../components/computer/CredentialPrompt.tsx";

/** Everything waiting on you, across all bots and chats. */
export function InboxPage() {
	const approvals = useApprovals();
	const pairings = usePairings();
	const senders = useEmailSenders();
	const logins = useCredentialRequests();
	const agents = useAgentMap();
	const canPair = useAccess().can("channels");
	const qc = useQueryClient();
	const [login, setLogin] = useState<CredentialRequest | null>(null);
	const [search] = useSearchParams();
	const approvalId = search.get("approval");
	const requests = approvals.data ?? [];
	const waiting = pairings.data ?? [];
	const signIns = logins.data ?? [];
	const decide = useMutation({
		mutationFn: ({ code, approve }: { code: string; approve: boolean }) =>
			api.channels.decidePairing(code, approve),
		onSuccess: (_, { approve }) => {
			haptic(approve ? "success" : "warning");
			void qc.invalidateQueries({ queryKey: qk.pairings });
		},
	});
	useEffect(() => {
		if (approvalId && approvals.data)
			document.getElementById(`approval-${approvalId}`)?.scrollIntoView({ block: "nearest" });
	}, [approvalId, approvals.data]);
	const senderDecision = useMutation({
		mutationFn: ({ id, allow }: { id: string; allow: boolean }) => api.email.decide(id, allow),
		onSuccess: () => void qc.invalidateQueries({ queryKey: qk.emailSenders }),
	});
	const failed = approvals.isError || pairings.isError || logins.isError || senders.isError;
	const pending = approvals.isPending || pairings.isPending || logins.isPending || senders.isPending;
	return (
		<Page title="Needs you" description="Review requests from your bots and connected accounts.">
			{failed && (
				<ErrorState
					title="Some requests didn't load"
					onRetry={() => {
						if (approvals.isError) void approvals.refetch();
						if (pairings.isError) void pairings.refetch();
						if (logins.isError) void logins.refetch();
						if (senders.isError) void senders.refetch();
					}}
				/>
			)}
			{requests.length > 0 && (
				<Section title="Approvals">
					{requests.map((request) => {
						const agent = agents.get(request.agentId);
						return (
							<div
								key={request.toolCallId}
								id={`approval-${request.toolCallId}`}
								className="flex scroll-mt-16 flex-col gap-1.5"
							>
								<div className="flex flex-wrap items-center gap-x-2 text-small text-fg-subtle">
									{agent && <AgentAvatar avatar={agent.avatar} size={24} />}
									<span className="font-medium text-fg">{agent?.name ?? "Bot"}</span>
									<span>{timeAgo(request.createdAt)}</span>
									{request.expiresAt && <span>· Expires {timeAgo(request.expiresAt)}</span>}
									<Link
										to={`/c/${request.conversationId}?m=${encodeURIComponent(request.messageId)}`}
										className="ml-auto flex min-h-8 items-center text-brand-ink hover:underline coarse:min-h-11"
									>
										Open chat
									</Link>
								</div>
								<ApprovalCard
									part={approvalPart(request)}
									conversationId={request.conversationId}
									agentId={request.agentId}
								/>
							</div>
						);
					})}
				</Section>
			)}
			{signIns.length > 0 && (
				<Section title="Sign-in requests">
					<List>
						{signIns.map((request) => {
							const agent = agents.get(request.agentId);
							return (
								<Row
									key={request.id}
									leading={agent && <AgentAvatar avatar={agent.avatar} size={32} />}
									title={request.site}
									subtitle={`${agent?.name ?? "A bot"} needs to sign in.`}
									chevron
									onClick={() => setLogin(request)}
								/>
							);
						})}
					</List>
				</Section>
			)}
			{waiting.length > 0 && (
				<Section
					title="Pairing requests"
					description={
						canPair
							? "Only approve codes you requested; senders can use your bot's tools and memory."
							: "Your role can see these requests, but can't approve or reject them."
					}
				>
					<List>
						{waiting.map((pair) => (
							<Row
								key={pair.code}
								wrap
								leading={<ChannelIcon type={pair.type} size={32} />}
								title={`${pair.senderName} → ${agents.get(pair.agentId)?.name ?? "Bot"}`}
								subtitle={
									<>
										{channelTitle(pair.type)} · Code <code>{pair.code}</code> ·{" "}
										{timeAgo(pair.createdAt)}
									</>
								}
								trailing={
									canPair && (
										<>
											<Button
												variant="primary"
												disabled={decide.isPending}
												onClick={() => decide.mutate({ code: pair.code, approve: true })}
											>
												<Check />
												Approve
											</Button>
											<Button
												variant="ghost"
												disabled={decide.isPending}
												onClick={() => decide.mutate({ code: pair.code, approve: false })}
											>
												Reject
											</Button>
										</>
									)
								}
							/>
						))}
					</List>
					{decide.isError && (
						<ErrorState
							title="Couldn't record your decision"
							onRetry={() => decide.variables && decide.mutate(decide.variables)}
						/>
					)}
				</Section>
			)}
			{Boolean(senders.data?.length) && (
				<Section
					title="New email senders"
					description="Allowed senders can use the bot's tools and memory by email."
				>
					<List>
						{senders.data?.map((n) => (
							<Row
								key={n.id}
								title={`New email for ${agents.get(n.agentId)?.name ?? "your bot"}`}
								subtitle={`${n.address || "Unknown address"} · ${n.verified ? n.subject || "No subject" : "Sender couldn't be verified"}`}
								wrap
								trailing={
									canPair && (
										<>
											{n.verified && (
												<Button
													variant="secondary"
													disabled={senderDecision.isPending}
													onClick={() => senderDecision.mutate({ id: n.id, allow: true })}
												>
													Allow this sender
												</Button>
											)}
											<Button
												variant="ghost"
												disabled={senderDecision.isPending}
												onClick={() => senderDecision.mutate({ id: n.id, allow: false })}
											>
												Dismiss
											</Button>
										</>
									)
								}
							/>
						))}
					</List>
					{senderDecision.isError && (
						<ErrorState
							error={senderDecision.error}
							onRetry={() => senderDecision.variables && senderDecision.mutate(senderDecision.variables)}
						/>
					)}
				</Section>
			)}
			{pending ? (
				<SkeletonRows count={2} leading />
			) : (
				!failed &&
				!requests.length &&
				!waiting.length &&
				!senders.data?.length &&
				!signIns.length && (
					<EmptyState
						icon={<Inbox />}
						title="You're all caught up."
						description="New requests will appear here."
					/>
				)
			)}
			<Dialog open={Boolean(login)} onOpenChange={(open) => !open && setLogin(null)} title="Sign in" size="sm">
				{login && (
					<LoginForm
						key={login.id}
						request={login}
						onDone={() => {
							setLogin(null);
							void logins.refetch();
						}}
					/>
				)}
			</Dialog>
		</Page>
	);
}
