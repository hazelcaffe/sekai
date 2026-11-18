import { cn, formatTokens, pluralize } from "@sekai/client";
import type { UsageReport } from "@sekai/shared";
import { Skeleton, Tooltip } from "@sekai/ui";
import type { ReactNode } from "react";
import { change, money, seconds, tokensOf } from "./format.ts";
import { percent } from "./ui.tsx";

function Stat({
	label,
	value,
	detail,
	delta,
	className,
}: {
	label: string;
	value: ReactNode;
	detail?: ReactNode;
	delta?: ReactNode;
	className?: string;
}) {
	return (
		<div className={cn("min-w-0 rounded-2xl border border-border bg-card px-4 py-3.5", className)}>
			<div className="flex items-center gap-2">
				<span className="truncate text-[13px] text-fg-muted">{label}</span>
				{delta && <span className="ml-auto shrink-0">{delta}</span>}
			</div>
			<div className="mt-0.5 truncate text-[22px] leading-8 font-semibold tracking-tight tabular-nums">
				{value}
			</div>
			{detail && <div className="text-xs leading-5 text-pretty text-fg-subtle">{detail}</div>}
		</div>
	);
}

/**
 * ▲ 12% / ▼ 8% against the same length of time just before. Spending more is amber, less is green; with nothing
 * to compare with it stays grey.
 */
function Delta({
	now,
	before,
	format,
	period,
}: {
	now: number;
	before: number;
	format: (n: number) => string;
	period: string;
}) {
	const c = change(now, before);
	if (c === null && !now) return null;
	const tip = `${format(before)} in ${period}`;
	let text: string;
	let tone: string;
	let label: string;
	if (c === null) {
		text = "New";
		tone = "bg-muted text-fg-muted";
		label = `Nothing in ${period}`;
	} else if (Math.abs(c) < 0.005) {
		text = "Same";
		tone = "bg-muted text-fg-muted";
		label = `About the same as ${period}`;
	} else {
		const pct = Math.abs(c) >= 9.995 ? `${Math.round(now / before)}×` : `${Math.round(Math.abs(c) * 100)}%`;
		text = `${c > 0 ? "▲" : "▼"} ${pct}`;
		tone = c > 0 ? "bg-warning/12 text-warning" : "bg-success/12 text-success";
		label = `${c > 0 ? "Up" : "Down"} ${pct} from ${period}`;
	}
	return (
		<Tooltip content={c === null ? label : `${label} (${tip})`}>
			<span
				className={cn(
					"inline-flex h-5 items-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums",
					tone,
				)}
			>
				<span aria-hidden>{text}</span>
				<span className="sr-only">{label}</span>
			</span>
		</Tooltip>
	);
}

export function StatCards({ r, before }: { r: UsageReport; before: string }) {
	const t = r.totals;
	const p = r.previous;
	const showCost = t.cost !== null || p.cost !== null;
	const reply = r.byPurpose.find((x) => x.purpose === "reply");
	const background = r.byPurpose.find((x) => x.purpose === "background");
	const priced = r.byModel.filter((m) => m.price).length;
	const finished = r.runs.done + r.runs.error;
	const extra = [
		t.cachedTokens ? `${formatTokens(t.cachedTokens)} cached` : "",
		t.reasoningTokens ? `${formatTokens(t.reasoningTokens)} reasoning` : "",
	].filter(Boolean);

	return (
		// With cost: three cards with a comparison on top, the two about replies under them.
		<div className={cn("grid grid-cols-2 gap-3", showCost ? "sm:grid-cols-6" : "lg:grid-cols-4")}>
			<Stat
				className={showCost ? "col-span-2" : undefined}
				label="Tokens"
				value={formatTokens(tokensOf(t))}
				delta={<Delta now={tokensOf(t)} before={tokensOf(p)} format={formatTokens} period={before} />}
				detail={
					<>
						{formatTokens(t.inputTokens)} in · {formatTokens(t.outputTokens)} out
						{extra.length > 0 && ` · ${extra.join(" · ")}`}
					</>
				}
			/>
			{showCost && (
				<Stat
					className="sm:col-span-2"
					label="Cost"
					value={t.cost !== null ? money(t.cost) : "—"}
					delta={<Delta now={t.cost ?? 0} before={p.cost ?? 0} format={money} period={before} />}
					detail={
						t.cost === null
							? "None of the models used has a price"
							: priced < r.byModel.length
								? `For ${pluralize(priced, "model")} with a price`
								: "At your prices"
					}
				/>
			)}
			<Stat
				className={showCost ? "sm:col-span-2" : undefined}
				label="Model calls"
				value={t.calls.toLocaleString()}
				delta={<Delta now={t.calls} before={p.calls} format={(n) => n.toLocaleString()} period={before} />}
				detail={`${(reply?.calls ?? 0).toLocaleString()} replies · ${(background?.calls ?? 0).toLocaleString()} background`}
			/>
			<Stat
				className={showCost ? "sm:col-span-3" : undefined}
				label="Replies"
				value={r.runs.total.toLocaleString()}
				detail={
					finished
						? `${percent(r.runs.done, finished)}% finished${r.runs.error ? ` · ${r.runs.error} failed` : ""}`
						: "None yet"
				}
			/>
			<Stat
				className={showCost ? "sm:col-span-3" : undefined}
				label="Average reply"
				value={r.runs.avgSeconds !== null ? seconds(r.runs.avgSeconds) : "—"}
				detail={r.runs.done ? "From start to finish" : "No finished replies yet"}
			/>
		</div>
	);
}

export function StatCardsSkeleton() {
	return (
		<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
			{[0, 1, 2, 3].map((i) => (
				<Skeleton key={i} className="h-[98px] rounded-2xl" />
			))}
		</div>
	);
}
