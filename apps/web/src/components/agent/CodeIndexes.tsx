import { api, cn, timeAgo, useMachines } from "@sekai/client";
import type { Agent, CodeIndex, CodeSearchHit } from "@sekai/shared";
import {
	Button,
	Confirm,
	Dialog,
	EmptyState,
	ErrorState,
	Field,
	Input,
	Link,
	List,
	type MenuEntry,
	Row,
	Section,
	Select,
	SkeletonRows,
} from "@sekai/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, FolderGit2, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { botPath } from "../../bots/registry.tsx";

const fmtBytes = (n: number) =>
	n > 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : n > 1000 ? `${Math.round(n / 1000)} KB` : `${n} B`;

function Progress({ ix }: { ix: CodeIndex }) {
	const p = ix.progress;
	const frac = p?.phase === "embedding" && p.total ? p.done / p.total : null;
	return (
		<div className="mt-2 flex flex-col gap-1">
			<div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
				<div
					className={cn(
						"h-full rounded-full bg-brand transition-[width] duration-panel",
						frac === null && "w-1/3 animate-pulse",
					)}
					style={frac === null ? undefined : { width: `${Math.max(4, Math.round(frac * 100))}%` }}
				/>
			</div>
			<span className="text-small text-fg-subtle">
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

/** Search one project by what the code does (the bot's code_search, tried by hand). */
function SearchDialog({ ix, onClose }: { ix: CodeIndex | null; onClose: () => void }) {
	const [query, setQuery] = useState("");
	const [hits, setHits] = useState<CodeSearchHit[] | null>(null);
	const [seen, setSeen] = useState<string | null>(null);
	if ((ix?.id ?? null) !== seen) {
		setSeen(ix?.id ?? null);
		setQuery("");
		setHits(null);
	}
	const search = useMutation({ mutationFn: () => api.code.search(ix?.id ?? "", query, 5), onSuccess: setHits });
	return (
		<Dialog
			open={ix !== null}
			onOpenChange={(o) => !o && onClose()}
			size="lg"
			title={`Search ${ix?.name ?? ""}`}
			description="Describe what you're looking for, the way you would to a teammate."
		>
			<form
				className="flex flex-col gap-4"
				onSubmit={(e) => {
					e.preventDefault();
					if (query.trim()) search.mutate();
				}}
			>
				<div className="flex gap-2">
					<Input
						autoFocus
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="e.g. where are sessions checked"
						aria-label={`Search ${ix?.name ?? "the project"}`}
					/>
					<Button type="submit" variant="secondary" loading={search.isPending} disabled={!query.trim()}>
						<Search /> Search
					</Button>
				</div>
				{hits && (
					<div className="flex flex-col gap-1.5">
						{hits.length === 0 && <p className="text-small text-fg-subtle">Nothing matched.</p>}
						{hits.map((h) => (
							<details key={`${h.path}:${h.startLine}`} className="rounded-lg bg-surface-2 px-3 py-2">
								<summary className="flex cursor-pointer list-none items-center gap-2 text-small">
									<span className="min-w-0 flex-1 truncate font-mono">
										{h.path}:{h.startLine}–{h.endLine}
									</span>
									{h.symbol && <span className="shrink-0 text-fg-subtle">{h.symbol}</span>}
								</summary>
								<pre className="mt-2 max-h-56 overflow-auto font-mono text-caption whitespace-pre text-fg-muted scrollbar-thin">
									{h.content}
								</pre>
							</details>
						))}
					</div>
				)}
			</form>
		</Dialog>
	);
}

function IndexRow({ ix, onSearch, onDelete }: { ix: CodeIndex; onSearch: () => void; onDelete: () => void }) {
	const qc = useQueryClient();
	const again = useMutation({
		mutationFn: () => api.code.refresh(ix.id),
		onSuccess: () => void qc.invalidateQueries({ queryKey: ["code", ix.agentId] }),
	});
	const ready = ix.status === "ready";
	const menu: MenuEntry[] = [
		ready && { label: "Search", icon: <Search />, onSelect: onSearch },
		{
			label: "Index again",
			icon: <RefreshCw />,
			disabled: ix.status === "indexing" || again.isPending,
			onSelect: () => again.mutate(),
		},
		{ label: "Delete index", icon: <Trash2 />, danger: true, onSelect: onDelete },
	];
	return (
		<Row
			icon={ix.status === "error" ? <CircleAlert /> : <FolderGit2 />}
			iconTone={ix.status === "error" ? "danger" : "neutral"}
			title={ix.name}
			subtitle={
				ix.status === "error" ? (
					<span className="text-danger-ink">{ix.error}</span>
				) : (
					<span className="break-all">
						{ix.root} · {ix.machineName}
						{ready &&
							` · ${ix.files.toLocaleString()} files · ${fmtBytes(ix.bytes)}${ix.lastIndexedAt ? ` · ${timeAgo(ix.lastIndexedAt)}` : ""}`}
					</span>
				)
			}
			onClick={ready ? onSearch : undefined}
			menu={menu}
			menuLabel={`${ix.name} actions`}
		>
			{ix.status === "indexing" && <Progress ix={ix} />}
		</Row>
	);
}

/** Codebases the bot indexed, to search them by meaning (code_index and code_search). */
export function CodeIndexes({ agent }: { agent: Agent }) {
	const qc = useQueryClient();
	const indexes = useQuery({
		queryKey: ["code", agent.id],
		queryFn: () => api.code.list(agent.id),
		refetchInterval: (q) => (q.state.data?.some((i) => i.status === "indexing") ? 3000 : false),
	});
	const { data: machines = [] } = useMachines(agent.id);
	const usable = machines.filter((m) => m.status === "running");
	const [adding, setAdding] = useState(false);
	const [machineId, setMachineId] = useState("");
	const [root, setRoot] = useState("");
	const [searching, setSearching] = useState<CodeIndex | null>(null);
	const [removing, setRemoving] = useState<CodeIndex | null>(null);
	const create = useMutation({
		mutationFn: () => api.code.create({ machineId: machineId || usable[0]?.id || "", root: root.trim() }),
		onSuccess: () => {
			setAdding(false);
			setRoot("");
			void qc.invalidateQueries({ queryKey: ["code", agent.id] });
		},
	});
	const remove = useMutation({
		mutationFn: (ix: CodeIndex) => api.code.delete(ix.id),
		onSuccess: () => void qc.invalidateQueries({ queryKey: ["code", agent.id] }),
		onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't delete the index."),
	});
	const list = indexes.data ?? [];

	return (
		<Section
			title="Code"
			description={`Projects ${agent.name} can search by what the code does. It indexes them itself, or you can.`}
			action={
				usable.length > 0 &&
				list.length > 0 && (
					<Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
						<Plus /> Add a project
					</Button>
				)
			}
		>
			{indexes.isLoading ? (
				<SkeletonRows count={2} />
			) : indexes.isError ? (
				<ErrorState size="sm" error={indexes.error} onRetry={() => void indexes.refetch()} />
			) : list.length === 0 ? (
				<EmptyState
					size="sm"
					icon={<FolderGit2 />}
					title="No code indexed yet"
					description={
						usable.length
							? `Ask ${agent.name} to index a project, or add one here.`
							: `${agent.name} needs a computer or devbox to index code on.`
					}
					action={
						usable.length ? (
							<Button variant="secondary" onClick={() => setAdding(true)}>
								<Plus /> Add a project
							</Button>
						) : (
							<Button variant="secondary" asChild>
								<Link href={botPath(agent.id, "computer")}>Open its computer</Link>
							</Button>
						)
					}
				/>
			) : (
				<List label="Indexed projects">
					{list.map((ix) => (
						<IndexRow
							key={ix.id}
							ix={ix}
							onSearch={() => setSearching(ix)}
							onDelete={() => setRemoving(ix)}
						/>
					))}
				</List>
			)}
			<Dialog
				open={adding}
				onOpenChange={setAdding}
				title="Add a project"
				description="Pick the folder to index. The files themselves aren't touched."
				footer={
					<>
						<Button variant="secondary" onClick={() => setAdding(false)}>
							Cancel
						</Button>
						<Button
							variant="primary"
							disabled={!root.trim()}
							loading={create.isPending}
							onClick={() => create.mutate()}
						>
							Index it
						</Button>
					</>
				}
			>
				<form
					className="flex flex-col gap-4"
					onSubmit={(e) => {
						e.preventDefault();
						if (root.trim() && !create.isPending) create.mutate();
					}}
				>
					{usable.length > 1 && (
						<Field label="On">
							<Select
								value={machineId || usable[0]?.id || ""}
								onValueChange={setMachineId}
								options={usable.map((m) => ({ value: m.id, label: m.name }))}
							/>
						</Field>
					)}
					<Field label="Folder" hint="The project's full path on that computer.">
						<Input
							autoFocus
							value={root}
							onChange={(e) => setRoot(e.target.value)}
							placeholder="e.g. /home/bot/projects/app"
							className="font-mono"
						/>
					</Field>
				</form>
			</Dialog>
			<SearchDialog ix={searching} onClose={() => setSearching(null)} />
			<Confirm
				open={removing !== null}
				onOpenChange={(o) => !o && setRemoving(null)}
				title={`Delete the index of ${removing?.name ?? "this project"}?`}
				description={`${agent.name} can't search this code until it's indexed again. The files themselves aren't touched.`}
				confirmLabel="Delete index"
				danger
				onConfirm={() => removing && remove.mutate(removing)}
			/>
		</Section>
	);
}
