import { api, cn, timeAgo, useAgents } from "@sekai/client";
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
	IconTile,
	Input,
	Section,
	Segmented,
	SettingsPanel,
	Spinner,
	Switch,
	Tooltip,
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
import { AddHostDialog, HostAccess, HostRow, KEYS, MasterKeyCard } from "./HostsSection.tsx";

const TS = ["tailscale"] as const;
const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : String(e));

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
				<div className="text-sm font-medium">{title}</div>
				{on && url && (
					<a
						href={url}
						target="_blank"
						rel="noreferrer"
						className="flex max-w-full items-center gap-1 font-mono text-[13px] text-brand-ink hover:underline"
					>
						<span className="truncate">{url.replace(/^https?:\/\//, "")}</span>
						<ExternalLink className="size-3 shrink-0" />
					</a>
				)}
				<div className="text-xs leading-5 text-fg-subtle">{note}</div>
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
	const https = useMutation({
		mutationFn: (on: boolean) => api.tailscale.setHttps(on),
		onSuccess: () => void qc.invalidateQueries({ queryKey: TS }),
		onError: fail,
	});
	const byIp = useMutation({
		mutationFn: (on: boolean) => api.tailscale.setByIp(on),
		onSuccess: () => void qc.invalidateQueries({ queryKey: TS }),
		onError: fail,
	});
	const here = typeof location !== "undefined" && o.https.url ? location.origin === o.https.url : false;
	if (o.self.error && !o.self.running) {
		return (
			<Section title="This server" description="Where Sekai runs, on your tailnet.">
				<Callout icon={<CircleAlert />} title="Tailscale isn't running here">
					{o.self.error}. Install or start Tailscale on the computer running Sekai.
				</Callout>
			</Section>
		);
	}
	return (
		<Section title="This server" description="Where Sekai runs, and how your other devices open it.">
			<div className="flex flex-col divide-y divide-border rounded-2xl border border-border bg-card">
				<div className="flex items-center gap-3 px-4 py-3.5">
					<span className="relative">
						<IconTile tone="brand">
							<Network />
						</IconTile>
						<span
							aria-hidden
							className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full bg-success ring-2 ring-card"
						/>
					</span>
					<div className="min-w-0 flex-1">
						<div className="truncate text-sm font-medium">
							{o.self.dnsName?.split(".")[0] ?? o.self.name}
							<span className="font-normal text-fg-subtle"> · {o.self.address}</span>
						</div>
						<div className="truncate text-xs text-fg-subtle">
							{[
								o.self.tailnet ? `${o.self.tailnet}'s tailnet` : null,
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
					pending={https.isPending}
					onChange={(on) => https.mutate(on)}
					note={
						o.https.on
							? `Only devices on your tailnet can open it${here ? " (you're on it now)" : ""}. If it doesn't open, turn on “Use Tailscale DNS” in that device's Tailscale app.`
							: "Serve Sekai at a private https address on your tailnet. Phones need it for push notifications, the microphone and passkeys."
					}
				/>
				<Address
					icon={<Globe />}
					title="By IP address"
					url={o.byIp.url}
					on={o.byIp.on}
					disabled={!o.byIp.url}
					pending={byIp.isPending}
					onChange={(on) => byIp.mutate(on)}
					note={
						o.byIp.on
							? "For devices where the name doesn't resolve. Plain http: browsers keep the microphone, push and passkeys off there."
							: "Also open Sekai at this server's tailnet IP, for devices where the name doesn't resolve."
					}
				/>
			</div>
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
		onSuccess: (next) => {
			done(next);
			toast.success(
				`Connected to the Tailscale API${next.api.devices !== null ? ` (${next.api.devices} devices)` : ""}`,
			);
		},
		onError: fail,
	});
	const remove = useMutation({
		mutationFn: api.tailscale.clearApi,
		onSuccess: () => {
			void qc.invalidateQueries({ queryKey: TS });
			void qc.invalidateQueries({ queryKey: KEYS.tailnet });
		},
	});
	const form = (
		<div className="flex flex-col gap-3">
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
						className="font-mono text-[13px]"
					/>
				</Field>
			) : (
				<>
					<p className="text-xs leading-5 text-fg-subtle">
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
								className="font-mono text-[13px]"
							/>
						</Field>
						<Field label="Client secret">
							<Input
								type="password"
								autoComplete="off"
								value={secret}
								onChange={(e) => setSecret(e.target.value)}
								placeholder="tskey-client-…"
								className="font-mono text-[13px]"
							/>
						</Field>
					</div>
				</>
			)}
			<div className="flex justify-end gap-2">
				{o.api.configured && (
					<Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
						Cancel
					</Button>
				)}
				<Button
					variant="primary"
					size="sm"
					disabled={
						save.isPending ||
						(kind === "token" ? token.trim().length < 10 : !clientId.trim() || secret.trim().length < 10)
					}
					onClick={() => save.mutate()}
				>
					{save.isPending && <Spinner className="text-primary-foreground" />} Connect
				</Button>
			</div>
		</div>
	);
	return (
		<>
			{o.api.hint && !editing && (
				<div className="p-3">
					<Callout icon={<CircleAlert />} title="That key can't read the tailnet">
						{o.api.hint}
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
						<div className="text-sm font-medium">
							{o.api.ok === false ? "The API key stopped working" : "Connected"}
						</div>
						<div className="truncate text-xs text-fg-subtle">
							{o.api.ok === false
								? o.api.error
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
				<div className="p-4">{form}</div>
			)}
			<Confirm
				open={removing}
				onOpenChange={setRemoving}
				title="Remove the Tailscale API key?"
				description="Sekai goes back to seeing devices through this server's own Tailscale. Nothing changes on your tailnet."
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
			toast.success("New auth key saved for bots' machines");
		},
		onError: fail,
	});
	const k = o.authKey;
	const days = k.expires ? Math.round((Date.parse(k.expires) - Date.now()) / 86_400_000) : null;
	const state = !k.set
		? "None set: bots' new machines won't join your tailnet."
		: k.revoked
			? "Revoked or deleted: new machines can't join."
			: k.expired
				? "Expired: new machines can't join."
				: days !== null
					? `Works for ${days} more day${days === 1 ? "" : "s"}${k.reusable === false ? " (single use)" : ""}.`
					: "Set (add an API key to see when it expires).";
	const bad = !k.set || k.revoked || k.expired || (days !== null && days < 7);
	return (
		<div className="flex items-center gap-3 px-4 py-3">
			<IconTile tone={bad ? "warning" : "neutral"}>
				<Server />
			</IconTile>
			<div className="min-w-0 flex-1">
				<div className="text-sm font-medium">Key for bots' new machines</div>
				<div className={cn("text-xs leading-5", bad ? "text-warning" : "text-fg-subtle")}>{state}</div>
			</div>
			{o.api.configured && o.api.ok !== false ? (
				<Button variant="secondary" size="sm" disabled={renew.isPending} onClick={() => renew.mutate()}>
					{renew.isPending ? <Spinner /> : <RefreshCw />} {k.set ? "Make a new one" : "Make one"}
				</Button>
			) : (
				<a href="/admin/computers" className="text-xs font-medium text-fg-muted hover:text-fg">
					Set in Computers
				</a>
			)}
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
				<span className="relative flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-fg-subtle [&_svg]:size-[18px]">
					{osIcon(d.os)}
					<span
						aria-hidden
						className={cn(
							"absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-card",
							d.online ? "bg-success" : "bg-fg-subtle/40",
						)}
					/>
				</span>
				<div className="min-w-0 flex-1">
					<div className="flex min-w-0 items-center gap-1.5">
						<span className="truncate text-sm font-medium">{d.name}</span>
						{expiresSoon && (
							<span className="shrink-0 rounded-md bg-warning/14 px-1.5 py-0.5 text-[11px] font-medium text-warning">
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
						<div className="truncate text-xs text-fg-subtle">{meta.join(" · ")}</div>
					</Tooltip>
				</div>
				{d.botMachine ? (
					<span className="shrink-0 rounded-md bg-muted px-2 py-1 text-xs text-fg-muted">
						{d.botMachine.name} · in Computers
					</span>
				) : (
					<div className="flex shrink-0 items-center gap-1">
						{host && (
							<DropdownMenu>
								<DropdownTrigger asChild>
									<Button variant="ghost" size="icon-sm" aria-label={`More for ${d.name}`}>
										<MoreHorizontal />
									</Button>
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

function Devices({ o }: { o: TailscaleOverview }) {
	const qc = useQueryClient();
	const { data: hosts = [] } = useQuery({ queryKey: KEYS.hosts, queryFn: api.hosts.list });
	const { data: agents = [] } = useAgents();
	const {
		data: tailnet,
		isLoading,
		isFetching,
		refetch,
	} = useQuery({ queryKey: KEYS.tailnet, queryFn: api.hosts.tailnet, staleTime: 20_000 });
	const [view, setView] = useState<"used" | "all" | null>(null);
	const [query, setQuery] = useState("");
	const [showOffline, setShowOffline] = useState(false);
	const [adding, setAdding] = useState<number | null>(null);
	const [user, setUser] = useState(o.defaultUser);
	const saveUser = useMutation({
		mutationFn: () => api.tailscale.setDefaultUser(user.trim()),
		onSuccess: (next) => {
			qc.setQueryData(TS, next);
			toast.success("Saved", { duration: 1200 });
		},
		onError: fail,
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
	return (
		<>
			<Section
				title="Devices bots can use"
				description="Turn a device on and bots can ask to work there, each with its own key, as your account or another one you add (like root). Your approval mode or primary bot decides; root always asks you."
			>
				<div className="flex flex-wrap items-center gap-2">
					<Segmented<"used" | "all">
						value={mode}
						onValueChange={setView}
						size="sm"
						options={[
							{ value: "used", label: `In use · ${used.length}` },
							{ value: "all", label: `All · ${devices.length}` },
						]}
					/>
					<label className="flex h-8 min-w-0 flex-1 basis-40 items-center gap-2 rounded-lg bg-muted px-2.5 text-[13px]">
						<Search className="size-3.5 shrink-0 text-fg-subtle" />
						<input
							value={query}
							onChange={(e) => setQuery(e.target.value)}
							placeholder="Find a device"
							aria-label="Find a device"
							className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-fg-subtle"
						/>
					</label>
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label="Refresh"
						disabled={isFetching}
						onClick={() => void refetch()}
					>
						<RefreshCw className={isFetching ? "animate-spin" : undefined} />
					</Button>
				</div>
				{tailnet?.error && (
					<p className="text-[13px] text-warning">
						{tailnet.via === "cli" && o.api.configured
							? `Tailscale API: ${tailnet.error}. Showing this server's view instead.`
							: tailnet.error}
					</p>
				)}
				{isLoading ? (
					<Spinner />
				) : shown.length ? (
					<div className="flex flex-col divide-y divide-border rounded-2xl border border-border bg-card">
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
					<div className="rounded-2xl border border-dashed border-border px-4 py-6 text-center text-[13px] text-fg-subtle">
						{q
							? `No device matches “${query.trim()}”.`
							: mode === "used"
								? "Bots can't use any device yet. Switch to All and turn one on."
								: "No devices on your tailnet yet."}
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
						className="self-start text-xs font-medium text-fg-muted hover:text-fg"
					>
						{showOffline ? "Hide offline devices" : `Show ${offline} offline`}
					</button>
				)}
				<form
					className="flex flex-wrap items-center gap-2 rounded-2xl bg-muted/45 px-4 py-3 text-[13px]"
					onSubmit={(e) => {
						e.preventDefault();
						if (user.trim() && user.trim() !== o.defaultUser) saveUser.mutate();
					}}
				>
					<span className="min-w-0 flex-1 basis-56 text-fg-muted">
						Devices you turn on start with your account
					</span>
					<Input
						value={user}
						onChange={(e) => setUser(e.target.value)}
						aria-label="Your account on your devices"
						className="h-8 w-36 font-mono text-[13px]"
					/>
					{user.trim() !== o.defaultUser && (
						<Button
							type="submit"
							variant="secondary"
							size="sm"
							disabled={!user.trim() || saveUser.isPending}
						>
							Save
						</Button>
					)}
				</form>
			</Section>
			<Section
				title="Other servers"
				description="Servers that aren't on your tailnet, reached at a public address or on your network."
				action={
					<Button variant="secondary" size="sm" onClick={() => setAdding(Date.now())}>
						<Plus /> Add by address
					</Button>
				}
			>
				{others.length > 0 && (
					<div className="flex flex-col divide-y divide-border rounded-2xl border border-border bg-card">
						{others.map((h) => (
							<HostRow key={h.id} h={h} agents={agents} />
						))}
					</div>
				)}
			</Section>
			<Section
				title="Sekai's master key"
				description="Install it once on each device, for each account bots should use. Sekai only uses it to add or remove a bot's own key when you, your primary bot or your approval mode says yes; bots never get it."
			>
				<MasterKeyCard bare />
			</Section>
			{adding && <AddHostDialog key={adding} open from={null} onOpenChange={(v) => !v && setAdding(null)} />}
		</>
	);
}

/** Admin → Tailscale: this server on the tailnet, its addresses, the devices bots can use, and the API. */
export function TailscalePanel() {
	const { data: o, isLoading, error } = useOverview();
	return (
		<SettingsPanel
			value="tailscale"
			title="Tailscale"
			description="Your tailnet: how you reach Sekai from your other devices, and which of them bots can work on."
		>
			{isLoading || !o ? (
				error ? (
					<p className="text-[13px] text-danger">{error.message}</p>
				) : (
					<Spinner />
				)
			) : (
				<>
					<ThisServer o={o} />
					<Devices o={o} />
					<Section
						title="Tailscale API"
						description="Lets Sekai see every device on your tailnet (owners, tags, key expiry) and make keys for bots' new machines."
					>
						<div className="flex flex-col divide-y divide-border rounded-2xl border border-border bg-card">
							<ApiKey o={o} />
							<AuthKey o={o} />
						</div>
					</Section>
				</>
			)}
		</SettingsPanel>
	);
}
