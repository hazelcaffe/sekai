import { api, dateTime, formatBytes, timeAgo } from "@sekai/client";
import type { BackupConfigUpdate, BackupInfo, BackupKind, BackupSchedule, BackupStatus } from "@sekai/shared";
import {
	type Autosave,
	Badge,
	Button,
	Callout,
	Confirm,
	EmptyState,
	ErrorState,
	errorMessage,
	Fold,
	Input,
	List,
	type MenuEntry,
	Page,
	Row,
	SaveState,
	Section,
	Segmented,
	SelectRow,
	SkeletonRows,
	useAutosave,
} from "@sekai/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	Archive,
	CalendarClock,
	CircleAlert,
	CircleCheck,
	DatabaseBackup,
	Download,
	Folder,
	HardDriveUpload,
	History,
	RotateCcw,
	Send,
	Trash2,
	Upload,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { SettingsSectionProps } from "../section.ts";

const KEY = ["backups"] as const;

const KIND_LABEL: Record<BackupKind, string> = {
	scheduled: "Automatic",
	manual: "Made by you",
	"before-restore": "Before a restore",
	uploaded: "Uploaded",
};

const fail = (e: unknown) => toast.error(errorMessage(e));

function CopyToRows({
	status,
	autosave,
	readOnly,
}: {
	status: BackupStatus;
	autosave: Autosave<BackupConfigUpdate>;
	readOnly?: boolean;
}) {
	const { data: hosts = [] } = useQuery({ queryKey: ["hosts"], queryFn: api.hosts.list, staleTime: 30_000 });
	const copy = status.config.copyTo;
	const [dir, setDir] = useState(copy?.dir ?? "sekai-backups");
	useEffect(() => setDir(copy?.dir ?? "sekai-backups"), [copy?.dir]);
	const last = status.lastCopy;

	const saveDir = () => {
		if (!copy) return;
		const trimmed = dir.trim() || "sekai-backups";
		setDir(trimmed);
		if (trimmed !== copy.dir) {
			autosave.save({ copyTo: { hostId: copy.hostId, dir: trimmed } });
		}
	};

	return (
		<>
			<SelectRow
				icon={<Send />}
				title="Also copy to"
				description={
					<>
						Keep an off-server copy on one of your devices.
						{copy && last && (
							<span
								className={last.ok ? "mt-0.5 block text-success-ink" : "mt-0.5 block text-danger-ink"}
							>
								{last.ok
									? `Last copied ${timeAgo(last.at)}`
									: `Last copy failed: ${errorMessage(last.error)}`}
							</span>
						)}
					</>
				}
				value={copy?.hostId ?? "none"}
				disabled={readOnly}
				onValueChange={(v) =>
					autosave.save({
						copyTo: v === "none" ? null : { hostId: v, dir: dir.trim() || "sekai-backups" },
					})
				}
				options={[
					{ value: "none", label: "Nowhere else" },
					...hosts.map((h) => ({ value: h.id, label: h.name })),
				]}
			/>
			{copy && (
				<Row
					icon={<Folder />}
					title="Folder on device"
					subtitle="Saved inside that device's home folder."
					wrap
					trailing={
						<Input
							value={dir}
							disabled={readOnly}
							onChange={(e) => setDir(e.target.value)}
							onBlur={saveDir}
							onKeyDown={(e) => {
								if (e.key === "Enter") {
									e.preventDefault();
									saveDir();
								}
							}}
							aria-label="Folder on device"
							placeholder="e.g. sekai-backups"
							className="w-full sm:w-52"
						/>
					}
				/>
			)}
		</>
	);
}

function BackupItemRow({ b, pending, readOnly }: { b: BackupInfo; pending: boolean; readOnly?: boolean }) {
	const qc = useQueryClient();
	const [confirm, setConfirm] = useState<"restore" | "delete" | null>(null);
	const restore = useMutation({
		mutationFn: () => api.backups.restore(b.name),
		onSuccess: (s) => {
			qc.setQueryData(KEY, s);
			toast.success("Restart Sekai to restore this backup");
		},
		onError: fail,
	});
	const remove = useMutation({
		mutationFn: () => api.backups.delete(b.name),
		onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
		onError: fail,
	});

	const download = () => {
		// A backup holds every secret: confirm it's you first when needed.
		void api.auth
			.ensureRecent()
			.then(() => {
				const a = document.createElement("a");
				a.href = api.backups.downloadUrl(b.name);
				a.download = b.name;
				a.click();
			})
			.catch(() => {});
	};

	const details = [
		KIND_LABEL[b.kind],
		formatBytes(b.size),
		b.files !== null ? `${b.files.toLocaleString()} files` : null,
		b.app ? `Sekai ${b.app}` : null,
	].filter(Boolean);

	const label = dateTime(b.createdAt);
	const menu: MenuEntry[] = [
		{ label: "Download", icon: <Download />, onSelect: download },
		!readOnly && {
			label: "Restore at restart",
			icon: <RotateCcw />,
			disabled: pending || restore.isPending,
			onSelect: () => setConfirm("restore"),
		},
		!readOnly && {
			label: "Delete",
			icon: <Trash2 />,
			danger: true,
			disabled: remove.isPending,
			onSelect: () => setConfirm("delete"),
		},
	];

	return (
		<>
			<Row
				icon={
					b.kind === "before-restore" ? (
						<History />
					) : b.kind === "uploaded" ? (
						<HardDriveUpload />
					) : (
						<Archive />
					)
				}
				iconTone={pending ? "warning" : "neutral"}
				title={label}
				subtitle={details.join(" · ")}
				badge={pending ? <Badge tone="warning">Restores at restart</Badge> : undefined}
				trailing={
					<Button variant="ghost" size="sm" className="max-sm:hidden" onClick={download}>
						<Download /> Download
					</Button>
				}
				menu={menu}
				menuLabel={`Actions for backup from ${label}`}
			/>
			<Confirm
				open={confirm === "restore"}
				onOpenChange={(o) => !o && setConfirm(null)}
				title="Restore this backup?"
				description={`Bots, chats, memory, settings, keys and uploads will go back to ${label} the next time Sekai starts. What's here now is backed up first so you can return to it.`}
				confirmLabel="Restore at restart"
				danger
				onConfirm={() => restore.mutate()}
			/>
			<Confirm
				open={confirm === "delete"}
				onOpenChange={(o) => !o && setConfirm(null)}
				title="Delete this backup?"
				description={`The backup from ${label} will be deleted from this server. Downloaded or off-server copies stay.`}
				confirmLabel="Delete"
				danger
				onConfirm={() => remove.mutate()}
			/>
		</>
	);
}

export function BackupsSection({ back, readOnly }: SettingsSectionProps) {
	const qc = useQueryClient();
	const {
		data: status,
		isLoading,
		isError,
		error,
		refetch,
	} = useQuery({ queryKey: KEY, queryFn: api.backups.status });

	const autosave = useAutosave<BackupConfigUpdate>(async (patch) => {
		const next = await api.backups.configure(patch);
		qc.setQueryData(KEY, next);
	});

	const file = useRef<HTMLInputElement>(null);
	const create = useMutation({
		mutationFn: api.backups.create,
		onSuccess: (b) => {
			void qc.invalidateQueries({ queryKey: KEY });
			toast.success(`Backed up (${formatBytes(b.size)})`);
		},
		onError: fail,
	});
	const upload = useMutation({
		mutationFn: (f: File) => api.backups.upload(f),
		onSuccess: () => {
			void qc.invalidateQueries({ queryKey: KEY });
			toast.success("Backup uploaded. Restore it from the list.");
		},
		onError: fail,
	});
	const cancel = useMutation({
		mutationFn: api.backups.cancelRestore,
		onSuccess: (s) => qc.setQueryData(KEY, s),
		onError: fail,
	});

	const working = Boolean(status?.running) || create.isPending;

	return (
		<Page
			back={back}
			title="Backups"
			description="Save everything on a schedule or right now, and restore in one go."
			actions={
				!readOnly ? (
					<Button variant="primary" size="sm" loading={working} onClick={() => create.mutate()}>
						<DatabaseBackup /> Back up now
					</Button>
				) : undefined
			}
		>
			{isLoading ? (
				<>
					<SkeletonRows count={3} leading={false} />
					<SkeletonRows count={2} />
				</>
			) : isError || !status ? (
				<ErrorState title="Backups didn't load" error={error} onRetry={() => void refetch()} />
			) : (
				<BackupsContent
					status={status}
					autosave={autosave}
					readOnly={readOnly}
					working={working}
					onCreate={() => create.mutate()}
					fileRef={file}
					uploading={upload.isPending}
					onUpload={(f) => upload.mutate(f)}
					cancelling={cancel.isPending}
					onCancelRestore={() => cancel.mutate()}
				/>
			)}
		</Page>
	);
}

function BackupsContent({
	status,
	autosave,
	readOnly,
	working,
	onCreate,
	fileRef,
	uploading,
	onUpload,
	cancelling,
	onCancelRestore,
}: {
	status: BackupStatus;
	autosave: Autosave<BackupConfigUpdate>;
	readOnly?: boolean;
	working: boolean;
	onCreate: () => void;
	fileRef: React.RefObject<HTMLInputElement | null>;
	uploading: boolean;
	onUpload: (file: File) => void;
	cancelling: boolean;
	onCancelRestore: () => void;
}) {
	const { config: cfg } = status;
	const pending = status.backups.find((b) => b.name === status.pendingRestore);
	const recentRestore =
		status.lastRestore && Date.now() - status.lastRestore.at < 3 * 86_400_000 ? status.lastRestore : null;

	return (
		<>
			{readOnly && <p className="text-small text-fg-muted">Only admins can change this.</p>}
			{status.pendingRestore && (
				<Callout
					tone="warning"
					icon={<RotateCcw />}
					title={`Restart Sekai to restore the backup from ${pending ? dateTime(pending.createdAt) : status.pendingRestore}`}
					action={
						!readOnly ? (
							<Button variant="secondary" size="sm" loading={cancelling} onClick={onCancelRestore}>
								Cancel
							</Button>
						) : undefined
					}
				>
					Restores as Sekai starts, after backing up what's here now.
				</Callout>
			)}
			{recentRestore && !status.pendingRestore && (
				<Callout
					tone={recentRestore.ok ? "success" : "danger"}
					icon={recentRestore.ok ? <CircleCheck /> : <CircleAlert />}
					title={
						recentRestore.ok
							? `Restored ${timeAgo(recentRestore.at)}`
							: `The restore ${timeAgo(recentRestore.at)} didn't work`
					}
				>
					{recentRestore.ok
						? `Sekai is running on ${recentRestore.name}. What was here before is saved as "Before a restore".`
						: `${errorMessage(recentRestore.error)} Sekai kept going with what it had.`}
				</Callout>
			)}
			{status.lastError && (
				<Callout
					tone="danger"
					icon={<CircleAlert />}
					title={`The automatic backup ${timeAgo(status.lastError.at)} failed`}
				>
					{errorMessage(status.lastError.error)}
				</Callout>
			)}

			<Section title="Schedule" saveState={<SaveState state={autosave} />}>
				<List label="Backup schedule">
					<Row
						icon={<CalendarClock />}
						title="Automatic backups"
						subtitle={
							status.nextRunAt ? `Next one ${dateTime(status.nextRunAt)}` : "Off — only manual backups."
						}
						wrap
						trailing={
							<Segmented<BackupSchedule>
								label="Automatic backups"
								value={cfg.schedule}
								onValueChange={(schedule) => autosave.save({ schedule })}
								options={[
									{ value: "off", label: "Off", disabled: readOnly },
									{ value: "daily", label: "Every night", disabled: readOnly },
									{ value: "weekly", label: "Weekly", disabled: readOnly },
								]}
							/>
						}
					/>
					<SelectRow
						icon={<Archive />}
						title="Keep"
						description="Older automatic backups are deleted; manual ones stay."
						value={String(cfg.keep)}
						disabled={readOnly}
						onValueChange={(v) => autosave.save({ keep: Number(v) })}
						options={[3, 7, 14, 30, 60].map((n) => ({ value: String(n), label: `Latest ${n}` }))}
					/>
					<CopyToRows status={status} autosave={autosave} readOnly={readOnly} />
				</List>
			</Section>

			<Section
				title="Saved backups"
				description="Includes passwords and keys — keep downloaded copies somewhere safe."
				action={
					!readOnly ? (
						<Button
							variant="secondary"
							size="sm"
							loading={uploading}
							onClick={() => fileRef.current?.click()}
						>
							<Upload /> Upload backup
						</Button>
					) : undefined
				}
			>
				{!readOnly && (
					<input
						ref={fileRef}
						type="file"
						accept=".gz,.tgz,application/gzip"
						className="hidden"
						onChange={(e) => {
							const f = e.target.files?.[0];
							if (f) onUpload(f);
							e.target.value = "";
						}}
					/>
				)}
				{status.backups.length === 0 ? (
					<List label="Saved backups">
						<EmptyState
							size="sm"
							icon={<Archive />}
							title="No backups yet"
							description={
								cfg.schedule === "off"
									? "Make a backup now, or turn on automatic backups above."
									: "The first automatic backup runs tonight, or make one now."
							}
							action={
								!readOnly ? (
									<Button variant="primary" size="sm" loading={working} onClick={onCreate}>
										<DatabaseBackup /> Back up now
									</Button>
								) : undefined
							}
						/>
					</List>
				) : (
					<List label="Saved backups">
						{status.backups.map((b) => (
							<BackupItemRow
								key={b.name}
								b={b}
								pending={b.name === status.pendingRestore}
								readOnly={readOnly}
							/>
						))}
					</List>
				)}
				<Fold variant="link" title="Moving to a new server">
					Kept on this server in <code className="font-mono text-caption">{status.dir}</code>. To move to a
					new server, upload a backup there (up to 30 MB here, or copy larger files directly into that folder)
					and restore it.
				</Fold>
			</Section>
		</>
	);
}
