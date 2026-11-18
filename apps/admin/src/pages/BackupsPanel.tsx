import { api, dateTime, formatBytes, timeAgo } from "@sekai/client";
import type { BackupConfigUpdate, BackupInfo, BackupKind, BackupSchedule, BackupStatus } from "@sekai/shared";
import {
	Badge,
	Button,
	Callout,
	Confirm,
	IconButton,
	Input,
	Section,
	Segmented,
	Select,
	SettingsGroup,
	SettingsPanel,
	SettingsRow,
	Skeleton,
	Spinner,
} from "@sekai/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	Archive,
	CalendarClock,
	CircleAlert,
	CircleCheck,
	Download,
	HardDriveUpload,
	History,
	Plus,
	RotateCcw,
	Send,
	Trash2,
	Upload,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

const KEY = ["backups"] as const;

const KIND_LABEL: Record<BackupKind, string> = {
	scheduled: "Automatic",
	manual: "Made by you",
	"before-restore": "Before a restore",
	uploaded: "Uploaded",
};

const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : String(e));

function useConfigure() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (patch: BackupConfigUpdate) => api.backups.configure(patch),
		onSuccess: (s) => qc.setQueryData(KEY, s),
		onError: fail,
	});
}

function CopyTo({ status }: { status: BackupStatus }) {
	const configure = useConfigure();
	const { data: hosts = [] } = useQuery({ queryKey: ["hosts"], queryFn: api.hosts.list, staleTime: 30_000 });
	const copy = status.config.copyTo;
	const [dir, setDir] = useState(copy?.dir ?? "sekai-backups");
	useEffect(() => setDir(copy?.dir ?? "sekai-backups"), [copy?.dir]);
	const last = status.lastCopy;
	return (
		<SettingsRow
			icon={<Send />}
			title="Also copy to"
			description={
				<>
					One of your devices, over SSH with Sekai's master key, so a backup survives this server's disk.
					{copy && last && (
						<span className={last.ok ? "mt-1 block text-success" : "mt-1 block text-danger"}>
							{last.ok ? `Last copied ${timeAgo(last.at)}` : `The last copy failed: ${last.error}`}
						</span>
					)}
				</>
			}
		>
			<div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
				<Select
					value={copy?.hostId ?? "none"}
					onValueChange={(v) =>
						configure.mutate({
							copyTo: v === "none" ? null : { hostId: v, dir: dir.trim() || "sekai-backups" },
						})
					}
					options={[
						{ value: "none", label: "Nowhere else" },
						...hosts.map((h) => ({ value: h.id, label: h.name })),
					]}
					className="w-full sm:w-44"
				/>
				{copy && (
					<form
						className="flex w-full gap-2 sm:w-56"
						onSubmit={(e) => {
							e.preventDefault();
							if (dir.trim()) configure.mutate({ copyTo: { hostId: copy.hostId, dir: dir.trim() } });
						}}
					>
						<Input
							value={dir}
							onChange={(e) => setDir(e.target.value)}
							aria-label="Folder on the device"
							placeholder="sekai-backups"
							className="min-w-0 flex-1"
						/>
						{dir.trim() !== copy.dir && (
							<Button type="submit" variant="secondary" disabled={!dir.trim() || configure.isPending}>
								Save
							</Button>
						)}
					</form>
				)}
			</div>
		</SettingsRow>
	);
}

function BackupRow({ b, pending }: { b: BackupInfo; pending: boolean }) {
	const qc = useQueryClient();
	const [confirm, setConfirm] = useState<"restore" | "delete" | null>(null);
	const restore = useMutation({
		mutationFn: () => api.backups.restore(b.name),
		onSuccess: (s) => {
			qc.setQueryData(KEY, s);
			toast.success("Restart Sekai to restore it");
		},
		onError: fail,
	});
	const remove = useMutation({
		mutationFn: () => api.backups.delete(b.name),
		onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
		onError: fail,
	});
	const details = [
		KIND_LABEL[b.kind],
		formatBytes(b.size),
		b.rows !== null ? `${b.rows.toLocaleString()} rows` : null,
		b.files !== null ? `${b.files.toLocaleString()} files` : null,
		b.app ? `Sekai ${b.app}` : null,
	].filter(Boolean);
	return (
		<div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
			<span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground [&_svg]:size-[18px]">
				{b.kind === "before-restore" ? <History /> : b.kind === "uploaded" ? <HardDriveUpload /> : <Archive />}
			</span>
			<div className="min-w-0 flex-1 basis-48">
				<div className="flex items-center gap-2">
					<span className="truncate text-sm font-medium" title={b.name}>
						{dateTime(b.createdAt)}
					</span>
					{pending && <Badge tone="warning">Restores at restart</Badge>}
				</div>
				<div className="truncate text-xs text-fg-subtle">{details.join(" · ")}</div>
			</div>
			<div className="flex items-center gap-1">
				<Button
					variant="ghost"
					size="sm"
					onClick={() =>
						// A backup holds every secret: confirm it's you first (when you last did a while ago).
						void api.auth
							.ensureRecent()
							.then(() => {
								const a = document.createElement("a");
								a.href = api.backups.downloadUrl(b.name);
								a.download = b.name;
								a.click();
							})
							.catch(() => {})
					}
				>
					<Download /> Download
				</Button>
				<Button
					variant="ghost"
					size="sm"
					onClick={() => setConfirm("restore")}
					disabled={pending || restore.isPending}
				>
					<RotateCcw /> Restore
				</Button>
				<IconButton label="Delete backup" onClick={() => setConfirm("delete")} disabled={remove.isPending}>
					<Trash2 />
				</IconButton>
			</div>
			<Confirm
				open={confirm === "restore"}
				onOpenChange={(o) => !o && setConfirm(null)}
				title="Restore this backup?"
				description={`Bots, chats, memory, settings, keys and uploads go back to how they were ${dateTime(b.createdAt)}. It happens the next time Sekai starts, and what's here then is backed up first, so you can come back to it.`}
				confirmLabel="Restore at restart"
				danger
				onConfirm={() => restore.mutate()}
			/>
			<Confirm
				open={confirm === "delete"}
				onOpenChange={(o) => !o && setConfirm(null)}
				title="Delete this backup?"
				description={`The backup from ${dateTime(b.createdAt)} is deleted from the server. Copies you downloaded or on a device stay.`}
				confirmLabel="Delete"
				danger
				onConfirm={() => remove.mutate()}
			/>
		</div>
	);
}

function BackupsBody() {
	const qc = useQueryClient();
	const { data: status, isLoading } = useQuery({ queryKey: KEY, queryFn: api.backups.status });
	const configure = useConfigure();
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
			toast.success("Backup added. Restore it from the list.");
		},
		onError: fail,
	});
	const cancel = useMutation({
		mutationFn: api.backups.cancelRestore,
		onSuccess: (s) => qc.setQueryData(KEY, s),
		onError: fail,
	});

	if (isLoading || !status) {
		return (
			<>
				<Skeleton className="h-40 rounded-2xl" />
				<Skeleton className="h-56 rounded-2xl" />
			</>
		);
	}
	const { config: cfg } = status;
	const pending = status.backups.find((b) => b.name === status.pendingRestore);
	const recentRestore =
		status.lastRestore && Date.now() - status.lastRestore.at < 3 * 86_400_000 ? status.lastRestore : null;
	const working = status.running || create.isPending;

	return (
		<>
			{status.pendingRestore && (
				<Callout
					tone="warning"
					icon={<RotateCcw />}
					title={`Restart Sekai to restore the backup from ${pending ? dateTime(pending.createdAt) : status.pendingRestore}`}
					action={
						<Button
							variant="secondary"
							size="sm"
							onClick={() => cancel.mutate()}
							disabled={cancel.isPending}
						>
							Cancel
						</Button>
					}
				>
					It's restored as Sekai starts, before anything else. What's here then is backed up first.
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
						? `Sekai is running on ${recentRestore.name}. What was here before is in the list ("Before a restore").`
						: `${recentRestore.error} Sekai kept going with what it had.`}
				</Callout>
			)}
			{status.lastError && (
				<Callout
					tone="danger"
					icon={<CircleAlert />}
					title={`The automatic backup ${timeAgo(status.lastError.at)} failed`}
				>
					{status.lastError.error}
				</Callout>
			)}

			<Section title="Schedule">
				<SettingsGroup>
					<SettingsRow
						icon={<CalendarClock />}
						title="Automatic backups"
						description={
							status.nextRunAt ? `Next one ${dateTime(status.nextRunAt)}` : "Off: only the ones you make."
						}
					>
						<Segmented<BackupSchedule>
							value={cfg.schedule}
							onValueChange={(schedule) => configure.mutate({ schedule })}
							options={[
								{ value: "off", label: "Off" },
								{ value: "daily", label: "Every night" },
								{ value: "weekly", label: "Weekly" },
							]}
						/>
					</SettingsRow>
					<SettingsRow
						icon={<Archive />}
						title="Keep"
						description="Older automatic backups are deleted. The ones you make stay until you delete them."
					>
						<Select
							value={String(cfg.keep)}
							onValueChange={(v) => configure.mutate({ keep: Number(v) })}
							options={[3, 7, 14, 30, 60].map((n) => ({ value: String(n), label: `Latest ${n}` }))}
							className="w-36"
						/>
					</SettingsRow>
					<CopyTo status={status} />
				</SettingsGroup>
			</Section>

			<Section
				title="Backups"
				description="Bots, chats, memory, routines, settings, keys and uploads, in one file. It holds every password and key Sekai keeps, so keep downloaded copies somewhere safe."
				action={
					<div className="flex gap-2">
						<Button
							variant="ghost"
							size="sm"
							onClick={() => file.current?.click()}
							disabled={upload.isPending}
						>
							{upload.isPending ? <Spinner /> : <Upload />} Upload
						</Button>
						<Button variant="primary" size="sm" onClick={() => create.mutate()} disabled={working}>
							{working ? <Spinner /> : <Plus />} Back up now
						</Button>
					</div>
				}
			>
				<input
					ref={file}
					type="file"
					accept=".gz,.tgz,application/gzip"
					className="hidden"
					onChange={(e) => {
						const f = e.target.files?.[0];
						if (f) upload.mutate(f);
						e.target.value = "";
					}}
				/>
				<div className="flex flex-col divide-y divide-border rounded-2xl border border-border bg-card">
					{status.backups.length === 0 && (
						<p className="px-4 py-6 text-center text-[13px] text-fg-subtle">
							No backups yet.{" "}
							{cfg.schedule === "off"
								? "Make one now."
								: "The first one is made tonight, or make one now."}
						</p>
					)}
					{status.backups.map((b) => (
						<BackupRow key={b.name} b={b} pending={b.name === status.pendingRestore} />
					))}
				</div>
				<p className="text-xs text-fg-subtle">
					Kept on the server in <code className="font-mono">{status.dir}</code>. Moving to a new server?
					Upload a backup there (up to 30 MB here; bigger ones: copy the file into that folder) and restore
					it.
				</p>
			</Section>
		</>
	);
}

export function BackupsPanel() {
	return (
		<SettingsPanel
			value="backups"
			title="Backups"
			description="Everything Sekai keeps, saved every night (or when you want) and restored in one go."
		>
			<BackupsBody />
		</SettingsPanel>
	);
}
