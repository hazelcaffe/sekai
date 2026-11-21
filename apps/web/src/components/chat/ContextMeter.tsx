import { api, cn, formatTokens, useAgentContext } from "@sekai/client";
import type { Agent, Conversation } from "@sekai/shared";
import { Button, Confirm, ErrorState, Fold, IconButton, List, Row, SkeletonRows } from "@sekai/ui";
import { useMutation } from "@tanstack/react-query";
import { Eraser, RefreshCw, Shrink, Trash2 } from "lucide-react";
import { useState } from "react";

/** Exactly what the bot reads on its next turn in this chat: the context meter, compact, reset, the full prompt. */
export function ContextMeter({ agent, conversation }: { agent: Agent; conversation: Conversation }) {
	const { data: ctx, isLoading, refetch, isFetching } = useAgentContext(agent.id, conversation.id);
	const [confirm, setConfirm] = useState<"reset" | "summary" | null>(null);
	const compact = useMutation({
		mutationFn: () => api.conversations.compact(conversation.id),
		onSuccess: () => void refetch(),
	});
	const clearSummary = useMutation({
		mutationFn: () => api.conversations.clearSummary(conversation.id),
		onSuccess: () => void refetch(),
	});
	const reset = useMutation({
		mutationFn: () => api.conversations.reset(conversation.id),
		onSuccess: () => void refetch(),
	});

	if (isLoading) return <SkeletonRows count={3} />;
	if (!ctx) return <ErrorState title="Couldn't load context" size="sm" onRetry={() => void refetch()} />;
	const pct = Math.min(100, (ctx.totalTokens / ctx.contextWindow) * 100);
	const segments = [
		...ctx.sections.map((s) => ({
			id: s.id,
			title: s.title === "Machines" ? "Computers" : s.title,
			tokens: s.tokens,
		})),
		{ id: "history", title: "Chat history", tokens: ctx.history.tokens },
	].filter((s) => s.tokens > 0);
	const colors = Array.from({ length: 8 }, (_, i) => `var(--series-${i + 1})`);

	return (
		<div className="flex flex-col gap-3">
			<div className="flex items-end justify-between gap-2">
				<div>
					<div className="text-title font-semibold tracking-tight">{formatTokens(ctx.totalTokens)}</div>
					<div className="text-small text-fg-subtle">
						of {formatTokens(ctx.contextWindow)} tokens on {ctx.model} ({pct.toFixed(pct < 1 ? 2 : 1)}%)
					</div>
				</div>
				<IconButton label="Refresh" size="icon-sm" onClick={() => void refetch()}>
					<RefreshCw className={cn(isFetching && "animate-spin")} />
				</IconButton>
			</div>
			<div className="flex h-2.5 overflow-hidden rounded-full bg-surface-2">
				{segments.map((s, i) => (
					<div
						key={s.id}
						aria-hidden
						style={{
							width: `${(s.tokens / ctx.contextWindow) * 100}%`,
							background: colors[i % colors.length],
							minWidth: 2,
						}}
					/>
				))}
			</div>
			<div className="grid grid-cols-1 gap-x-4 gap-y-1 xs:grid-cols-2">
				{segments.map((s, i) => (
					<div key={s.id} className="flex items-center gap-2 text-small">
						<span
							className="size-2 shrink-0 rounded-full"
							style={{ background: colors[i % colors.length] }}
						/>
						<span className="min-w-0 flex-1 truncate text-fg-muted">{s.title}</span>
						<span className="text-fg-subtle tabular-nums">{formatTokens(s.tokens)}</span>
					</div>
				))}
			</div>

			<List>
				<Row
					title="Chat history"
					subtitle={`${ctx.history.messages} messages in context${ctx.history.summarizedMessages > 0 ? ` · ${ctx.history.summarizedMessages} summarized` : ""}`}
					wrap
					trailing={
						<Button variant="secondary" loading={compact.isPending} onClick={() => compact.mutate()}>
							<Shrink /> Compact now
						</Button>
					}
				/>
			</List>
			<Fold title="Learn more" variant="link">
				{ctx.history.summary && (
					<div className="mb-3">
						<h3 className="mb-2 font-medium">Summary</h3>
						<p className="max-h-40 overflow-y-auto rounded-lg bg-surface-2 p-3 text-small whitespace-pre-wrap text-fg-muted">
							{ctx.history.summary}
						</p>
						<Button variant="ghost" onClick={() => setConfirm("summary")}>
							<Eraser /> Clear summary
						</Button>
					</div>
				)}
				<h3 className="mb-2 font-medium">Full prompt ({ctx.tools.length} tools)</h3>
				<pre className="max-h-[50dvh] overflow-auto rounded-lg border border-border bg-bg p-3 font-mono text-caption whitespace-pre-wrap text-fg-muted [overflow-wrap:anywhere] scrollbar-thin">
					{ctx.systemPrompt}
				</pre>
			</Fold>
			<Button variant="danger-ghost" className="self-start" onClick={() => setConfirm("reset")}>
				<Trash2 /> Reset chat
			</Button>
			<Confirm
				open={Boolean(confirm)}
				onOpenChange={(open) => !open && setConfirm(null)}
				title={confirm === "summary" ? "Clear the summary?" : "Reset this chat?"}
				description={
					confirm === "summary"
						? "The bot will no longer read the summary, but the messages stay in this chat."
						: "Clears the chat history and summary. Memory and notes are kept."
				}
				confirmLabel={confirm === "summary" ? "Clear summary" : "Reset"}
				danger
				onConfirm={() => (confirm === "summary" ? clearSummary.mutate() : reset.mutate())}
			/>
		</div>
	);
}
