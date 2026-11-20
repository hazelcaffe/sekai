import { AgentAvatar, api, qk, useAgentMap, useMachines, useSettings } from "@sekai/client";
import type { Machine, MachineSettings, MachineSpecs, Settings } from "@sekai/shared";
import {
	Badge,
	Button,
	EmptyState,
	Field,
	Input,
	Section,
	Segmented,
	SettingsPanel,
	Spinner,
	ToggleRow,
	type Tone,
} from "@sekai/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Box, Check, ChevronRight, CircleAlert, Cpu, Gauge, Laptop, Monitor, Network, Server } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

function SpecsFields({
	value,
	onChange,
	ballooning,
}: {
	value: MachineSpecs;
	onChange: (s: MachineSpecs) => void;
	ballooning?: boolean;
}) {
	const n = (v: string) => Math.max(0, Number(v) || 0);
	return (
		<div className={ballooning ? "grid grid-cols-2 gap-2 sm:grid-cols-4" : "grid grid-cols-3 gap-2"}>
			<Field label="Cores">
				<Input
					type="number"
					min={1}
					value={value.cores}
					onChange={(e) => onChange({ ...value, cores: n(e.target.value) || 1 })}
				/>
			</Field>
			<Field label="RAM (GB)">
				<Input
					type="number"
					min={1}
					value={value.memoryMb / 1024}
					onChange={(e) => onChange({ ...value, memoryMb: (n(e.target.value) || 1) * 1024 })}
				/>
			</Field>
			{ballooning && (
				<Field label="Min RAM (GB)">
					<Input
						type="number"
						min={0}
						value={value.minMemoryMb / 1024}
						onChange={(e) => onChange({ ...value, minMemoryMb: n(e.target.value) * 1024 })}
					/>
				</Field>
			)}
			<Field label="Disk (GB)">
				<Input
					type="number"
					min={8}
					value={value.diskGb}
					onChange={(e) => onChange({ ...value, diskGb: n(e.target.value) || 8 })}
				/>
			</Field>
		</div>
	);
}

const STATUS_TONE: Partial<Record<Machine["status"], Tone>> = {
	running: "success",
	creating: "info",
	provisioning: "info",
	deleting: "warning",
	stopped: "neutral",
	error: "danger",
};

function MachineIcon({ m }: { m: Machine }) {
	if (m.kind === "device") return <Laptop />;
	if (m.kind === "devbox") return <Box />;
	return <Monitor />;
}

/** Every bot's computers, devboxes and lent devices. */
function AllMachines() {
	const { data: machines, isLoading } = useMachines();
	const agents = useAgentMap();
	if (isLoading) return <Spinner />;
	if (!machines?.length) {
		return (
			<EmptyState
				icon={<Monitor />}
				tone="neutral"
				title="No computers yet"
				description="Bots get one when you give them a computer in their Computer tab, or when they ask for a devbox."
				className="rounded-2xl border border-dashed border-border py-8"
			/>
		);
	}
	return (
		<div className="divide-y divide-border rounded-2xl border border-border bg-card">
			{machines.map((m) => {
				const agent = agents.get(m.agentId);
				return (
					<a
						key={m.id}
						href={`/bot/${m.agentId}`}
						className="flex items-center gap-3 px-4 py-3 transition-colors first:rounded-t-2xl last:rounded-b-2xl hover:bg-muted/50"
					>
						<span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground [&_svg]:size-[18px]">
							<MachineIcon m={m} />
						</span>
						<div className="min-w-0 flex-1">
							<div className="truncate text-sm font-medium">{m.name}</div>
							<div className="truncate text-xs text-fg-subtle">
								{m.kind === "device" ? "Lent device" : m.kind === "devbox" ? "Devbox" : "Computer"} ·{" "}
								{m.backend ? `${m.backend === "lxc" ? "Container" : "Virtual machine"} · ` : ""}
								{m.specs.cores} cores · {Math.round(m.specs.memoryMb / 1024)} GB
							</div>
						</div>
						{agent && (
							<span className="hidden items-center gap-1.5 text-xs text-fg-muted sm:flex">
								<AgentAvatar avatar={agent.avatar} size={20} />
								{agent.name}
							</span>
						)}
						<Badge tone={STATUS_TONE[m.status] ?? "neutral"}>{m.status}</Badge>
					</a>
				);
			})}
		</div>
	);
}

export function ComputersPanel() {
	return (
		<SettingsPanel
			value="computers"
			title="Computers"
			description="Bots' own computers (with a desktop) and devboxes (temporary, for development) on your Proxmox server, as virtual machines or containers."
			className="max-w-3xl"
		>
			<a
				href="/admin/tailscale"
				className="group flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 transition-colors hover:bg-muted/50"
			>
				<Network className="size-5 shrink-0 text-fg-subtle" />
				<span className="min-w-0 flex-1">
					<span className="block text-sm font-medium">Your own servers and devices</span>
					<span className="block text-xs text-fg-subtle">Which ones bots can work on: Admin → Tailscale</span>
				</span>
				<ChevronRight className="size-4 text-fg-subtle transition-transform group-hover:translate-x-0.5" />
			</a>
			<ComputersBody />
		</SettingsPanel>
	);
}

function ComputersBody() {
	const { data: settings } = useSettings();
	if (!settings) return <Spinner />;
	return (
		<>
			<Section title="In use" icon={<Monitor />}>
				<AllMachines />
			</Section>
			<ComputerSettings settings={settings} />
		</>
	);
}

/** Proxmox, Tailscale and the defaults for bots' computers and devboxes. */
function ComputerSettings({ settings }: { settings: Settings }) {
	const qc = useQueryClient();
	const [m, setM] = useState<MachineSettings>(settings.machines);
	useEffect(() => setM(settings.machines), [settings.machines]);
	const save = useMutation({
		mutationFn: () => api.settings.update({ machines: m }),
		onSuccess: (next) => {
			qc.setQueryData(qk.settings, next);
			toast.success("Saved", { duration: 1200 });
		},
	});
	const test = useMutation({
		mutationFn: async () => {
			await api.settings.update({ machines: m });
			return api.machines.testProxmox();
		},
	});
	const px = m.proxmox;
	const setPx = (patch: Partial<MachineSettings["proxmox"]>) => setM({ ...m, proxmox: { ...px, ...patch } });
	const dirty = JSON.stringify(m) !== JSON.stringify(settings.machines);
	const result = test.data;

	return (
		<>
			<Section
				title="Proxmox"
				icon={<Server />}
				description="Sekai creates and manages machines through Proxmox's API with a token."
			>
				<div className="grid gap-3 sm:grid-cols-2">
					<Field label="Proxmox URL" hint="e.g. https://192.168.0.10:8006">
						<Input
							value={px.url}
							onChange={(e) => setPx({ url: e.target.value })}
							className="font-mono text-[13px]"
						/>
					</Field>
					<Field label="Node">
						<Input value={px.node} onChange={(e) => setPx({ node: e.target.value })} placeholder="pve" />
					</Field>
					<Field label="API token ID" hint="Datacenter → Permissions → API Tokens">
						<Input
							value={px.tokenId}
							onChange={(e) => setPx({ tokenId: e.target.value })}
							placeholder="sekai@pve!bots"
							className="font-mono text-[13px]"
						/>
					</Field>
					<Field label="Token secret">
						<Input
							type="password"
							autoComplete="off"
							value={px.tokenSecret}
							onChange={(e) => setPx({ tokenSecret: e.target.value })}
							className="font-mono text-[13px]"
						/>
					</Field>
					<Field label="Disk storage" hint="Where VM and container disks go">
						<Input
							value={px.storage}
							onChange={(e) => setPx({ storage: e.target.value })}
							placeholder="local-lvm"
						/>
					</Field>
					<Field label="Image storage" hint="Needs the ISO, Container template and Import content types">
						<Input
							value={px.imageStorage}
							onChange={(e) => setPx({ imageStorage: e.target.value })}
							placeholder="local"
						/>
					</Field>
					<Field label="Network bridge">
						<Input
							value={px.bridge}
							onChange={(e) => setPx({ bridge: e.target.value })}
							placeholder="vmbr0"
						/>
					</Field>
					<Field label="First VM ID" hint="New machines take the first free id from here">
						<Input
							type="number"
							min={100}
							value={px.vmidStart}
							onChange={(e) => setPx({ vmidStart: Number(e.target.value) || 100 })}
						/>
					</Field>
				</div>
				<ToggleRow
					title="Accept Proxmox's self-signed certificate"
					description="Proxmox uses one unless you installed your own."
					checked={px.insecureTls}
					onCheckedChange={(insecureTls) => setPx({ insecureTls })}
				/>
				<div className="flex flex-wrap items-center gap-2">
					<Button variant="secondary" onClick={() => test.mutate()} disabled={test.isPending || !px.url}>
						{test.isPending && <Spinner />} Test connection
					</Button>
					{result && (
						<span
							className={`flex items-center gap-1.5 text-[13px] ${result.ok ? "text-success" : "text-danger"}`}
						>
							{result.ok ? <Check className="size-4" /> : <CircleAlert className="size-4" />}
							{result.ok ? `Proxmox ${result.version} · nodes: ${result.nodes.join(", ")}` : result.error}
						</span>
					)}
				</div>
				{result?.ok && result.storages.length > 0 && (
					<p className="text-xs leading-5 text-fg-subtle">
						Storages on {px.node}: {result.storages.join(" · ")}
					</p>
				)}
			</Section>

			<Section
				title="Tailscale"
				icon={<Network />}
				description="So you and your bots reach machines from anywhere."
			>
				<Field
					label="Tailscale auth key"
					hint="A reusable auth key (tskey-auth-…): bots' machines join your tailnet with it. Leave empty to skip Tailscale. With the Tailscale API set up (Admin → Tailscale), Sekai can make one for you and warns before it expires."
				>
					<Input
						type="password"
						autoComplete="off"
						value={m.tailscaleAuthKey}
						onChange={(e) => setM({ ...m, tailscaleAuthKey: e.target.value })}
						className="font-mono text-[13px]"
						placeholder="tskey-auth-…"
					/>
				</Field>
			</Section>

			<Section title="New machines" icon={<Cpu />} description="What a bot gets unless it asks for more.">
				<div className="flex flex-col gap-2">
					<div className="grid gap-3 sm:grid-cols-2">
						<Field label="New computers run as">
							<Segmented
								value={m.computerBackend}
								onValueChange={(computerBackend) => setM({ ...m, computerBackend })}
								options={[
									{ value: "vm", label: "Virtual machine" },
									{ value: "lxc", label: "Container" },
								]}
								className="self-start"
							/>
						</Field>
						<Field label="New devboxes run as">
							<Segmented
								value={m.devboxBackend}
								onValueChange={(devboxBackend) => setM({ ...m, devboxBackend })}
								options={[
									{ value: "lxc", label: "Container" },
									{ value: "vm", label: "Virtual machine" },
								]}
								className="self-start"
							/>
						</Field>
					</div>
					<p className="text-xs leading-5 text-fg-subtle">
						Containers are much lighter and start faster. Virtual machines are fully separate, with their
						own kernel: better for Docker-heavy or kernel work. You and your bots can still pick either each
						time.
					</p>
				</div>
				<div className="flex flex-col gap-2">
					<div className="text-[13px] font-medium">A new computer</div>
					<SpecsFields
						value={m.computerSpecs}
						ballooning
						onChange={(computerSpecs) => setM({ ...m, computerSpecs })}
					/>
				</div>
				<div className="flex flex-col gap-2">
					<div className="text-[13px] font-medium">A new devbox</div>
					<SpecsFields value={m.devboxSpecs} onChange={(devboxSpecs) => setM({ ...m, devboxSpecs })} />
					<div className="grid grid-cols-2 gap-2">
						<Field label="Deleted after (hours)">
							<Input
								type="number"
								min={1}
								value={m.devboxTtlHours}
								onChange={(e) =>
									setM({ ...m, devboxTtlHours: Math.max(0.25, Number(e.target.value) || 24) })
								}
							/>
						</Field>
						<Field label="At most, per bot">
							<Input
								type="number"
								min={0}
								max={20}
								value={m.maxDevboxesPerAgent}
								onChange={(e) =>
									setM({ ...m, maxDevboxesPerAgent: Math.max(0, Number(e.target.value) || 0) })
								}
							/>
						</Field>
					</div>
				</div>
				<ToggleRow
					title="Bots can get a computer without asking"
					description="Off: a bot asking for a computer (or a bigger one) waits for your OK. Devboxes never need asking."
					checked={m.agentRequests === "allow"}
					onCheckedChange={(on) => setM({ ...m, agentRequests: on ? "allow" : "ask" })}
				/>
			</Section>
			<Section
				title="Faster screen control"
				icon={<Gauge />}
				action={<Badge tone="warning">Experimental</Badge>}
				description="How bots see and use their computers' screens."
			>
				<ToggleRow
					title="Use screen-relay on bots' computers"
					description="Screenshots and clicks go through screen-relay (by Vercel Labs, still experimental) instead of a command over SSH each time: screenshots about 7 times faster, clicks and typing about 50 times. Sekai sets it up on each Linux computer the first time a bot uses its screen (Node 22 and a short build, a minute or two in the background) and keeps the usual way until it's ready, or whenever it fails. Screens wider than 1600 pixels keep the usual way."
					checked={m.screenRelay}
					onCheckedChange={(screenRelay) => setM({ ...m, screenRelay })}
				/>
			</Section>
			{dirty && (
				<div className="sticky bottom-4 z-10 flex items-center justify-between gap-3 rounded-2xl border border-border bg-popover/95 px-4 py-3 shadow-pop backdrop-blur animate-in fade-in-0 slide-in-from-bottom-2">
					<span className="text-sm text-muted-foreground">You have unsaved changes</span>
					<div className="flex gap-2">
						<Button variant="ghost" size="sm" onClick={() => setM(settings.machines)}>
							Discard
						</Button>
						<Button variant="primary" size="sm" disabled={save.isPending} onClick={() => save.mutate()}>
							{save.isPending && <Spinner className="text-primary-foreground" />} Save
						</Button>
					</div>
				</div>
			)}
		</>
	);
}
