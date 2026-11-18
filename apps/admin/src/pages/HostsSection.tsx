import { AgentAvatar, api, timeAgo } from "@sekai/client";
import type { Agent, HostStatus, HostWithStatus, TailnetDevice } from "@sekai/shared";
import { Button, Confirm, Dialog, Field, Input, Segmented, Select, Spinner } from "@sekai/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	Check,
	CircleAlert,
	CircleCheck,
	Copy,
	KeyRound,
	Plus,
	RefreshCw,
	Server,
	ShieldAlert,
	Trash2,
	UserRound,
	X,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export const KEYS = {
	hosts: ["hosts"] as const,
	master: ["hosts", "master"] as const,
	tailnet: ["hosts", "tailnet"] as const,
	grants: ["hosts", "grants"] as const,
};

/** What to run on a device once so Sekai's master key can log in there. */
export function installCommand(publicKey: string, windows: boolean): string {
	return windows
		? `Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0; Set-Service sshd -StartupType Automatic; Start-Service sshd; $f = "$env:ProgramData\\ssh\\administrators_authorized_keys"; Add-Content -Force -Path $f -Value '${publicKey}'; icacls $f /inheritance:r /grant "Administrators:F" /grant "SYSTEM:F"`
		: `mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo '${publicKey}' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys`;
}

export function CopyLine({ value, label }: { value: string; label: string }) {
	const [done, setDone] = useState(false);
	return (
		<div className="flex items-start gap-1 rounded-xl bg-muted px-3 py-2">
			<code className="min-w-0 flex-1 font-mono text-xs leading-5 break-all">{value}</code>
			<Button
				variant="ghost"
				size="icon-sm"
				aria-label={`Copy ${label}`}
				onClick={() => {
					void navigator.clipboard.writeText(value);
					setDone(true);
					setTimeout(() => setDone(false), 1200);
				}}
			>
				{done ? <Check /> : <Copy />}
			</Button>
		</div>
	);
}

/** bare: without its own heading (the page already has one). */
export function MasterKeyCard({ bare }: { bare?: boolean }) {
	const qc = useQueryClient();
	const { data } = useQuery({ queryKey: KEYS.master, queryFn: api.hosts.masterKey });
	const [rotating, setRotating] = useState(false);
	const rotate = useMutation({
		mutationFn: api.hosts.rotateMasterKey,
		onSuccess: (k) => {
			qc.setQueryData(KEYS.master, k);
			toast.success("New master key made. Install it on your devices again.");
		},
	});
	const [os, setOs] = useState<"unix" | "windows">("unix");
	if (!data) return <Spinner />;
	const install = installCommand(data.publicKey, false);
	const installWindows = installCommand(data.publicKey, true);
	return (
		<div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
			<div className={bare ? "hidden" : "flex items-start gap-3"}>
				<span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand-ink">
					<KeyRound className="size-4" />
				</span>
				<div className="min-w-0 flex-1">
					<div className="text-sm font-semibold">Sekai's master key</div>
					<p className="text-[13px] leading-5 text-fg-subtle">
						Install it once on each device (for the account bots should use). Sekai uses it only to add or
						remove a bot's own key when you, your primary bot or your approval mode says yes. Bots never get
						the master key.
					</p>
				</div>
			</div>
			<Segmented<"unix" | "windows">
				value={os}
				onValueChange={setOs}
				size="sm"
				options={[
					{ value: "unix", label: "Linux & macOS" },
					{ value: "windows", label: "Windows" },
				]}
			/>
			<Field
				label={os === "windows" ? "Run this in PowerShell as administrator" : "Run this on the device"}
				hint={
					os === "windows"
						? "Turns on Windows' SSH server and installs the key for administrator accounts."
						: undefined
				}
			>
				<CopyLine value={os === "windows" ? installWindows : install} label="install command" />
			</Field>
			<div className="flex flex-wrap items-center gap-2 text-xs text-fg-subtle">
				<span className="font-mono">{data.fingerprint}</span>
				<span>· made {timeAgo(data.createdAt)}</span>
				<Button variant="ghost" size="xs" className="ml-auto" onClick={() => setRotating(true)}>
					<RefreshCw /> New master key
				</Button>
			</div>
			<Confirm
				open={rotating}
				onOpenChange={setRotating}
				title="Make a new master key?"
				description="Sekai switches to the new key: it can't add or remove bots' keys on a device until you install the new one there. The old key stays on your devices until you take it out of authorized_keys (look for sekai-master), so remove it if it may have leaked. Bots keep the access they have."
				confirmLabel="Make a new key"
				onConfirm={() => rotate.mutate()}
			/>
		</div>
	);
}

export function AddHostDialog({
	open,
	onOpenChange,
	from,
}: {
	open: boolean;
	onOpenChange: (o: boolean) => void;
	from: TailnetDevice | null;
}) {
	const qc = useQueryClient();
	const [name, setName] = useState(from?.name ?? "");
	const [address, setAddress] = useState(from?.address || from?.dnsName || "");
	const [user, setUser] = useState("");
	const [port, setPort] = useState("22");
	const [description, setDescription] = useState("");
	const add = useMutation({
		mutationFn: () =>
			api.hosts.create({
				name: name.trim().replace(/[^\w.-]+/g, "-"),
				address: address.trim(),
				user: user.trim(),
				port: Number(port) || 22,
				description,
				source: from ? "tailscale" : "manual",
				tailscaleId: from?.id ?? null,
				os: from?.os || null,
			}),
		onSuccess: (h) => {
			void qc.invalidateQueries({ queryKey: ["hosts"] });
			toast.success(`Added ${h.name}. Checking that the master key works…`);
			onOpenChange(false);
		},
		onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
	});
	return (
		<Dialog
			open={open}
			onOpenChange={onOpenChange}
			icon={<Server />}
			title={from ? `Add ${from.name}` : "Add a server or device"}
			description="A machine bots may work on when you allow it. Install the master key above on it first."
			footer={
				<>
					<Button variant="ghost" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button
						variant="primary"
						disabled={!name.trim() || !address.trim() || !user.trim() || add.isPending}
						onClick={() => add.mutate()}
					>
						{add.isPending && <Spinner className="text-primary-foreground" />} Add
					</Button>
				</>
			}
		>
			<div className="flex flex-col gap-4">
				<div className="grid gap-3 sm:grid-cols-2">
					<Field label="Name" hint="What bots call it">
						<Input value={name} onChange={(e) => setName(e.target.value)} placeholder="laptop" />
					</Field>
					<Field label="Account" hint="The login that has the master key">
						<Input
							value={user}
							onChange={(e) => setUser(e.target.value)}
							placeholder="sam"
							className="font-mono"
						/>
					</Field>
				</div>
				<div className="grid gap-3 sm:grid-cols-[1fr_96px]">
					<Field label="Address" hint={from ? "Its tailnet name" : "Hostname or IP (a tailnet name works)"}>
						<Input value={address} onChange={(e) => setAddress(e.target.value)} className="font-mono" />
					</Field>
					<Field label="SSH port">
						<Input value={port} onChange={(e) => setPort(e.target.value)} inputMode="numeric" />
					</Field>
				</div>
				<Field label="What it is (optional)" hint="Helps bots pick the right one">
					<Input
						value={description}
						onChange={(e) => setDescription(e.target.value)}
						placeholder="My laptop, Ubuntu, projects in ~/code"
					/>
				</Field>
			</div>
		</Dialog>
	);
}

export function GrantChip({ agent, onRevoke, by }: { agent: Agent | undefined; onRevoke: () => void; by: string }) {
	return (
		<span
			className="flex h-8 items-center gap-1.5 rounded-full border border-border pr-1 pl-1 text-[13px]"
			title={`Allowed by ${by}`}
		>
			{agent && <AgentAvatar avatar={agent.avatar} size={24} />}
			{agent?.name ?? "A bot"}
			<button
				type="button"
				onClick={onRevoke}
				aria-label={`Remove ${agent?.name ?? "this bot"}'s access`}
				className="rounded-full p-1 text-fg-subtle hover:bg-muted hover:text-fg"
			>
				<X className="size-3.5" />
			</button>
		</span>
	);
}

const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : String(e));
const isWindows = (os: string | null | undefined) => /windows/i.test(os ?? "");
const ADMIN = /^(root|administrator)$/i;

function StatusText({ s }: { s: HostStatus | undefined }) {
	if (!s || s.ok === null) return <span className="text-fg-subtle">Checking…</span>;
	if (s.ok)
		return (
			<span className="inline-flex min-w-0 items-center gap-1 text-success">
				<CircleCheck className="size-3.5 shrink-0" />
				<span className="truncate">{s.about ?? "Reachable"}</span>
			</span>
		);
	return (
		<span className="inline-flex min-w-0 items-center gap-1 text-danger">
			<CircleAlert className="size-3.5 shrink-0" />
			<span className="truncate">{s.error}</span>
		</span>
	);
}

/** One account on a device: whether Sekai's key works there, and which bots may use it. */
function AccountRow({
	h,
	account,
	agents,
	publicKey,
}: {
	h: HostWithStatus;
	account: string;
	agents: Agent[];
	publicKey: string | undefined;
}) {
	const qc = useQueryClient();
	const main = account === h.user;
	const windows = isWindows(h.os);
	const s = main ? h.status : h.accountStatus[account];
	const [giving, setGiving] = useState(false);
	const [editing, setEditing] = useState(false);
	const [name, setName] = useState(account);
	const [removing, setRemoving] = useState(false);
	const refresh = () => void qc.invalidateQueries({ queryKey: KEYS.hosts });
	const grants = h.grants.filter((g) => (g.account ?? h.user) === account);
	const without = agents.filter((a) => !grants.some((g) => g.agentId === a.id));
	const grant = useMutation({
		mutationFn: (agentId: string) => api.hosts.grant(agentId, h.id, account),
		onSuccess: () => {
			refresh();
			setGiving(false);
		},
		onError: fail,
	});
	const revoke = useMutation({ mutationFn: (id: string) => api.hosts.revoke(id), onSuccess: refresh });
	const rename = useMutation({
		mutationFn: () => api.hosts.update(h.id, { user: name.trim() }),
		onSuccess: () => {
			setEditing(false);
			refresh();
			void api.hosts.check(h.id).then(refresh);
		},
		onError: fail,
	});
	const remove = useMutation({
		mutationFn: () => api.hosts.removeAccount(h.id, account),
		onSuccess: refresh,
		onError: fail,
	});
	return (
		<div className="flex flex-col gap-2 px-3 py-2.5">
			<div className="flex min-h-7 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
				{ADMIN.test(account) ? (
					<ShieldAlert className="size-4 shrink-0 text-warning" aria-hidden />
				) : (
					<UserRound className="size-4 shrink-0 text-fg-subtle" aria-hidden />
				)}
				{editing ? (
					<form
						className="flex items-center gap-1.5"
						onSubmit={(e) => {
							e.preventDefault();
							if (name.trim()) rename.mutate();
						}}
					>
						<Input
							autoFocus
							value={name}
							onChange={(e) => setName(e.target.value)}
							className="h-7 w-36 font-mono text-xs"
							aria-label="Your account on this device"
						/>
						<Button type="submit" size="xs" variant="secondary" disabled={rename.isPending}>
							Save
						</Button>
						<Button type="button" size="xs" variant="ghost" onClick={() => setEditing(false)}>
							Cancel
						</Button>
					</form>
				) : (
					<span className="font-mono text-[13px] font-medium text-fg">{account}</span>
				)}
				{!editing && (
					<span className="text-fg-subtle">
						{main ? "· your account" : ADMIN.test(account) ? "· full control" : "· another account"}
					</span>
				)}
				{!editing && (
					<span className="ml-auto flex items-center gap-0.5">
						{main ? (
							<Button variant="ghost" size="xs" onClick={() => setEditing(true)}>
								Change
							</Button>
						) : (
							<Button variant="ghost" size="xs" onClick={() => setRemoving(true)}>
								Remove
							</Button>
						)}
					</span>
				)}
			</div>
			{!editing && (
				<div className="-mt-1.5 flex min-w-0 pl-6 text-xs">
					<StatusText s={s} />
				</div>
			)}
			{s?.ok === false && publicKey && /master key|refused/i.test(s.error ?? "") && (
				<Field
					label={
						windows
							? `On ${h.name}, run this in PowerShell as administrator`
							: ADMIN.test(account)
								? `On ${h.name}, run this as root (sudo -i first)`
								: `On ${h.name}, run this as ${account}`
					}
				>
					<CopyLine value={installCommand(publicKey, windows)} label="install command" />
				</Field>
			)}
			{s?.ok !== false && (
				<div className="flex flex-wrap items-center gap-1.5 pl-6">
					{grants.length === 0 && !giving && (
						<span className="text-xs text-fg-subtle">
							{ADMIN.test(account)
								? "No bot is in. Bots ask (and you always decide) before they get root."
								: "Bots ask when they need it, or let one in now."}
						</span>
					)}
					{grants.map((g) => (
						<GrantChip
							key={g.id}
							agent={agents.find((a) => a.id === g.agentId)}
							by={g.grantedBy}
							onRevoke={() => revoke.mutate(g.id)}
						/>
					))}
					{giving ? (
						<div className="w-44">
							<Select
								size="sm"
								value=""
								placeholder="Pick a bot"
								onValueChange={(id) => grant.mutate(id)}
								options={without.map((a) => ({ value: a.id, label: a.name }))}
							/>
						</div>
					) : (
						without.length > 0 &&
						s?.ok === true && (
							<Button variant="ghost" size="xs" onClick={() => setGiving(true)}>
								<Plus /> Let a bot in
							</Button>
						)
					)}
					{grant.isPending && <Spinner />}
				</div>
			)}
			<Confirm
				open={removing}
				onOpenChange={setRemoving}
				title={`Stop bots using ${account} on ${h.name}?`}
				description="Bots' keys come off that account and they lose access as it. Sekai's own key stays there."
				confirmLabel="Stop"
				danger
				onConfirm={() => remove.mutate()}
			/>
		</div>
	);
}

/** Lets bots use another account on a device (root, a service account): Sekai sets its key up when it can. */
function AddAccount({ h }: { h: HostWithStatus }) {
	const qc = useQueryClient();
	const [open, setOpen] = useState(false);
	const [name, setName] = useState("");
	const have = new Set([h.user, ...h.accounts]);
	const suggestions = (isWindows(h.os) ? ["Administrator"] : ["root"]).filter((a) => !have.has(a));
	const add = useMutation({
		mutationFn: (account: string) => api.hosts.addAccount(h.id, account),
		onSuccess: (r) => {
			void qc.invalidateQueries({ queryKey: KEYS.hosts });
			setOpen(false);
			setName("");
			if (r.setup === "ready") toast.success(`${r.account} is ready: Sekai's key already works there.`);
			else if (r.setup === "sudo") toast.success(`Set up ${r.account}: Sekai added its key there with sudo.`);
			else
				toast.message(`Added ${r.account}. Run the command shown to finish.`, {
					description: r.note ?? undefined,
				});
		},
		onError: fail,
	});
	if (!open) {
		return (
			<div className="px-2 py-1.5">
				<Button variant="ghost" size="xs" onClick={() => setOpen(true)}>
					<Plus /> Add an account
				</Button>
			</div>
		);
	}
	return (
		<form
			className="flex flex-col gap-2 px-3 py-2.5"
			onSubmit={(e) => {
				e.preventDefault();
				if (name.trim()) add.mutate(name.trim());
			}}
		>
			<div className="flex flex-wrap items-center gap-1.5">
				<Input
					autoFocus
					value={name}
					onChange={(e) => setName(e.target.value)}
					placeholder={suggestions[0] ?? "account"}
					className="h-8 w-40 font-mono text-[13px]"
					aria-label="Account name"
				/>
				{suggestions.map((a) => (
					<Button key={a} type="button" variant="secondary" size="xs" onClick={() => add.mutate(a)}>
						{a}
					</Button>
				))}
				<Button type="submit" variant="primary" size="xs" disabled={!name.trim() || add.isPending}>
					{add.isPending ? <Spinner className="text-primary-foreground" /> : null} Add
				</Button>
				<Button type="button" variant="ghost" size="xs" onClick={() => setOpen(false)}>
					Cancel
				</Button>
			</div>
			<p className="text-xs leading-5 text-fg-subtle">
				Sekai adds its key to that account with sudo when {h.user} may use sudo without a password; otherwise it
				shows the command to run.{" "}
				{suggestions.includes("root") || name.trim() === "root"
					? "A bot let in as root can change anything there, so bots always ask you before they get it."
					: ""}
			</p>
		</form>
	);
}

/** Every account bots can use on a device, its status, and who's in. */
export function HostAccess({ h, agents }: { h: HostWithStatus; agents: Agent[] }) {
	const { data: master } = useQuery({ queryKey: KEYS.master, queryFn: api.hosts.masterKey });
	return (
		<div className="flex flex-col divide-y divide-border rounded-xl bg-muted/45">
			{[h.user, ...h.accounts.filter((a) => a !== h.user)].map((a) => (
				<AccountRow key={a} h={h} account={a} agents={agents} publicKey={master?.publicKey} />
			))}
			<AddAccount h={h} />
		</div>
	);
}

/** A server that isn't on your tailnet (added by address). */
export function HostRow({ h, agents }: { h: HostWithStatus; agents: Agent[] }) {
	const qc = useQueryClient();
	const [removing, setRemoving] = useState(false);
	const refresh = () => void qc.invalidateQueries({ queryKey: KEYS.hosts });
	const check = useMutation({ mutationFn: () => api.hosts.check(h.id), onSuccess: refresh });
	const remove = useMutation({ mutationFn: () => api.hosts.delete(h.id), onSuccess: refresh });
	return (
		<div className="flex flex-col gap-3 px-4 py-3">
			<div className="flex items-center gap-3">
				<span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-fg-subtle">
					<Server className="size-[18px]" />
				</span>
				<div className="min-w-0 flex-1">
					<div className="truncate text-sm font-medium">{h.name}</div>
					<div className="truncate font-mono text-xs text-fg-subtle">
						{h.address}
						{h.port !== 22 ? `:${h.port}` : ""}
						{h.description ? <span className="font-sans"> · {h.description}</span> : null}
					</div>
				</div>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Check again"
					disabled={check.isPending}
					onClick={() => check.mutate()}
				>
					<RefreshCw className={check.isPending ? "animate-spin" : undefined} />
				</Button>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label={`Remove ${h.name}`}
					onClick={() => setRemoving(true)}
				>
					<Trash2 />
				</Button>
			</div>
			<HostAccess h={h} agents={agents} />
			<Confirm
				open={removing}
				onOpenChange={setRemoving}
				title={`Remove ${h.name}?`}
				description="Bots' keys are taken off it (if it's reachable), and they lose access."
				confirmLabel="Remove"
				danger
				onConfirm={() => remove.mutate()}
			/>
		</div>
	);
}
