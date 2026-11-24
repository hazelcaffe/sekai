import { api } from "@sekai/client";
import type { SignInClientMessage, SignInServerMessage, SignInTicket } from "@sekai/shared";
import { Button, Callout, copyText, Dialog, Input, Spinner } from "@sekai/ui";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { Check, ClipboardPaste, Copy, ExternalLink, KeyRound, Terminal as TerminalIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const TERM_THEME = {
	background: "#111318",
	foreground: "#e8ecf4",
	cursor: "#e8ecf4",
	cursorAccent: "#111318",
	selectionBackground: "rgba(130, 170, 255, 0.3)",
	black: "#1a1d24",
	red: "#f87171",
	green: "#4ade80",
	yellow: "#facc15",
	blue: "#60a5fa",
	magenta: "#c084fc",
	cyan: "#22d3ee",
	white: "#e8ecf4",
	brightBlack: "#64748b",
	brightRed: "#fca5a5",
	brightGreen: "#86efac",
	brightYellow: "#fde047",
	brightBlue: "#93c5fd",
	brightMagenta: "#d8b4fe",
	brightCyan: "#67e8f9",
	brightWhite: "#ffffff",
};

type SessionExit = Extract<SignInServerMessage, { type: "exit" }>;

/**
 * Interactive browser terminal for signing in a subscription CLI (a Dialog on desktop, a sheet on phones).
 * Shows large one-tap buttons above the terminal whenever a sign-in URL, one-time code, or paste prompt appears.
 */
export function SignInTerminal({
	open,
	onOpenChange,
	title,
	hint,
	ticket,
	onDone,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	hint?: string;
	ticket: SignInTicket | null;
	onDone: () => void;
}) {
	const hostRef = useRef<HTMLDivElement | null>(null);
	const wsRef = useRef<WebSocket | null>(null);
	const onDoneRef = useRef(onDone);
	onDoneRef.current = onDone;

	const [phase, setPhase] = useState<"connecting" | "running" | "exited">("connecting");
	const [link, setLink] = useState<string | null>(null);
	const [code, setCode] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);
	const [wantsPaste, setWantsPaste] = useState(false);
	const [pasteOpen, setPasteOpen] = useState(false);
	const [pasteValue, setPasteValue] = useState("");
	const [exit, setExit] = useState<SessionExit | null>(null);
	const [socketError, setSocketError] = useState<string | null>(null);

	useEffect(() => {
		if (!open || !ticket) return;
		setPhase("connecting");
		setLink(null);
		setCode(null);
		setCopied(false);
		setWantsPaste(false);
		setPasteOpen(false);
		setPasteValue("");
		setExit(null);
		setSocketError(null);

		let disposed = false;
		let closeTimer: ReturnType<typeof setTimeout> | null = null;
		let term: Terminal | null = null;
		let fit: FitAddon | null = null;
		let ro: ResizeObserver | null = null;
		let ws: WebSocket | null = null;

		const sendJson = (msg: SignInClientMessage) => {
			if (ws && ws.readyState === WebSocket.OPEN) {
				ws.send(JSON.stringify(msg));
			}
		};

		const fitAndResize = () => {
			if (!fit || !term || disposed) return;
			try {
				fit.fit();
				sendJson({ type: "resize", cols: term.cols, rows: term.rows });
			} catch {}
		};

		// Wait one animation frame so the Dialog/Sheet portal has mounted hostRef with real dimensions.
		const raf = requestAnimationFrame(() => {
			if (disposed || !hostRef.current) return;
			const container = hostRef.current;

			term = new Terminal({
				cursorBlink: true,
				fontSize: 13,
				fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
				scrollback: 1000,
				theme: TERM_THEME,
			});
			fit = new FitAddon();
			term.loadAddon(fit);
			term.open(container);
			fit.fit();
			term.focus();

			ws = new WebSocket(api.providers.signInUrl(ticket.ticket));
			ws.binaryType = "arraybuffer";
			wsRef.current = ws;

			ws.addEventListener("open", () => {
				if (disposed) return;
				fitAndResize();
			});

			ws.addEventListener("message", (ev) => {
				if (disposed) return;
				if (ev.data instanceof ArrayBuffer) {
					term?.write(new Uint8Array(ev.data));
					return;
				}
				if (typeof ev.data !== "string") return;
				let msg: SignInServerMessage;
				try {
					msg = JSON.parse(ev.data) as SignInServerMessage;
				} catch {
					return;
				}
				if (msg.type === "started") {
					setPhase("running");
					fitAndResize();
				} else if (msg.type === "link") {
					setLink(msg.url);
				} else if (msg.type === "code") {
					setCode(msg.code);
					setCopied(false);
				} else if (msg.type === "paste") {
					setWantsPaste(true);
				} else if (msg.type === "exit") {
					setExit(msg);
					setPhase("exited");
					onDoneRef.current();
					if (msg.reason === "exited" && msg.code === 0) {
						closeTimer = setTimeout(() => {
							if (!disposed) onOpenChange(false);
						}, 1400);
					}
				}
			});

			ws.addEventListener("error", () => {
				if (disposed) return;
				setSocketError("Couldn't connect to the sign-in terminal. Try again.");
				setPhase("exited");
			});

			ws.addEventListener("close", () => {
				if (disposed) return;
				setPhase((prev) => (prev === "exited" ? prev : "exited"));
				onDoneRef.current();
			});

			term.onData((data) => {
				sendJson({ type: "input", data });
			});

			ro = new ResizeObserver(() => fitAndResize());
			ro.observe(container);
		});

		return () => {
			disposed = true;
			cancelAnimationFrame(raf);
			if (closeTimer) clearTimeout(closeTimer);
			ro?.disconnect();
			if (ws && ws.readyState <= WebSocket.OPEN) {
				try {
					ws.close();
				} catch {}
			}
			wsRef.current = null;
			term?.dispose();
		};
	}, [open, ticket, onOpenChange]);

	const copyCode = async () => {
		if (!code) return;
		await copyText(code);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	const sendPaste = () => {
		const trimmed = pasteValue.trim();
		if (!trimmed) return;
		const ws = wsRef.current;
		if (ws && ws.readyState === WebSocket.OPEN) {
			const msg: SignInClientMessage = { type: "input", data: `${trimmed}\r` };
			ws.send(JSON.stringify(msg));
			setPasteValue("");
		}
	};

	const showPasteBar = (wantsPaste || pasteOpen) && phase === "running";
	const succeeded = exit?.reason === "exited" && exit.code === 0;
	const failed =
		socketError ||
		(exit &&
			(exit.reason === "error" || exit.reason === "timeout" || (exit.reason === "exited" && exit.code !== 0)));

	return (
		<Dialog
			open={open}
			onOpenChange={onOpenChange}
			size="lg"
			icon={<KeyRound />}
			title={title}
			description={hint || "Follow the steps in the terminal below."}
			footer={
				<div className="flex w-full items-center justify-between gap-3">
					<div className="flex min-w-0 items-center gap-2 text-caption text-fg-muted">
						{phase === "connecting" || phase === "running" ? (
							<>
								<Spinner className="size-4" />
								<span className="truncate font-mono">{ticket?.command ?? "Connecting…"}</span>
							</>
						) : succeeded ? (
							<span className="text-success-ink">Finished</span>
						) : (
							<span className="truncate font-mono">{ticket?.command}</span>
						)}
					</div>
					<div className="flex shrink-0 items-center gap-2">
						{phase === "running" && !showPasteBar && (
							<Button variant="ghost" size="sm" onClick={() => setPasteOpen(true)}>
								<ClipboardPaste /> Paste code
							</Button>
						)}
						<Button
							variant={phase === "exited" ? "primary" : "secondary"}
							onClick={() => onOpenChange(false)}
						>
							{phase === "exited" ? "Done" : "Cancel"}
						</Button>
					</div>
				</div>
			}
		>
			<div className="flex flex-col gap-3">
				{(link || code) && (
					<div className="flex flex-col gap-2.5 rounded-lg border border-border bg-surface-2 p-3">
						{code && (
							<div className="flex flex-wrap items-center justify-between gap-2">
								<div className="min-w-0">
									<div className="text-caption text-fg-muted">One-time code</div>
									<div className="font-mono text-title font-semibold tracking-wider text-fg select-all">
										{code}
									</div>
								</div>
								<Button variant="secondary" onClick={() => void copyCode()}>
									{copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy code"}
								</Button>
							</div>
						)}
						{link && (
							<a
								href={link}
								target="_blank"
								rel="noreferrer"
								className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-brand px-4 py-2 text-small font-medium text-brand-foreground transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
							>
								<ExternalLink aria-hidden className="size-4 shrink-0" /> Open the sign-in page
							</a>
						)}
					</div>
				)}

				{showPasteBar && (
					<form
						className="flex items-center gap-2"
						onSubmit={(e) => {
							e.preventDefault();
							sendPaste();
						}}
					>
						<Input
							value={pasteValue}
							onChange={(e) => setPasteValue(e.target.value)}
							placeholder="Paste the code or token from the sign-in page"
							className="font-mono"
							autoComplete="off"
							spellCheck={false}
						/>
						<Button type="submit" variant="primary" disabled={!pasteValue.trim()}>
							Send
						</Button>
					</form>
				)}

				{succeeded && (
					<Callout tone="success" title="Signed in">
						Checking your subscription now…
					</Callout>
				)}

				{failed && (
					<Callout tone="danger" title="Sign-in didn't finish">
						{socketError ||
							exit?.message ||
							`The sign-in command stopped (exit code ${exit?.code ?? "unknown"}). Check the terminal output below and try again.`}
					</Callout>
				)}

				<div className="relative overflow-hidden rounded-lg border border-border bg-surface-2">
					<div className="flex items-center gap-1.5 border-b border-border px-3 py-1.5 text-caption text-fg-muted">
						<TerminalIcon aria-hidden className="size-3.5" />
						<span>Sign-in terminal</span>
					</div>
					<div
						ref={hostRef}
						className="h-64 w-full p-2 sm:h-80"
						style={{ backgroundColor: TERM_THEME.background }}
						data-testid="signin-terminal"
					/>
				</div>
			</div>
		</Dialog>
	);
}
