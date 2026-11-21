import { api, cn, timeAgo, useAgents, useSettings } from "@sekai/client";
import type { HostWithStatus, TailnetDevice, TailscaleOverview } from "@sekai/shared";
import {
	Button,
	Callout,
	Confirm,
	DropdownContent,
	DropdownItem,
	DropdownMenu,
	DropdownSeparator,
	DropdownTrigger,
	Field,
	Fold,
	FormGroup,
	IconButton,
	IconTile,
	Input,
	List,
	Page,
	Row,
	SaveState,
	Section,
	Segmented,
	SkeletonRows,
	Spinner,
	Switch,
	Tabs,
	TabsList,
	TabsTrigger,
	Tooltip,
	useFormValues,
} from "@sekai/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	CircleAlert,
	CircleCheck,
	ExternalLink,
	Globe,
	Laptop,
	Lock,
	MoreHorizontal,
	Network,
	Plus,
	RefreshCw,
	Search,
	Server,
	Smartphone,
	Trash2,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { LoadProblem } from "../../components/computer/LoadProblem.tsx";
import { useComputerSave as useAutosave } from "../../components/computer/useComputerSave.ts";
import { useGoBack } from "../../lib/back.ts";
import type { SettingsSectionProps } from "../section.ts";
import { useSaveMachines } from "./Computers.tsx";
import { AddHostDialog, HostAccess, HostRow, KEYS, MasterKeyCard } from "./HostsSection.tsx";
import { PhoneNotifications } from "./PhoneNotifications.tsx";

const TS = ["tailscale"] as const;
const fail = () => toast.error("Couldn’t update the network. Check the connection and try again.");

function useOverview() {
	return useQuery({ queryKey: TS, queryFn: api.tailscale.overview, staleTime: 15_000 });
}

// ---------------------------------------------------------------- this server

/** One way to open Sekai from your other devices, with its switch. */
function Address({
	icon,
	title,
	url,
	note,
	on,
	disabled,
	pending,
	onChange,
}: {
	icon: ReactNode;
	title: string;
	url: string | null;
	note: ReactNode;
	on: boolean;
	disabled?: boolean;
	pending: boolean;
	onChange: (on: boolean) => void;
}) {
	return (
		<div className="flex items-center gap-3 px-4 py-3">
			<IconTile tone={on ? "brand" : "neutral"}>{icon}</IconTile>
			<div className="min-w-0 flex-1">
				<div className="text-body font-medium">{title}</div>
				{on && url && (
					<a
						href={url}
						target="_blank"
						rel="noreferrer"
						className="flex max-w-full items-center gap-1 font-mono text-body text-brand-ink hover:underline"
					>
						<span className="truncate">{url.replace(/^https?:\/\//, "")}</span>
						<ExternalLink className="size-4 shrink-0" />
					</a>
				)}
				<div className="text-small text-fg-subtle">{note}</div>
			</div>
			{pending ? (
				<Spinner />
			) : (
				<Switch checked={on} label={title} disabled={disabled} onCheckedChange={onChange} />
			)}
		</div>
	);
}

function ThisServer({ o }: { o: TailscaleOverview }) {
	const qc = useQueryClient();
	const [disconnect, setDisconnect] = useState<"https" | "ip" | null>(null);
	const https = useAutosave(async (on: boolean) => {
		try {
			await api.tailscale.setHttps(on);
			await qc.invalidateQueries({ queryKey: TS });
		} catch {
			throw new Error("Check Tailscale’s HTTPS settings and try again.");
		}
	});
	const byIp = useAutosave(async (on: boolean) => {
		try {
			await api.tailscale.setByIp(on);
			await qc.invalidateQueries({ queryKey: TS });
		} catch {
			throw new Error("Check this server’s network connection and try again.");
		}
	});
	const here = typeof location !== "undefined" && o.https.url ? location.origin === o.https.url : false;
	if (o.self.error && !o.self.running) {
		return (
			<Section title="This server">
				<Callout icon={<CircleAlert />} title="Tailscale isn't running here">
					Install or start Tailscale on the computer running Sekai, then refresh this page.
				</Callout>
			</Section>
		);
	}
	return (
		<Section
			title="This server"
			saveState={
				<>
					<SaveState state={https} />
					<SaveState state={byIp} />
				</>
			}
		>
			<div className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface">
				<div className="flex items-center gap-3 px-4 py-3.5">
					<span className="relative">
						<IconTile tone="brand">
							<Network />
						</IconTile>
						<span
							aria-hidden
							className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full bg-success ring-2 ring-surface"
						/>
					</span>
					<div className="min-w-0 flex-1">
						<div className="truncate text-body font-medium">
							{o.self.dnsName?.split(".")[0] ?? o.self.name}
							<span className="font-normal text-fg-subtle"> · {o.self.address}</span>
						</div>
						<div className="truncate text-small text-fg-subtle">
							{[
								o.self.tailnet ? `${o.self.tailnet}’s network` : null,
								o.self.login && o.self.login !== o.self.tailnet ? `signed in as ${o.self.login}` : null,
								o.self.version ? `Tailscale ${o.self.version}` : null,
							]
								.filter(Boolean)
								.join(" · ")}
						</div>
					</div>
				</div>
				<Address
					icon={<Lock />}
					title="Private HTTPS address"
					url={o.https.url}
					on={o.https.on}
					disabled={!o.https.canServe}
					pending={https.status === "saving"}
					onChange={(on) => (on ? https.save(true) : setDisconnect("https"))}
					note={
						o.https.on
							? `Private to your network${here ? " · You’re using this address" : ""}.`
							: "A secure address for notifications, the microphone and passkeys."
					}
				/>
				<Address
					icon={<Globe />}
					title="By IP address"
					url={o.byIp.url}
					on={o.byIp.on}
					disabled={!o.byIp.url}
					pending={byIp.status === "saving"}
					onChange={(on) => (on ? byIp.save(true) : setDisconnect("ip"))}
					note={
						o.byIp.on
							? "Browsers keep the microphone, notifications and passkeys off at this address."
							: "Use this address if a device can’t find the server by name."
					}
				/>
			</div>
			<Confirm
				open={Boolean(disconnect)}
				onOpenChange={(o) => !o && setDisconnect(null)}
				title="Turn off this address?"
				description="Devices using this address will lose their connection to Sekai."
				confirmLabel="Turn off"
				onConfirm={() => (disconnect === "https" ? https : byIp).save(false)}
			/>
		</Section>
	);
}

// ---------------------------------------------------------------- the API

function expiresIn(iso: string): string {
	const days = Math.round((Date.parse(iso) - Date.now()) / 86_400_000);
	return days < 0 ? "expired" : days === 0 ? "expires today" : `expires in ${days} day${days === 1 ? "" : "s"}`;
}

function ApiKey({ o }: { o: TailscaleOverview }) {
	const qc = useQueryClient();
	const [kind, setKind] = useState<"token" | "oauth">("token");
	const [token, setToken] = useState("");
	const [clientId, setClientId] = useState("");
	const [secret, setSecret] = useState("");
	const [editing, setEditing] = useState(false);
	const [removing, setRemoving] = useState(false);
	const done = (next: TailscaleOverview) => {
		qc.setQueryData(TS, next);
		void qc.invalidateQueries({ queryKey: KEYS.tailnet });
		setEditing(false);
		setToken("");
		setSecret("");
	};
	const save = useMutation({
		mutationFn: () => api.tailscale.setApi(kind === "token" ? { token } : { clientId, clientSecret: secret }),
		onSuccess: done,
		onError: () => {},
	});
	const remove = useMutation({
		mutationFn: api.tailscale.clearApi,
		onSuccess: () => {
			void qc.invalidateQueries({ queryKey: TS });
			void qc.invalidateQueries({ queryKey: KEYS.tailnet });
		},
	});
	const form = (
		<FormGroup
			dirty={Boolean(token || clientId || secret)}
			onCancel={() => {
				setToken("");
				setClientId("");
				setSecret("");
				setEditing(false);
			}}
			submitLabel="Connect"
			disabled={kind === "token" ? token.trim().length < 10 : !clientId.trim() || secret.trim().length < 10}
			onSubmit={async () => {
				try {
					await save.mutateAsync();
				} catch {
					throw new Error(
						"Couldn’t connect to Tailscale. Check the credentials and their permissions, then try again.",
					);
				}
			}}
		>
			<Segmented<"token" | "oauth">
				value={kind}
				onValueChange={setKind}
				size="sm"
				options={[
					{ value: "token", label: "Access token" },
					{ value: "oauth", label: "OAuth client" },
				]}
			/>
			{kind === "token" ? (
				<Field
					label="API access token"
					hint={
						<>
							Tailscale admin →{" "}
							<a
								href="https://login.tailscale.com/admin/settings/keys"
								target="_blank"
								rel="noreferrer"
								className="font-medium text-brand-ink hover:underline"
							>
								Settings → Keys
							</a>{" "}
							→ Generate access token. It starts with tskey-api- and lasts up to 90 days.
						</>
					}
				>
					<Input
						type="password"
						autoComplete="off"
						value={token}
						onChange={(e) => setToken(e.target.value)}
						placeholder="tskey-api-…"
						className="font-mono text-body"
					/>
				</Field>
			) : (
				<>
					<p className="text-small text-fg-subtle">
						An OAuth client doesn't expire. Make one under{" "}
						<a
							href="https://login.tailscale.com/admin/settings/oauth"
							target="_blank"
							rel="noreferrer"
							className="font-medium text-brand-ink hover:underline"
						>
							Settings → OAuth clients
						</a>{" "}
						with Devices: read and Keys → Auth keys: write.
					</p>
					<div className="grid gap-3 sm:grid-cols-2">
						<Field label="Client ID">
							<Input
								value={clientId}
								onChange={(e) => setClientId(e.target.value)}
								className="font-mono text-body"
							/>
						</Field>
						<Field label="Client secret">
							<Input
								type="password"
								autoComplete="off"
								value={secret}
								onChange={(e) => setSecret(e.target.value)}
								placeholder="tskey-client-…"
								className="font-mono text-body"
							/>
						</Field>
					</div>
				</>
			)}
		</FormGroup>
	);
	return (
		<>
			{o.api.hint && !editing && (
				<div className="p-3">
					<Callout icon={<CircleAlert />} title="Device list unavailable">
						Check that the key can read devices on your network.
					</Callout>
				</div>
			)}
			{o.api.configured &&
				!editing &&
				o.api.expires &&
				Date.parse(o.api.expires) - Date.now() < 10 * 86_400_000 && (
					<div className="p-3">
						<Callout icon={<CircleAlert />} title="The API token expires soon">
							Make a new access token in the Tailscale admin and paste it with Change (or use an OAuth
							client, which doesn't expire).
						</Callout>
					</div>
				)}
			{o.api.configured && !editing ? (
				<div className="flex items-center gap-3 px-4 py-3">
					<IconTile tone={o.api.ok === false ? "danger" : "success"}>
						{o.api.ok === false ? <CircleAlert /> : <CircleCheck />}
					</IconTile>
					<div className="min-w-0 flex-1">
						<div className="text-body font-medium">
							{o.api.ok === false ? "The API key stopped working" : "Connected"}
						</div>
						<div className="truncate text-small text-fg-subtle">
							{o.api.ok === false
								? "Check the key in Tailscale or replace it."
								: [
										o.api.kind === "oauth" ? "OAuth client" : "Access token",
										o.api.devices !== null ? `${o.api.devices} devices` : null,
										o.api.expires ? expiresIn(o.api.expires) : null,
									]
										.filter(Boolean)
										.join(" · ")}
						</div>
					</div>
					<Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
						Change
					</Button>
					<Button variant="danger-ghost" size="sm" onClick={() => setRemoving(true)}>
						Remove
					</Button>
				</div>
			) : (
				<div>{form}</div>
			)}
			<Confirm
				open={removing}
				onOpenChange={setRemoving}
				title="Remove the Tailscale API key?"
				description="Sekai will only see devices visible from this server. Your private network stays as it is."
				confirmLabel="Remove"
				danger
				onConfirm={() => remove.mutate()}
			/>
		</>
	);
}

/** The auth key bots' new computers and devboxes join the tailnet with. */
function AuthKey({ o }: { o: TailscaleOverview }) {
	const qc = useQueryClient();
	const renew = useMutation({
		mutationFn: api.tailscale.renewAuthKey,
		onSuccess: (next) => {
			qc.setQueryData(TS, next);
			void qc.invalidateQueries({ queryKey: ["settings"] });
			toast.success("New auth key saved for bots' computers");
		},
		onError: fail,
	});
	const k = o.authKey;
	const days = k.expires ? Math.round((Date.parse(k.expires) - Date.now()) / 86_400_000) : null;
	const state = !k.set
		? "New computers won’t join your private network."
		: k.revoked
			? "The key was removed. New computers can’t join."
			: k.expired
				? "The key expired. New computers can’t join."
				: days !== null
					? `Works for ${days} more day${days === 1 ? "" : "s"}${k.reusable === false ? " (single use)" : ""}.`
					: "Set (connect Tailscale to check when it expires).";
	const bad = !k.set || k.revoked || k.expired || (days !== null && days < 7);
	return (
		<div className="flex items-center gap-3 px-4 py-3">
			<IconTile tone={bad ? "warning" : "neutral"}>
				<Server />
			</IconTile>
			<div className="min-w-0 flex-1">
				<div className="text-body font-medium">Key for new computers</div>
				<div className={cn("text-small", bad ? "text-warning-ink" : "text-fg-subtle")}>{state}</div>
			</div>
			{o.api.configured && o.api.ok !== false ? (
				<Button variant="secondary" size="sm" disabled={renew.isPending} onClick={() => renew.mutate()}>
					{renew.isPending ? <Spinner /> : <RefreshCw />} {k.set ? "Make a new one" : "Make one"}
				</Button>
			) : null}
		</div>
	);
}

// ---------------------------------------------------------------- devices

function osIcon(os: string): ReactNode {
	if (/ios|android/i.test(os)) return <Smartphone />;
	if (/windows|macos|darwin/i.test(os)) return <Laptop />;
	return <Server />;
}

/** One device on your tailnet: whether bots can use it, and as which accounts. */
function DeviceRow({
	d,
	host,
	defaultUser,
}: {
	d: TailnetDevice;
	host: HostWithStatus | undefined;
	defaultUser: string;
}) {
	const qc = useQueryClient();
	const { data: agents = [] } = useAgents();
	const [removing, setRemoving] = useState(false);
	const refresh = () => void qc.invalidateQueries({ queryKey: KEYS.hosts });
	const enable = useMutation({
		mutationFn: async () => {
			const base = d.name.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "device";
			const make = (name: string) =>
				api.hosts.create({
					name,
					// Its Tailscale IP never changes, and works even where tailnet names don't resolve (WSL).
					address: d.address || d.dnsName,
					user: defaultUser,
					source: "tailscale",
					tailscaleId: d.id,
					os: d.os || null,
				});
			try {
				return await make(base);
			} catch (err) {
				// Another device already has that name: tell them apart by their tailnet id.
				if (!/already/.test(String(err))) throw err;
				return make(`${base}-${d.id.slice(-4)}`);
			}
		},
		onSuccess: () => {
			refresh();
			setTimeout(refresh, 4000);
		},
		onError: fail,
	});
	const disable = useMutation({
		mutationFn: () => api.hosts.delete(host?.id ?? ""),
		onSuccess: refresh,
		onError: fail,
	});
	const check = useMutation({ mutationFn: () => api.hosts.check(host?.id ?? ""), onSuccess: refresh });
	const meta = [
		d.os || "unknown OS",
		d.owner === "Tagged" ? d.tags.map((t) => t.replace(/^tag:/, "")).join(", ") : d.owner,
		d.address,
		d.online ? null : d.lastSeen ? `seen ${timeAgo(Date.parse(d.lastSeen))}` : "offline",
	].filter(Boolean);
	const expiresSoon = d.keyExpires && Date.parse(d.keyExpires) - Date.now() < 7 * 86_400_000;
	return (
		<div className="flex flex-col gap-3 px-4 py-3">
			<div className="flex items-center gap-3">
				<span className="relative flex size-9 shrink-0 items-center justify-center rounded-md bg-surface-2 text-fg-subtle [&_svg]:size-5">
					{osIcon(d.os)}
					<span
						aria-hidden
						className={cn(
							"absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-surface",
							d.online ? "bg-success" : "bg-fg-subtle/40",
						)}
					/>
				</span>
				<div className="min-w-0 flex-1">
					<div className="flex min-w-0 items-center gap-1.5">
						<span className="truncate text-body font-medium">{d.name}</span>
						{expiresSoon && (
							<span className="shrink-0 rounded-sm bg-warning-soft px-1.5 py-0.5 text-caption font-medium text-warning-ink">
								key expires soon
							</span>
						)}
					</div>
					<Tooltip
						content={
							d.clientVersion
								? `Tailscale ${d.clientVersion}${d.updateAvailable ? " (an update is available)" : ""}`
								: d.dnsName
						}
					>
						<div className="truncate text-small text-fg-subtle">{meta.join(" · ")}</div>
					</Tooltip>
				</div>
				{d.botMachine ? (
					<span className="shrink-0 rounded-sm bg-surface-2 px-2 py-1 text-caption text-fg-muted">
						{d.botMachine.name} · in Computers
					</span>
				) : (
					<div className="flex shrink-0 items-center gap-1">
						{host && (
							<DropdownMenu>
								<DropdownTrigger asChild>
									<IconButton variant="ghost" size="icon-sm" label={`More for ${d.name}`}>
										<MoreHorizontal />
									</IconButton>
								</DropdownTrigger>
								<DropdownContent>
									<DropdownItem icon={<RefreshCw />} onSelect={() => check.mutate()}>
										Check again
									</DropdownItem>
									<DropdownSeparator />
									<DropdownItem danger icon={<Trash2 />} onSelect={() => setRemoving(true)}>
										Stop bots using it
									</DropdownItem>
								</DropdownContent>
							</DropdownMenu>
						)}
						{enable.isPending || disable.isPending ? (
							<Spinner />
						) : (
							<Switch
								checked={Boolean(host)}
								label={`Bots can use ${d.name}`}
								onCheckedChange={(on) => (on ? enable.mutate() : setRemoving(true))}
							/>
						)}
					</div>
				)}
			</div>
			{host && (
				<div className="sm:pl-12">
					<HostAccess h={host} agents={agents} />
				</div>
			)}
			<Confirm
				open={removing}
				onOpenChange={setRemoving}
				title={`Stop bots using ${d.name}?`}
				description="Their keys are taken off it (if it's reachable), and they lose access. Nothing else on the device changes."
				confirmLabel="Stop"
				danger
				onConfirm={() => disable.mutate()}
			/>
		</div>
	);
}

function Devices({ o, servers }: { o: TailscaleOverview; servers?: boolean }) {
	const qc = useQueryClient();
	const hostsQuery = useQuery({ queryKey: KEYS.hosts, queryFn: api.hosts.list });
	const hosts = hostsQuery.data ?? [];
	const { data: agents = [] } = useAgents();
	const {
		data: tailnet,
		isLoading,
		isFetching,
		isError,
		refetch,
	} = useQuery({ queryKey: KEYS.tailnet, queryFn: api.hosts.tailnet, staleTime: 20_000 });
	const [view, setView] = useState<"used" | "all" | null>(null);
	const [query, setQuery] = useState("");
	const [showOffline, setShowOffline] = useState(false);
	const [adding, setAdding] = useState<number | null>(null);
	const [user, setUser] = useState(o.defaultUser);
	const saveUser = useAutosave(async (name: string) => {
		qc.setQueryData(TS, await api.tailscale.setDefaultUser(name));
	});
	const devices = tailnet?.devices ?? [];
	const hostOf = (d: TailnetDevice) => hosts.find((h) => h.id === d.hostId);
	const used = devices.filter((d) => hostOf(d) || d.botMachine);
	const mode = view ?? (used.some((d) => hostOf(d)) ? "used" : "all");
	const q = query.trim().toLowerCase();
	const matches = (d: TailnetDevice) =>
		!q || [d.name, d.address, d.os, d.owner ?? "", ...d.tags].some((x) => x.toLowerCase().includes(q));
	const pool = (mode === "used" ? used : devices).filter(matches);
	const shown = mode === "all" && !showOffline && !q ? pool.filter((d) => d.online || hostOf(d)) : pool;
	const offline = pool.length - shown.length;
	const onTailnet = new Set(devices.map((d) => d.hostId).filter(Boolean));
	const others = hosts.filter((h) => !onTailnet.has(h.id));
	if (hostsQuery.isError || isError)
		return (
			<LoadProblem
				what="devices"
				retry={() => {
					void hostsQuery.refetch();
					void refetch();
				}}
			/>
		);
	if (isLoading || !hostsQuery.data) return <SkeletonRows />;
	return (
		<>
			{!servers && (
				<Section
					title="Device access"
					description="Turn a device on to let bots ask to work there; full control always needs your approval."
				>
					<div className="flex flex-wrap items-center gap-2">
						<Tabs value={mode} onValueChange={(v) => setView(v === "used" ? "used" : "all")}>
							<TabsList aria-label="Device list">
								<TabsTrigger value="used">In use · {used.length}</TabsTrigger>
								<TabsTrigger value="all">All · {devices.length}</TabsTrigger>
							</TabsList>
						</Tabs>
						<label className="flex h-8 min-w-0 flex-1 basis-40 items-center gap-2 rounded-md bg-surface-2 px-2.5 text-body">
							<Search className="size-4 shrink-0 text-fg-subtle" />
							<input
								value={query}
								onChange={(e) => setQuery(e.target.value)}
								placeholder="Find a device"
								aria-label="Find a device"
								className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-fg-subtle"
							/>
						</label>
						<IconButton
							variant="ghost"
							size="icon-sm"
							label="Refresh"
							disabled={isFetching}
							onClick={() => void refetch()}
						>
							<RefreshCw className={isFetching ? "animate-spin" : undefined} />
						</IconButton>
					</div>
					{tailnet?.error && (
						<p className="text-body text-warning-ink">
							{tailnet.via === "cli" && o.api.configured
								? "Couldn’t reach Tailscale. Showing devices this server can see instead."
								: "Couldn’t find network devices. Check Tailscale and refresh the list."}
						</p>
					)}
					{isLoading ? (
						<Spinner />
					) : shown.length ? (
						<div className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface">
							{shown.map((d) => (
								<DeviceRow
									key={`${d.id}:${d.hostId ?? ""}`}
									d={d}
									host={hostOf(d)}
									defaultUser={o.defaultUser}
								/>
							))}
						</div>
					) : (
						<div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-small text-fg-subtle">
							{q
								? `No device matches “${query.trim()}”.`
								: mode === "used"
									? "Bots can't use any device yet. Switch to All and turn one on."
									: "No devices on your private network yet."}
							{mode === "used" && !q && (
								<div className="mt-2">
									<Button variant="secondary" size="sm" onClick={() => setView("all")}>
										Show all devices
									</Button>
								</div>
							)}
						</div>
					)}
					{mode === "all" && !q && (offline > 0 || showOffline) && (
						<button
							type="button"
							onClick={() => setShowOffline((v) => !v)}
							className="self-start text-caption font-medium text-fg-muted hover:text-fg"
						>
							{showOffline ? "Hide offline devices" : `Show ${offline} offline`}
						</button>
					)}
					<Fold title="Advanced" summary="Default device account">
						<Section title="Device account" saveState={<SaveState state={saveUser} />}>
							<Field label="Account on new devices">
								<Input
									value={user}
									onChange={(e) => setUser(e.target.value)}
									onBlur={() => {
										if (user.trim() && user.trim() !== o.defaultUser) saveUser.save(user.trim());
									}}
									onKeyDown={(e) => {
										if (e.key === "Enter") e.currentTarget.blur();
									}}
									aria-label="Your account on your devices"
									className="h-8 w-36 font-mono text-body"
								/>
							</Field>
						</Section>
					</Fold>
				</Section>
			)}
			{servers && (
				<Section
					title="Connected servers"
					action={
						<Button variant="secondary" size="sm" onClick={() => setAdding(Date.now())}>
							<Plus /> Add by address
						</Button>
					}
				>
					{others.length > 0 && (
						<div className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface">
							{others.map((h) => (
								<HostRow key={h.id} h={h} agents={agents} />
							))}
						</div>
					)}
					{!others.length && <p className="text-small text-fg-muted">No servers added by address yet.</p>}
				</Section>
			)}
			{adding && <AddHostDialog key={adding} open from={null} onOpenChange={(v) => !v && setAdding(null)} />}
		</>
	);
}

function JoinKey({ saved }: { saved: string }) {
	const f = useFormValues({ key: saved });
	const save = useSaveMachines();
	const qc = useQueryClient();
	return (
		<FormGroup
			dirty={f.dirty}
			onCancel={() => f.reset()}
			onSubmit={async () => {
				f.reset({ key: (await save({ tailscaleAuthKey: f.values.key })).tailscaleAuthKey });
				await qc.invalidateQueries({ queryKey: TS });
			}}
		>
			<Field
				label="Reusable auth key"
				hint="New computers join your network with this key. Leave it empty to skip."
			>
				<Input
					type="password"
					autoComplete="off"
					value={f.values.key}
					onChange={(e) => f.set("key", e.target.value)}
					placeholder="tskey-auth-…"
				/>
			</Field>
		</FormGroup>
	);
}

function NetworkKeys({ overview }: { overview: TailscaleOverview }) {
	const settings = useSettings();
	return (
		<>
			<Section
				title="Network connection"
				description="Connect Tailscale to find devices and create keys for new computers."
			>
				<ApiKey o={overview} />
			</Section>
			<Section title="New computers">
				<AuthKey o={overview} />
				{settings.data ? (
					<JoinKey saved={settings.data.machines.tailscaleAuthKey} />
				) : settings.isError ? (
					<LoadProblem what="the network key" retry={settings.refetch} />
				) : (
					<SkeletonRows count={1} />
				)}
			</Section>
		</>
	);
}

const titles: Record<string, string> = {
	devices: "Your devices",
	servers: "Other servers",
	connection: "Private network",
	key: "Device key",
	notifications: "Phone notifications",
	"notifications/ios": "iPhone and iPad",
	"notifications/android": "Android",
};

/** The network overview: reach this server, then decide which devices bots can use. */
export function NetworkSection({ back, rest }: SettingsSectionProps) {
	const q = useOverview();
	const o = q.data;
	const goBack = useGoBack();
	const phone = rest.startsWith("notifications/");
	const parent = phone ? "/settings/network/notifications" : "/settings/network";
	return (
		<Page
			key={rest}
			back={
				titles[rest]
					? { label: phone ? "Phone notifications" : "Network & devices", onClick: () => goBack(parent) }
					: back
			}
			title={titles[rest] ?? "Network & devices"}
			description={
				rest === "notifications"
					? "Set up delivery for the Sekai phone apps."
					: !rest
						? "Reach Sekai from your devices and choose where bots can work."
						: undefined
			}
		>
			{phone || rest === "notifications" ? (
				<PhoneNotifications platform={rest.split("/")[1]} />
			) : rest === "key" ? (
				<Section
					title="Install the key"
					description="Install this public key in each device account your bots may use."
				>
					<MasterKeyCard bare />
				</Section>
			) : q.isError ? (
				<LoadProblem what="the network" retry={q.refetch} />
			) : !o ? (
				<SkeletonRows count={4} />
			) : rest === "devices" || rest === "servers" ? (
				<Devices key={rest} o={o} servers={rest === "servers"} />
			) : rest === "connection" ? (
				<NetworkKeys overview={o} />
			) : (
				<>
					<ThisServer o={o} />
					<Section title="Access">
						<List>
							<Row
								icon={<Laptop />}
								title="Your devices"
								subtitle="Choose which devices bots may use"
								href="/settings/network/devices"
							/>
							<Row
								icon={<Server />}
								title="Other servers"
								subtitle="Connect a server by address"
								href="/settings/network/servers"
							/>
							<Row
								icon={<Smartphone />}
								title="Phone notifications"
								subtitle="Delivery to iPhone, iPad and Android"
								href="/settings/network/notifications"
							/>
						</List>
					</Section>
					<Fold title="Advanced" summary="Network connection and keys">
						<List>
							<Row
								icon={<Network />}
								title="Private network"
								subtitle="Connect Tailscale and set keys for new computers"
								href="/settings/network/connection"
							/>
							<Row
								icon={<Lock />}
								title="Device key"
								subtitle="Set up access to device accounts"
								href="/settings/network/key"
							/>
						</List>
					</Fold>
				</>
			)}
		</Page>
	);
}
