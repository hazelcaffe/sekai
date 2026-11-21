import { api, cn, formatBytes, pluralize, qk, timeAgo, useAccess, useDocuments } from "@sekai/client";
import type { LibraryDocument, LibraryHit } from "@sekai/shared";
import {
	Button,
	Confirm,
	Dialog,
	DropdownContent,
	DropdownEntries,
	DropdownMenu,
	DropdownTrigger,
	EmptyState,
	ErrorState,
	errorMessage,
	Field,
	Fold,
	IconButton,
	Input,
	List,
	type MenuEntry,
	Page,
	Row,
	Section,
	SkeletonRows,
	Spinner,
} from "@sekai/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	CircleAlert,
	Ellipsis,
	ExternalLink,
	FileText,
	FolderUp,
	Library,
	Pencil,
	RotateCw,
	Search,
	Trash2,
	Upload,
} from "lucide-react";
import { type DragEvent, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { SearchInput } from "../components/activity/SearchInput.tsx";

const ACCEPT = ".pdf,.docx,.md,.markdown,.txt,.csv,.tsv,.json,.html,.htm,.xml,.yaml,.yml,.rst,.org,.tex";

/** Files from a folder pick or a drop, with the folder they came in (if any). */
type Incoming = { file: File; collection: string };

function folderOf(file: File): string {
	const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? "";
	return rel.includes("/") ? (rel.split("/")[0] ?? "") : "";
}

function sourceHref(doc: LibraryDocument | undefined, page: number | null = null): string | null {
	if (!doc?.url) return null;
	if (page !== null && doc.mime === "application/pdf") return `${doc.url}#page=${page}`;
	return doc.url;
}

function openExternal(url: string) {
	window.open(url, "_blank", "noopener");
}

function DocumentRow({ doc }: { doc: LibraryDocument }) {
	const qc = useQueryClient();
	const [confirmDelete, setConfirmDelete] = useState(false);
	const [renaming, setRenaming] = useState(false);
	const [titleDraft, setTitleDraft] = useState(doc.title);

	const fail = (e: unknown) => toast.error(errorMessage(e));
	const remove = useMutation({
		mutationFn: () => api.documents.delete(doc.id),
		onSuccess: () => void qc.invalidateQueries({ queryKey: qk.documents }),
		onError: fail,
	});
	const reindex = useMutation({
		mutationFn: () => api.documents.reindex(doc.id),
		onSuccess: () => void qc.invalidateQueries({ queryKey: qk.documents }),
		onError: fail,
	});
	const rename = useMutation({
		mutationFn: (title: string) => api.documents.rename(doc.id, title),
		onSuccess: () => {
			void qc.invalidateQueries({ queryKey: qk.documents });
			setRenaming(false);
		},
		onError: fail,
	});

	const subtitle =
		doc.status === "indexing" ? (
			"Reading document…"
		) : doc.status === "error" ? (
			<span className="text-danger-ink">{errorMessage(doc.error)}</span>
		) : (
			<span>
				{[
					doc.pages ? pluralize(doc.pages, "page") : null,
					pluralize(doc.chunks, "passage"),
					formatBytes(doc.size),
				]
					.filter(Boolean)
					.join(" · ")}
				{doc.error ? <span className="text-warning-ink"> · {doc.error}</span> : null}
			</span>
		);

	const menu: MenuEntry[] = [
		Boolean(doc.url) && {
			label: "Open file",
			icon: <ExternalLink />,
			onSelect: () => openExternal(doc.url ?? ""),
		},
		{
			label: "Rename",
			icon: <Pencil />,
			onSelect: () => {
				setTitleDraft(doc.title);
				setRenaming(true);
			},
		},
		{
			label: "Read again",
			icon: <RotateCw />,
			disabled: doc.status === "indexing" || reindex.isPending,
			onSelect: () => reindex.mutate(),
		},
		{
			label: "Delete",
			icon: <Trash2 />,
			danger: true,
			onSelect: () => setConfirmDelete(true),
		},
	];

	return (
		<>
			<Row
				icon={doc.status === "indexing" ? <Spinner /> : doc.status === "error" ? <CircleAlert /> : <FileText />}
				iconTone={doc.status === "error" ? "danger" : "neutral"}
				title={doc.title}
				subtitle={subtitle}
				value={<span className="text-caption max-sm:hidden">{timeAgo(doc.createdAt)}</span>}
				onClick={doc.url ? () => openExternal(doc.url ?? "") : undefined}
				chevron={false}
				menu={menu}
				menuLabel={`More for ${doc.title}`}
			/>
			<Dialog
				open={renaming}
				onOpenChange={setRenaming}
				title="Rename document"
				size="sm"
				footer={
					<>
						<Button variant="ghost" onClick={() => setRenaming(false)} disabled={rename.isPending}>
							Cancel
						</Button>
						<Button
							variant="primary"
							loading={rename.isPending}
							disabled={!titleDraft.trim() || titleDraft.trim() === doc.title}
							onClick={() => rename.mutate(titleDraft.trim())}
						>
							Save
						</Button>
					</>
				}
			>
				<form
					onSubmit={(e) => {
						e.preventDefault();
						if (titleDraft.trim() && titleDraft.trim() !== doc.title) rename.mutate(titleDraft.trim());
					}}
				>
					<Field label="Title" hint={`File: ${doc.fileName}`}>
						<Input
							value={titleDraft}
							onChange={(e) => setTitleDraft(e.target.value)}
							placeholder="e.g. Field Notes issue 03"
						/>
					</Field>
				</form>
			</Dialog>
			<Confirm
				open={confirmDelete}
				onOpenChange={setConfirmDelete}
				title={`Delete "${doc.title}"?`}
				description="Bots won't be able to search it anymore, and the file will be deleted from Sekai."
				confirmLabel="Delete"
				danger
				onConfirm={() => remove.mutate()}
			/>
		</>
	);
}

/** A search result: the document and the start of the passage; it opens to the whole passage and the page. */
function HitRow({ hit, doc }: { hit: LibraryHit; doc?: LibraryDocument }) {
	const [open, setOpen] = useState(false);
	const url = sourceHref(doc, hit.page);
	return (
		<Row
			icon={<FileText />}
			title={hit.title}
			subtitle={<span className={cn("block whitespace-pre-line", !open && "line-clamp-2")}>{hit.content}</span>}
			value={hit.page !== null ? <span className="text-caption tabular-nums">page {hit.page}</span> : undefined}
			open={open}
			onOpenChange={setOpen}
			details={
				<div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-fg-muted">
					{hit.heading && <span>{hit.heading}</span>}
					{url ? (
						<a
							href={url}
							target="_blank"
							rel="noopener noreferrer"
							className="inline-flex items-center gap-1.5 font-medium text-brand-ink hover:underline"
						>
							<ExternalLink className="size-4" />
							{hit.page !== null ? `Open page ${hit.page}` : "Open the document"}
						</a>
					) : (
						!hit.heading && <span>From {doc?.fileName ?? hit.title}</span>
					)}
				</div>
			}
		/>
	);
}

function LibrarySearch({ docsById }: { docsById: ReadonlyMap<string, LibraryDocument> }) {
	const [query, setQuery] = useState("");
	const [q, setQ] = useState("");
	useEffect(() => {
		const t = setTimeout(() => setQ(query.trim()), 300);
		return () => clearTimeout(t);
	}, [query]);
	const {
		data: hits,
		isFetching,
		isError,
		error,
		refetch,
	} = useQuery({
		queryKey: ["documents", "search", q],
		queryFn: () => api.documents.search(q, 8),
		enabled: q.length >= 2,
	});
	return (
		<div className="flex flex-col gap-3">
			<SearchInput
				value={query}
				onValueChange={setQuery}
				placeholder="Search documents by words or meaning…"
				label="Search the library"
				loading={isFetching}
			/>
			{q.length >= 2 &&
				(isError ? (
					<ErrorState size="sm" title="Search didn't work" error={error} onRetry={() => void refetch()} />
				) : hits ? (
					hits.length === 0 ? (
						<EmptyState
							size="sm"
							icon={<Search />}
							title="Nothing matches"
							description="Try different words or a broader question."
						/>
					) : (
						<List label="Search results">
							{hits.map((h) => (
								<HitRow key={`${h.documentId}-${h.chunk}`} hit={h} doc={docsById.get(h.documentId)} />
							))}
						</List>
					)
				) : null)}
		</div>
	);
}

export function LibraryPage() {
	const { can } = useAccess();
	const canUpload = can("library");
	const { data: docs = [], isLoading, isError, error, refetch } = useDocuments();
	const files = useRef<HTMLInputElement>(null);
	const folder = useRef<HTMLInputElement>(null);
	const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
	const [dragging, setDragging] = useState(false);

	const docsById = useMemo(() => new Map(docs.map((d) => [d.id, d])), [docs]);

	const upload = async (incoming: Incoming[]) => {
		if (!incoming.length || !canUpload) return;
		setProgress({ done: 0, total: incoming.length });
		const failed: string[] = [];
		for (const [i, item] of incoming.entries()) {
			try {
				await api.documents.upload(item.file, item.collection);
			} catch (e) {
				failed.push(`${item.file.name}: ${errorMessage(e)}`);
			}
			setProgress({ done: i + 1, total: incoming.length });
		}
		setProgress(null);
		if (failed.length) {
			toast.error(failed.slice(0, 3).join("\n") + (failed.length > 3 ? `\n…and ${failed.length - 3} more` : ""));
		} else {
			toast.success(
				incoming.length === 1 ? "Added. Bots can search it in a moment." : `Added ${incoming.length} files`,
			);
		}
	};

	const onDrop = (e: DragEvent) => {
		e.preventDefault();
		setDragging(false);
		if (!canUpload) return;
		void upload([...e.dataTransfer.files].map((file) => ({ file, collection: "" })));
	};

	const groups = new Map<string, LibraryDocument[]>();
	for (const d of docs) groups.set(d.collection, [...(groups.get(d.collection) ?? []), d]);
	const indexing = docs.filter((d) => d.status === "indexing").length;

	const overflowEntries: MenuEntry[] = [
		{
			label: "Upload folder",
			icon: <FolderUp />,
			disabled: progress !== null,
			onSelect: () => folder.current?.click(),
		},
	];

	return (
		<Page
			title="Library"
			description="Documents every bot can search and cite by page."
			actions={
				canUpload && !isError ? (
					<div className="flex items-center gap-1.5">
						<Button
							variant="ghost"
							size="sm"
							className="max-md:hidden"
							onClick={() => folder.current?.click()}
							disabled={progress !== null}
						>
							<FolderUp /> Upload folder
						</Button>
						{docs.length > 0 && (
							<Button
								variant="primary"
								size="sm"
								onClick={() => files.current?.click()}
								disabled={progress !== null}
							>
								<Upload /> Add files
							</Button>
						)}
						<div className="md:hidden">
							<DropdownMenu>
								<DropdownTrigger asChild>
									<IconButton label="More upload options" size="icon-sm">
										<Ellipsis />
									</IconButton>
								</DropdownTrigger>
								<DropdownContent title="Upload options">
									<DropdownEntries entries={overflowEntries} />
								</DropdownContent>
							</DropdownMenu>
						</div>
					</div>
				) : undefined
			}
		>
			{canUpload && (
				<>
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
				</>
			)}
			<div
				className={cn(
					"flex flex-col gap-7",
					dragging && canUpload && "rounded-xl ring-2 ring-brand/40 ring-offset-4 ring-offset-bg",
				)}
				onDragOver={
					canUpload
						? (e) => {
								e.preventDefault();
								setDragging(true);
							}
						: undefined
				}
				onDragLeave={canUpload ? () => setDragging(false) : undefined}
				onDrop={canUpload ? onDrop : undefined}
			>
				{progress && (
					<div
						role="status"
						className="flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-body tabular-nums"
					>
						<Spinner /> Uploading {Math.min(progress.done + 1, progress.total)} of {progress.total}…
					</div>
				)}
				{isLoading ? (
					<SkeletonRows count={4} />
				) : isError ? (
					<ErrorState title="Library didn't load" error={error} onRetry={() => void refetch()} />
				) : docs.length === 0 ? (
					<EmptyState
						icon={<Library />}
						title="No documents yet"
						description={
							canUpload
								? "Add PDFs, Word docs, Markdown or text so every bot can search them."
								: "Uploading documents isn't enabled for your role. Ask an admin if you need it."
						}
						action={
							canUpload ? (
								<Button variant="primary" onClick={() => files.current?.click()}>
									<Upload /> Add files
								</Button>
							) : undefined
						}
					/>
				) : (
					<>
						{!canUpload && (
							<p className="text-small text-fg-muted">
								Your role can search documents here; ask an admin to allow uploads.
							</p>
						)}
						{docs.some((d) => d.status === "ready") && <LibrarySearch docsById={docsById} />}
						{[...groups.entries()].map(([collection, list]) => (
							<Section
								key={collection || "_files"}
								title={collection || (groups.size > 1 ? "Other files" : "Documents")}
								description={
									collection === "" && indexing
										? `Reading ${pluralize(indexing, "document")}…`
										: undefined
								}
							>
								<List label={collection || "Documents"}>
									{list.map((d) => (
										<DocumentRow key={d.id} doc={d} />
									))}
								</List>
							</Section>
						))}
						{canUpload && (
							<Fold variant="link" title="Supported files">
								Reads PDF, Word (.docx), Markdown, text, HTML, CSV and JSON up to 25 MB each. Scanned
								PDFs need OCR first. Drop files anywhere on this page, or upload a folder to group them.
							</Fold>
						)}
					</>
				)}
			</div>
		</Page>
	);
}
