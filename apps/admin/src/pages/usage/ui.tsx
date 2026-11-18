import { cn } from "@sekai/client";
import { Skeleton } from "@sekai/ui";
import { lazy, type ReactNode, useSyncExternalStore } from "react";

/** recharts arrives in its own chunk, the first time a chart shows. */
const charts = () => import("./charts.tsx");
export const TokensChart = lazy(() => charts().then((m) => ({ default: m.TokensChart })));
export const SplitChart = lazy(() => charts().then((m) => ({ default: m.SplitChart })));

export function ChartFallback({ height }: { height: number }) {
	return <Skeleton className="w-full rounded-xl" style={{ height }} />;
}

const NARROW = "(max-width: 639px)";
const subscribe = (cb: () => void) => {
	const mq = matchMedia(NARROW);
	mq.addEventListener("change", cb);
	return () => mq.removeEventListener("change", cb);
};

/** Phone-sized: charts drop their second axis and pack their labels tighter. */
export function useNarrow(): boolean {
	return useSyncExternalStore(
		subscribe,
		() => matchMedia(NARROW).matches,
		() => false,
	);
}

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
	return <div className={cn("rounded-2xl border border-border bg-card p-4", className)}>{children}</div>;
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
		<div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}>
			<div
				className={cn("h-full rounded-full transition-[width] duration-500", !color && "bg-brand")}
				style={{ width: `${pct}%`, ...(color ? { background: color } : {}) }}
			/>
		</div>
	);
}

export function Swatch({ color, className }: { color: string; className?: string }) {
	return (
		<span aria-hidden className={cn("size-2.5 shrink-0 rounded-[3px]", className)} style={{ background: color }} />
	);
}

export const percent = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
