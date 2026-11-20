import {
	adminUrl,
	api,
	cn,
	dateTime,
	formatBytes,
	timeAgo,
	useCheckpoints,
	useMachineMembers,
	useMachines,
	useSavedLogins,
	useSeats,
	useSettings,
} from "@sekai/client";
import {
	type Agent,
	type Checkpoint,
	DEFAULT_COMPUTER_SPECS,
	DEFAULT_DEVBOX_SPECS,
	type Machine,
	type MachineBackend,
	type MachineSpecs,
} from "@sekai/shared";
import { Badge, Button, Confirm, Field, Fold, IconButton, Input, Section, Segmented, Spinner } from "@sekai/ui";
import { useMutation } from "@tanstack/react-query";
import {
	AlertTriangle,
	BookmarkPlus,
	Box,
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
import { useState } from "react";
import { toast } from "sonner";
import { Access, ScreenPreview, StatusBadge } from "./MachineParts.tsx";
import { Seats, SharedBrowsers, ShareMachine } from "./Sharing.tsx";
import { VncView } from "./VncView.tsx";
import { WebApps } from "./WebApps.tsx";

const gb = (mb: number) => `${Math.round((mb / 1024) * 10) / 10} GB`;

function specsLine(s: MachineSpecs): string {
	const mem = s.minMemoryMb && s.minMemoryMb < s.memoryMb ? `${gb(s.minMemoryMb)}–${gb(s.memoryMb)}` : gb(s.memoryMb);
	return `${s.cores} cores · ${mem} RAM · ${s.diskGb} GB disk`;
}

const BACKEND_LABEL: Record<MachineBackend, string> = { vm: "Virtual machine", lxc: "Container" };

/** Virtual machine or container, for a new computer or devbox. */
function BackendChoice({
	value,
	onChange,
	order,
}: {
	value: MachineBackend;
	onChange: (b: MachineBackend) => void;
	order: MachineBackend[];
}) {
	return (
		<div className="flex flex-col gap-1.5">
			<Segmented
				value={value}
				onValueChange={onChange}
				options={order.map((b) => ({ value: b, label: BACKEND_LABEL[b] }))}
				size="sm"
				className="self-start"
			/>
			<p className="text-xs leading-5 text-fg-subtle">
				{value === "lxc"
					? "Lighter and quicker to start. It shares your server's kernel."
					: "Fully separate, with its own kernel: for Docker-heavy or kernel work."}
			</p>
		</div>
	);
}

function SpecsEditor({
	value,
	onSave,
	onCancel,
	vm,
	ballooning,
}: {
	value: MachineSpecs;
	onSave: (s: MachineSpecs) => void;
	onCancel: () => void;
	/** Virtual machines restart for new cores and memory; containers take them right away. */
	vm: boolean;
	ballooning: boolean;
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
			{ballooning && (
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
				Disks can only grow.{" "}
				{vm
					? "Changing cores or memory restarts a running virtual machine."
					: "A container takes new cores and memory right away."}
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
	const { data: members = [] } = useMachineMembers(machine.id, machine.provider !== "local");
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
	const backend = machine.backend ? BACKEND_LABEL[machine.backend] : null;

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
						{backend ? `${backend} · ` : ""}
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
					vm={machine.backend === "vm"}
					ballooning={isComputer && machine.backend === "vm"}
					onSave={(s) => update.mutate(s)}
					onCancel={() => setEditing(false)}
				/>
			)}
			{(machine.status === "running" || machine.status === "stopped") && <Access machine={machine} />}
			{machine.provider !== "local" && machine.status === "running" && <WebApps machine={machine} />}
			{machine.provider === "proxmox" && (machine.status === "running" || machine.status === "stopped") && (
				<Checkpoints machine={machine} />
			)}
			{machine.provider !== "local" && (machine.status === "running" || machine.status === "stopped") && (
				<ShareMachine machine={machine} />
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
				description={[
					machine.provider === "proxmox"
						? `The ${machine.backend === "lxc" ? "container" : "virtual machine"} and everything on it are deleted from Proxmox. ${agent.name}'s memory and chats are kept.`
						: "Sekai forgets this machine. Nothing on it is touched, except the accounts other bots got there.",
					members.length
						? `${members.length} other bot${members.length === 1 ? "" : "s"} use${members.length === 1 ? "s" : ""} it and lose${members.length === 1 ? "s" : ""} ${members.length === 1 ? "its account" : "their accounts"} there.`
						: "",
				]
					.filter(Boolean)
					.join(" ")}
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
	const [chosen, setChosen] = useState<MachineBackend | null>(null);
	const backend = chosen ?? settings?.machines.computerBackend ?? "vm";
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
				: api.machines.create({ agentId: agent.id, kind: "computer", backend, specs: specs ?? undefined }),
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
					<BackendChoice value={backend} onChange={setChosen} order={["vm", "lxc"]} />
					{specs ? (
						<SpecsEditor
							value={specs}
							vm={backend === "vm"}
							ballooning={backend === "vm"}
							onSave={setSpecs}
							onCancel={() => setSpecs(null)}
						/>
					) : (
						<div className="flex items-center justify-between text-xs text-fg-subtle">
							{specsLine(backend === "lxc" ? { ...base, minMemoryMb: 0 } : base)}
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
	const [chosen, setChosen] = useState<MachineBackend | null>(null);
	const backend = chosen ?? settings?.machines.devboxBackend ?? "lxc";
	const create = useMutation({
		mutationFn: () =>
			api.machines.create({
				agentId: agent.id,
				kind: "devbox",
				backend,
				name: name.trim() || undefined,
				ttlHours: Number(hours) || undefined,
			}),
		onSuccess: () => {
			setAdding(false);
			setName("");
			setHours("");
			setChosen(null);
		},
	});
	if (!proxmox && devboxes.length === 0) return null;
	return (
		<Section
			title="Devboxes"
			description="Temporary Linux machines for development work. They're deleted on their own when their time is up."
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
					<BackendChoice value={backend} onChange={setChosen} order={["lxc", "vm"]} />
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
	const { data: seats = [] } = useSeats(agent.id);
	const { data: settings } = useSettings();
	const proxmox = Boolean(
		settings?.machines.proxmox.url && settings.machines.proxmox.tokenId && settings.machines.proxmox.node,
	);
	const computer = machines.find((m) => m.kind === "computer");
	const devboxes = machines.filter((m) => m.kind === "devbox");
	const devices = machines.filter((m) => m.kind === "device");
	// Someone else's bot: its own computer stays theirs; here it's what you share with it.
	const theirs = Boolean(agent.sharedBy);
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
				{theirs ? (
					<div className="flex flex-col items-center gap-2 rounded-2xl bg-surface-2/50 px-4 py-6 text-center">
						<Monitor className="size-8 text-fg-subtle" />
						<div className="text-sm font-medium">
							{agent.name} is {agent.sharedBy}'s bot
						</div>
						<p className="max-w-xs text-xs leading-5 text-fg-subtle">
							Its own computer stays theirs. Share one of your bots' computers or a browser with it, and
							it works there in your chats, in its own account.
						</p>
					</div>
				) : computer ? (
					/* Keyed: another bot's machine must never show this one's passwords or key. */
					<MachineCard key={computer.id} machine={computer} agent={agent} />
				) : seats.length === 0 ? (
					<NewComputer agent={agent} proxmox={proxmox} />
				) : null}
				{/* Without a computer of its own, the ones it shares come first. */}
				{!computer && <Seats agent={agent} />}
				{!theirs && !computer && seats.length > 0 && (
					<Fold title="A computer of its own" summary="Its own desktop on your Proxmox server">
						<NewComputer agent={agent} proxmox={proxmox} />
					</Fold>
				)}
				{!theirs && <Devboxes agent={agent} devboxes={devboxes} proxmox={proxmox} />}
				{computer && <Seats agent={agent} />}
				<SharedBrowsers agent={agent} />
				{!theirs && <LentComputers agent={agent} devices={devices} />}
				{!theirs && <SavedLogins agent={agent} />}
				{!theirs && !computer && devboxes.length === 0 && devices.length === 0 && seats.length === 0 && (
					<p className="flex items-start gap-2 text-xs leading-5 text-fg-subtle">
						<Box className="mt-0.5 size-3.5 shrink-0" />
						Without a computer, {agent.name} still browses the web with a browser on your Sekai server.
					</p>
				)}
			</div>
		</div>
	);
}
