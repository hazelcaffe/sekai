import { cn } from "@sekai/client";
import { useEffect, useRef } from "react";

const BAR_IDS = ["a", "b", "c", "d", "e", "f", "g", "h"];

/** A few bars that move with a level (0–1), read every frame. */
export function LevelBars({ level, bars = 4, className }: { level: () => number; bars?: number; className?: string }) {
	const ref = useRef<HTMLSpanElement>(null);
	useEffect(() => {
		let raf = 0;
		let smooth = 0;
		const tick = () => {
			smooth = smooth * 0.7 + Math.min(1, level() * 2.2) * 0.3;
			const el = ref.current;
			if (el) {
				[...el.children].forEach((c, i) => {
					const wobble = 0.55 + 0.45 * Math.sin(performance.now() / (120 + i * 37) + i);
					(c as HTMLElement).style.transform = `scaleY(${Math.max(0.18, smooth * wobble)})`;
				});
			}
			raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	}, [level]);
	return (
		<span ref={ref} aria-hidden className={cn("flex h-4 items-center gap-[3px]", className)}>
			{BAR_IDS.slice(0, bars).map((id) => (
				<span
					key={id}
					className="h-full w-[3px] origin-center rounded-full bg-current transition-transform duration-75"
				/>
			))}
		</span>
	);
}
