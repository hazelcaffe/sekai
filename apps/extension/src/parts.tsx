import type { ExtensionCommand, Message, NoticePart, PendingApproval, ToolPart } from "@sekai/shared";
import { Button, Callout, cn, Fold, Spinner, StatusDot } from "@sekai/ui";
import { Check, ChevronRight, CircleAlert, ExternalLink, ShieldAlert, X } from "lucide-react";
import { useId, useState } from "react";
import { ExtensionMarkdown } from "./markdown.tsx";

const TOOL_STATUS_LABEL: Record<ToolPart["status"], string> = {
	pending: "Waiting",
	awaiting_approval: "Needs you",
	running: "Running",
	done: "Done",
	error: "Failed",
	denied: "Denied",
};

/** One quiet collapsible line for a bot's tool steps (expands to show each step). */
function ToolGroup({ parts }: { parts: ToolPart[] }) {
	const [open, setOpen] = useState(false);
	const listId = useId();
	const running = parts.some((p) => p.status === "running" || p.status === "pending");
	const waiting = parts.some((p) => p.status === "awaiting_approval");
	const failed = parts.some((p) => p.status === "error" || p.status === "denied");

	const summary =
		parts.length === 1
			? (parts[0]?.title ?? parts[0]?.name ?? "Used a tool")
			: running
				? (parts.findLast((p) => p.status === "running")?.title ?? `Working (${parts.length} steps)`)
				: `${parts.length} steps`;

	return (
		<div className="my-1">
			<button
				type="button"
				aria-expanded={open}
				aria-controls={listId}
				onClick={() => setOpen((v) => !v)}
				className="inline-flex max-w-full items-center gap-1.5 rounded-md py-1 text-left text-small text-fg-muted transition-colors duration-fast hover:text-fg"
			>
				{running ? (
					<Spinner className="size-3.5 shrink-0 text-brand-ink" />
				) : waiting ? (
					<StatusDot tone="warning" label="Needs you" size="sm" />
				) : failed ? (
					<CircleAlert aria-hidden className="size-3.5 shrink-0 text-danger-ink" />
				) : (
					<Check aria-hidden className="size-3.5 shrink-0 text-fg-subtle" />
				)}
				<span className="truncate">{summary}</span>
				<ChevronRight
					aria-hidden
					className={cn(
						"size-3.5 shrink-0 text-fg-subtle transition-transform duration-fast",
						open && "rotate-90",
					)}
				/>
			</button>
			{open && (
				<ul id={listId} className="mt-1 space-y-1.5 border-l border-border pl-3">
					{parts.map((p) => (
						<li key={p.id} className="text-small">
							<div className="flex items-center justify-between gap-2">
								<span className="min-w-0 truncate text-fg">{p.title ?? p.name}</span>
								<span
									className={cn(
										"shrink-0 text-caption",
										p.status === "error" || p.status === "denied"
											? "text-danger-ink"
											: p.status === "awaiting_approval"
												? "text-warning-ink"
												: "text-fg-subtle",
									)}
								>
									{TOOL_STATUS_LABEL[p.status]}
								</span>
							</div>
							{p.error && <p className="mt-0.5 break-words text-caption text-danger-ink">{p.error}</p>}
						</li>
					))}
				</ul>
			)}
		</div>
	);
}

function NoticeInline({ part }: { part: NoticePart }) {
	const tone = part.level === "error" ? "danger" : part.level === "warning" ? "warning" : "info";
	return (
		<Callout tone={tone} className="my-1 py-2">
			<span className="text-small">{part.text}</span>
		</Callout>
	);
}

/** One chat message: yours in a soft bubble, the bot's as plain reading text. */
export function MessageView({ message, botName }: { message: Message; botName: string }) {
	if (message.sender === "user") {
		const text = message.parts
			.flatMap((p) => (p.type === "text" ? [p.text] : []))
			.join("\n")
			.trim();
		return (
			<article className="flex justify-end" aria-label="Your message">
				<div className="max-w-[85%] rounded-xl bg-surface-2 px-3.5 py-2.5 text-body text-fg">
					<p className="whitespace-pre-wrap break-words">{text}</p>
				</div>
			</article>
		);
	}

	const textBlocks = message.parts.flatMap((p) => (p.type === "text" && p.text.trim() ? [p.text] : []));
	const toolParts = message.parts.filter((p): p is ToolPart => p.type === "tool");
	const notices = message.parts.filter((p): p is NoticePart => p.type === "notice");
	const streaming = message.status === "streaming";

	return (
		<article className="space-y-1.5" aria-label={`Message from ${botName}`}>
			<div className="flex items-center gap-2">
				<span className="text-caption font-medium text-fg-muted">{botName}</span>
				{streaming && <StatusDot tone="brand" pulse label="Working" size="sm" />}
			</div>
			{toolParts.length > 0 && <ToolGroup parts={toolParts} />}
			{notices.map((n, i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: notices have no id
				<NoticeInline key={i} part={n} />
			))}
			{textBlocks.length > 0 && <ExtensionMarkdown text={textBlocks.join("\n\n")} />}
			{message.error && (
				<p role="alert" className="break-words text-small text-danger-ink">
					{message.error}
				</p>
			)}
			{streaming && textBlocks.length === 0 && toolParts.length === 0 && (
				<p className="text-small text-fg-subtle">Thinking…</p>
			)}
			{message.status === "cancelled" && <p className="text-caption text-fg-subtle">Stopped</p>}
		</article>
	);
}

const quote = (s: string) => `“${s.length > 160 ? `${s.slice(0, 160)}…` : s}”`;

/**
 * What a browser action will do, in words. The server's title only names the action ("Used your browser: type"),
 * and its reason asks you to check the tab and the action, so they're shown here rather than folded into Details.
 */
export function browserActionSummary(
	args: Record<string, unknown>,
	tabName: (tabId: number) => string | null,
): string | null {
	const input = (args.input && typeof args.input === "object" ? args.input : args) as Record<string, unknown>;
	const str = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : "");
	const where = typeof input.tabId === "number" ? (tabName(input.tabId) ?? "a shared tab") : "a shared tab";
	switch (input.action) {
		case "click":
			return `Click on ${where}`;
		case "type":
			return `Type ${quote(str("text"))} on ${where}`;
		case "select":
			return `Choose ${quote(str("value"))} on ${where}`;
		case "press":
			return `Press ${str("key")} on ${where}`;
		case "navigate":
			return `Go from ${where} to ${str("url")}`;
		case "back":
			return `Go back on ${where}`;
		case "forward":
			return `Go forward on ${where}`;
		case "reload":
			return `Reload ${where}`;
		case "close":
			return `Close ${where}`;
		case "open":
			return `Open ${str("url")} in a new tab`;
		case "scroll":
			return `Scroll ${str("direction")} on ${where}`;
		default:
			return null;
	}
}

/** Pending approval card: plain words first, technical arguments folded away. */
export function ApprovalCard({
	approval,
	busy,
	onDecide,
	tabName,
}: {
	approval: PendingApproval;
	busy: boolean;
	onDecide: (approve: boolean) => void;
	/** The shared tab's name for an id, to say where a browser action happens. */
	tabName: (tabId: number) => string | null;
}) {
	const hasArgs = Object.keys(approval.args ?? {}).length > 0;
	const summary =
		approval.toolName === "extension_browser" ? browserActionSummary(approval.args ?? {}, tabName) : null;
	return (
		<Callout
			tone="warning"
			icon={<ShieldAlert />}
			title={<span className="break-words">{summary ?? (approval.title || approval.toolName)}</span>}
		>
			{approval.reason && <p className="text-small text-fg-muted">{approval.reason}</p>}
			{hasArgs && (
				<Fold title="Details" variant="link" className="mt-1">
					<pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap break-all rounded-md bg-surface-2 p-2 font-mono text-caption text-fg">
						{JSON.stringify(approval.args, null, 2)}
					</pre>
				</Fold>
			)}
			<div className="mt-2.5 flex flex-wrap items-center gap-2">
				<Button size="sm" variant="primary" loading={busy} onClick={() => onDecide(true)}>
					Approve
				</Button>
				<Button size="sm" variant="secondary" disabled={busy} onClick={() => onDecide(false)}>
					Deny
				</Button>
			</div>
		</Callout>
	);
}

/** Confirmation card when a bot asks to open and share a new tab. */
export function OpenTabCard({
	command,
	busy,
	onAnswer,
}: {
	command: ExtensionCommand;
	busy: boolean;
	onAnswer: (allow: boolean) => void;
}) {
	if (command.input.action !== "open") return null;
	let host = command.input.url;
	try {
		host = new URL(command.input.url).hostname;
	} catch {}
	return (
		<Callout tone="warning" icon={<ExternalLink />} title="Open and share a new tab?">
			<p className="text-small font-medium text-fg">{host}</p>
			<p className="mt-0.5 break-all text-caption text-fg-muted">{command.input.url}</p>
			<div className="mt-2.5 flex flex-wrap items-center gap-2">
				<Button size="sm" variant="primary" loading={busy} onClick={() => onAnswer(true)}>
					Open and share
				</Button>
				<Button size="sm" variant="secondary" disabled={busy} onClick={() => onAnswer(false)}>
					Decline
				</Button>
			</div>
		</Callout>
	);
}

/** Compact dismissible error notice. */
export function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
	return (
		<div
			role="alert"
			className="flex items-start gap-2 rounded-lg border border-danger/25 bg-danger-soft px-3 py-2 text-small text-danger-ink"
		>
			<CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
			<p className="min-w-0 flex-1 break-words">{message}</p>
			<button
				type="button"
				aria-label="Dismiss error"
				onClick={onDismiss}
				className="-mr-1 flex size-6 shrink-0 items-center justify-center rounded-sm text-danger-ink/80 transition-colors duration-fast hover:bg-danger/10 hover:text-danger-ink"
			>
				<X aria-hidden className="size-3.5" />
			</button>
		</div>
	);
}
