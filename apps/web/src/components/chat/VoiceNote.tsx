import { assetUrl, cn } from "@sekai/client";
import type { AudioPart } from "@sekai/shared";
import { Pause, Play } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

const BARS = 42;

/** Loudness bars from Discord-style waveform bytes (base64), or a gentle default. */
function bars(waveform: string | undefined): number[] {
	let raw: number[] = [];
	try {
		raw = waveform ? [...atob(waveform)].map((c) => c.charCodeAt(0)) : [];
	} catch {}
	if (raw.length === 0) return Array.from({ length: BARS }, (_, i) => 0.35 + 0.25 * Math.sin(i * 0.9));
	return Array.from({ length: BARS }, (_, i) => {
		const from = Math.floor((i / BARS) * raw.length);
		const to = Math.max(from + 1, Math.floor(((i + 1) / BARS) * raw.length));
		let max = 0;
		for (let j = from; j < to; j++) max = Math.max(max, raw[j] ?? 0);
		return Math.max(0.12, max / 255);
	});
}

const clock = (ms: number) => {
	const s = Math.max(0, Math.round(ms / 1000));
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

let playing: HTMLAudioElement | null = null;

/** A voice message: play it, see how far along it is, tap the bars to jump. */
export function VoiceNote({ part, tint, className }: { part: AudioPart; tint?: string; className?: string }) {
	const audio = useRef<HTMLAudioElement | null>(null);
	const [state, setState] = useState<"idle" | "playing" | "paused">("idle");
	const [at, setAt] = useState(0);
	const shape = useMemo(() => bars(part.waveform), [part.waveform]);
	const duration = part.durationMs || 1;

	useEffect(() => () => audio.current?.pause(), []);
	useEffect(() => {
		if (state !== "playing") return;
		let raf = 0;
		const tick = () => {
			if (audio.current) setAt(audio.current.currentTime * 1000);
			raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	}, [state]);

	const el = () => {
		if (!audio.current) {
			const a = new Audio(assetUrl(part.url));
			a.onended = () => {
				setState("idle");
				setAt(0);
			};
			a.onpause = () => setState((s) => (s === "playing" ? "paused" : s));
			audio.current = a;
		}
		return audio.current;
	};
	const toggle = () => {
		const a = el();
		if (state === "playing") {
			a.pause();
			setState("paused");
			return;
		}
		// One voice note at a time.
		if (playing && playing !== a) playing.pause();
		playing = a;
		a.play()
			.then(() => setState("playing"))
			.catch(() => setState("idle"));
	};
	const seek = (e: React.MouseEvent<HTMLDivElement>) => {
		const r = e.currentTarget.getBoundingClientRect();
		const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
		const a = el();
		a.currentTime = (frac * duration) / 1000;
		setAt(frac * duration);
		if (state !== "playing") toggle();
	};
	const progress = Math.min(1, at / duration);

	return (
		<div
			className={cn("flex w-[min(320px,100%)] items-center gap-3 rounded-full py-1.5 pr-4 pl-1.5", className)}
			style={tint ? { background: `color-mix(in oklab, ${tint} 26%, var(--surface-2))` } : undefined}
		>
			<button
				type="button"
				onClick={toggle}
				aria-label={state === "playing" ? "Pause voice message" : "Play voice message"}
				className="flex size-9 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-transform active:scale-90 [&_svg]:size-4"
			>
				{state === "playing" ? (
					<Pause className="fill-current" />
				) : (
					<Play className="translate-x-px fill-current" />
				)}
			</button>
			<div className="flex h-8 min-w-0 flex-1 cursor-pointer items-center gap-[2px]" onClick={seek}>
				{shape.map((h, i) => (
					<span
						// biome-ignore lint/suspicious/noArrayIndexKey: fixed set of bars
						key={i}
						className={cn(
							"w-[3px] shrink-0 rounded-full transition-colors",
							i / BARS < progress ? "bg-foreground" : "bg-foreground/25",
						)}
						style={{ height: `${Math.round(h * 100)}%` }}
					/>
				))}
			</div>
			<span className="shrink-0 text-xs text-fg-subtle tabular-nums">
				{clock(state === "idle" ? duration : at)}
			</span>
		</div>
	);
}
