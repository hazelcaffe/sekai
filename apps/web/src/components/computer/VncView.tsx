import { AgentAvatar, api, cn, useAgents } from "@sekai/client";
import type { Machine } from "@sekai/shared";
import {
	Button,
	Dialog,
	DropdownContent,
	DropdownItem,
	DropdownMenu,
	DropdownTrigger,
	IconButton,
	Input,
	Spinner,
	Textarea,
	Tooltip,
} from "@sekai/ui";
import {
	Check,
	ClipboardPaste,
	Command,
	Expand,
	GraduationCap,
	Keyboard,
	Maximize,
	Minimize,
	MonitorX,
	RotateCw,
	Shrink,
	Undo2,
} from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useLayout } from "../../lib/hooks.ts";
import { TeachDialogs, useTeach } from "./Teach.tsx";

type RfbClient = InstanceType<typeof import("@novnc/novnc").default>;

/** X11 keysyms for the keys the toolbar can press. */
const KEY = {
	backspace: 0xff08,
	tab: 0xff09,
	enter: 0xff0d,
	escape: 0xff1b,
	ctrl: 0xffe3,
	alt: 0xffe9,
	super: 0xffeb,
	shift: 0xffe1,
	f4: 0xffc1,
	t: 0x0074,
	v: 0x0076,
} as const;

/** A typed character as a keysym (Latin-1 as itself, the rest as Unicode keysyms). */
function keysymOf(ch: string): number {
	if (ch === "\n") return KEY.enter;
	const code = ch.codePointAt(0) ?? 0;
	return code < 0x100 ? code : 0x01000000 | code;
}

/** Presses keys together (in order), then lets go (in reverse). */
function chord(rfb: RfbClient | null, keys: number[]): void {
	if (!rfb) return;
	for (const k of keys) rfb.sendKey(k, null, true);
	for (const k of [...keys].reverse()) rfb.sendKey(k, null, false);
	rfb.focus();
}

function Elapsed({ since }: { since: number }) {
	const [now, setNow] = useState(Date.now());
	useEffect(() => {
		const t = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(t);
	}, []);
	const s = Math.max(0, Math.floor((now - since) / 1000));
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const sec = String(s % 60).padStart(2, "0");
	return <span className="tabular-nums">{h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`}</span>;
}

function Tool({
	label,
	onClick,
	disabled,
	active,
	children,
}: {
	label: string;
	onClick?: () => void;
	disabled?: boolean;
	active?: boolean;
	children: ReactNode;
}) {
	return (
		<IconButton
			label={label}
			aria-pressed={active}
			onClick={onClick}
			disabled={disabled}
			className={cn(
				"flex size-9 items-center justify-center rounded-full text-fg-muted transition-colors hover:bg-fg/10 hover:text-fg disabled:pointer-events-none disabled:opacity-35 coarse:size-11 [&_svg]:size-5",
				active && "bg-fg/12 text-fg",
			)}
		>
			{children}
		</IconButton>
	);
}

/** Centered message over the screen: connecting, a password, or why it dropped. */
function Notice({ children }: { children: ReactNode }) {
	return (
		<div className="absolute inset-0 flex items-center justify-center bg-screen/70 p-6 backdrop-blur-sm">
			<div className="flex w-[min(360px,100%)] flex-col items-center gap-3 rounded-xl bg-surface-raised px-6 py-7 text-center shadow-pop ring-1 ring-fg/10">
				{children}
			</div>
		</div>
	);
}

/**
 * Takeover: the bot's desktop in the app, full screen and under your control (VNC through Sekai). The bot
 * keeps its hands off until you hand it back. agentId: a bot with a seat on the computer (its own screen there).
 */
export function VncView({
	machine,
	agentId,
	open,
	onOpenChange,
}: {
	machine: Machine;
	agentId?: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const { phone } = useLayout();
	const { data: agents = [] } = useAgents();
	const agent = agents.find((a) => a.id === (agentId ?? machine.agentId));
	const botName = agent?.name ?? "The bot";
	const root = useRef<HTMLDivElement>(null);
	const screen = useRef<HTMLDivElement>(null);
	const typing = useRef<HTMLInputElement>(null);
	const rfb = useRef<RfbClient | null>(null);
	const [state, setState] = useState<"connecting" | "connected" | "password" | "closed">("connecting");
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [attempt, setAttempt] = useState(0);
	const [since, setSince] = useState<number | null>(null);
	const [fit, setFit] = useState(true);
	const [full, setFull] = useState(false);
	const [pasting, setPasting] = useState(false);
	const [pasteText, setPasteText] = useState("");
	const { teaching, dialogs: teachDialogs } = useTeach({
		machine,
		agentId,
		screen,
		focusScreen: () => rfb.current?.focus(),
	});
	const recording = teaching.phase === "recording";
	// Skills belong to your own bots (a bot someone shared with you keeps its owner's).
	const canTeach = Boolean(agent && !agent.sharedBy);
	const touch = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
	const canFullscreen = typeof document !== "undefined" && document.fullscreenEnabled;
	const connected = state === "connected";

	// biome-ignore lint/correctness/useExhaustiveDependencies: attempt reconnects
	useEffect(() => {
		if (!open) return;
		let cancelled = false;
		setState("connecting");
		setError(null);
		(async () => {
			try {
				await api.machines.takeover(machine.id, true, agentId);
				if (cancelled) return;
				const [{ default: RFB }, access] = await Promise.all([
					import("@novnc/novnc"),
					api.machines.access(machine.id, agentId).catch(() => null),
				]);
				if (cancelled || !screen.current) return;
				const client = new RFB(screen.current, api.machines.vncUrl(machine.id, agentId), {
					credentials: access?.vncPassword ? { password: access.vncPassword } : undefined,
					shared: true,
				});
				client.scaleViewport = true;
				client.background = "var(--screen)";
				client.qualityLevel = 8;
				client.addEventListener("connect", () => {
					setState("connected");
					setSince((s) => s ?? Date.now());
					client.focus();
				});
				client.addEventListener("disconnect", (e) => {
					const clean = (e as CustomEvent<{ clean: boolean }>).detail?.clean;
					setState("closed");
					if (!clean) setError("The connection to the computer dropped.");
				});
				client.addEventListener("credentialsrequired", () => setState("password"));
				client.addEventListener("securityfailure", () => setError("The VNC password was wrong."));
				// Something was copied on the computer: offer it here (browsers only allow writing on a click).
				client.addEventListener("clipboard", (e) => {
					const text = (e as CustomEvent<{ text: string }>).detail?.text ?? "";
					if (!text.trim()) return;
					toast("Copied on the computer", {
						action: {
							label: "Copy here",
							onClick: () => void navigator.clipboard?.writeText(text).catch(() => {}),
						},
					});
				});
				rfb.current = client;
			} catch {
				if (cancelled) return;
				setError("Check the computer’s connection to Sekai, then try again.");
				setState("closed");
			}
		})();
		return () => {
			cancelled = true;
			rfb.current?.disconnect();
			rfb.current = null;
			void api.machines
				.takeover(machine.id, false, agentId)
				.catch(() => toast.error("Couldn’t hand back the screen. Check the connection and reopen it."));
		};
	}, [open, machine.id, agentId, attempt]);

	const resetTeaching = teachDialogs.reset;
	// biome-ignore lint/correctness/useExhaustiveDependencies: only when the view closes (reset changes every render)
	useEffect(() => {
		if (!open) {
			setSince(null);
			resetTeaching();
		}
	}, [open]);

	useEffect(() => {
		if (rfb.current) rfb.current.scaleViewport = fit;
	}, [fit]);

	useEffect(() => {
		const onChange = () => setFull(Boolean(document.fullscreenElement));
		document.addEventListener("fullscreenchange", onChange);
		return () => document.removeEventListener("fullscreenchange", onChange);
	}, []);

	const handBack = () => {
		if (recording) {
			// The recording would be lost: finish it first (check the steps, save or discard), then hand back.
			teaching.stop();
			return;
		}
		if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
		onOpenChange(false);
		toast(`Handed back to ${botName}`, { duration: 2000 });
	};

	const toggleFullscreen = () => {
		if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
		// Include portal-based menus and Teach dialogs in browser full screen.
		else void document.documentElement.requestFullscreen().catch(() => {});
	};

	/** Pastes on the computer: sets its clipboard, then presses Ctrl+V where its cursor is. */
	const paste = (text: string) => {
		const client = rfb.current;
		if (!client || !text) return;
		client.clipboardPasteFrom(text);
		setTimeout(() => chord(client, [KEY.ctrl, KEY.v]), 120);
		teaching.text(text, true);
	};
	/** A shortcut from the Keys menu (recorded while teaching, under xdotool's name). */
	const press = (keys: number[], combo: string) => {
		chord(rfb.current, keys);
		teaching.press(combo);
	};
	const startPaste = async () => {
		const text = await navigator.clipboard?.readText?.().catch(() => "");
		if (text) paste(text);
		else {
			setPasteText("");
			setPasting(true);
		}
	};

	/** Typing from a phone's keyboard (the screen itself takes a computer keyboard directly). */
	const onType = (e: React.FormEvent<HTMLInputElement>) => {
		const ev = e.nativeEvent as InputEvent;
		const client = rfb.current;
		if (client) {
			if (ev.inputType === "deleteContentBackward") {
				client.sendKey(KEY.backspace, null);
				teaching.key({ key: "Backspace" });
			} else if (ev.inputType === "insertLineBreak") {
				client.sendKey(KEY.enter, null);
				teaching.key({ key: "Enter" });
			} else if (ev.data) {
				for (const ch of ev.data) client.sendKey(keysymOf(ch), null);
				teaching.text(ev.data);
			}
		}
		e.currentTarget.value = "";
	};

	const status = recording ? (
		<>
			<span aria-hidden className="size-2 shrink-0 animate-pulse rounded-full bg-danger" />
			<span className="truncate">
				Recording{phone ? "" : ` for ${botName}`} · {teaching.count} step{teaching.count === 1 ? "" : "s"}
				{teaching.startedAt && (
					<>
						{" · "}
						<Elapsed since={teaching.startedAt} />
					</>
				)}
			</span>
		</>
	) : connected ? (
		<>
			<span aria-hidden className="size-1.5 shrink-0 animate-pulse rounded-full bg-info" />
			<span className="truncate">
				You're in control{phone ? "" : ` · ${botName} is waiting`}
				{since && (
					<>
						{" · "}
						<Elapsed since={since} />
					</>
				)}
			</span>
		</>
	) : state === "closed" ? (
		<>
			<span aria-hidden className="size-1.5 shrink-0 rounded-full bg-danger" />
			<span className="truncate">Disconnected</span>
		</>
	) : (
		<>
			<span aria-hidden className="size-1.5 shrink-0 rounded-full bg-warning" />
			<span className="truncate">Connecting…</span>
		</>
	);

	const tools = (
		<div className="flex shrink-0 items-center gap-0.5 rounded-full bg-fg/[0.06] p-1 ring-1 ring-fg/10">
			{canTeach && !recording && (
				<Button
					variant="ghost"
					size="sm"
					aria-label={`Teach ${botName}`}
					onClick={teaching.begin}
					disabled={!connected || teaching.phase !== "idle"}
				>
					<GraduationCap /> Teach
				</Button>
			)}
			{!phone && (
				<Tool label="Paste text on the computer" onClick={() => void startPaste()} disabled={!connected}>
					<ClipboardPaste />
				</Tool>
			)}
			{touch && (
				<Tool label="Keyboard" onClick={() => typing.current?.focus()} disabled={!connected}>
					<Keyboard />
				</Tool>
			)}
			<DropdownMenu>
				<Tooltip content="Keys" side="bottom">
					<DropdownTrigger asChild>
						<button
							type="button"
							aria-label="Keys"
							disabled={!connected}
							className="flex size-9 items-center justify-center rounded-full text-fg-muted transition-colors hover:bg-fg/10 hover:text-fg disabled:pointer-events-none disabled:opacity-35 coarse:size-11 [&_svg]:size-5"
						>
							<Command />
						</button>
					</DropdownTrigger>
				</Tooltip>
				<DropdownContent className="dark min-w-52 text-fg">
					<DropdownItem
						onSelect={() => {
							rfb.current?.sendCtrlAltDel();
							teaching.press("ctrl+alt+Delete");
						}}
					>
						Ctrl + Alt + Del
					</DropdownItem>
					<DropdownItem onSelect={() => press([KEY.super], "super")}>Windows / Super key</DropdownItem>
					<DropdownItem onSelect={() => press([KEY.alt, KEY.tab], "alt+Tab")}>Alt + Tab</DropdownItem>
					<DropdownItem onSelect={() => press([KEY.escape], "Escape")}>Escape</DropdownItem>
					<DropdownItem onSelect={() => press([KEY.alt, KEY.f4], "alt+F4")}>
						Alt + F4 (close window)
					</DropdownItem>
					<DropdownItem onSelect={() => press([KEY.ctrl, KEY.alt, KEY.t], "ctrl+alt+t")}>
						Ctrl + Alt + T (terminal)
					</DropdownItem>
					{phone && <DropdownItem onSelect={() => void startPaste()}>Paste text…</DropdownItem>}
				</DropdownContent>
			</DropdownMenu>
			<Tool label={fit ? "Actual size" : "Fit to window"} onClick={() => setFit((f) => !f)} disabled={!connected}>
				{fit ? <Expand /> : <Shrink />}
			</Tool>
			{canFullscreen && !phone && (
				<Tool label={full ? "Exit full screen" : "Full screen"} onClick={toggleFullscreen}>
					{full ? <Minimize /> : <Maximize />}
				</Tool>
			)}
		</div>
	);

	return (
		<DialogPrimitive.Root open={open} onOpenChange={(o) => (o ? onOpenChange(true) : handBack())}>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Content
					ref={root}
					className="dark fixed inset-0 z-takeover flex flex-col bg-screen text-fg outline-none animate-in fade-in-0 duration-200"
					// Escape belongs to the computer (closing apps, menus…); Hand back is the way out.
					onEscapeKeyDown={(e) => {
						if (e.isTrusted || !phone) e.preventDefault();
					}}
				>
					<DialogPrimitive.Title className="sr-only">{machine.name}</DialogPrimitive.Title>
					<DialogPrimitive.Description className="sr-only">
						You're using {botName}'s {agentId ? "screen" : "computer"}. It waits until you hand it back.
					</DialogPrimitive.Description>

					<header className="flex shrink-0 items-center gap-3 px-3 pt-safe-3 pb-2.5 md:px-4">
						{agent && <AgentAvatar avatar={agent.avatar} size={phone ? 30 : 34} />}
						<div className="min-w-0 flex-1">
							<div className="truncate text-body font-semibold tracking-tight">{machine.name}</div>
							<div className="flex items-center gap-1.5 text-small text-fg-muted">{status}</div>
						</div>

						{!phone && tools}

						{recording && (
							<Button
								onClick={teaching.stop}
								size={phone ? "sm" : "md"}
								className="shrink-0 rounded-full bg-danger px-4 text-danger-foreground hover:bg-danger/90"
							>
								<Check /> Done
							</Button>
						)}
						<Button
							onClick={handBack}
							size={phone ? "sm" : "md"}
							className="shrink-0 rounded-full bg-fg px-4 text-bg hover:bg-fg/90"
						>
							<Undo2 /> {phone ? "Hand back" : `Hand back to ${botName}`}
						</Button>
					</header>

					<div className={cn("relative min-h-0 flex-1 px-2 md:px-4 md:pb-4", phone ? "pb-2" : "pb-safe-2")}>
						<div className="relative h-full overflow-hidden rounded-lg bg-screen shadow-pop ring-1 ring-fg/10">
							<div ref={screen} className="absolute inset-0" />
							{state === "connecting" && (
								<Notice>
									{agent ? <AgentAvatar avatar={agent.avatar} size={56} /> : null}
									<div className="flex items-center gap-2 text-body font-medium">
										<Spinner className="text-fg" /> Connecting to {machine.name}
									</div>
									<p className="text-body text-fg-muted">
										{botName} waits until you hand the screen back.
									</p>
								</Notice>
							)}
							{state === "password" && (
								<Notice>
									<div className="text-body font-medium">Enter the screen password</div>
									<form
										className="flex w-full flex-col gap-2"
										onSubmit={(e) => {
											e.preventDefault();
											rfb.current?.sendCredentials({ password });
											setPassword("");
											setState("connecting");
										}}
									>
										<Input
											autoFocus
											type="password"
											aria-label="Screen password (VNC)"
											value={password}
											onChange={(e) => setPassword(e.target.value)}
										/>
										<Button type="submit" variant="primary">
											Connect
										</Button>
									</form>
								</Notice>
							)}
							{state === "closed" && (
								<Notice>
									<span className="flex size-12 items-center justify-center rounded-lg bg-fg/[0.06] text-fg-muted [&_svg]:size-6">
										<MonitorX />
									</span>
									<div className="text-body font-medium">
										{error ? "Lost the connection" : "Disconnected"}
									</div>
									<p className="text-body text-fg-muted">
										{error ?? "The computer closed the connection."}
									</p>
									<div className="mt-1 flex gap-2">
										<Button
											onClick={() => setAttempt((n) => n + 1)}
											className="rounded-full bg-fg px-4 text-bg hover:bg-fg/90"
										>
											<RotateCw /> Try again
										</Button>
										<Button
											variant="ghost"
											onClick={handBack}
											className="rounded-full text-fg-muted hover:bg-fg/10 hover:text-fg"
										>
											Close
										</Button>
									</div>
								</Notice>
							)}
						</div>
					</div>

					{phone && <div className="flex shrink-0 justify-center pb-safe-3">{tools}</div>}

					{/* A phone's keyboard types here, and each key goes to the computer. */}
					<input
						ref={typing}
						aria-label="Type on the computer"
						autoCapitalize="off"
						autoComplete="off"
						autoCorrect="off"
						spellCheck={false}
						onInput={onType}
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								e.preventDefault();
								rfb.current?.sendKey(KEY.enter, null);
								teaching.key({ key: "Enter" });
							}
						}}
						className="pointer-events-none fixed bottom-0 left-0 size-px opacity-0"
					/>

					<TeachDialogs state={teachDialogs} botName={botName} />

					<Dialog
						open={pasting}
						onOpenChange={setPasting}
						icon={<ClipboardPaste />}
						title="Paste on the computer"
						description="It's pasted where the computer's cursor is."
						footer={
							<>
								<Button variant="ghost" onClick={() => setPasting(false)}>
									Cancel
								</Button>
								<Button
									variant="primary"
									disabled={!pasteText}
									onClick={() => {
										setPasting(false);
										paste(pasteText);
									}}
								>
									Paste
								</Button>
							</>
						}
					>
						<Textarea
							autoFocus
							aria-label="Text to paste"
							value={pasteText}
							onChange={(e) => setPasteText(e.target.value)}
							placeholder="Type or paste text here"
						/>
					</Dialog>
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
}
