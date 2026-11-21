import { api, cn, useAuth } from "@sekai/client";
import type { UsageScope } from "@sekai/shared";
import { Button, EmptyState, ErrorState, Page, Segmented, Select, Skeleton } from "@sekai/ui";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChartColumnStacked, Download } from "lucide-react";
import { type ReactNode, useMemo, useRef, useState } from "react";
import { BotList, ModelList, PeopleList, Triggers } from "./usage/Breakdowns.tsx";
import { chartRows, RANGES, type Range } from "./usage/format.ts";
import { Heatmap } from "./usage/Heatmap.tsx";
import { LimitsCard } from "./usage/LimitsCard.tsx";
import { SplitCard } from "./usage/SplitCard.tsx";
import { StatCards, StatCardsSkeleton } from "./usage/StatCards.tsx";
import { useNames } from "./usage/series.ts";
import { TokensCard } from "./usage/TokensCard.tsx";
import { Panel } from "./usage/ui.tsx";
import "./usage/usage.css";
import type { SettingsSectionProps } from "../section.ts";

function Toolbar({
	range,
	onRange,
	scope,
	onScope,
	admin,
	selfId,
	scopeName,
}: {
	range: Range;
	onRange: (r: Range) => void;
	scope: UsageScope;
	onScope: (s: UsageScope) => void;
	admin: boolean;
	selfId: string | null;
	scopeName: string | null;
}) {
	const people = useQuery({
		queryKey: ["usage", "people"],
		queryFn: api.admin.users,
		enabled: admin,
		staleTime: 5 * 60_000,
	});
	const options = [
		{ value: "me", label: "Just me" },
		{ value: "all", label: "Everyone" },
		...(people.data ?? [])
			.filter((u) => u.id !== selfId)
			.sort((a, b) => a.name.localeCompare(b.name))
			.map((u) => ({ value: u.id, label: u.name })),
	];
	// Picked from the list before the people load: still say who.
	if (!options.some((o) => o.value === scope)) options.push({ value: scope, label: scopeName ?? "Someone" });

	return (
		<div className="flex flex-wrap items-center gap-2">
			<Segmented<Range>
				value={range}
				label="Time range"
				onValueChange={onRange}
				options={RANGES.map((r) => ({
					value: r.value,
					label: (
						<>
							<span className="sm:hidden">{r.short}</span>
							<span className="max-sm:hidden">{r.label}</span>
						</>
					),
				}))}
			/>
			{admin && (
				<Select
					size="sm"
					label="Whose usage"
					value={scope}
					onValueChange={onScope}
					options={options}
					className="w-40 max-w-full"
				/>
			)}
			<Button asChild size="sm" variant="ghost" className="ml-auto">
				<a href={api.usage.exportUrl(Number(range), scope)} download>
					<Download />
					<span>
						<span className="max-xs:hidden">Download </span>CSV
					</span>
				</a>
			</Button>
		</div>
	);
}

function LoadingBody() {
	return (
		<>
			<StatCardsSkeleton />
			<div className="flex flex-col gap-4">
				<Skeleton className="h-6 w-40 rounded-md" />
				<Skeleton className="h-[330px] rounded-lg" />
			</div>
			<Skeleton className="h-64 rounded-lg" />
			<Skeleton className="h-56 rounded-lg" />
		</>
	);
}

export function UsageSection({ back }: SettingsSectionProps) {
	const { data: auth } = useAuth();
	const access = auth?.access ?? null;
	const admin = access?.admin ?? false;
	const selfId = access?.userId ?? null;
	const [range, setRange] = useState<Range>("30");
	const [picked, setPicked] = useState<UsageScope>("me");
	const scope: UsageScope = admin ? picked : "me";
	const top = useRef<HTMLDivElement>(null);
	const days = Number(range);

	const q = useQuery({
		queryKey: ["usage", days, scope],
		queryFn: () => api.usage.report(days, scope),
		refetchInterval: 60_000,
		placeholderData: keepPreviousData,
	});
	const r = q.data;
	const names = useNames();
	const chart = useMemo(() => (r ? chartRows(r) : null), [r]);
	const stale = q.isPlaceholderData;
	const before = RANGES.find((x) => x.value === range)?.before ?? "the period before";

	const pickScope = (s: UsageScope) => {
		setPicked(s === selfId ? "me" : s);
		top.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
	};

	let body: ReactNode;
	if (!r || !chart) {
		body = q.isError ? (
			<ErrorState title="Usage didn't load" error={q.error} onRetry={() => void q.refetch()} />
		) : (
			<LoadingBody />
		);
	} else {
		const empty = r.totals.calls === 0;
		body = (
			<>
				<StatCards r={r} before={before} />
				{r.limits && <LimitsCard limits={r.limits} />}
				{empty ? (
					<Panel className="p-0">
						<EmptyState
							icon={<ChartColumnStacked />}
							title="No usage in this period"
							description="Tokens appear here as soon as bots reply or run background work."
							action={
								range !== "365" ? (
									<Button variant="secondary" size="sm" onClick={() => setRange("365")}>
										Show last year
									</Button>
								) : undefined
							}
						/>
					</Panel>
				) : (
					<>
						<TokensCard r={r} rows={chart.rows} grain={chart.grain} names={names} />
						<SplitCard r={r} rows={chart.rows} grain={chart.grain} />
						<Heatmap r={r} />
						{r.scope.kind === "all" && <PeopleList r={r} selfId={selfId} onPick={pickScope} />}
						<BotList r={r} names={names} />
						<ModelList r={r} names={names} canPrice={admin} />
						<Triggers r={r} />
					</>
				)}
			</>
		);
	}

	return (
		<Page
			back={back}
			title="Usage"
			description="Tokens, replies and cost over time, by bot and model."
			width="wide"
		>
			<div ref={top} className="-mb-4 flex scroll-mt-24 flex-col gap-3">
				<Toolbar
					range={range}
					onRange={setRange}
					scope={scope}
					onScope={pickScope}
					admin={admin}
					selfId={selfId}
					scopeName={r?.scope.name ?? null}
				/>
				{r?.scope.kind === "user" && (
					<p className="text-small text-fg-muted">
						Showing <span className="font-medium text-fg">{r.scope.name}</span>'s usage.{" "}
						<button
							type="button"
							onClick={() => pickScope("all")}
							className="font-medium text-brand-ink hover:underline"
						>
							Back to everyone
						</button>
					</p>
				)}
			</div>
			<div
				aria-busy={stale || q.isLoading}
				className={cn(
					"flex flex-col gap-8 transition-opacity duration-fast motion-reduce:transition-none",
					stale && "opacity-60",
				)}
			>
				{body}
			</div>
		</Page>
	);
}
