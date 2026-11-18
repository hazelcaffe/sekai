import { api, cn, timeAgo, useMachines } from "@sekai/client";
import type { Agent, CodeIndex, CodeSearchHit } from "@sekai/shared";
import { Button, Confirm, EmptyState, Field, Input, Select, Spinner } from "@sekai/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, FolderGit2, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const fmtBytes = (n: number) =>
	n > 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : n > 1000 ? `${Math.round(n / 1000)} KB` : `${n} B`;

function Progress({ ix }: { ix: CodeIndex }) {
	const p = ix.progress;
	const frac = p?.phase === "embedding" && p.total ? p.done / p.total : null;
	return (
		<div className="flex flex-col gap-1">
			<div className="h-1.5 overflow-hidden rounded-full bg-muted">
				<div
					className={cn(
						"h-full rounded-full bg-brand transition-[width] duration-500",
						frac === null && "w-1/3 animate-pulse",
					)}
					style={frac === null ? undefined : { width: `${Math.max(4, Math.round(frac * 100))}%` }}
				/>
			</div>
			<span className="text-xs text-fg-subtle">
				{p?.phase === "scanning"
					? "Looking through the folder…"
					: p?.phase === "cleaning"
						? "Dropping what changed…"
						: p?.total
							? `Reading ${p.done} of ${p.total} files`
							: "Starting…"}
			</span>
		</div>
	);
}

function IndexCard({ ix }: { ix: CodeIndex }) {
	const qc = useQueryClient();
	const [removing, setRemoving] = useState(false);
	const [query, setQuery] = useState("");
	const [hits, setHits] = useState<CodeSearchHit[] | null>(null);
	const refresh = () => void qc.invalidateQueries({ queryKey: ["code", ix.agentId] });
	const again = useMutation({ mutationFn: () => api.code.refresh(ix.id), onSuccess: refresh });
	const remove = useMutation({ mutationFn: () => api.code.delete(ix.id), onSuccess: refresh });
	const search = useMutation({
		mutationFn: () => api.code.search(ix.id, query, 5),
		onSuccess: setHits,
		onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
	});
	return (
		<div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-3.5">
			<div className="flex items-start gap-3">
				<span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-fg-subtle [&_svg]:size-[18px]">
					{ix.status === "error" ? <CircleAlert className="text-danger" /> : <FolderGit2 />}
				</span>
				<div className="min-w-0 flex-1">
					<div className="truncate text-sm font-medium">{ix.name}</div>
					<div className="truncate font-mono text-xs text-fg-subtle" title={ix.root}>
						{ix.root}
					</div>
					<div className="mt-0.5 text-xs text-fg-subtle">
						{ix.machineName}
						{ix.status === "ready" &&
							` · ${ix.files.toLocaleString()} files · ${fmtBytes(ix.bytes)}${ix.lastIndexedAt ? ` · ${timeAgo(ix.lastIndexedAt)}` : ""}`}
					</div>
				</div>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Index again"
					disabled={ix.status === "indexing" || again.isPending}
					onClick={() => again.mutate()}
				>
					<RefreshCw className={ix.status === "indexing" ? "animate-spin" : undefined} />
				</Button>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label={`Delete the index of ${ix.name}`}
					onClick={() => setRemoving(true)}
				>
					<Trash2 />
				</Button>
			</div>
			{ix.status === "indexing" && <Progress ix={ix} />}
			{ix.status === "error" && <p className="text-xs leading-5 text-danger">{ix.error}</p>}
			{ix.status === "ready" && (
				<form
					className="relative"
					onSubmit={(e) => {
						e.preventDefault();
						if (query.trim()) search.mutate();
					}}
				>
					<Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle" />
					<Input
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="Try a search: “where are sessions checked”"
						className="pl-9"
						aria-label={`Search ${ix.name}`}
					/>
					{search.isPending && <Spinner className="absolute top-1/2 right-3 -translate-y-1/2" />}
				</form>
			)}
			{hits && (
				<div className="flex flex-col gap-1.5">
					{hits.length === 0 && <p className="text-xs text-fg-subtle">Nothing matched.</p>}
					{hits.map((h) => (
						<details
							key={`${h.path}:${h.startLine}`}
							className="group rounded-xl bg-surface-2/50 px-3 py-2"
						>
							<summary className="flex cursor-pointer list-none items-center gap-2 text-xs">
								<span className="min-w-0 flex-1 truncate font-mono">
									{h.path}:{h.startLine}–{h.endLine}
								</span>
								{h.symbol && <span className="shrink-0 text-fg-subtle">{h.symbol}</span>}
							</summary>
							<pre className="mt-2 max-h-56 overflow-auto font-mono text-[11px] leading-4 whitespace-pre text-fg-muted scrollbar-thin">
								{h.content}
							</pre>
						</details>
					))}
				</div>
			)}
			<Confirm
				open={removing}
				onOpenChange={setRemoving}
				title={`Delete the index of ${ix.name}?`}
				description="The bot can't search this code until it's indexed again. The files themselves aren't touched."
				confirmLabel="Delete"
				danger
				onConfirm={() => remove.mutate()}
			/>
		</div>
	);
}

/** Codebases the bot indexed, to search them by meaning (code_index and code_search). */
export function CodeTab({ agent }: { agent: Agent }) {
	const qc = useQueryClient();
	const { data: indexes = [], isLoading } = useQuery({
		queryKey: ["code", agent.id],
		queryFn: () => api.code.list(agent.id),
		refetchInterval: (q) => (q.state.data?.some((i) => i.status === "indexing") ? 3000 : false),
	});
	const { data: machines = [] } = useMachines(agent.id);
	const usable = machines.filter((m) => m.status === "running");
	const [adding, setAdding] = useState(false);
	const [machineId, setMachineId] = useState("");
	const [root, setRoot] = useState("");
	const create = useMutation({
		mutationFn: () => api.code.create({ machineId: machineId || usable[0]?.id || "", root: root.trim() }),
		onSuccess: () => {
			setAdding(false);
			setRoot("");
			void qc.invalidateQueries({ queryKey: ["code", agent.id] });
		},
		onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
	});

	return (
		<div className="flex flex-col gap-4">
			<div className="flex items-start justify-between gap-3">
				<p className="text-xs leading-5 text-fg-subtle">
					Projects {agent.name} indexed, so it finds code by what it does, not just by name. It indexes them
					itself when it works on one, or add one here.
				</p>
				{!adding && usable.length > 0 && (
					<Button variant="secondary" size="xs" className="shrink-0" onClick={() => setAdding(true)}>
						<Plus /> Add
					</Button>
				)}
			</div>
			{adding && (
				<div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-3.5">
					{usable.length > 1 && (
						<Field label="On">
							<Select
								value={machineId || usable[0]?.id || ""}
								onValueChange={setMachineId}
								options={usable.map((m) => ({ value: m.id, label: m.name }))}
							/>
						</Field>
					)}
					<Field label="Folder" hint="The project's full path on that machine">
						<Input
							autoFocus
							value={root}
							onChange={(e) => setRoot(e.target.value)}
							placeholder="/home/bot/projects/app"
							className="font-mono text-[13px]"
						/>
					</Field>
					<div className="flex justify-end gap-2">
						<Button variant="ghost" size="sm" onClick={() => setAdding(false)}>
							Cancel
						</Button>
						<Button
							variant="primary"
							size="sm"
							disabled={!root.trim() || create.isPending}
							onClick={() => create.mutate()}
						>
							{create.isPending && <Spinner className="text-primary-foreground" />} Index it
						</Button>
					</div>
				</div>
			)}
			{isLoading ? (
				<Spinner />
			) : indexes.length === 0 && !adding ? (
				<EmptyState
					icon={<FolderGit2 />}
					title="No code indexed"
					description={
						usable.length
							? `Ask ${agent.name} to index a project (“index ~/app”), or add one.`
							: `${agent.name} needs a computer or devbox (or your computer, lent through the desktop app) first.`
					}
				/>
			) : (
				indexes.map((ix) => <IndexCard key={ix.id} ix={ix} />)
			)}
		</div>
	);
}
