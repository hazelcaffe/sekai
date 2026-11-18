import {
	adminUrl,
	api,
	cn,
	dateTime,
	formatBytes,
	timeAgo,
	useCheckpoints,
	useMachines,
	useSavedLogins,
	useSettings,
} from "@sekai/client";
import {
	type Agent,
	type Checkpoint,
	DEFAULT_COMPUTER_SPECS,
	DEFAULT_DEVBOX_SPECS,
	type Machine,
	type MachineAccess,
	type MachineSpecs,
} from "@sekai/shared";
import { Badge, Button, Confirm, Field, IconButton, Input, Section, Spinner } from "@sekai/ui";
import { useMutation } from "@tanstack/react-query";
import {
	AlertTriangle,
	BookmarkPlus,
	Box,
	Check,
	Copy,
	Download,
	Eye,
	History,
	KeyRound,
	Laptop,
	Maximize2,
	Monitor,
	Plus,
	Power,
	RotateCcw,
	RotateCw,
	Trash2,
	X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { VncView } from "./VncView.tsx";

const gb = (mb: number) => `${Math.round((mb / 1024) * 10) / 10} GB`;

function specsLine(s: MachineSpecs): string {
	const mem = s.minMemoryMb && s.minMemoryMb < s.memoryMb ? `${gb(s.minMemoryMb)}–${gb(s.memoryMb)}` : gb(s.memoryMb);
	return `${s.cores} cores · ${mem} RAM · ${s.diskGb} GB disk`;
}

function StatusBadge({ m }: { m: Machine }) {
	const tone =
		m.status === "running"
			? "success"
			: m.status === "error"
				? "danger"
				: m.status === "stopped"
					? "neutral"
					: "info";
	const label = {
		creating: "Setting up",
		provisioning: "Setting up",
		running: "Running",
		stopped: "Off",
		error: "Problem",
		deleting: "Deleting",
	}[m.status];
	return <Badge tone={tone}>{label}</Badge>;
}

function CopyRow({ label, value, secret }: { label: string; value: string; secret?: boolean }) {
	const [done, setDone] = useState(false);
	return (
		<div className="flex items-center gap-2 py-1 text-[13px]">
			<span className="w-20 shrink-0 text-fg-subtle">{label}</span>
			<code className="min-w-0 flex-1 truncate font-mono text-[12px]">{secret ? "••••••••••" : value}</code>
			<IconButton
				label={done ? "Copied" : "Copy"}
				size="icon-sm"
				onClick={async () => {
					await navigator.clipboard.writeText(value);
					setDone(true);
					setTimeout(() => setDone(false), 1200);
				}}
			>
				{done ? <Check /> : <Copy />}
			</IconButton>
		</div>
	);
}

/** The live screen: a fresh screenshot every couple of seconds while the panel is open. */
function ScreenPreview({ machine, onTakeover }: { machine: Machine; onTakeover: () => void }) {
	const [src, setSrc] = useState(() => api.machines.screenUrl(machine.id));
	const [failed, setFailed] = useState(false);
	useEffect(() => {
		const t = setInterval(() => {
			if (document.visibilityState === "visible") setSrc(api.machines.screenUrl(machine.id));
		}, 2500);
		return () => clearInterval(t);
	}, [machine.id]);
	return (
		<button
			type="button"
			onClick={onTakeover}
			className="group relative block aspect-[16/10] w-full overflow-hidden rounded-2xl border border-border bg-black"
			aria-label="Take over"
		>
			{!failed && (
				<img
					src={src}
					alt={`${machine.name}'s screen`}
					className="size-full object-contain"
					onError={() => setFailed(true)}
					onLoad={() => setFailed(false)}
				/>
			)}
			{failed && (
				<span className="absolute inset-0 flex items-center justify-center text-xs text-neutral-400">
					The screen isn't available right now
				</span>
			)}
			<span className="absolute right-2 bottom-2 flex items-center gap-1.5 rounded-full bg-black/70 px-2.5 py-1 text-xs font-medium text-white opacity-0 transition-opacity group-hover:opacity-100 coarse:opacity-100">
				<Maximize2 className="size-3.5" /> Take over
			</span>
		</button>
	);
}

function SpecsEditor({
	value,
	onSave,
	onCancel,
	kind,
}: {
	value: MachineSpecs;
	onSave: (s: MachineSpecs) => void;
	onCancel: () => void;
	kind: Machine["kind"];
}) {
	const [s, setS] = useState(value);
	const num = (v: string, fallback: number) => (Number.isFinite(Number(v)) && v !== "" ? Number(v) : fallback);
	return (
		<div className="flex flex-col gap-3 rounded-2xl bg-surface-2/50 p-3">
			<div className="grid grid-cols-3 gap-2">
				<Field label="Cores">
					<Input
						type="number"
						min={1}
						max={64}
						value={s.cores}
						onChange={(e) => setS({ ...s, cores: num(e.target.value, s.cores) })}
					/>
				</Field>
				<Field label="RAM (GB)">
					<Input
						type="number"
						min={1}
						max={256}
						value={Math.round(s.memoryMb / 1024)}
						onChange={(e) => {
							const mb = num(e.target.value, s.memoryMb / 1024) * 1024;
							setS({ ...s, memoryMb: mb, minMemoryMb: Math.min(s.minMemoryMb, mb) });
						}}
					/>
				</Field>
				<Field label="Disk (GB)">
					<Input
						type="number"
						min={value.diskGb}
						max={4096}
						value={s.diskGb}
						onChange={(e) => setS({ ...s, diskGb: num(e.target.value, s.diskGb) })}
					/>
				</Field>
			</div>
			{kind === "computer" && (
				<Field
					label="Minimum RAM (GB)"
					hint="Ballooning: the VM gives memory back down to this when idle. 0 turns it off."
				>
					<Input
						type="number"
						min={0}
						max={Math.round(s.memoryMb / 1024)}
						value={Math.round(s.minMemoryMb / 1024)}
						onChange={(e) => setS({ ...s, minMemoryMb: num(e.target.value, s.minMemoryMb / 1024) * 1024 })}
					/>
				</Field>
			)}
			<p className="text-xs text-fg-subtle">
				Disks can only grow. Changing cores or memory restarts a running computer.
			</p>
			<div className="flex justify-end gap-2">
				<Button variant="secondary" size="sm" onClick={onCancel}>
					Cancel
				</Button>
				<Button variant="primary" size="sm" onClick={() => onSave(s)}>
					Save
				</Button>
			</div>
		</div>
	);
}

function Access({ machine }: { machine: Machine }) {
	const [access, setAccess] = useState<MachineAccess | null>(null);
	const reveal = useMutation({ mutationFn: () => api.machines.access(machine.id), onSuccess: setAccess });
	const host = machine.addresses.tailscale ?? machine.addresses.lan;
	const download = () => {
		if (!access) return;
		const blob = new Blob([access.privateKey], { type: "text/plain" });
		const a = document.createElement("a");
		a.href = URL.createObjectURL(blob);
		a.download = `${machine.hostname}-key`;
		a.click();
		// Some browsers cancel a download whose URL is revoked right away.
		setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
	};
	return (
		<div className="flex flex-col">
			{host && (
				<CopyRow
					label="SSH"
					value={`ssh ${machine.username}@${host}${machine.ports.ssh !== 22 ? ` -p ${machine.ports.ssh}` : ""}`}
				/>
			)}
			{host && machine.ports.vnc && <CopyRow label="VNC" value={`${host}:${machine.ports.vnc}`} />}
			{host && machine.ports.rdp && <CopyRow label="RDP" value={`${host}:${machine.ports.rdp}`} />}
			{machine.addresses.tailscale && machine.addresses.lan && (
				<CopyRow label="LAN" value={machine.addresses.lan} />
			)}
			{access ? (
				<>
					{access.userPassword && <CopyRow label={machine.username} value={access.userPassword} />}
					{access.rootPassword && <CopyRow label="root" value={access.rootPassword} />}
					{access.vncPassword && <CopyRow label="VNC pass" value={access.vncPassword} />}
					<div className="mt-1 flex gap-2">
						<Button variant="ghost" size="sm" onClick={download}>
							<Download /> SSH key
						</Button>
						<Button variant="ghost" size="sm" onClick={() => setAccess(null)}>
							<X /> Hide
						</Button>
					</div>
				</>
			) : (
				<Button
					variant="ghost"
					size="sm"
					className="mt-1 self-start"
					onClick={() => reveal.mutate()}
					disabled={reveal.isPending}
				>
					<Eye /> Passwords and key
				</Button>
			)}
		</div>
	);
}

/** Snapshots of the machine's disk: made by you, the bot, or Sekai before a risky command. Go back to one. */
function Checkpoints({ machine }: { machine: Machine }) {
	const [open, setOpen] = useState(false);
	const [label, setLabel] = useState("");
	const [restoring, setRestoring] = useState<Checkpoint | null>(null);
	const { data, isLoading, error } = useCheckpoints(machine.id, open);
	const list = data?.checkpoints;
	const backups = data?.mode === "backup";
	const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : String(e));
	const create = useMutation({
		mutationFn: () => api.machines.checkpoints.create(machine.id, label.trim()),
		onSuccess: () => {
			setLabel("");
			toast.success("Checkpoint saved");
		},
		onError: fail,
	});
	const restore = useMutation({
		mutationFn: (name: string) => api.machines.checkpoints.restore(machine.id, name),
		onSuccess: () => toast.success(`${machine.name} went back to the checkpoint`),
		onError: fail,
	});
	const remove = useMutation({
		mutationFn: (name: string) => api.machines.checkpoints.delete(machine.id, name),
		onError: fail,
	});
	const working = create.isPending || restore.isPending || remove.isPending;

	if (!open) {
		return (
			<Button variant="ghost" size="sm" className="self-start" onClick={() => setOpen(true)}>
				<History /> Checkpoints
			</Button>
		);
	}
	return (
		<div className="flex flex-col gap-2 rounded-2xl bg-surface-2/60 p-3">
			<div className="flex items-center gap-2">
				<span className="min-w-0 flex-1">
					<span className="block text-[13px] font-medium">Checkpoints</span>
					<span className="block text-xs text-fg-subtle">
						Save the {machine.kind === "computer" ? "computer" : "devbox"} as it is, and go back if
						something breaks.{" "}
						{backups
							? "Its storage can't take snapshots, so each checkpoint is a full backup on your Proxmox server: it takes a minute or two and uses disk space."
							: "Sekai saves one on its own before risky commands (the latest 3 are kept)."}
					</span>
				</span>
				<IconButton size="icon-sm" label="Close" onClick={() => setOpen(false)}>
					<X />
				</IconButton>
			</div>
			<form
				className="flex gap-2"
				onSubmit={(e) => {
					e.preventDefault();
					if (!working) create.mutate();
				}}
			>
				<Input
					value={label}
					onChange={(e) => setLabel(e.target.value)}
					placeholder="What it's for (optional)"
					maxLength={200}
					className="h-8 flex-1 text-[13px]"
					aria-label="Checkpoint label"
				/>
				<Button type="submit" variant="secondary" size="sm" disabled={working}>
					{create.isPending ? <Spinner /> : <BookmarkPlus />} Save
				</Button>
			</form>
			{isLoading ? (
				<div className="flex justify-center py-2">
					<Spinner />
				</div>
			) : error ? (
				<p className="text-xs text-danger">{error instanceof Error ? error.message : String(error)}</p>
			) : list && list.length > 0 ? (
				<div className="flex flex-col divide-y divide-border">
					{list.map((cp) => (
						<div key={cp.name} className="flex items-center gap-2 py-1.5">
							<span className="min-w-0 flex-1">
								<span className="flex items-center gap-1.5">
									<span className="truncate text-[13px]">{cp.label}</span>
									{cp.auto && <Badge className="shrink-0">Auto</Badge>}
								</span>
								<span className="block text-xs text-fg-subtle" title={dateTime(cp.at)}>
									{timeAgo(cp.at)}
									{cp.size ? ` · ${formatBytes(cp.size)}` : ""}
								</span>
							</span>
							<Button
								variant="ghost"
								size="xs"
								disabled={working}
								onClick={() => setRestoring(cp)}
								aria-label={`Go back to ${cp.label}`}
							>
								<RotateCcw /> Go back
							</Button>
							<IconButton
								size="icon-sm"
								label="Delete checkpoint"
								disabled={working}
								onClick={() => remove.mutate(cp.name)}
							>
								<Trash2 />
							</IconButton>
						</div>
					))}
				</div>
			) : (
				<p className="py-1 text-xs text-fg-subtle">No checkpoints yet.</p>
			)}
			{create.isPending && backups && (
				<div className="flex items-center gap-2 text-xs text-fg-muted">
					<Spinner /> Saving a full backup… this takes a minute or two.
				</div>
			)}
			{restore.isPending && (
				<div className="flex items-center gap-2 text-xs text-fg-muted">
					<Spinner /> Going back…{" "}
					{backups ? "restoring a backup takes a few minutes." : "this takes a minute or two."}
				</div>
			)}
			<Confirm
				open={restoring !== null}
				onOpenChange={(o) => !o && setRestoring(null)}
				title="Go back to this checkpoint?"
				description={
					restoring
						? `${machine.name} goes back to how it was ${timeAgo(restoring.at)} ("${restoring.label}"). Everything since is lost${machine.status === "running" ? ", and it restarts" : ""}.`
						: undefined
				}
				confirmLabel="Go back"
				danger
				onConfirm={() => {
					if (restoring) restore.mutate(restoring.name);
					setRestoring(null);
				}}
			/>
		</div>
	);
}

function MachineCard({ machine, agent }: { machine: Machine; agent: Agent }) {
	const [takeover, setTakeover] = useState(false);
	const [editing, setEditing] = useState(false);
	const [confirm, setConfirm] = useState(false);
	const update = useMutation({
		mutationFn: (specs: MachineSpecs) => api.machines.update(machine.id, { specs }),
		onSuccess: () => setEditing(false),
	});
	const power = useMutation({
		mutationFn: (action: "start" | "stop" | "restart") =>
			action === "start"
				? api.machines.start(machine.id)
				: action === "stop"
					? api.machines.stop(machine.id)
					: api.machines.restart(machine.id),
	});
	const retry = useMutation({ mutationFn: () => api.machines.retry(machine.id) });
	const remove = useMutation({ mutationFn: () => api.machines.delete(machine.id) });
	const busy = machine.status === "creating" || machine.status === "provisioning" || machine.status === "deleting";
	const isComputer = machine.kind === "computer";

	return (
		<div className="flex flex-col gap-3">
			{isComputer && machine.status === "running" && (
				<ScreenPreview machine={machine} onTakeover={() => setTakeover(true)} />
			)}
			{busy && (
				<div className="flex items-center gap-3 rounded-2xl bg-surface-2/60 px-3.5 py-3 text-[13px]">
					<Spinner />
					<span className="min-w-0 flex-1">
						<span className="block font-medium">
							{machine.status === "deleting" ? "Deleting" : "Setting up"}
						</span>
						<span className="block text-xs text-fg-subtle">
							{machine.statusDetail ?? "…"}
							{isComputer && machine.status !== "deleting" ? " · about 10 minutes the first time" : ""}
						</span>
					</span>
				</div>
			)}
			{machine.status === "error" && (
				<div className="flex gap-2.5 rounded-2xl border border-danger/30 bg-danger/[0.06] px-3.5 py-3 text-[13px]">
					<AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />
					<span className="min-w-0 flex-1 break-words">{machine.statusDetail}</span>
				</div>
			)}
			<div className="flex items-center gap-2">
				<span className="min-w-0 flex-1">
					<span className="flex items-center gap-2">
						<span className="truncate text-sm font-medium">{machine.name}</span>
						<StatusBadge m={machine} />
					</span>
					<span className="block truncate text-xs text-fg-subtle">
						{specsLine(machine.specs)}
						{machine.expiresAt ? ` · deleted ${timeAgo(machine.expiresAt)}` : ""}
					</span>
				</span>
				{machine.provider === "proxmox" && !busy && (
					<Button variant="ghost" size="xs" onClick={() => setEditing((v) => !v)}>
						Resize
					</Button>
				)}
			</div>
			{editing && (
				<SpecsEditor
					value={machine.specs}
					kind={machine.kind}
					onSave={(s) => update.mutate(s)}
					onCancel={() => setEditing(false)}
				/>
			)}
			{(machine.status === "running" || machine.status === "stopped") && <Access machine={machine} />}
			{machine.provider === "proxmox" && (machine.status === "running" || machine.status === "stopped") && (
				<Checkpoints machine={machine} />
			)}
			<div className="flex flex-wrap gap-1.5">
				{isComputer && machine.status === "running" && (
					<Button variant="secondary" size="sm" onClick={() => setTakeover(true)}>
						<Maximize2 /> Take over
					</Button>
				)}
				{machine.provider === "proxmox" && machine.status === "running" && (
					<Button
						variant="ghost"
						size="sm"
						onClick={() => power.mutate("restart")}
						disabled={power.isPending}
					>
						<RotateCw /> Restart
					</Button>
				)}
				{machine.provider === "proxmox" && (machine.status === "running" || machine.status === "stopped") && (
					<Button
						variant="ghost"
						size="sm"
						onClick={() => power.mutate(machine.status === "running" ? "stop" : "start")}
						disabled={power.isPending}
					>
						<Power /> {machine.status === "running" ? "Turn off" : "Turn on"}
					</Button>
				)}
				{machine.provider === "ssh" && machine.status === "error" && (
					<Button variant="secondary" size="sm" onClick={() => retry.mutate()} disabled={retry.isPending}>
						<RotateCw /> Try again
					</Button>
				)}
				{machine.status !== "deleting" && (
					<Button variant="danger-ghost" size="sm" onClick={() => setConfirm(true)}>
						<Trash2 /> Delete
					</Button>
				)}
			</div>
			{isComputer && <VncView machine={machine} open={takeover} onOpenChange={setTakeover} />}
			<Confirm
				open={confirm}
				onOpenChange={setConfirm}
				title={`Delete ${machine.name}?`}
				description={
					machine.provider === "proxmox"
						? `The ${isComputer ? "VM" : "container"} and everything on it are deleted from Proxmox. ${agent.name}'s memory and chats are kept.`
						: "Sekai forgets this machine. Nothing on it is touched."
				}
				confirmLabel="Delete"
				danger
				onConfirm={() => remove.mutate()}
			/>
		</div>
	);
}

function NewComputer({ agent, proxmox }: { agent: Agent; proxmox: boolean }) {
	const { data: settings } = useSettings();
	const [specs, setSpecs] = useState<MachineSpecs | null>(null);
	const [ssh, setSsh] = useState<{ host: string; port: string; username: string } | null>(null);
	const create = useMutation({
		mutationFn: () =>
			ssh
				? api.machines.create({
						agentId: agent.id,
						kind: "computer",
						provider: "ssh",
						ssh: {
							host: ssh.host.trim(),
							port: Number(ssh.port) || 22,
							username: ssh.username.trim(),
							vncPort: 5900,
							rdpPort: 3389,
						},
					})
				: api.machines.create({ agentId: agent.id, kind: "computer", specs: specs ?? undefined }),
	});
	const base = settings?.machines.computerSpecs ?? DEFAULT_COMPUTER_SPECS;
	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-col items-center gap-2 rounded-2xl bg-surface-2/50 px-4 py-6 text-center">
				<Monitor className="size-8 text-fg-subtle" />
				<div className="text-sm font-medium">Give {agent.name} a computer</div>
				<p className="max-w-xs text-xs leading-5 text-fg-subtle">
					Its own Debian desktop with Chrome, on your Proxmox server. {agent.name} uses it on its own; you can
					watch here and take over any time.
				</p>
			</div>
			{proxmox ? (
				<>
					{specs ? (
						<SpecsEditor value={specs} kind="computer" onSave={setSpecs} onCancel={() => setSpecs(null)} />
					) : (
						<div className="flex items-center justify-between text-xs text-fg-subtle">
							{specsLine(base)}
							<Button variant="ghost" size="xs" onClick={() => setSpecs(base)}>
								Change
							</Button>
						</div>
					)}
					<Button variant="primary" onClick={() => create.mutate()} disabled={create.isPending}>
						{create.isPending ? <Spinner /> : <Plus />} Create the computer
					</Button>
				</>
			) : (
				<p className="text-[13px] text-fg-muted">
					Connect your Proxmox server in{" "}
					<a href={adminUrl("computers")} className="text-info underline-offset-2 hover:underline">
						Admin → Computers
					</a>{" "}
					first.
				</p>
			)}
			{ssh ? (
				<div className="flex flex-col gap-2 rounded-2xl border border-border p-3">
					<div className="text-[13px] font-medium">A machine you already have</div>
					<p className="text-xs text-fg-subtle">
						A Linux desktop reachable over SSH. Sekai shows you the key to add there.
					</p>
					<div className="grid grid-cols-[1fr_5rem] gap-2">
						<Input
							placeholder="Host or IP"
							value={ssh.host}
							onChange={(e) => setSsh({ ...ssh, host: e.target.value })}
						/>
						<Input
							placeholder="Port"
							value={ssh.port}
							onChange={(e) => setSsh({ ...ssh, port: e.target.value })}
						/>
					</div>
					<Input
						placeholder="User"
						value={ssh.username}
						onChange={(e) => setSsh({ ...ssh, username: e.target.value })}
					/>
					<div className="flex justify-end gap-2">
						<Button variant="secondary" size="sm" onClick={() => setSsh(null)}>
							Cancel
						</Button>
						<Button
							variant="primary"
							size="sm"
							disabled={!ssh.host || !ssh.username || create.isPending}
							onClick={() => create.mutate()}
						>
							Add
						</Button>
					</div>
				</div>
			) : (
				<Button
					variant="ghost"
					size="sm"
					className="self-center"
					onClick={() => setSsh({ host: "", port: "22", username: "" })}
				>
					Use a machine I already have
				</Button>
			)}
		</div>
	);
}

function Devboxes({ agent, devboxes, proxmox }: { agent: Agent; devboxes: Machine[]; proxmox: boolean }) {
	const { data: settings } = useSettings();
	const [adding, setAdding] = useState(false);
	const [name, setName] = useState("");
	const [hours, setHours] = useState("");
	const create = useMutation({
		mutationFn: () =>
			api.machines.create({
				agentId: agent.id,
				kind: "devbox",
				name: name.trim() || undefined,
				ttlHours: Number(hours) || undefined,
			}),
		onSuccess: () => {
			setAdding(false);
			setName("");
			setHours("");
		},
	});
	if (!proxmox && devboxes.length === 0) return null;
	return (
		<Section
			title="Devboxes"
			description="Temporary Linux containers for development work. They're deleted on their own when their time is up."
			action={
				proxmox && !adding ? (
					<Button variant="secondary" size="xs" onClick={() => setAdding(true)}>
						<Plus /> New
					</Button>
				) : undefined
			}
		>
			{adding && (
				<div className="flex flex-col gap-2 rounded-2xl bg-surface-2/50 p-3">
					<div className="grid grid-cols-[1fr_6rem] gap-2">
						<Input
							autoFocus
							placeholder="Name, e.g. api-test"
							value={name}
							onChange={(e) => setName(e.target.value)}
						/>
						<Input
							type="number"
							min={1}
							placeholder={`${settings?.machines.devboxTtlHours ?? 24} h`}
							value={hours}
							onChange={(e) => setHours(e.target.value)}
						/>
					</div>
					<div className="flex items-center justify-between gap-2">
						<span className="text-xs text-fg-subtle">
							{specsLine(settings?.machines.devboxSpecs ?? DEFAULT_DEVBOX_SPECS)}
						</span>
						<span className="flex gap-2">
							<Button variant="secondary" size="sm" onClick={() => setAdding(false)}>
								Cancel
							</Button>
							<Button
								variant="primary"
								size="sm"
								onClick={() => create.mutate()}
								disabled={create.isPending}
							>
								Create
							</Button>
						</span>
					</div>
				</div>
			)}
			{devboxes.length === 0 && !adding && (
				<p className="text-[13px] text-fg-subtle">None right now. {agent.name} can make its own.</p>
			)}
			{devboxes.map((d) => (
				<div key={d.id} className="rounded-2xl border border-border p-3">
					<MachineCard machine={d} agent={agent} />
				</div>
			))}
		</Section>
	);
}

/** Your own computers lent to the bot from the desktop app. Removing one revokes it there too. */
function LentComputers({ agent, devices }: { agent: Agent; devices: Machine[] }) {
	const [confirm, setConfirm] = useState<Machine | null>(null);
	const remove = useMutation({ mutationFn: (id: string) => api.machines.delete(id) });
	if (devices.length === 0) return null;
	return (
		<Section
			title="Your computers"
			description={`Computers you lent ${agent.name} from the Sekai desktop app. Change what it may do there in the app's settings.`}
		>
			{devices.map((d) => {
				const online = d.status === "running";
				return (
					<div key={d.id} className="flex items-center gap-3 rounded-2xl border border-border px-3 py-2.5">
						<Laptop className="size-4 shrink-0 text-fg-subtle" />
						<span className="min-w-0 flex-1">
							<span className="flex items-center gap-2">
								<span className="truncate text-[13px] font-medium">{d.name}</span>
								<Badge tone={online ? "success" : "neutral"}>{online ? "Online" : "Offline"}</Badge>
							</span>
							<span className="block truncate text-xs text-fg-subtle">
								{online
									? `${agent.name} works as ${d.username}`
									: "Open the Sekai desktop app there to let it work again"}
							</span>
						</span>
						<Button variant="danger-ghost" size="sm" onClick={() => setConfirm(d)}>
							Stop lending
						</Button>
					</div>
				);
			})}
			<Confirm
				open={Boolean(confirm)}
				onOpenChange={(open) => !open && setConfirm(null)}
				title={`Stop lending ${confirm?.name ?? "this computer"}?`}
				description={`${agent.name} can't use it anymore. The desktop app there is told too; you can lend it again from its settings.`}
				confirmLabel="Stop lending"
				danger
				onConfirm={() => confirm && remove.mutate(confirm.id)}
			/>
		</Section>
	);
}

function SavedLogins({ agent }: { agent: Agent }) {
	const { data: logins = [] } = useSavedLogins(agent.id);
	const forget = useMutation({ mutationFn: (id: string) => api.credentials.forget(id) });
	if (logins.length === 0) return null;
	return (
		<Section
			title="Saved logins"
			description={`Sites ${agent.name} can sign in to without asking you. Passwords stay encrypted on your server.`}
		>
			{logins.map((l) => (
				<div key={l.id} className="flex items-center gap-3 rounded-xl px-1 py-1.5">
					<KeyRound className="size-4 shrink-0 text-fg-subtle" />
					<span className="min-w-0 flex-1">
						<span className="block truncate text-[13px] font-medium">{l.site}</span>
						<span className="block truncate text-xs text-fg-subtle">
							{l.username}
							{l.lastUsedAt ? ` · used ${timeAgo(l.lastUsedAt)}` : ""}
						</span>
					</span>
					<IconButton label="Forget" size="icon-sm" onClick={() => forget.mutate(l.id)}>
						<Trash2 />
					</IconButton>
				</div>
			))}
		</Section>
	);
}

/** A bot's computer (live view, takeover, access), its devboxes and its saved logins. */
export function ComputerPanel({ agent, onClose }: { agent: Agent; onClose: () => void }) {
	const { data: machines = [] } = useMachines(agent.id);
	const { data: settings } = useSettings();
	const proxmox = Boolean(
		settings?.machines.proxmox.url && settings.machines.proxmox.tokenId && settings.machines.proxmox.node,
	);
	const computer = machines.find((m) => m.kind === "computer");
	const devboxes = machines.filter((m) => m.kind === "devbox");
	const devices = machines.filter((m) => m.kind === "device");
	return (
		<div className="flex h-full min-h-0 flex-col pt-safe">
			<div className="flex items-center gap-2 px-4 pt-4 pb-3">
				<Monitor className="size-5 text-fg-subtle" />
				<div className="min-w-0 flex-1 truncate text-[15px] font-semibold">{agent.name}'s computer</div>
				<IconButton label="Close" onClick={onClose}>
					<X />
				</IconButton>
			</div>
			<div className={cn("flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-4 pb-6 pb-safe scrollbar-thin")}>
				{/* Keyed: another bot's machine must never show this one's passwords or key. */}
				{computer ? (
					<MachineCard key={computer.id} machine={computer} agent={agent} />
				) : (
					<NewComputer agent={agent} proxmox={proxmox} />
				)}
				<Devboxes agent={agent} devboxes={devboxes} proxmox={proxmox} />
				<LentComputers agent={agent} devices={devices} />
				<SavedLogins agent={agent} />
				{!computer && devboxes.length === 0 && devices.length === 0 && (
					<p className="flex items-start gap-2 text-xs leading-5 text-fg-subtle">
						<Box className="mt-0.5 size-3.5 shrink-0" />
						Without a computer, {agent.name} still browses the web with a browser on your Sekai server.
					</p>
				)}
			</div>
		</div>
	);
}
