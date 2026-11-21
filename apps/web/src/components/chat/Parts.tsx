import { api, assetUrl, cn, haptic, Markdown, qk, useAgents, useConversations, useMcpServers } from "@sekai/client";
import {
	type AdvisorPart,
	type ApprovalScope,
	type NoticePart,
	type ReasoningPart,
	type ToolPart,
	toolKindLabel,
	toolOutcome,
} from "@sekai/shared";
import {
	Badge,
	Button,
	DropdownContent,
	DropdownItem,
	DropdownLabel,
	DropdownMenu,
	DropdownSeparator,
	DropdownTrigger,
	Fold,
	IconButton,
	Link,
	Spinner,
} from "@sekai/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
	AlertTriangle,
	AppWindow,
	Bell,
	Bot,
	Brain,
	Check,
	ChevronDown,
	ChevronRight,
	CircleAlert,
	Clock,
	Globe,
	Info,
	Lightbulb,
	Monitor,
	NotebookPen,
	Plug,
	Server,
	ShieldAlert,
	ShieldCheck,
	Sparkles,
	SquareTerminal,
	Users,
	X,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { useNavigate } from "react-router";
import { approvalScopeLabels } from "./approval-part.ts";

// ---------------------------------------------------------------- reasoning

export function ReasoningBlock({ part, streaming }: { part: ReasoningPart; streaming: boolean }) {
	const [open, setOpen] = useState(false);
	const live = streaming && part.endedAt === undefined;
	const seconds =
		part.startedAt && part.endedAt ? Math.max(1, Math.round((part.endedAt - part.startedAt) / 1000)) : null;
	return (
		<div className="my-1.5">
			<button
				type="button"
				onClick={() => setOpen((o) => !o)}
				aria-expanded={open}
				className="flex items-center gap-1.5 rounded-md py-1 text-small text-fg-subtle hover:text-fg-muted coarse:min-h-11"
			>
				<Lightbulb className="size-4" />
				{live ? (
					<span className="shimmer-text">Thinking…</span>
				) : (
					<span>{seconds ? `Thought for ${seconds}s` : "Thoughts"}</span>
				)}
				<ChevronRight className={cn("size-4 transition-transform", open && "rotate-90")} />
			</button>
			{open && (
				<div className="mt-1 mb-2 border-l-2 border-border pl-3.5 text-small whitespace-pre-wrap text-fg-muted">
					{part.text.trim() || "…"}
				</div>
			)}
		</div>
	);
}

// ---------------------------------------------------------------- planner / council

export function AdvisorBlock({ part }: { part: AdvisorPart }) {
	const [open, setOpen] = useState(false);
	const label = part.role === "planner" ? "Plan" : "Advisor";
	return (
		<div className="my-1.5 rounded-lg border border-border bg-surface/60">
			<button
				type="button"
				onClick={() => setOpen((o) => !o)}
				className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-body"
			>
				{part.role === "planner" ? (
					<Sparkles className="size-4 text-fg-subtle" />
				) : (
					<Users className="size-4 text-fg-subtle" />
				)}
				<span className="font-medium">{label}</span>
				<span className="truncate text-fg-subtle">{part.model}</span>
				<span className="ml-auto flex items-center gap-2">
					{part.status === "running" && <Spinner />}
					{part.status === "error" && <CircleAlert className="size-4 text-danger-ink" />}
					<ChevronDown className={cn("size-4 text-fg-subtle transition-transform", open && "rotate-180")} />
				</span>
			</button>
			{open && (
				<div className="border-t border-border px-3.5 py-3">
					<Markdown text={part.text || "…"} className="text-small text-fg-muted" />
				</div>
			)}
		</div>
	);
}

// ---------------------------------------------------------------- tools

const CATEGORY_ICONS: Record<string, ReactNode> = {
	memory: <Brain />,
	notes: <NotebookPen />,
	routines: <Clock />,
	skills: <Sparkles />,
	agents: <Bot />,
	web: <Globe />,
	browser: <AppWindow />,
	computer: <Monitor />,
	machines: <Server />,
	system: <Bell />,
};

function toolIcon(part: ToolPart): ReactNode {
	if (part.source === "mcp" || part.category?.startsWith("mcp:")) return <Plug />;
	if (part.source === "external") return <SquareTerminal />;
	return CATEGORY_ICONS[part.category ?? ""] ?? <Sparkles />;
}

const RISK_TONE = { read: "neutral", write: "info", external: "warning", destructive: "danger" } as const;

function approvalText(part: ToolPart): string | null {
	const a = part.approval;
	if (!a) return null;
	const who = {
		rule: "a rule",
		mode: "approval mode",
		reviewer: "the reviewer",
		primary: "your primary bot",
		user: "you",
		timeout: "timeout",
	}[a.by];
	if (a.decision === "denied")
		return a.by === "user" ? "You denied this" : `Blocked by ${who}${a.note ? `: ${a.note}` : ""}`;
	if (a.by === "mode") return null;
	return `Approved by ${who}${a.note ? `: ${a.note}` : ""}`;
}

function pretty(value: unknown): string {
	try {
		return typeof value === "string" ? value : JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

/** Asking another bot happens in their own thread; this finds it so the card can open it. */
function useTeamThread(part: ToolPart, agentId: string | null | undefined): string | null {
	const { data: agents } = useAgents();
	const { data: conversations } = useConversations();
	if (part.name !== "agent_ask" || !agentId) return null;
	const to = String(part.args.to ?? "")
		.replace(/^@/, "")
		.toLowerCase();
	const other = agents?.find((a) => a.id === to || a.name.toLowerCase() === to);
	if (!other) return null;
	const thread = conversations?.find(
		(c) => c.settings.team && c.memberIds.includes(agentId) && c.memberIds.includes(other.id),
	);
	return thread?.id ?? null;
}

export function ToolCard({
	part,
	conversationId,
	agentId,
}: {
	part: ToolPart;
	conversationId: string;
	agentId?: string | null;
}) {
	const [open, setOpen] = useState(false);
	const thread = useTeamThread(part, agentId);
	const navigate = useNavigate();
	if (part.status === "awaiting_approval")
		return <ApprovalCard part={part} conversationId={conversationId} agentId={agentId} inline />;
	const running = part.status === "pending" || part.status === "running";
	const failed = part.status === "error";
	const denied = part.status === "denied";
	const approval = approvalText(part);
	return (
		<div className="my-1">
			<div className="flex max-w-full items-center gap-2">
				<button
					type="button"
					onClick={() => setOpen((o) => !o)}
					aria-expanded={open}
					className="flex min-w-0 max-w-full items-center gap-2 rounded-lg py-1 text-left text-small text-fg-muted hover:text-fg coarse:min-h-11"
				>
					<span
						className={cn(
							"flex size-5 shrink-0 items-center justify-center [&_svg]:size-4",
							failed && "text-danger-ink",
							denied && "text-warning-ink",
						)}
					>
						{toolIcon(part)}
					</span>
					<span className={cn("truncate", running && "shimmer-text")}>
						{part.reason && running ? part.reason : toolOutcome(part.title ?? part.name, part.status)}
					</span>
					{running && <Spinner className="shrink-0" />}
					{part.status === "done" && <Check className="size-4 shrink-0 text-success-ink" />}
					{failed && <X className="size-4 shrink-0 text-danger-ink" />}
					{denied && <ShieldAlert className="size-4 shrink-0 text-warning-ink" />}
					{approval && part.approval?.by === "reviewer" && (
						<ShieldCheck className="size-4 shrink-0 text-info-ink" />
					)}
					<ChevronRight
						className={cn("size-4 shrink-0 text-fg-subtle transition-transform", open && "rotate-90")}
					/>
				</button>
				{part.images?.length ? (
					<span className="flex shrink-0 gap-1">
						{part.images.slice(0, 2).map((url) => (
							<a key={url} href={assetUrl(url)} target="_blank" rel="noreferrer">
								<img
									src={assetUrl(url)}
									alt=""
									loading="lazy"
									className="h-7 w-11 rounded-sm border border-border object-cover"
								/>
							</a>
						))}
					</span>
				) : null}
				{thread && (
					<button
						type="button"
						onClick={() => navigate(`/c/${thread}`)}
						className="shrink-0 text-caption text-fg-subtle underline-offset-2 hover:text-fg hover:underline"
					>
						Read their chat
					</button>
				)}
			</div>
			{open && (
				<div className="mt-1 mb-2 ml-8 overflow-hidden rounded-lg border border-border bg-bg-subtle text-small">
					<div className="flex flex-wrap items-center gap-1.5 border-b border-border px-3 py-2">
						<code className="font-mono text-fg-muted">{part.name}</code>
						{part.risk && <Badge tone={RISK_TONE[part.risk]}>{part.risk}</Badge>}
						{approval && <span className="text-fg-subtle">{approval}</span>}
					</div>
					{Object.keys(part.args).length > 0 && (
						<pre className="max-h-56 overflow-auto border-b border-border px-3 py-2 font-mono leading-5 whitespace-pre-wrap text-fg-muted scrollbar-thin">
							{pretty(part.args)}
						</pre>
					)}
					{(part.result ?? part.error) && (
						<pre
							className={cn(
								"max-h-72 overflow-auto px-3 py-2 font-mono leading-5 whitespace-pre-wrap scrollbar-thin",
								failed ? "text-danger-ink" : "text-fg-muted",
							)}
						>
							{part.result ?? part.error}
						</pre>
					)}
				</div>
			)}
		</div>
	);
}

/** "Ask first": the action, why it needs you, and how far your decision should reach. */
export function ApprovalCard({
	part,
	conversationId,
	agentId,
	inline,
}: {
	part: ToolPart;
	conversationId: string;
	agentId?: string | null;
	inline?: boolean;
}) {
	const { data: agents } = useAgents();
	const qc = useQueryClient();
	const canSetBotRule = Boolean(agents?.some((agent) => agent.id === agentId && !agent.sharedBy));
	const decide = useMutation({
		mutationFn: (d: { approve: boolean; scope: ApprovalScope }) => api.approvals.decide(part.id, d),
		onSuccess: (_, d) => {
			haptic(d.approve ? "success" : "warning");
			void qc.invalidateQueries({ queryKey: qk.approvals });
		},
	});
	const busy = decide.isPending;
	const { data: apps } = useMcpServers();
	const scopes = approvalScopeLabels({
		kind: toolKindLabel(part.category, (name) => apps?.find((a) => a.name === name)?.title),
		bot: agents?.find((a) => a.id === agentId)?.name ?? null,
	});
	return (
		<div className="overflow-hidden rounded-lg border border-border bg-surface" data-conversation={conversationId}>
			<div className="flex items-start gap-3 px-4 pt-4">
				<span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-warning-soft text-warning-ink [&_svg]:size-4">
					<ShieldAlert />
				</span>
				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-center gap-2">
						<span className="text-body font-medium">{part.title ?? part.name}</span>
						{part.risk === "destructive" && <Badge tone="danger">Destructive</Badge>}
					</div>
					{part.reason && (
						<p className="mt-1 text-small text-fg-muted">
							{part.reason
								.replace(/Ask-every-time mode: /i, "")
								.replaceAll("agent's", "bot's")
								.replace(/^\w/, (c) => c.toUpperCase())}
						</p>
					)}
					<Fold title="Action details" variant="link" className="mt-2">
						<pre className="max-h-56 overflow-auto rounded-lg bg-bg-subtle px-3 py-2 font-mono text-small whitespace-pre-wrap text-fg-muted [overflow-wrap:anywhere] scrollbar-thin">
							{part.name}
							{"\n"}
							{pretty(part.args)}
						</pre>
					</Fold>
				</div>
			</div>
			<div className="flex flex-wrap items-center gap-2 px-4 py-4">
				<div className="flex">
					<Button
						variant="primary"
						loading={busy && decide.variables?.approve}
						disabled={busy}
						onClick={() => decide.mutate({ approve: true, scope: "once" })}
						className={cn(!part.alwaysAsk && "rounded-r-none")}
					>
						<Check />
						{part.alwaysAsk ? "Approve once" : "Approve"}
					</Button>
					{/* Requests that always need you (root…) can't become a rule: no "always allow" here. */}
					{!part.alwaysAsk && (
						<DropdownMenu>
							<DropdownTrigger asChild>
								<IconButton
									variant="primary"
									size="icon"
									disabled={busy}
									className="rounded-l-none border-l border-primary-foreground/20 px-2"
									label="More approval options"
								>
									<ChevronDown />
								</IconButton>
							</DropdownTrigger>
							<DropdownContent align="start" className="w-64">
								<DropdownLabel>Approve</DropdownLabel>
								<DropdownItem onSelect={() => decide.mutate({ approve: true, scope: "once" })}>
									Just this once
								</DropdownItem>
								<DropdownItem onSelect={() => decide.mutate({ approve: true, scope: "conversation" })}>
									Allow for this chat
								</DropdownItem>
								{canSetBotRule && (
									<DropdownItem
										onSelect={() => decide.mutate({ approve: true, scope: "agent_tool" })}
									>
										{scopes.botTool}
									</DropdownItem>
								)}
								{scopes.botKind && canSetBotRule && (
									<DropdownItem
										onSelect={() => decide.mutate({ approve: true, scope: "agent_category" })}
									>
										{scopes.botKind}
									</DropdownItem>
								)}
								<DropdownItem onSelect={() => decide.mutate({ approve: true, scope: "global_tool" })}>
									{scopes.everyTool}
								</DropdownItem>
								{scopes.everyKind && (
									<DropdownItem
										onSelect={() => decide.mutate({ approve: true, scope: "global_category" })}
									>
										{scopes.everyKind}
									</DropdownItem>
								)}
							</DropdownContent>
						</DropdownMenu>
					)}
				</div>
				<div className="flex">
					<Button
						variant="secondary"
						loading={busy && !decide.variables?.approve}
						disabled={busy}
						onClick={() => decide.mutate({ approve: false, scope: "once" })}
						className={cn(!part.alwaysAsk && "rounded-r-none")}
					>
						Deny
					</Button>
					{!part.alwaysAsk && (
						<DropdownMenu>
							<DropdownTrigger asChild>
								<IconButton
									variant="secondary"
									size="icon"
									disabled={busy}
									className="rounded-l-none border-l border-border px-2"
									label="More deny options"
								>
									<ChevronDown />
								</IconButton>
							</DropdownTrigger>
							<DropdownContent align="start" className="w-60">
								<DropdownItem onSelect={() => decide.mutate({ approve: false, scope: "once" })}>
									Deny this time
								</DropdownItem>
								<DropdownItem onSelect={() => decide.mutate({ approve: false, scope: "conversation" })}>
									Block for this chat
								</DropdownItem>
								{canSetBotRule && (
									<>
										<DropdownSeparator />
										<DropdownItem
											danger
											onSelect={() => decide.mutate({ approve: false, scope: "agent_tool" })}
										>
											{scopes.blockBotTool}
										</DropdownItem>
									</>
								)}
							</DropdownContent>
						</DropdownMenu>
					)}
				</div>
			</div>
			{decide.isError && (
				<p role="alert" className="px-4 pb-3 text-small text-danger-ink">
					Couldn't record your decision. Try again.
				</p>
			)}
			{inline && (
				<Link
					href={`/inbox?approval=${encodeURIComponent(part.id)}`}
					className="mx-4 mb-2 inline-flex min-h-8 items-center text-small text-brand-ink hover:underline coarse:min-h-11"
				>
					Open in Needs you
				</Link>
			)}
		</div>
	);
}

export function NoticeLine({ part }: { part: NoticePart }) {
	const memory = part.text.startsWith("Saved to memory") || part.text.startsWith("Forgot");
	const icon =
		part.level === "error" ? (
			<CircleAlert />
		) : part.level === "warning" ? (
			<AlertTriangle />
		) : memory ? (
			<Brain />
		) : (
			<Info />
		);
	return (
		<div
			className={cn(
				"my-1.5 flex items-start gap-2 text-body [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0",
				part.level === "error"
					? "text-danger-ink"
					: part.level === "warning"
						? "text-warning-ink"
						: "text-fg-subtle",
			)}
		>
			{icon}
			<span className="min-w-0 break-words">{part.text}</span>
		</div>
	);
}
