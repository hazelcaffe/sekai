import {
	AgentAvatar,
	api,
	formatTokens,
	shortModelName,
	timeAgo,
	useAgentMap,
	useConversations,
	useModels,
} from "@sekai/client";
import type { Run } from "@sekai/shared";
import { Badge, Button, Row, Spinner, type Tone } from "@sekai/ui";
import { useMutation } from "@tanstack/react-query";
import { CircleAlert, CircleCheck, CircleSlash, ShieldAlert } from "lucide-react";

function statusIcon(run: Run) {
	switch (run.status) {
		case "queued":
		case "running":
			return <Spinner />;
		case "awaiting_approval":
			return <ShieldAlert />;
		case "done":
			return <CircleCheck />;
		case "error":
			return <CircleAlert />;
		case "cancelled":
			return <CircleSlash />;
	}
}

function statusTone(run: Run): Tone {
	switch (run.status) {
		case "awaiting_approval":
			return "warning";
		case "done":
			return "success";
		case "error":
			return "danger";
		case "queued":
		case "running":
			return "brand";
		case "cancelled":
			return "neutral";
	}
}

/** What a finished reply was for: "Replied in “Field Notes”" (a run's own title says what's going on meanwhile). */
export function doneTitle(run: Pick<Run, "status" | "trigger" | "title">, chatTitle: string | undefined): string {
	const reply = run.trigger === "user" || run.trigger === "regenerate" || run.trigger === "channel";
	return run.status === "done" && reply && chatTitle ? `Replied in “${chatTitle}”` : run.title;
}

/** One run in Activity (Working or Done): opens its chat, and offers Stop while active. */
export function RunRow({ run, showAgent }: { run: Run; showAgent?: boolean }) {
	const agents = useAgentMap();
	const agent = agents.get(run.agentId);
	const { data: models } = useModels();
	const { data: chats } = useConversations();
	const modelId = run.model?.split("::").pop() ?? null;
	const model = modelId
		? shortModelName(
				models?.find((m) => m.id === modelId),
				modelId,
			)
		: null;
	const chat = chats?.find((c) => c.id === run.conversationId);
	const cancel = useMutation({ mutationFn: () => api.runs.cancel(run.id) });
	const active = run.status === "queued" || run.status === "running" || run.status === "awaiting_approval";
	const working = run.status === "queued" || run.status === "running";
	const tokens = run.usage ? run.usage.inputTokens + run.usage.outputTokens : 0;
	const title = doneTitle(run, chat?.title);
	const botPrefix =
		showAgent && agent && !title.toLowerCase().startsWith(agent.name.toLowerCase()) ? agent.name : null;

	const meta = [
		botPrefix,
		timeAgo(run.startedAt ?? run.createdAt),
		model,
		tokens > 0 ? `${formatTokens(tokens)} tokens` : null,
	]
		.filter(Boolean)
		.join(" · ");

	const badge =
		run.status === "awaiting_approval" ? (
			<Badge tone="warning">Needs you</Badge>
		) : run.status === "error" ? (
			<Badge tone="danger">Failed</Badge>
		) : run.status === "cancelled" ? (
			<Badge tone="neutral">Stopped</Badge>
		) : undefined;

	return (
		<Row
			leading={showAgent && agent ? <AgentAvatar avatar={agent.avatar} size={32} working={working} /> : undefined}
			icon={showAgent && agent ? undefined : statusIcon(run)}
			iconTone={statusTone(run)}
			title={title}
			subtitle={
				run.error ? (
					// The run's own error, as the chat shows it (not a screen error), kept to a couple of lines.
					<span className="line-clamp-2">
						{meta}
						<span className="text-danger-ink"> · {run.error}</span>
					</span>
				) : (
					meta
				)
			}
			badge={badge}
			href={`/c/${run.conversationId}`}
			trailing={
				active ? (
					<Button variant="secondary" size="sm" loading={cancel.isPending} onClick={() => cancel.mutate()}>
						Stop
					</Button>
				) : undefined
			}
		/>
	);
}
