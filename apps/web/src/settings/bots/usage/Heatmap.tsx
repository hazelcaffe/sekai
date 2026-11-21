import { cn, formatTokens } from "@sekai/client";
import type { UsageReport } from "@sekai/shared";
import { Section } from "@sekai/ui";
import { Fragment, type KeyboardEvent, useRef, useState } from "react";
import { hourLabel, WEEKDAYS } from "./format.ts";
import { Panel } from "./ui.tsx";

/** Brand color, stronger the more tokens; the square root keeps quiet hours from vanishing next to a busy one. */
const shade = (v: number, max: number) =>
	v <= 0 || max <= 0
		? "var(--surface-2)"
		: `color-mix(in oklab, var(--brand) ${Math.round(16 + 84 * Math.sqrt(v / max))}%, var(--surface-2))`;

const span = (d: number, h: number) => `${WEEKDAYS[d]?.long ?? ""}, ${hourLabel(h)} – ${hourLabel((h + 1) % 24)}`;

const KEYS: Record<string, [number, number]> = {
	ArrowLeft: [0, -1],
	ArrowRight: [0, 1],
	ArrowUp: [-1, 0],
	ArrowDown: [1, 0],
};

/**
 * Weekday × hour, Monday first, in the report's time zone. Hover, focus or tap a square for its tokens. The squares
 * are one stop for the keyboard (the arrow keys move between them), not 168.
 */
export function Heatmap({ r }: { r: UsageReport }) {
	const [active, setActive] = useState<[number, number] | null>(null);
	const [current, setCurrent] = useState<[number, number]>([0, 0]);
	const cells = useRef(new Map<number, HTMLButtonElement>());
	const onKey = (e: KeyboardEvent, d: number, h: number) => {
		const step = KEYS[e.key];
		const days = r.heatmap.length;
		const next: [number, number] | null = step
			? [Math.min(Math.max(d + step[0], 0), days - 1), Math.min(Math.max(h + step[1], 0), 23)]
			: e.key === "Home"
				? [d, 0]
				: e.key === "End"
					? [d, 23]
					: null;
		if (!next) return;
		e.preventDefault();
		setCurrent(next);
		cells.current.get(next[0] * 24 + next[1])?.focus();
	};
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
								<div className="self-center pr-1.5 text-caption leading-none text-fg-subtle">
									{WEEKDAYS[d]?.short}
								</div>
								{row.map((v, h) => {
									const label = `${span(d, h)}: ${formatTokens(v)} tokens`;
									const on = active?.[0] === d && active[1] === h;
									return (
										<button
											// biome-ignore lint/suspicious/noArrayIndexKey: the hour is the key
											key={h}
											type="button"
											aria-label={label}
											tabIndex={current[0] === d && current[1] === h ? 0 : -1}
											ref={(el) => {
												if (el) cells.current.set(d * 24 + h, el);
												else cells.current.delete(d * 24 + h);
											}}
											onKeyDown={(e) => onKey(e, d, h)}
											onPointerEnter={() => setActive([d, h])}
											onFocus={() => {
												setCurrent([d, h]);
												setActive([d, h]);
											}}
											onClick={() => setActive([d, h])}
											className={cn(
												"aspect-[3/4] rounded-sm outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring sm:aspect-square",
												on && "ring-2 ring-fg/50 ring-offset-1 ring-offset-surface",
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
									"col-span-3 pt-1 text-caption whitespace-nowrap text-fg-subtle",
									i % 2 === 1 && "max-sm:invisible",
								)}
							>
								{hourLabel(i * 3)}
							</div>
						))}
					</div>
				</figure>
				<div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-small">
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
							<span key={f} className="size-2.5 rounded-sm" style={{ background: shade(f, 1) }} />
						))}
						More
					</span>
				</div>
			</Panel>
		</Section>
	);
}
