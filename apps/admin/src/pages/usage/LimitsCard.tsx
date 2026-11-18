import { formatTokens } from "@sekai/client";
import type { UsageReport } from "@sekai/shared";
import { Section } from "@sekai/ui";
import { money } from "./format.ts";
import { Meter, Panel, percent } from "./ui.tsx";

type Limits = NonNullable<UsageReport["limits"]>;

/** Nearly used up turns amber, then red at the limit. */
const toneOf = (used: number, limit: number) =>
	used >= limit ? "var(--danger)" : used / limit >= 0.8 ? "var(--warning)" : "var(--brand)";

function LimitRow({
	label,
	used,
	limit,
	format,
}: {
	label: string;
	used: number;
	limit: number;
	format: (n: number) => string;
}) {
	const pct = percent(used, limit);
	return (
		<div>
			<div className="flex items-baseline gap-2 text-sm">
				<span className="font-medium">{label}</span>
				<span className="ml-auto text-xs text-fg-muted tabular-nums">
					{format(used)} of {format(limit)}
					<span className="text-fg-subtle"> · {Math.min(pct, 100)}%</span>
				</span>
			</div>
			<div
				role="progressbar"
				aria-label={label}
				aria-valuemin={0}
				aria-valuemax={limit}
				aria-valuenow={Math.min(used, limit)}
				aria-valuetext={`${format(used)} of ${format(limit)}`}
			>
				<Meter value={used} max={limit} color={toneOf(used, limit)} className="mt-1.5 h-2" />
			</div>
		</div>
	);
}

/** A member's own limits (from their role) and how much of each is used. */
export function LimitsCard({ limits: l }: { limits: Limits }) {
	const rows = [
		l.tokensPerDay !== null && (
			<LimitRow
				key="day"
				label="Tokens today"
				used={l.tokensToday}
				limit={l.tokensPerDay}
				format={formatTokens}
			/>
		),
		l.tokensPerMonth !== null && (
			<LimitRow
				key="month"
				label="Tokens this month"
				used={l.tokensMonth}
				limit={l.tokensPerMonth}
				format={formatTokens}
			/>
		),
		l.costPerMonth !== null && (
			<LimitRow
				key="cost"
				label="Cost this month"
				used={l.costMonth ?? 0}
				limit={l.costPerMonth}
				format={money}
			/>
		),
	].filter(Boolean);
	if (rows.length === 0) return null;
	const out =
		(l.tokensPerDay !== null && l.tokensToday >= l.tokensPerDay) ||
		(l.tokensPerMonth !== null && l.tokensMonth >= l.tokensPerMonth) ||
		(l.costPerMonth !== null && (l.costMonth ?? 0) >= l.costPerMonth);
	return (
		<Section
			title="Your limits"
			description="Set by your role. Today's tokens start over at midnight, the monthly ones on the 1st."
		>
			<Panel className="flex flex-col gap-4">
				{rows}
				{out && (
					<p className="text-xs text-danger">
						You've reached a limit, so your bots can't answer for now. Ask an admin if you need more.
					</p>
				)}
			</Panel>
		</Section>
	);
}
