import { api, formatTokens, shortTime, useAccess, useAgent, useJob, useJobs } from "@sekai/client";
import { activeJob, type Job, type JobStatus } from "@sekai/shared";
import {
	Badge,
	Button,
	Callout,
	Card,
	CardContent,
	Confirm,
	ErrorState,
	Field,
	Link,
	List,
	Page,
	Row,
	Section,
	SkeletonPage,
	SkeletonRows,
	Textarea,
} from "@sekai/ui";
import { useMutation } from "@tanstack/react-query";
import { FileCode2, FolderOpen, MessageSquare, Send, Square, Terminal } from "lucide-react";
import { useState } from "react";
import { useParams } from "react-router";
import { useGoBack } from "../lib/back.ts";

const labels: Record<JobStatus, string> = {
	working: "Working",
	approval: "Needs approval",
	question: "Has a question",
	done: "Done",
	failed: "Failed",
	stopped: "Stopped",
};
function State({ status }: { status: JobStatus }) {
	return (
		<Badge
			tone={
				status === "done"
					? "success"
					: status === "working"
						? "brand"
						: status === "failed"
							? "danger"
							: status === "stopped"
								? "neutral"
								: "warning"
			}
		>
			{labels[status]}
		</Badge>
	);
}
function Stop({ job }: { job: Job }) {
	const [open, setOpen] = useState(false);
	const stop = useMutation({ mutationFn: () => api.jobs.stop(job.id) });
	return (
		<>
			<Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
				<Square />
				Stop
			</Button>
			<Confirm
				open={open}
				onOpenChange={setOpen}
				title="Stop this job?"
				description="The worker will stop. Its files and transcript will stay here."
				confirmLabel="Stop job"
				danger
				onConfirm={() => stop.mutate()}
			/>
		</>
	);
}
export function JobRow({ job }: { job: Job }) {
	return (
		<Row
			icon={<FileCode2 />}
			title={job.title}
			subtitle={`${job.providerTitle} · ${job.lastStep}`}
			badge={<State status={job.status} />}
			href={`/jobs/${job.id}`}
		/>
	);
}
export function ChatJob({ id }: { id: string }) {
	const list = useJobs();
	const job = list.data?.find((j) => j.id === id);
	return (
		<div className="px-4 py-2 md:px-6">
			{job ? (
				<Card className="max-w-xl">
					<CardContent className="flex min-w-0 flex-col gap-2">
						<div className="flex items-center justify-between gap-2 text-small text-fg-muted">
							<span className="truncate">
								{job.providerTitle} · {shortTime(job.createdAt)}
							</span>
							<State status={job.status} />
						</div>
						<strong className="break-words text-heading">{job.title}</strong>
						<p className="line-clamp-2 break-words text-small text-fg-muted">{job.lastStep}</p>
						<div className="flex items-center gap-2">
							<Button asChild size="sm" variant="outline">
								<Link href={`/jobs/${id}`}>Open</Link>
							</Button>
							{activeJob(job.status) && <Stop job={job} />}
						</div>
					</CardContent>
				</Card>
			) : list.isLoading ? (
				<SkeletonRows count={1} />
			) : (
				<Link className="text-brand-ink" href={`/jobs/${id}`}>
					Open coding job
				</Link>
			)}
		</div>
	);
}
export function JobPage() {
	const id = useParams().jobId ?? "";
	const q = useJob(id);
	const job = q.data;
	const agent = useAgent(job?.agentId);
	const back = useGoBack();
	const { can } = useAccess();
	const [draft, setDraft] = useState("");
	const send = useMutation({
		mutationFn: (text: string) => api.jobs.send(id, text),
		onSuccess: (_, sent) => setDraft((current) => (current === sent ? "" : current)),
	});
	if (q.isLoading) return <SkeletonPage />;
	if (!job) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
	const active = activeJob(job.status);
	return (
		<Page
			title={job.title}
			description={`${job.providerTitle} · ${agent?.name ?? "Coding job"}`}
			back={{ label: "Activity", onClick: () => back("/activity") }}
			actions={active ? <Stop job={job} /> : undefined}
		>
			<Section>
				<List>
					<Row
						icon={<FileCode2 />}
						title="Coding job"
						subtitle={`Started ${new Date(job.createdAt).toLocaleString()}`}
						badge={<State status={job.status} />}
					/>
					<Row
						icon={<FolderOpen />}
						title={job.location}
						subtitle={job.folder.split("/").slice(-2).join("/")}
						details={<p className="break-all text-small">{job.folder}</p>}
					/>
					<Row icon={<MessageSquare />} title="Original chat" href={`/c/${job.conversationId}`} />
				</List>
			</Section>
			{job.status === "approval" && (
				<Callout
					tone="warning"
					title="This job needs approval"
					action={<Link href="/inbox">Open Needs you</Link>}
				>
					Review the request before the worker continues.
				</Callout>
			)}
			<Section title="Transcript">
				<List>
					{job.steps.map((s) =>
						s.kind === "tool" || s.kind === "plan" ? (
							<Row
								key={s.id}
								icon={<Terminal />}
								title={s.text || "Tool call"}
								details={
									<pre className="overflow-x-auto whitespace-pre-wrap break-words text-small">
										{s.detail || "Waiting for the result…"}
									</pre>
								}
							/>
						) : (
							<div className="min-w-0 space-y-1 px-4 py-3" key={s.id}>
								<p className="text-caption font-medium text-fg-subtle">
									{s.kind === "input"
										? "Instruction"
										: s.kind === "message"
											? job.providerTitle
											: "Job update"}{" "}
									· {shortTime(s.at)}
								</p>
								<p className="whitespace-pre-wrap break-words text-body">{s.text}</p>
							</div>
						),
					)}
				</List>
			</Section>
			{active && can("subscriptions") && (
				<Section>
					<form
						className="space-y-2"
						onSubmit={(e) => {
							e.preventDefault();
							if (draft.trim() && !send.isPending) send.mutate(draft);
						}}
					>
						<Field label="Message the worker">
							<Textarea
								value={draft}
								onChange={(e) => setDraft(e.target.value)}
								maxLength={16000}
								rows={2}
							/>
						</Field>
						<Button type="submit" disabled={!draft.trim()} loading={send.isPending}>
							<Send />
							Send message
						</Button>
					</form>
				</Section>
			)}
			<Section title="Usage">
				<p className="text-small text-fg-muted">
					{job.usage
						? `${formatTokens(job.usage.inputTokens)} input tokens · ${formatTokens(job.usage.outputTokens)} output tokens`
						: "The subscription hasn’t reported token usage."}
				</p>
			</Section>
		</Page>
	);
}
