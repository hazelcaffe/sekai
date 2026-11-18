import { cn, formatTokens } from "@sekai/client";
import type { UsageReport } from "@sekai/shared";
import { Section } from "@sekai/ui";
import { Fragment, useState } from "react";
import { hourLabel, WEEKDAYS } from "./format.ts";
import { Panel } from "./ui.tsx";

/** Brand color, stronger the more tokens; the square root keeps quiet hours from vanishing next to a busy one. */
const shade = (v: number, max: number) =>
	v <= 0 || max <= 0
		? "var(--muted)"
		: `color-mix(in oklab, var(--brand) ${Math.round(16 + 84 * Math.sqrt(v / max))}%, var(--muted))`;

const span = (d: number, h: number) => `${WEEKDAYS[d]?.long ?? ""}, ${hourLabel(h)} – ${hourLabel((h + 1) % 24)}`;

/** Weekday × hour, Monday first, in the report's time zone. Hover or tap a square for its tokens. */
export function Heatmap({ r }: { r: UsageReport }) {
	const [active, setActive] = useState<[number, number] | null>(null);
	let max = 0;
	let busiest: [number, number] | null = null;
	for (const [d, row] of r.heatmap.entries()) {
		for (const [h, v] of row.entries()) {
			if (v > max) {
				max = v;
				busiest = [d, h];
			}
		}
	}
	const value = active ? (r.heatmap[active[0]]?.[active[1]] ?? 0) : 0;

	return (
		<Section
			title="When it's busy"
			description={`Tokens by weekday and hour, in ${r.timezone.replace(/_/g, " ")}.`}
		>
			<Panel>
				<figure aria-label="Tokens by weekday and hour" className="overflow-x-auto scrollbar-thin">
					<div
						className="grid min-w-[17rem] gap-[2px] sm:gap-[3px]"
						style={{ gridTemplateColumns: "2.25rem repeat(24, minmax(0, 1fr))" }}
						onPointerLeave={(e) => {
							if (e.pointerType === "mouse") setActive(null);
						}}
					>
						{r.heatmap.map((row, d) => (
							<Fragment key={WEEKDAYS[d]?.long ?? d}>
								<div className="self-center pr-1.5 text-[11px] leading-none text-fg-subtle">
									{WEEKDAYS[d]?.short}
								</div>
								{row.map((v, h) => {
									const label = `${span(d, h)}: ${formatTokens(v)} tokens`;
									const on = active?.[0] === d && active[1] === h;
									return (
										<div
											// biome-ignore lint/suspicious/noArrayIndexKey: the hour is the key
											key={h}
											role="img"
											aria-label={label}
											title={label}
											onPointerEnter={() => setActive([d, h])}
											className={cn(
												"aspect-[3/4] rounded-[3px] transition-shadow sm:aspect-square",
												on && "ring-2 ring-fg/50 ring-offset-1 ring-offset-card",
											)}
											style={{ background: shade(v, max) }}
										/>
									);
								})}
							</Fragment>
						))}
						<div />
						{Array.from({ length: 8 }, (_, i) => (
							<div
								key={hourLabel(i * 3)}
								className={cn(
									"col-span-3 pt-1 text-[10px] whitespace-nowrap text-fg-subtle",
									i % 2 === 1 && "max-sm:invisible",
								)}
							>
								{hourLabel(i * 3)}
							</div>
						))}
					</div>
				</figure>
				<div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
					<span className="min-h-5 flex-1 basis-56 text-fg-muted tabular-nums" aria-live="polite">
						{active ? (
							<>
								{span(active[0], active[1])}:{" "}
								<span className="font-medium text-fg">{formatTokens(value)} tokens</span>
							</>
						) : busiest ? (
							<>
								Busiest: <span className="font-medium text-fg">{WEEKDAYS[busiest[0]]?.long}s</span>{" "}
								around {hourLabel(busiest[1])}
							</>
						) : (
							"Quiet all week"
						)}
					</span>
					<span className="inline-flex items-center gap-1 text-fg-subtle" aria-hidden>
						Less
						{[0, 0.08, 0.3, 0.6, 1].map((f) => (
							<span key={f} className="size-2.5 rounded-[3px]" style={{ background: shade(f, 1) }} />
						))}
						More
					</span>
				</div>
			</Panel>
		</Section>
	);
}
