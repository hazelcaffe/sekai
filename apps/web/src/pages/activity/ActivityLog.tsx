import { AgentAvatar, api, cn, dateTime, shortTime, useAgents, useAuth } from "@sekai/client";
import { type ActivityEntry, type ActivityQuery, toolOutcome, type UsageScope } from "@sekai/shared";
import {
	Badge,
	Button,
	DropdownContent,
	DropdownEntries,
	DropdownMenu,
	DropdownTrigger,
	EmptyState,
	ErrorState,
	IconButton,
	Link,
	List,
	type MenuEntry,
	Row,
	Select,
	SkeletonRows,
	Tooltip,
	useIsPhone,
} from "@sekai/ui";
import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
	Ban,
	ChevronRight,
	CircleAlert,
	CircleCheck,
	Download,
	ExternalLink,
	ScrollText,
	SlidersHorizontal,
} from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { SearchInput } from "../../components/activity/SearchInput.tsx";

/** Who decided, besides the person (named per row) and a timeout (which always denies). */
const BY_LABEL: Record<"rule" | "mode" | "reviewer" | "primary", string> = {
	rule: "a tool's rule",
	mode: "the approvals rule",
	reviewer: "the reviewer",
	primary: "the primary bot",
};

const RISK_LABEL: Record<NonNullable<ActivityEntry["risk"]>, string> = {
	read: "Read",
	write: "Write",
	external: "Outside Sekai",
	destructive: "Destructive",
};

const RISK_TONE = { read: "neutral", write: "info", external: "warning", destructive: "danger" } as const;

function Outcome({ e }: { e: ActivityEntry }) {
	if (e.status === "done") return <CircleCheck className="size-4 shrink-0 text-success-ink" aria-label="Done" />;
	if (e.status === "denied") return <Ban className="size-4 shrink-0 text-warning-ink" aria-label="Denied" />;
	return <CircleAlert className="size-4 shrink-0 text-danger-ink" aria-label="Failed" />;
}

/** "Allowed by you", "Denied by Mika Aoki" (someone else's row, for admins), "Allowed by the reviewer"… */
function decisionText(e: ActivityEntry, selfId: string | null): string | null {
	if (!e.decision || !e.decidedBy) return null;
	if (e.decidedBy === "timeout") return "Denied: no answer in time";
	const verb = e.decision === "approved" ? "Allowed" : "Denied";
	if (e.decidedBy === "user") {
		const mine = !e.userId || e.userId === selfId;
		return `${verb} by ${mine ? "you" : (e.userName ?? "its owner")}`;
	}
	return `${verb} by ${BY_LABEL[e.decidedBy]}`;
}

/** "read", "outside Sekai"… for a sentence. */
const riskWords = (risk: NonNullable<ActivityEntry["risk"]>) =>
	risk === "external" ? "outside Sekai" : RISK_LABEL[risk].toLowerCase();

function EntryDetails({ e, selfId, className }: { e: ActivityEntry; selfId: string | null; className?: string }) {
	const decided = decisionText(e, selfId);
	return (
		<div className={cn("flex flex-col gap-2.5 text-small", className)}>
			<div className="flex flex-wrap gap-x-4 gap-y-1 text-fg-muted">
				<span>{dateTime(e.at)}</span>
				{e.durationMs !== null && (
					<span className="tabular-nums">took {(e.durationMs / 1000).toFixed(1)}s</span>
				)}
				{e.risk && <span>risk: {riskWords(e.risk)}</span>}
				{e.source !== "builtin" && <span>{e.source === "mcp" ? "from an app" : "the bot's own tool"}</span>}
				<span className="font-mono">{e.tool}</span>
			</div>
			{e.private && (
				<p className="text-fg-subtle">
					What it was asked and what came back stay with {e.userName ?? "its person"}.
				</p>
			)}
			{decided && (
				<div>
					<span className="font-medium text-fg">{decided}</span>
					{e.note ? <span className="text-fg-muted">: {e.note}</span> : null}
				</div>
			)}
			{Object.keys(e.args).length > 0 && (
				<pre className="max-h-48 overflow-auto rounded-md border border-border bg-surface p-2.5 font-mono text-caption whitespace-pre-wrap break-all">
					{JSON.stringify(e.args, null, 2)}
				</pre>
			)}
			{(e.error || e.result) && (
				<pre
					className={cn(
						"max-h-48 overflow-auto rounded-md border border-border bg-surface p-2.5 font-mono text-caption whitespace-pre-wrap break-all",
						e.error && "text-danger-ink",
					)}
				>
					{e.error ?? e.result}
				</pre>
			)}
			{e.conversationId && e.messageId && (
				<Link
					href={`/c/${e.conversationId}?m=${e.messageId}`}
					className="inline-flex items-center gap-1.5 self-start font-medium text-brand-ink hover:underline"
				>
					<ExternalLink className="size-4" /> Open in chat
				</Link>
			)}
		</div>
	);
}

/** A phone's log entry: a row that opens to its details. */
function MobileLogRow({
	e,
	botName,
	showPerson,
	selfId,
	avatar,
	open,
	onToggle,
}: {
	e: ActivityEntry;
	botName: string;
	showPerson: boolean;
	selfId: string | null;
	avatar?: Parameters<typeof AgentAvatar>[0]["avatar"];
	open: boolean;
	onToggle: () => void;
}) {
	const decided = decisionText(e, selfId);
	const who = showPerson && e.userName ? `${e.userName} · ${botName}` : botName;
	return (
		<Row
			leading={
				avatar ? (
					<AgentAvatar avatar={avatar} size={28} />
				) : (
					<span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-caption font-semibold text-fg-muted">
						{botName.slice(0, 1).toUpperCase()}
					</span>
				)
			}
			title={
				<span className="flex items-center gap-2">
					<Outcome e={e} />
					<span className="truncate">{toolOutcome(e.title, e.status)}</span>
				</span>
			}
			subtitle={
				<span className="block truncate">
					{who}
					{decided ? ` · ${decided}` : ""}
				</span>
			}
			value={<span className="text-caption text-fg-subtle tabular-nums">{shortTime(e.at)}</span>}
			open={open}
			onOpenChange={onToggle}
			details={<EntryDetails e={e} selfId={selfId} />}
		/>
	);
}

/** Activity → Log: everything bots did, how it went and who allowed it; searchable and exportable. */
export function ActivityLog({ agentId }: { agentId?: string }) {
	const phone = useIsPhone();
	const { data: auth } = useAuth();
	const admin = Boolean(auth?.access?.admin);
	const selfId = auth?.access?.userId ?? null;
	const { data: agents = [] } = useAgents();

	const [urlParams] = useSearchParams();
	const initialQ = urlParams.get("q") ?? "";
	const [search, setSearch] = useState(initialQ);
	const [q, setQ] = useState(initialQ.trim());
	const [pickedScope, setPickedScope] = useState<UsageScope>("me");
	const [status, setStatus] = useState("all");
	const [risk, setRisk] = useState("all");
	const [decidedBy, setDecidedBy] = useState("all");
	const [expandedId, setExpandedId] = useState<string | null>(null);
	// On phones the filters fold behind one button, so the log starts near the top.
	const [filtersOpen, setFiltersOpen] = useState(false);

	useEffect(() => {
		const t = setTimeout(() => setQ(search.trim()), 250);
		return () => clearTimeout(t);
	}, [search]);

	const people = useQuery({
		queryKey: ["usage", "people"],
		queryFn: api.admin.users,
		enabled: admin,
		staleTime: 5 * 60_000,
	});

	const scope: UsageScope = admin ? pickedScope : "me";
	const scopeOptions = [
		{ value: "me", label: "Just me" },
		{ value: "all", label: "Everyone" },
		...(people.data ?? [])
			.filter((u) => u.id !== selfId)
			.sort((a, b) => a.name.localeCompare(b.name))
			.map((u) => ({ value: u.id, label: u.name })),
	];

	const filters: ActivityQuery = {
		...(q ? { q } : {}),
		...(scope !== "me" ? { scope } : {}),
		...(agentId ? { agentId } : {}),
		...(status !== "all" ? { status: status as ActivityQuery["status"] } : {}),
		...(risk !== "all" ? { risk: risk as NonNullable<ActivityQuery["risk"]> } : {}),
		...(decidedBy !== "all" ? { decidedBy: decidedBy as NonNullable<ActivityQuery["decidedBy"]> } : {}),
	};

	const list = useInfiniteQuery({
		queryKey: ["activity", filters],
		queryFn: ({ pageParam }) =>
			api.activity.list({ ...filters, limit: 50, ...(pageParam ? { before: pageParam } : {}) }),
		initialPageParam: 0,
		getNextPageParam: (last) => (last.length === 50 ? last.at(-1)?.at : undefined),
		refetchInterval: 20_000,
		placeholderData: keepPreviousData,
	});

	const entries = list.data?.pages.flat() ?? [];
	const byId = new Map(agents.map((a) => [a.id, a]));
	const hasLocalFilters = Boolean(search.trim() || status !== "all" || risk !== "all" || decidedBy !== "all");
	const filtered = hasLocalFilters || Boolean(agentId);
	const showPerson = admin && scope === "all";
	const othersToo = admin && scope !== "me";
	const filterCount = [scope !== "me", status !== "all", risk !== "all", decidedBy !== "all"].filter(Boolean).length;
	const showFilters = !phone || filtersOpen;

	const clearFilters = () => {
		setSearch("");
		setQ("");
		setStatus("all");
		setRisk("all");
		setDecidedBy("all");
	};

	const triggerDownload = (format: "csv" | "jsonl") => {
		const a = document.createElement("a");
		a.href = api.activity.exportUrl(filters, format);
		a.download = "";
		a.click();
	};

	const exportEntries: MenuEntry[] = [
		{ label: "Export CSV", icon: <Download />, onSelect: () => triggerDownload("csv") },
		{ label: "Export JSON lines", icon: <Download />, onSelect: () => triggerDownload("jsonl") },
	];

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-col gap-2">
				<div className="flex items-center gap-2">
					<SearchInput
						value={search}
						onValueChange={setSearch}
						label="Search the activity log"
						placeholder={phone ? "Search the log" : "Search actions, tools or details…"}
						loading={search.trim() !== q || list.isPlaceholderData}
						className="flex-1"
					/>
					{phone && (
						<Button
							variant="secondary"
							size="sm"
							aria-expanded={filtersOpen}
							onClick={() => setFiltersOpen((v) => !v)}
						>
							<SlidersHorizontal /> Filters{filterCount ? ` (${filterCount})` : ""}
						</Button>
					)}
					<DropdownMenu>
						<DropdownTrigger asChild>
							{phone ? (
								<IconButton label="Export" variant="secondary" size="icon-sm">
									<Download />
								</IconButton>
							) : (
								<Button variant="secondary" size="sm">
									<Download /> Export
								</Button>
							)}
						</DropdownTrigger>
						<DropdownContent title="Export log">
							<DropdownEntries entries={exportEntries} />
						</DropdownContent>
					</DropdownMenu>
				</div>
				{showFilters && (
					<div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
						{admin && (
							<Select
								size="sm"
								label="Whose activity"
								value={scope}
								onValueChange={(v) => setPickedScope(v === selfId ? "me" : v)}
								options={scopeOptions}
								className="w-full sm:w-40"
							/>
						)}
						<Select
							size="sm"
							label="Outcome"
							value={status}
							onValueChange={setStatus}
							options={[
								{ value: "all", label: "Any outcome" },
								{ value: "done", label: "Done" },
								{ value: "error", label: "Failed" },
								{ value: "denied", label: "Denied" },
							]}
							className="w-full sm:w-36"
						/>
						<Select
							size="sm"
							label="Risk"
							value={risk}
							onValueChange={setRisk}
							options={[
								{ value: "all", label: "Any risk" },
								{ value: "read", label: "Read" },
								{ value: "write", label: "Write" },
								{ value: "external", label: "Outside Sekai" },
								{ value: "destructive", label: "Destructive" },
							]}
							className="w-full sm:w-36"
						/>
						<Select
							size="sm"
							label="Decided by"
							value={decidedBy}
							onValueChange={setDecidedBy}
							options={[
								{ value: "all", label: "Decided by anyone" },
								{ value: "user", label: othersToo ? "Decided by a person" : "Decided by you" },
								{ value: "rule", label: "By a tool's rule" },
								{ value: "mode", label: "By the approvals rule" },
								{ value: "reviewer", label: "By the reviewer" },
								{ value: "primary", label: "By the primary bot" },
								{ value: "timeout", label: "No answer in time" },
							]}
							className={cn("w-full sm:w-44", !admin && "max-sm:col-span-2")}
						/>
					</div>
				)}
			</div>

			<div
				aria-busy={list.isPlaceholderData}
				className={cn("transition-opacity duration-fast", list.isPlaceholderData && "opacity-60")}
			>
				{list.isLoading ? (
					<SkeletonRows count={6} />
				) : list.isError ? (
					<ErrorState
						title="Activity log didn't load"
						error={list.error}
						onRetry={() => void list.refetch()}
					/>
				) : entries.length === 0 ? (
					<EmptyState
						icon={<ScrollText />}
						title={filtered ? "Nothing matches" : "No actions logged yet"}
						description={
							filtered
								? "Try different search words or filters."
								: "Every tool a bot uses shows up here, with who allowed it."
						}
						action={
							hasLocalFilters ? (
								<Button variant="secondary" onClick={clearFilters}>
									Clear filters
								</Button>
							) : undefined
						}
					/>
				) : phone ? (
					<List label="Activity log">
						{entries.map((e) => {
							const a = e.agentId ? byId.get(e.agentId) : undefined;
							const botName = a?.name ?? e.agentName ?? (e.agentId ? "A deleted bot" : "Sekai");
							return (
								<MobileLogRow
									key={e.id}
									e={e}
									botName={botName}
									showPerson={showPerson}
									selfId={selfId}
									avatar={a?.avatar}
									open={expandedId === e.id}
									onToggle={() => setExpandedId((cur) => (cur === e.id ? null : e.id))}
								/>
							);
						})}
					</List>
				) : (
					/* Wide screens: a real data table (DESIGN.md "Big data stays a real table on wide screens"). */
					<div className="overflow-hidden rounded-lg border border-border bg-surface">
						<table className="w-full border-collapse text-left">
							<thead>
								<tr className="border-b border-border bg-surface-2/40 text-caption font-medium text-fg-subtle">
									<th className="py-2.5 pr-3 pl-4 font-medium">Action</th>
									<th className="px-3 py-2.5 font-medium">{showPerson ? "Bot & person" : "Bot"}</th>
									<th className="px-3 py-2.5 font-medium">Decision</th>
									<th className="px-3 py-2.5 font-medium">Risk</th>
									<th className="py-2.5 pr-4 pl-3 text-right font-medium">When</th>
								</tr>
							</thead>
							<tbody>
								{entries.map((e) => {
									const a = e.agentId ? byId.get(e.agentId) : undefined;
									const botName = a?.name ?? e.agentName ?? (e.agentId ? "A deleted bot" : "Sekai");
									const decided = decisionText(e, selfId);
									const open = expandedId === e.id;
									const toggle = () => setExpandedId((cur) => (cur === e.id ? null : e.id));
									return (
										<Fragment key={e.id}>
											<tr
												onClick={toggle}
												className={cn(
													"cursor-pointer border-t border-border transition-colors duration-fast first:border-t-0 hover:bg-surface-2/50",
													open && "bg-surface-2/40",
												)}
											>
												{/* Takes the room the other columns leave, and truncates (max-w-0 lets it shrink). */}
												<td className="w-full max-w-0 py-2.5 pr-3 pl-4">
													<button
														type="button"
														aria-expanded={open}
														onClick={(ev) => {
															ev.stopPropagation();
															toggle();
														}}
														className="flex w-full min-w-0 items-center gap-2.5 text-left outline-none focus-visible:underline"
													>
														<Outcome e={e} />
														<span className="block min-w-0 flex-1 truncate text-body font-medium text-fg">
															{toolOutcome(e.title, e.status)}
														</span>
													</button>
												</td>
												<td className="px-3 py-2.5 whitespace-nowrap">
													<div className="flex items-center gap-2">
														{a?.avatar ? (
															<AgentAvatar avatar={a.avatar} size={24} />
														) : (
															<span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-2 text-caption font-semibold text-fg-muted">
																{botName.slice(0, 1).toUpperCase()}
															</span>
														)}
														<div className="min-w-0">
															<div className="max-w-36 truncate text-body text-fg">
																{botName}
															</div>
															{showPerson && e.userName && (
																<div className="max-w-36 truncate text-caption text-fg-subtle">
																	{e.userName}
																</div>
															)}
														</div>
													</div>
												</td>
												<td className="px-3 py-2.5 text-small whitespace-nowrap text-fg-muted">
													{decided ?? <span className="text-fg-subtle">—</span>}
												</td>
												<td className="px-3 py-2.5 whitespace-nowrap">
													{e.risk && e.risk !== "read" ? (
														<Badge tone={RISK_TONE[e.risk]}>{RISK_LABEL[e.risk]}</Badge>
													) : e.risk === "read" ? (
														<span className="text-small text-fg-subtle">Read</span>
													) : (
														<span className="text-small text-fg-subtle">—</span>
													)}
												</td>
												<td className="py-2.5 pr-4 pl-3 text-right whitespace-nowrap">
													<div className="inline-flex items-center gap-2">
														<Tooltip content={dateTime(e.at)}>
															<span className="text-caption text-fg-subtle tabular-nums">
																{shortTime(e.at)}
															</span>
														</Tooltip>
														<ChevronRight
															aria-hidden
															className={cn(
																"size-4 text-fg-subtle transition-transform duration-fast",
																open && "rotate-90",
															)}
														/>
													</div>
												</td>
											</tr>
											{open && (
												<tr>
													<td colSpan={5} className="p-0">
														<EntryDetails
															e={e}
															selfId={selfId}
															className="border-t border-border bg-surface-2/35 px-4 py-3"
														/>
													</td>
												</tr>
											)}
										</Fragment>
									);
								})}
							</tbody>
						</table>
					</div>
				)}
			</div>

			{list.hasNextPage && (
				<Button
					variant="secondary"
					className="self-center"
					onClick={() => void list.fetchNextPage()}
					loading={list.isFetchingNextPage}
				>
					Show older
				</Button>
			)}
		</div>
	);
}
