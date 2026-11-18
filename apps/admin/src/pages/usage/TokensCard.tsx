import { cn, formatTokens } from "@sekai/client";
import type { UsageReport } from "@sekai/shared";
import { Section, Segmented } from "@sekai/ui";
import { Suspense, useMemo, useState } from "react";
import { type ChartRow, type Grain, money } from "./format.ts";
import { buildSeries, type Names, type Stack } from "./series.ts";
import { ChartFallback, Panel, TokensChart, useNarrow } from "./ui.tsx";

const PER: Record<Grain, string> = { hour: "hour", day: "day", week: "week" };
const HEIGHT = 260;

/** The main chart: tokens per hour, day or week, stacked by model or by bot, and the cost line. */
export function TokensCard({
	r,
	rows,
	grain,
	names,
}: {
	r: UsageReport;
	rows: ChartRow[];
	grain: Grain;
	names: Names;
}) {
	const [stack, setStack] = useState<Stack>("model");
	const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
	const narrow = useNarrow();
	const series = useMemo(() => buildSeries(r, rows, stack, names), [r, rows, stack, names]);
	const visible = series.filter((s) => !hidden.has(s.id));
	const showCost = r.totals.cost !== null;
	const toggle = (id: string) =>
		setHidden((h) => {
			const next = new Set(h);
			if (!next.delete(id)) next.add(id);
			return next;
		});

	return (
		<Section
			title="Tokens over time"
			description={`Per ${PER[grain]}, in ${r.timezone.replace(/_/g, " ")}. Tap a name to hide it.`}
			action={
				<Segmented<Stack>
					value={stack}
					onValueChange={(s) => {
						setStack(s);
						setHidden(new Set());
					}}
					size="sm"
					options={[
						{ value: "model", label: "By model" },
						{ value: "agent", label: "By bot" },
					]}
				/>
			}
		>
			<Panel className="px-2 pt-3 pb-3 sm:px-4">
				<Suspense fallback={<ChartFallback height={HEIGHT} />}>
					<TokensChart
						rows={rows}
						series={visible}
						stack={stack}
						grain={grain}
						showCost={showCost}
						narrow={narrow}
						height={HEIGHT}
					/>
				</Suspense>
				<ul className="mt-3 flex flex-wrap gap-1.5 px-2 sm:px-0">
					{series.map((s) => {
						const off = hidden.has(s.id);
						return (
							<li key={s.id}>
								<button
									type="button"
									aria-pressed={!off}
									onClick={() => toggle(s.id)}
									className={cn(
										"inline-flex max-w-full items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs transition-colors hover:bg-muted coarse:py-1.5",
										off && "text-fg-subtle",
									)}
								>
									<span
										aria-hidden
										className={cn("size-2.5 shrink-0 rounded-[3px]", off && "opacity-30")}
										style={{ background: s.color }}
									/>
									<span className={cn("max-w-44 truncate", off && "line-through")}>{s.name}</span>
									<span className="text-fg-subtle tabular-nums">{formatTokens(s.total)}</span>
								</button>
							</li>
						);
					})}
					{showCost && (
						<li className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs">
							<span aria-hidden className="h-0.5 w-3 rounded-full bg-fg/75" />
							Cost
							<span className="text-fg-subtle tabular-nums">{money(r.totals.cost ?? 0)}</span>
						</li>
					)}
				</ul>
			</Panel>
		</Section>
	);
}
