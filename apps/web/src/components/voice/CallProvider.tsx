import { AgentAvatar, api, type CallStatus, cn, useAccess, useAgents, useCall } from "@sekai/client";
import { type Agent, avatarColor, type CallRing } from "@sekai/shared";
import { Button, Dialog, ErrorState, Fold, IconButton, Input } from "@sekai/ui";
import { ArrowUp, AudioLines, Mic, MicOff, Phone, PhoneOff } from "lucide-react";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
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
		if (!active || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
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
	}, [level, active]);
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

function CallCard({
	target,
	onClose,
	expanded,
	onExpand,
}: {
	target: CallTarget;
	onClose: () => void;
	expanded: boolean;
	onExpand: (value: boolean) => void;
}) {
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

	const status = !consented
		? "Ready to call"
		: call.muted && call.status === "listening"
			? "Muted"
			: (call.label ?? STATUS[call.status]);
	const muteLabel = call.muted ? "Unmute" : "Mute";
	const mute = (
		<IconButton
			label={muteLabel}
			aria-pressed={call.muted}
			disabled={!call.active || Boolean(call.micError)}
			onClick={call.toggleMute}
		>
			{call.muted ? <MicOff /> : <Mic />}
		</IconButton>
	);
	return (
		<>
			{!expanded && (
				<section
					aria-label="Current call"
					className="fixed right-4 z-sticky flex max-w-[calc(100%-2rem)] items-center gap-1 rounded-xl border border-border bg-surface-raised px-2 shadow-pop max-md:bottom-[calc(max(1rem,var(--safe-bottom))+var(--toast-lift,0px))] md:right-6 md:bottom-6"
				>
					<button
						type="button"
						onClick={() => onExpand(true)}
						className="flex min-h-11 min-w-0 items-center gap-2 rounded-lg px-2 text-left hover:bg-surface-2"
					>
						<AgentAvatar avatar={target.agent.avatar} size={26} />
						<span className="min-w-0">
							<span className="block truncate text-body font-medium">{target.agent.name}</span>
							<span className="block truncate text-caption text-fg-subtle">
								{status}
								{timer && ` · ${timer}`}
							</span>
						</span>
					</button>
					{call.active && mute}
					<IconButton
						label={call.active ? "End call" : "Close call"}
						className="text-danger-ink"
						onClick={call.active ? call.hangUp : onClose}
					>
						<PhoneOff />
					</IconButton>
				</section>
			)}
			<Dialog
				open={expanded}
				onOpenChange={onExpand}
				title={`Call with ${target.agent.name}`}
				icon={<AudioLines />}
				size="sm"
			>
				<div className="flex flex-col items-center gap-4 py-4 text-center">
					<div className="relative flex size-28 items-center justify-center">
						<Halo
							level={call.status === "speaking" ? botLevel : youLevel}
							color={call.status === "speaking" ? color : "var(--brand)"}
							active={call.status === "speaking" || (call.status === "listening" && !call.muted)}
						/>
						<AgentAvatar avatar={target.agent.avatar} size={96} state={presence} />
					</div>
					<div>
						<div
							className={cn(
								"mt-0.5 text-body",
								call.status === "thinking" || call.status === "working"
									? "shimmer-text"
									: "text-fg-muted",
							)}
						>
							{status}
							{timer && ` · ${timer}`}
						</div>
					</div>
					{consented ? (
						<div className="flex w-full flex-col gap-2" aria-live="polite">
							{lastBot?.text && <p className="line-clamp-3 text-body">{lastBot.text}</p>}
							{lastYou?.text && (
								<p className="line-clamp-2 text-small text-fg-subtle">
									You: {lastYou.text}
									{!lastYou.final ? "…" : ""}
								</p>
							)}
						</div>
					) : (
						<div className="flex w-full flex-col gap-3 text-left text-small text-fg-muted">
							<p>
								Your voice is sent to the speech-to-text service and the conversation is saved in this
								chat.
							</p>
							<Fold title="Learn more" variant="link">
								Let anyone nearby know before you start. You can mute your microphone at any time.
							</Fold>
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
					{call.error && (
						<ErrorState
							size="sm"
							title="Couldn't connect the call"
							description="Check your connection or voice settings, then try again."
							onRetry={begin}
						/>
					)}
					{consented && call.micError && call.active && (
						<p className="text-small text-fg-subtle">
							Couldn't use the microphone. Type a message to hear a reply.
						</p>
					)}
				</div>
				{consented && call.active && (
					<form
						className="flex items-center gap-2 border-t border-border pt-4"
						onSubmit={(e) => {
							e.preventDefault();
							send();
						}}
					>
						<Input
							value={typed}
							onChange={(e) => setTyped(e.target.value)}
							placeholder={call.micError ? `Message ${target.agent.name}…` : "Or type…"}
							aria-label={`Type to ${target.agent.name}`}
							maxLength={2000}
							className="min-w-0 flex-1"
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
				{consented && call.active && (
					<div className="mt-4 flex flex-wrap items-center gap-2">
						<Button variant="ghost" onClick={() => onExpand(false)}>
							Minimize
						</Button>
						<span className="ml-auto">{mute}</span>
						<Button variant="danger" onClick={call.hangUp}>
							<PhoneOff /> End call
						</Button>
					</div>
				)}
			</Dialog>
		</>
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
	useRingTone(true);
	const decline = () => {
		useUi.getState().setRings((r) => r.filter((x) => x.id !== ring.id));
		void api.voice.declineRing(ring.id).catch(() => {});
	};
	return (
		<Dialog
			open
			onOpenChange={(open) => !open && decline()}
			title={`${agent.name} is calling`}
			size="sm"
			footer={
				<>
					<Button variant="ghost" onClick={decline}>
						<PhoneOff /> Decline
					</Button>
					<Button onClick={onAnswer}>
						<Phone /> Answer
					</Button>
				</>
			}
		>
			<div className="flex items-center gap-3">
				<AgentAvatar avatar={agent.avatar} size={52} />
				<p className="text-body text-fg-muted">{ring.reason}</p>
			</div>
			<p className="mt-3 text-small text-fg-subtle">
				If you don't answer, {agent.name} will send a message instead.
			</p>
		</Dialog>
	);
}

/** Holds the current call so it keeps going while you move around the app. */
export function CallProvider({ children }: { children: ReactNode }) {
	const [current, setCurrent] = useState<CallTarget | null>(null);
	const [expanded, setExpanded] = useState(false);
	const canVoice = useAccess().can("voice");
	const [key, setKey] = useState(0);
	const currentRef = useRef<CallTarget | null>(null);
	currentRef.current = current;
	const startCall = useCallback((target: CallTarget) => {
		const c = currentRef.current;
		if (c) {
			if (c.conversationId !== target.conversationId) toast(`You're already on a call with ${c.agent.name}`);
			setExpanded(true);
			return;
		}
		setCurrent(target);
		setExpanded(true);
		setKey((k) => k + 1);
	}, []);
	const close = useCallback(() => setCurrent(null), []);
	const rings = useUi((s) => s.rings);
	const { data: agents = [] } = useAgents();
	const ring = current || !canVoice ? null : rings.find((r) => agents.some((a) => a.id === r.agentId));
	const ringAgent = ring ? agents.find((a) => a.id === ring.agentId) : undefined;
	return (
		<CallContext.Provider value={{ current, startCall }}>
			{children}
			{current && (
				<CallCard
					key={key}
					target={current}
					onClose={close}
					expanded={expanded}
					onExpand={(open) => setExpanded(open)}
				/>
			)}
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
