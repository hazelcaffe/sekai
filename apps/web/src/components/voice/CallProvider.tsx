import { AgentAvatar, api, type CallStatus, cn, useAgents, useCall } from "@sekai/client";
import { type Agent, avatarColor, type CallRing } from "@sekai/shared";
import { Button, IconButton } from "@sekai/ui";
import { ArrowUp, AudioLines, Mic, MicOff, Phone, PhoneOff, X } from "lucide-react";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useLayout } from "../../lib/hooks.ts";
import { useUi } from "../../stores/ui.ts";

interface CallTarget {
	conversationId: string;
	agent: Agent;
	/** Answering this bot's call. */
	ring?: string;
}

interface CallContextValue {
	/** The bot you're on a call with, if any. */
	current: CallTarget | null;
	startCall(target: CallTarget): void;
}

const CallContext = createContext<CallContextValue>({ current: null, startCall: () => {} });

export const useCallControls = () => useContext(CallContext);

const CONSENT_KEY = "sekai.callConsent";

const STATUS: Record<CallStatus, string> = {
	connecting: "Connecting…",
	listening: "Listening",
	thinking: "Thinking…",
	speaking: "Speaking",
	working: "Working on it…",
	ended: "Call ended",
};

function useTimer(startedAt: number | null): string {
	const [now, setNow] = useState(Date.now());
	useEffect(() => {
		if (!startedAt) return;
		const t = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(t);
	}, [startedAt]);
	if (!startedAt) return "";
	const s = Math.max(0, Math.floor((now - startedAt) / 1000));
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Rings around the avatar that breathe with whoever is talking. */
function Halo({ level, color, active }: { level: () => number; color: string; active: boolean }) {
	const a = useRef<HTMLSpanElement>(null);
	const b = useRef<HTMLSpanElement>(null);
	useEffect(() => {
		let raf = 0;
		let smooth = 0;
		const tick = () => {
			smooth = smooth * 0.8 + Math.min(1, level() * 2.5) * 0.2;
			if (a.current) a.current.style.transform = `scale(${1.08 + smooth * 0.22})`;
			if (b.current) b.current.style.transform = `scale(${1.18 + smooth * 0.45})`;
			raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	}, [level]);
	return (
		<>
			<span
				ref={b}
				aria-hidden
				className={cn(
					"absolute inset-0 rounded-full transition-opacity duration-500",
					active ? "opacity-25" : "opacity-0",
				)}
				style={{ background: color }}
			/>
			<span
				ref={a}
				aria-hidden
				className={cn(
					"absolute inset-0 rounded-full transition-opacity duration-500",
					active ? "opacity-40" : "opacity-10",
				)}
				style={{ background: color }}
			/>
		</>
	);
}

function CallCard({ target, onClose }: { target: CallTarget; onClose: () => void }) {
	const { phone } = useLayout();
	const call = useCall(target.conversationId, target.ring);
	// Answering a bot's call is the go-ahead.
	const [consented, setConsented] = useState(() => Boolean(target.ring) || localStorage.getItem(CONSENT_KEY) === "1");
	const started = useRef(false);
	const timer = useTimer(call.startedAt);
	const color = avatarColor(target.agent.avatar) ?? "var(--brand)";

	const begin = useCallback(() => {
		started.current = true;
		void call.start();
	}, [call.start]);

	// Started from the phone button (a click), so the browser lets audio play.
	useEffect(() => {
		if (consented && !started.current) begin();
	}, [consented, begin]);

	const wasActive = useRef(false);
	useEffect(() => {
		if (call.active) wasActive.current = true;
		else if (wasActive.current && !call.error) onClose();
	}, [call.active, call.error, onClose]);

	const lastBot = [...call.lines].reverse().find((l) => l.who === "bot");
	const lastYou = [...call.lines].reverse().find((l) => l.who === "you");
	const presence =
		call.status === "speaking"
			? "working"
			: call.status === "thinking" || call.status === "working"
				? "thinking"
				: "idle";
	const botLevel = useCallback(() => call.levels().bot, [call.levels]);
	const youLevel = useCallback(() => call.levels().you, [call.levels]);
	const [typed, setTyped] = useState("");
	const send = () => {
		if (call.sendText(typed)) setTyped("");
	};

	return (
		<div
			role="dialog"
			aria-label={`Call with ${target.agent.name}`}
			className={cn(
				"fixed z-[75] flex flex-col overflow-hidden bg-popover text-popover-foreground shadow-pop",
				phone
					? "inset-0 pt-safe pb-safe"
					: "right-6 bottom-6 w-[340px] rounded-[28px] border border-border animate-in fade-in-0 slide-in-from-bottom-4 zoom-in-95 duration-300",
			)}
		>
			<div
				aria-hidden
				className="pointer-events-none absolute inset-x-0 top-0 h-64"
				style={{
					background: `radial-gradient(70% 70% at 50% 0%, color-mix(in oklab, ${color} 22%, transparent), transparent)`,
				}}
			/>
			<div className="relative flex items-center gap-2 px-4 pt-4">
				<span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
					<AudioLines className="size-3.5" /> Call{timer ? ` · ${timer}` : ""}
				</span>
				{!call.active && (
					<IconButton label="Close" size="icon-sm" className="ml-auto" onClick={onClose}>
						<X />
					</IconButton>
				)}
			</div>
			<div
				className={cn(
					"relative flex flex-col items-center px-6 text-center",
					phone ? "flex-1 justify-center gap-6" : "gap-4 pt-4 pb-5",
				)}
			>
				<div
					className="relative flex items-center justify-center"
					style={{ width: phone ? 176 : 128, height: phone ? 176 : 128 }}
				>
					<Halo
						level={call.status === "speaking" ? botLevel : youLevel}
						color={call.status === "speaking" ? color : "var(--brand)"}
						active={call.status === "speaking" || (call.status === "listening" && !call.muted)}
					/>
					<AgentAvatar avatar={target.agent.avatar} size={phone ? 148 : 108} state={presence} alive />
				</div>
				<div>
					<div className="text-lg font-semibold tracking-tight">{target.agent.name}</div>
					<div
						className={cn(
							"mt-0.5 text-sm",
							call.status === "thinking" || call.status === "working"
								? "shimmer-text"
								: "text-muted-foreground",
						)}
					>
						{consented
							? call.muted && call.status === "listening"
								? "Muted"
								: (call.label ?? STATUS[call.status])
							: "Ready to call"}
					</div>
				</div>
				{consented ? (
					<div
						className={cn("flex w-full flex-col gap-1.5", phone ? "min-h-24" : "min-h-16")}
						aria-live="polite"
					>
						{lastBot?.text && <p className="line-clamp-3 text-[15px] leading-6">{lastBot.text}</p>}
						{lastYou?.text && (
							<p className="line-clamp-2 text-[13px] leading-5 text-fg-subtle">
								You: {lastYou.text}
								{!lastYou.final ? "…" : ""}
							</p>
						)}
					</div>
				) : (
					<div className="flex flex-col gap-3 rounded-2xl bg-muted/70 p-3.5 text-left text-[13px] leading-5 text-muted-foreground">
						<p>
							Your voice goes to the speech-to-text service while you talk, and what you both say is saved
							in this chat. Let anyone near you know before you start.
						</p>
						<Button
							variant="primary"
							onClick={() => {
								localStorage.setItem(CONSENT_KEY, "1");
								setConsented(true);
							}}
						>
							<Phone /> Start the call
						</Button>
					</div>
				)}
				{call.error && <p className="text-[13px] text-destructive">{call.error}</p>}
				{consented && call.micError && call.active && (
					<p className="text-[13px] text-fg-subtle">
						{call.micError} Type below and {target.agent.name} answers out loud.
					</p>
				)}
			</div>
			{consented && call.active && (
				<form
					className={cn("relative flex items-center gap-1.5 px-4", phone ? "pb-4" : "pb-3")}
					onSubmit={(e) => {
						e.preventDefault();
						send();
					}}
				>
					<input
						value={typed}
						onChange={(e) => setTyped(e.target.value)}
						placeholder={call.micError ? `Message ${target.agent.name}…` : "Or type…"}
						aria-label={`Type to ${target.agent.name}`}
						maxLength={2000}
						autoFocus={Boolean(call.micError)}
						className="h-10 min-w-0 flex-1 rounded-full bg-muted px-4 text-[15px] outline-none placeholder:text-fg-subtle focus-visible:ring-[3px] focus-visible:ring-ring/20 coarse:h-11"
					/>
					<IconButton
						type="submit"
						label="Send"
						variant="primary"
						className="rounded-full"
						disabled={!typed.trim() || call.status === "connecting"}
					>
						<ArrowUp />
					</IconButton>
				</form>
			)}
			{consented && (
				<div className={cn("relative flex items-center justify-center gap-5 px-6", phone ? "pb-10" : "pb-6")}>
					<button
						type="button"
						onClick={call.toggleMute}
						disabled={!call.active || Boolean(call.micError)}
						aria-pressed={call.muted}
						aria-label={call.muted ? "Unmute" : "Mute"}
						className={cn(
							"flex size-14 items-center justify-center rounded-full transition-[background-color,color,scale] duration-200 ease-spring active:scale-90 disabled:opacity-40 [&_svg]:size-6",
							call.muted ? "bg-foreground text-background" : "bg-muted text-foreground hover:bg-accent",
						)}
					>
						{call.muted ? <MicOff /> : <Mic />}
					</button>
					{call.active ? (
						<button
							type="button"
							onClick={call.hangUp}
							aria-label="End call"
							className="flex size-14 items-center justify-center rounded-full bg-destructive text-white shadow-[0_8px_24px_-8px] shadow-destructive/60 transition-[scale,background-color] duration-200 ease-spring hover:bg-destructive/90 active:scale-90 [&_svg]:size-6"
						>
							<PhoneOff />
						</button>
					) : (
						<button
							type="button"
							onClick={begin}
							aria-label="Call again"
							className="flex size-14 items-center justify-center rounded-full bg-success text-white transition-[scale] duration-200 ease-spring active:scale-90 [&_svg]:size-6"
						>
							<Phone />
						</button>
					)}
				</div>
			)}
		</div>
	);
}

/** A soft two-tone ring while a bot is calling (browsers may keep it silent until you've clicked somewhere). */
function useRingTone(on: boolean) {
	useEffect(() => {
		if (!on) return;
		let ctx: AudioContext | null = null;
		try {
			ctx = new AudioContext();
		} catch {
			return;
		}
		const c = ctx;
		const ring = () => {
			if (c.state !== "running") return;
			const t = c.currentTime;
			for (const [i, f] of [440, 523.25].entries()) {
				const o = c.createOscillator();
				const g = c.createGain();
				o.frequency.value = f;
				g.gain.setValueAtTime(0, t + i * 0.18);
				g.gain.linearRampToValueAtTime(0.08, t + i * 0.18 + 0.02);
				g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.18 + 0.5);
				o.connect(g).connect(c.destination);
				o.start(t + i * 0.18);
				o.stop(t + i * 0.18 + 0.55);
			}
		};
		void c.resume().catch(() => {});
		ring();
		const t = setInterval(ring, 2200);
		return () => {
			clearInterval(t);
			void c.close();
		};
	}, [on]);
}

/** A bot calling you: answer or decline (it messages you instead if you don't). */
function IncomingCall({ ring, agent, onAnswer }: { ring: CallRing; agent: Agent; onAnswer: () => void }) {
	const { phone } = useLayout();
	const color = avatarColor(agent.avatar) ?? "var(--brand)";
	useRingTone(true);
	const decline = () => {
		useUi.getState().setRings((r) => r.filter((x) => x.id !== ring.id));
		void api.voice.declineRing(ring.id).catch(() => {});
	};
	return (
		<div
			role="alertdialog"
			aria-label={`${agent.name} is calling`}
			className={cn(
				"fixed z-[80] flex flex-col items-center overflow-hidden bg-popover text-center text-popover-foreground shadow-pop",
				phone
					? "inset-0 justify-center gap-8 px-8 pt-safe pb-safe"
					: "right-6 bottom-6 w-[320px] gap-4 rounded-[28px] border border-border px-6 py-6 animate-in fade-in-0 slide-in-from-bottom-4 zoom-in-95 duration-300",
			)}
		>
			<div
				aria-hidden
				className="pointer-events-none absolute inset-x-0 top-0 h-56"
				style={{
					background: `radial-gradient(70% 70% at 50% 0%, color-mix(in oklab, ${color} 28%, transparent), transparent)`,
				}}
			/>
			<div
				className="relative flex items-center justify-center"
				style={{ width: phone ? 170 : 116, height: phone ? 170 : 116 }}
			>
				<span
					aria-hidden
					className="absolute inset-0 animate-ping rounded-full opacity-20"
					style={{ background: color }}
				/>
				<AgentAvatar avatar={agent.avatar} size={phone ? 150 : 100} alive />
			</div>
			<div className="relative">
				<div className="text-lg font-semibold tracking-tight">{agent.name} is calling</div>
				<p className="mt-1 line-clamp-3 text-sm leading-5 text-muted-foreground">{ring.reason}</p>
			</div>
			<div className="relative flex items-center gap-8">
				<button
					type="button"
					onClick={decline}
					aria-label="Decline"
					className="flex size-14 items-center justify-center rounded-full bg-destructive text-white transition-transform duration-200 ease-spring active:scale-90 [&_svg]:size-6"
				>
					<PhoneOff />
				</button>
				<span className="relative flex">
					<span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-success/40" />
					<button
						type="button"
						onClick={onAnswer}
						aria-label="Answer"
						className="relative flex size-14 items-center justify-center rounded-full bg-success text-white transition-transform duration-200 ease-spring active:scale-90 [&_svg]:size-6"
					>
						<Phone />
					</button>
				</span>
			</div>
			<p className="relative text-xs text-fg-subtle">
				If you don't answer, {agent.name} sends you a message instead.
			</p>
		</div>
	);
}

/** Holds the current call so it keeps going while you move around the app. */
export function CallProvider({ children }: { children: ReactNode }) {
	const [current, setCurrent] = useState<CallTarget | null>(null);
	const [key, setKey] = useState(0);
	const currentRef = useRef<CallTarget | null>(null);
	currentRef.current = current;
	const startCall = useCallback((target: CallTarget) => {
		const c = currentRef.current;
		if (c) {
			if (c.conversationId !== target.conversationId) toast(`You're already on a call with ${c.agent.name}`);
			return;
		}
		setCurrent(target);
		setKey((k) => k + 1);
	}, []);
	const close = useCallback(() => setCurrent(null), []);
	const rings = useUi((s) => s.rings);
	const { data: agents = [] } = useAgents();
	const ring = current ? null : rings.find((r) => agents.some((a) => a.id === r.agentId));
	const ringAgent = ring ? agents.find((a) => a.id === ring.agentId) : undefined;
	return (
		<CallContext.Provider value={{ current, startCall }}>
			{children}
			{current && <CallCard key={key} target={current} onClose={close} />}
			{ring && ringAgent && (
				<IncomingCall
					key={ring.id}
					ring={ring}
					agent={ringAgent}
					onAnswer={() => {
						useUi.getState().setRings((r) => r.filter((x) => x.id !== ring.id));
						startCall({ conversationId: ring.conversationId, agent: ringAgent, ring: ring.id });
					}}
				/>
			)}
		</CallContext.Provider>
	);
}
