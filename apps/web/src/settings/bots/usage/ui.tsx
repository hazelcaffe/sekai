import { cn } from "@sekai/client";
import { Skeleton, useMediaQuery } from "@sekai/ui";
import { lazy, type ReactNode } from "react";

/** recharts arrives in its own chunk, the first time a chart shows. */
const charts = () => import("./charts.tsx");
export const TokensChart = lazy(() => charts().then((m) => ({ default: m.TokensChart })));
export const SplitChart = lazy(() => charts().then((m) => ({ default: m.SplitChart })));

export function ChartFallback({ height }: { height: number }) {
	return <Skeleton className="w-full rounded-lg" style={{ height }} />;
}

/** Phone-sized: charts drop their second axis and pack their labels tighter. */
export function useNarrow(): boolean {
	return useMediaQuery("(max-width: 639px)");
}

export function useReducedMotion(): boolean {
	return useMediaQuery("(prefers-reduced-motion: reduce)");
}

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
	return <div className={cn("rounded-lg border border-border bg-surface p-4", className)}>{children}</div>;
}

/** A thin bar for a share of the biggest (or of a limit). */
export function Meter({
	value,
	max,
	color,
	className,
}: {
	value: number;
	max: number;
	color?: string;
	className?: string;
}) {
	const pct = max > 0 ? Math.min(100, Math.max(value > 0 ? 2 : 0, (value / max) * 100)) : 0;
	return (
		<div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-surface-2", className)}>
			<div
				className={cn(
					"h-full rounded-full transition-[width] duration-panel motion-reduce:transition-none",
					!color && "bg-brand",
				)}
				style={{ width: `${pct}%`, ...(color ? { background: color } : {}) }}
			/>
		</div>
	);
}

export function Swatch({ color, className }: { color: string; className?: string }) {
	return <span aria-hidden className={cn("size-2.5 shrink-0 rounded-sm", className)} style={{ background: color }} />;
}

export const percent = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
