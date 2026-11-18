import { formatTokens } from "@sekai/client";
import type { UsageReport } from "@sekai/shared";
import { Section } from "@sekai/ui";
import { Suspense } from "react";
import { type ChartRow, calls, type Grain, money, tokensOf } from "./format.ts";
import { BACKGROUND, REPLY } from "./series.ts";
import { ChartFallback, Panel, percent, SplitChart, Swatch, useNarrow } from "./ui.tsx";

const HEIGHT = 150;

/** Replies against background work (titles, memory, reviews…): the share of each, and both over time. */
export function SplitCard({ r, rows, grain }: { r: UsageReport; rows: ChartRow[]; grain: Grain }) {
	const narrow = useNarrow();
	const total = tokensOf(r.totals);
	const parts = [
		{ id: "reply", label: "Replies", color: REPLY, t: r.byPurpose.find((p) => p.purpose === "reply") },
		{
			id: "background",
			label: "Background",
			color: BACKGROUND,
			t: r.byPurpose.find((p) => p.purpose === "background"),
		},
	] as const;

	return (
		<Section
			title="Replies and background work"
			description="Replies are bots answering, with their tools and advisors. Background is titles, memory, reviews and other upkeep."
		>
			<Panel className="px-2 pt-4 pb-3 sm:px-4">
				<div className="grid grid-cols-2 gap-3 px-2 sm:px-0">
					{parts.map((p) => {
						const n = p.t ? tokensOf(p.t) : 0;
						return (
							<div key={p.id} className="min-w-0">
								<div className="flex items-center gap-1.5 text-[13px] text-fg-muted">
									<Swatch color={p.color} />
									{p.label}
								</div>
								<div className="mt-0.5 flex items-baseline gap-1.5">
									<span className="text-lg font-semibold tracking-tight tabular-nums">
										{formatTokens(n)}
									</span>
									<span className="text-xs text-fg-subtle tabular-nums">{percent(n, total)}%</span>
								</div>
								<div className="truncate text-xs text-fg-subtle tabular-nums">
									{calls(p.t?.calls ?? 0)}
									{p.t?.cost != null ? ` · ${money(p.t.cost)}` : ""}
								</div>
							</div>
						);
					})}
				</div>
				<div className="mx-2 mt-3 flex h-2 overflow-hidden rounded-full bg-muted sm:mx-0" aria-hidden>
					{parts.map((p) => (
						<div
							key={p.id}
							className="h-full transition-[width] duration-500"
							style={{
								width: `${total ? ((p.t ? tokensOf(p.t) : 0) / total) * 100 : 0}%`,
								background: p.color,
							}}
						/>
					))}
				</div>
				<div className="mt-4">
					<Suspense fallback={<ChartFallback height={HEIGHT} />}>
						<SplitChart rows={rows} grain={grain} narrow={narrow} height={HEIGHT} />
					</Suspense>
				</div>
			</Panel>
		</Section>
	);
}
