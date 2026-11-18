import { api, cn, formatBytes, pluralize, timeAgo, useDocuments } from "@sekai/client";
import type { LibraryDocument, LibraryHit } from "@sekai/shared";
import {
	Button,
	Confirm,
	DropdownContent,
	DropdownItem,
	DropdownMenu,
	DropdownTrigger,
	EmptyState,
	IconButton,
	Input,
	Section,
	Skeleton,
	Spinner,
} from "@sekai/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
	CircleAlert,
	ExternalLink,
	FileText,
	FolderUp,
	Library,
	MoreHorizontal,
	RotateCw,
	Search,
	Trash2,
	TriangleAlert,
	Upload,
} from "lucide-react";
import { type DragEvent, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Page } from "../components/layout/PageHeader.tsx";

const ACCEPT = ".pdf,.docx,.md,.markdown,.txt,.csv,.tsv,.json,.html,.htm,.xml,.yaml,.yml,.rst,.org,.tex";

/** Files from a folder pick or a drop, with the folder they came in (if any). */
type Incoming = { file: File; collection: string };

function folderOf(file: File): string {
	const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? "";
	return rel.includes("/") ? (rel.split("/")[0] ?? "") : "";
}

function DocumentRow({ doc }: { doc: LibraryDocument }) {
	const [confirm, setConfirm] = useState(false);
	const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : String(e));
	const remove = useMutation({ mutationFn: () => api.documents.delete(doc.id), onError: fail });
	const reindex = useMutation({ mutationFn: () => api.documents.reindex(doc.id), onError: fail });
	const detail =
		doc.status === "indexing"
			? "Reading it…"
			: doc.status === "error"
				? doc.error
				: [
						doc.pages ? pluralize(doc.pages, "page") : null,
						pluralize(doc.chunks, "passage"),
						formatBytes(doc.size),
					]
						.filter(Boolean)
						.join(" · ");
	return (
		<div className="flex items-center gap-3 px-4 py-2.5 coarse:py-3.5">
			<span
				className={cn(
					"flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-fg-muted [&_svg]:size-[18px]",
					doc.status === "error" && "bg-danger/10 text-danger",
				)}
			>
				{doc.status === "indexing" ? <Spinner /> : doc.status === "error" ? <CircleAlert /> : <FileText />}
			</span>
			<div className="min-w-0 flex-1">
				<div className="truncate text-sm font-medium" title={doc.fileName}>
					{doc.title}
				</div>
				<div className={cn("truncate text-xs text-fg-subtle", doc.status === "error" && "text-danger")}>
					{detail}
				</div>
				{doc.status === "ready" && doc.error && (
					<div className="flex items-center gap-1 truncate text-xs text-warning">
						<TriangleAlert className="size-3 shrink-0" /> {doc.error}
					</div>
				)}
			</div>
			<span className="hidden shrink-0 text-xs text-fg-subtle sm:block">{timeAgo(doc.createdAt)}</span>
			<DropdownMenu>
				<DropdownTrigger asChild>
					<IconButton label={`More for ${doc.title}`} size="icon-sm">
						<MoreHorizontal />
					</IconButton>
				</DropdownTrigger>
				<DropdownContent align="end">
					{doc.url && (
						<DropdownItem
							icon={<ExternalLink />}
							onSelect={() => window.open(doc.url ?? "", "_blank", "noopener")}
						>
							Open the file
						</DropdownItem>
					)}
					<DropdownItem
						icon={<RotateCw />}
						disabled={doc.status === "indexing"}
						onSelect={() => reindex.mutate()}
					>
						Read it again
					</DropdownItem>
					<DropdownItem icon={<Trash2 />} danger onSelect={() => setConfirm(true)}>
						Delete
					</DropdownItem>
				</DropdownContent>
			</DropdownMenu>
			<Confirm
				open={confirm}
				onOpenChange={setConfirm}
				title={`Delete "${doc.title}"?`}
				description="Bots can't search it anymore, and the file is deleted from Sekai."
				confirmLabel="Delete"
				danger
				onConfirm={() => remove.mutate()}
			/>
		</div>
	);
}

function Hit({ hit }: { hit: LibraryHit }) {
	return (
		<div className="flex flex-col gap-1 px-4 py-3">
			<div className="flex items-baseline gap-2 text-xs text-fg-subtle">
				<span className="truncate font-medium text-fg">{hit.title}</span>
				{hit.page !== null && <span className="shrink-0">page {hit.page}</span>}
				{hit.heading && <span className="truncate">· {hit.heading}</span>}
			</div>
			<p className="line-clamp-4 text-[13px] leading-5 whitespace-pre-line text-fg-muted">{hit.content}</p>
		</div>
	);
}

function TrySearch() {
	const [query, setQuery] = useState("");
	const [q, setQ] = useState("");
	useEffect(() => {
		const t = setTimeout(() => setQ(query.trim()), 350);
		return () => clearTimeout(t);
	}, [query]);
	const { data: hits, isFetching } = useQuery({
		queryKey: ["documents", "search", q],
		queryFn: () => api.documents.search(q, 6),
		enabled: q.length >= 2,
	});
	return (
		<Section title="Try a search" description="The way your bots search: by meaning, and by the words themselves.">
			<div className="relative">
				<Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle" />
				<Input
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					placeholder="What does the warranty cover?"
					aria-label="Search the library"
					className="pl-9"
				/>
				{isFetching && <Spinner className="absolute top-1/2 right-3 -translate-y-1/2" />}
			</div>
			{q.length >= 2 && hits && (
				<div className="flex flex-col divide-y divide-border rounded-2xl border border-border bg-card">
					{hits.length === 0 ? (
						<p className="px-4 py-3 text-[13px] text-fg-subtle">Nothing matches.</p>
					) : (
						hits.map((h) => <Hit key={`${h.documentId}-${h.chunk}`} hit={h} />)
					)}
				</div>
			)}
		</Section>
	);
}

export function LibraryPage() {
	const { data: docs = [], isLoading } = useDocuments();
	const files = useRef<HTMLInputElement>(null);
	const folder = useRef<HTMLInputElement>(null);
	const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
	const [dragging, setDragging] = useState(false);

	const upload = async (incoming: Incoming[]) => {
		if (!incoming.length) return;
		setProgress({ done: 0, total: incoming.length });
		const failed: string[] = [];
		for (const [i, item] of incoming.entries()) {
			try {
				await api.documents.upload(item.file, item.collection);
			} catch (e) {
				failed.push(`${item.file.name}: ${e instanceof Error ? e.message : String(e)}`);
			}
			setProgress({ done: i + 1, total: incoming.length });
		}
		setProgress(null);
		if (failed.length)
			toast.error(failed.slice(0, 3).join("\n") + (failed.length > 3 ? `\n…and ${failed.length - 3} more` : ""));
		else
			toast.success(
				incoming.length === 1 ? "Added. Bots can search it in a moment." : `Added ${incoming.length} files`,
			);
	};

	const onDrop = (e: DragEvent) => {
		e.preventDefault();
		setDragging(false);
		void upload([...e.dataTransfer.files].map((file) => ({ file, collection: "" })));
	};

	const groups = new Map<string, LibraryDocument[]>();
	for (const d of docs) groups.set(d.collection, [...(groups.get(d.collection) ?? []), d]);
	const indexing = docs.filter((d) => d.status === "indexing").length;

	return (
		<Page
			title="Library"
			description="Documents every bot can search: manuals, papers, notes, contracts. They cite the title and page."
			actions={
				<div className="flex gap-2">
					<Button
						variant="ghost"
						size="sm"
						onClick={() => folder.current?.click()}
						disabled={progress !== null}
					>
						<FolderUp /> Folder
					</Button>
					<Button
						variant="primary"
						size="sm"
						onClick={() => files.current?.click()}
						disabled={progress !== null}
					>
						<Upload /> Add files
					</Button>
				</div>
			}
		>
			<input
				ref={files}
				type="file"
				multiple
				accept={ACCEPT}
				className="hidden"
				onChange={(e) => {
					void upload([...(e.target.files ?? [])].map((file) => ({ file, collection: "" })));
					e.target.value = "";
				}}
			/>
			<input
				ref={folder}
				type="file"
				multiple
				className="hidden"
				// A whole folder; its name becomes the collection. (Not a standard attribute, so set as a string.)
				{...{ webkitdirectory: "" }}
				onChange={(e) => {
					const all = [...(e.target.files ?? [])].filter((f) => !f.name.startsWith("."));
					void upload(all.map((file) => ({ file, collection: folderOf(file) })));
					e.target.value = "";
				}}
			/>
			<div
				className={cn(
					"flex flex-col gap-7",
					dragging && "rounded-3xl ring-2 ring-brand/40 ring-offset-4 ring-offset-bg",
				)}
				onDragOver={(e) => {
					e.preventDefault();
					setDragging(true);
				}}
				onDragLeave={() => setDragging(false)}
				onDrop={onDrop}
			>
				{progress && (
					<div className="flex items-center gap-3 rounded-2xl bg-surface-2/60 px-4 py-3 text-[13px]">
						<Spinner /> Uploading {Math.min(progress.done + 1, progress.total)} of {progress.total}…
					</div>
				)}
				{isLoading ? (
					<Skeleton className="h-48 rounded-2xl" />
				) : docs.length === 0 ? (
					<EmptyState
						icon={<Library />}
						title="Nothing here yet"
						description="Add PDFs, Word files, Markdown or text (or drop them here), or a whole folder. Every bot can then search them."
						action={
							<Button variant="primary" onClick={() => files.current?.click()}>
								<Upload /> Add files
							</Button>
						}
					/>
				) : (
					<>
						{docs.some((d) => d.status === "ready") && <TrySearch />}
						{[...groups.entries()].map(([collection, list]) => (
							<Section
								key={collection || "_files"}
								title={collection || (groups.size > 1 ? "Files" : "Documents")}
								description={
									collection === "" && indexing
										? `Reading ${pluralize(indexing, "document")}…`
										: undefined
								}
							>
								<div className="flex flex-col divide-y divide-border rounded-2xl border border-border bg-card">
									{list.map((d) => (
										<DocumentRow key={d.id} doc={d} />
									))}
								</div>
							</Section>
						))}
						<p className="text-xs text-fg-subtle">
							Reads PDF, Word (.docx), Markdown, text, HTML, CSV and JSON, up to 25 MB each. Scanned PDFs
							need OCR first. Drop files anywhere on this page.
						</p>
					</>
				)}
			</div>
		</Page>
	);
}
