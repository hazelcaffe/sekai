import { AgentAvatar, api, cn, dateTime, shortTime, useAgents } from "@sekai/client";
import type { ActivityEntry, ActivityQuery } from "@sekai/shared";
import { Badge, Button, EmptyState, Input, Select, SettingsPanel, Skeleton, Spinner } from "@sekai/ui";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Ban, ChevronRight, CircleAlert, CircleCheck, Download, ExternalLink, ScrollText, Search } from "lucide-react";
import { useEffect, useState } from "react";

const BY_LABEL: Record<NonNullable<ActivityEntry["decidedBy"]>, string> = {
	user: "you",
	rule: "a rule",
	mode: "the approval mode",
	reviewer: "the reviewer model",
	primary: "your primary bot",
	timeout: "a timeout",
};

const RISK_TONE = { read: "neutral", write: "info", external: "warning", destructive: "danger" } as const;

function Outcome({ e }: { e: ActivityEntry }) {
	if (e.status === "done") return <CircleCheck className="size-4 shrink-0 text-success" aria-label="Done" />;
	if (e.status === "denied") return <Ban className="size-4 shrink-0 text-warning" aria-label="Denied" />;
	return <CircleAlert className="size-4 shrink-0 text-danger" aria-label="Failed" />;
}

function decisionText(e: ActivityEntry): string | null {
	if (!e.decision || !e.decidedBy) return null;
	return `${e.decision === "approved" ? "Allowed" : "Denied"} by ${BY_LABEL[e.decidedBy]}`;
}

function Row({
	e,
	botName,
	avatar,
}: {
	e: ActivityEntry;
	botName: string;
	avatar?: Parameters<typeof AgentAvatar>[0]["avatar"];
}) {
	const [open, setOpen] = useState(false);
	const decided = decisionText(e);
	return (
		<div className="flex flex-col">
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				aria-expanded={open}
				className="flex items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/50 coarse:py-3.5"
			>
				{avatar ? (
					<AgentAvatar avatar={avatar} size={28} />
				) : (
					<span className="size-7 shrink-0 rounded-full bg-muted" />
				)}
				<span className="min-w-0 flex-1">
					<span className="flex items-center gap-2">
						<Outcome e={e} />
						<span className="truncate text-[13px] font-medium">{e.title}</span>
					</span>
					<span className="block truncate text-xs text-fg-subtle">
						{botName} · {e.tool}
						{decided ? ` · ${decided}` : ""}
					</span>
				</span>
				{e.risk && e.risk !== "read" && (
					<Badge tone={RISK_TONE[e.risk]} className="hidden shrink-0 sm:inline-flex">
						{e.risk}
					</Badge>
				)}
				<span className="shrink-0 text-xs text-fg-subtle tabular-nums" title={dateTime(e.at)}>
					{shortTime(e.at)}
				</span>
				<ChevronRight
					className={cn("size-4 shrink-0 text-fg-subtle transition-transform", open && "rotate-90")}
				/>
			</button>
			{open && (
				<div className="flex flex-col gap-2 border-t border-border bg-muted/30 px-4 py-3 text-xs">
					<div className="flex flex-wrap gap-x-4 gap-y-1 text-fg-muted">
						<span>{dateTime(e.at)}</span>
						{e.durationMs !== null && <span>took {(e.durationMs / 1000).toFixed(1)}s</span>}
						{e.risk && <span>risk: {e.risk}</span>}
						{e.source !== "builtin" && (
							<span>{e.source === "mcp" ? "from an app" : "the agent's own tool"}</span>
						)}
					</div>
					{decided && (
						<div>
							<span className="font-medium">{decided}</span>
							{e.note ? <span className="text-fg-muted">: {e.note}</span> : null}
						</div>
					)}
					{Object.keys(e.args).length > 0 && (
						<pre className="max-h-48 overflow-auto rounded-lg bg-card p-2 font-mono text-[11px] leading-4 whitespace-pre-wrap break-all">
							{JSON.stringify(e.args, null, 2)}
						</pre>
					)}
					{(e.error || e.result) && (
						<pre
							className={cn(
								"max-h-48 overflow-auto rounded-lg bg-card p-2 font-mono text-[11px] leading-4 whitespace-pre-wrap break-all",
								e.error && "text-danger",
							)}
						>
							{e.error ?? e.result}
						</pre>
					)}
					{e.conversationId && e.messageId && (
						<a
							href={`/c/${e.conversationId}?m=${e.messageId}`}
							className="inline-flex items-center gap-1 self-start font-medium text-brand-ink hover:underline"
						>
							<ExternalLink className="size-3.5" /> Open in the chat
						</a>
					)}
				</div>
			)}
		</div>
	);
}

function ActivityBody() {
	const { data: agents = [] } = useAgents();
	const [search, setSearch] = useState("");
	const [q, setQ] = useState("");
	const [agentId, setAgentId] = useState("all");
	const [status, setStatus] = useState("all");
	const [decidedBy, setDecidedBy] = useState("all");
	useEffect(() => {
		const t = setTimeout(() => setQ(search.trim()), 250);
		return () => clearTimeout(t);
	}, [search]);
	const filters: ActivityQuery = {
		...(q ? { q } : {}),
		...(agentId !== "all" ? { agentId } : {}),
		...(status !== "all" ? { status: status as ActivityQuery["status"] } : {}),
		...(decidedBy !== "all" ? { decidedBy: decidedBy as ActivityQuery["decidedBy"] } : {}),
	};
	const list = useInfiniteQuery({
		queryKey: ["activity", filters],
		queryFn: ({ pageParam }) =>
			api.activity.list({ ...filters, limit: 50, ...(pageParam ? { before: pageParam } : {}) }),
		initialPageParam: 0,
		getNextPageParam: (last) => (last.length === 50 ? last.at(-1)?.at : undefined),
		refetchInterval: 20_000,
	});
	const entries = list.data?.pages.flat() ?? [];
	const byId = new Map(agents.map((a) => [a.id, a]));
	const filtered = Object.keys(filters).length > 0;

	return (
		<>
			<div className="flex flex-col gap-2">
				<div className="relative">
					<Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle" />
					<Input
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						placeholder="Search what bots did (tools, titles, details)"
						aria-label="Search the activity log"
						className="pl-9"
					/>
				</div>
				<div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
					<Select
						value={agentId}
						onValueChange={setAgentId}
						options={[
							{ value: "all", label: "Every bot" },
							...agents.map((a) => ({ value: a.id, label: a.name })),
						]}
					/>
					<Select
						value={status}
						onValueChange={setStatus}
						options={[
							{ value: "all", label: "Any outcome" },
							{ value: "done", label: "Done" },
							{ value: "error", label: "Failed" },
							{ value: "denied", label: "Denied" },
						]}
					/>
					<Select
						value={decidedBy}
						onValueChange={setDecidedBy}
						options={[
							{ value: "all", label: "Decided by anyone" },
							{ value: "user", label: "Decided by you" },
							{ value: "rule", label: "By a rule" },
							{ value: "mode", label: "By the approval mode" },
							{ value: "reviewer", label: "By the reviewer model" },
							{ value: "primary", label: "By your primary bot" },
							{ value: "timeout", label: "Timed out" },
						]}
					/>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<span className="text-xs text-fg-subtle">Export {filtered ? "what's shown" : "everything"}:</span>
					<Button variant="ghost" size="sm" asChild>
						<a href={api.activity.exportUrl(filters, "csv")} download>
							<Download /> CSV
						</a>
					</Button>
					<Button variant="ghost" size="sm" asChild>
						<a href={api.activity.exportUrl(filters, "jsonl")} download>
							<Download /> JSON lines
						</a>
					</Button>
				</div>
			</div>

			{list.isLoading ? (
				<Skeleton className="h-80 rounded-2xl" />
			) : entries.length === 0 ? (
				<EmptyState
					icon={<ScrollText />}
					title={filtered ? "Nothing matches" : "Nothing yet"}
					description={
						filtered
							? "Try other words or filters."
							: "Every tool a bot uses shows up here, with who allowed it."
					}
				/>
			) : (
				<div className="flex flex-col divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
					{entries.map((e) => {
						const a = e.agentId ? byId.get(e.agentId) : undefined;
						return (
							<Row
								key={e.id}
								e={e}
								botName={a?.name ?? (e.agentId ? "A deleted bot" : "Sekai")}
								avatar={a?.avatar}
							/>
						);
					})}
				</div>
			)}
			{list.hasNextPage && (
				<Button
					variant="secondary"
					className="self-center"
					onClick={() => void list.fetchNextPage()}
					disabled={list.isFetchingNextPage}
				>
					{list.isFetchingNextPage ? <Spinner /> : null} Show older
				</Button>
			)}
		</>
	);
}

export function ActivityPanel() {
	return (
		<SettingsPanel
			value="activity"
			title="Activity log"
			description="Everything your bots did, how it went, and who allowed it."
		>
			<ActivityBody />
		</SettingsPanel>
	);
}
