import {
	type Agent,
	catalogEntry,
	MCP_CATALOG,
	MCP_CATEGORIES,
	type McpCatalogEntry,
	type McpCategory,
	type McpServerCreate,
	type McpServerWithStatus,
	type McpSetup,
	type McpTransportInput,
} from "@sekai/shared";
import { Badge, Button, Confirm, Dialog, Field, Input, Segmented, Spinner, Switch, ToggleRow } from "@sekai/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
	ArrowLeft,
	Check,
	CircleAlert,
	Copy,
	ExternalLink,
	KeyRound,
	LogIn,
	Plug,
	RefreshCw,
	Search,
	Terminal,
	Trash2,
	Users,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.ts";
import { useAgents, useMcpServers } from "../data.ts";
import { qk } from "../query.ts";
import { cn } from "../utils.ts";
import { AgentAvatar } from "./AgentAvatar.tsx";

// ---------------------------------------------------------------- icons

const TINTS = ["#0ea5e9", "#6366f1", "#14b8a6", "#f59e0b", "#ec4899", "#8b5cf6", "#22c55e", "#ef4444"];

/** An app's icon (its site's favicon, through the server), or a monogram. */
export function AppIcon({
	domain,
	name,
	size = 40,
	className,
}: {
	domain?: string | null;
	name: string;
	size?: number;
	className?: string;
}) {
	const [broken, setBroken] = useState(false);
	const radius = Math.round(size * 0.28);
	if (domain && !broken) {
		return (
			<span
				className={cn(
					"flex shrink-0 items-center justify-center overflow-hidden bg-white ring-1 ring-border",
					className,
				)}
				style={{ width: size, height: size, borderRadius: radius }}
			>
				<img
					src={api.mcp.iconUrl(domain)}
					alt=""
					loading="lazy"
					onError={() => setBroken(true)}
					style={{ width: size * 0.62, height: size * 0.62 }}
				/>
			</span>
		);
	}
	const tint = TINTS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % TINTS.length];
	return (
		<span
			aria-hidden
			className={cn("flex shrink-0 items-center justify-center font-semibold text-white", className)}
			style={{ width: size, height: size, borderRadius: radius, background: tint, fontSize: size * 0.42 }}
		>
			{name.trim()[0]?.toUpperCase() ?? "?"}
		</span>
	);
}

/** The store entry a server came from, and the domain to show its icon. */
export function appOf(s: Pick<McpServerWithStatus, "catalogId" | "transport">): {
	entry?: McpCatalogEntry;
	domain: string | null;
} {
	const entry = catalogEntry(s.catalogId);
	if (entry) return { entry, domain: entry.domain };
	if (s.transport.type === "stdio") return { domain: null };
	try {
		return { domain: new URL(s.transport.url).hostname.replace(/^(mcp|api)\./, "") };
	} catch {
		return { domain: null };
	}
}

// ---------------------------------------------------------------- status

type Tone = "success" | "warning" | "danger" | "neutral";

export function appState(s: McpServerWithStatus): { label: string; tone: Tone } {
	if (!s.enabled) return { label: "Off", tone: "neutral" };
	switch (s.status.state) {
		case "connected":
			return { label: `${s.status.tools.length} tools`, tone: "success" };
		case "needs_auth":
			return { label: "Sign in", tone: "warning" };
		case "connecting":
			return { label: "Connecting…", tone: "neutral" };
		case "error":
			return { label: "Problem", tone: "danger" };
		default:
			return { label: "Not connected", tone: "neutral" };
	}
}

const DOT: Record<Tone, string> = {
	success: "bg-success",
	warning: "bg-warning",
	danger: "bg-danger",
	neutral: "bg-fg-subtle/50",
};

// ---------------------------------------------------------------- access

export interface Access {
	scope: "all" | "agents";
	agentIds: string[];
}

/** Every bot, or the ones you pick. */
function AccessPicker({ value, onChange, agents }: { value: Access; onChange: (a: Access) => void; agents: Agent[] }) {
	return (
		<div className="flex flex-col gap-2.5">
			<Segmented<"all" | "agents">
				value={value.scope}
				onValueChange={(scope) => onChange({ ...value, scope })}
				options={[
					{ value: "all", label: "Every bot", icon: <Users /> },
					{ value: "agents", label: "Only some bots" },
				]}
			/>
			{value.scope === "agents" && (
				<div className="flex flex-wrap gap-1.5">
					{agents.map((a) => {
						const on = value.agentIds.includes(a.id);
						return (
							<button
								key={a.id}
								type="button"
								aria-pressed={on}
								onClick={() =>
									onChange({
										...value,
										agentIds: on
											? value.agentIds.filter((x) => x !== a.id)
											: [...value.agentIds, a.id],
									})
								}
								className={cn(
									"flex h-9 items-center gap-1.5 rounded-full border pr-3 pl-1 text-[13px] font-medium transition-colors",
									on
										? "border-brand/50 bg-brand/8 text-fg"
										: "border-border text-fg-muted hover:bg-muted/60",
								)}
							>
								<AgentAvatar avatar={a.avatar} size={26} />
								{a.name}
								{on && <Check className="size-3.5 text-brand-ink" />}
							</button>
						);
					})}
				</div>
			)}
			<p className="text-xs leading-5 text-fg-subtle">
				{value.scope === "all"
					? "Every bot, including new ones, gets its tools. You can still switch it off for a bot in its Tools tab."
					: value.agentIds.length
						? "Only these bots get its tools. Turn it on for more from each bot's Tools tab."
						: "Pick the bots that should have it."}
			</p>
		</div>
	);
}

// ---------------------------------------------------------------- sign-in

function CopyBox({ value }: { value: string }) {
	const [done, setDone] = useState(false);
	return (
		<div className="flex items-center gap-1 rounded-xl bg-muted px-3 py-1.5">
			<code className="min-w-0 flex-1 truncate font-mono text-xs">{value}</code>
			<Button
				variant="ghost"
				size="icon-sm"
				aria-label="Copy"
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

const isLocalOrigin = () => ["localhost", "127.0.0.1"].includes(location.hostname);

/** The address an app sends you back to (what to register for your own OAuth client). */
export function redirectAddress(loopback = false): string {
	const plainHttp = location.protocol === "http:" && !isLocalOrigin();
	const origin = loopback || plainHttp ? `http://localhost:${location.port || "80"}` : location.origin;
	return `${origin}/api/mcp/oauth/callback`;
}

/**
 * Sends you to the app's sign-in page and waits until it's connected. When the app can't send you back to this
 * address (plain http that isn't localhost), you paste the address you land on.
 */
function SignIn({
	server,
	loopback,
	onDone,
}: {
	server: McpServerWithStatus;
	loopback?: boolean;
	onDone?: () => void;
}) {
	const qc = useQueryClient();
	const { data: servers = [] } = useMcpServers();
	const live = servers.find((s) => s.id === server.id) ?? server;
	const [flow, setFlow] = useState<{ url: string | null; pasteBack: boolean } | null>(null);
	const [pasted, setPasted] = useState("");
	const popup = useRef<Window | null>(null);
	const start = useMutation({
		mutationFn: () => api.mcp.signIn(server.id, { loopback }),
		onSuccess: (r) => {
			setFlow(r);
			if (r.url && popup.current) popup.current.location.href = r.url;
			else popup.current?.close();
		},
		onError: () => popup.current?.close(),
	});
	const finish = useMutation({
		mutationFn: () => api.mcp.finishSignIn(pasted),
		onSuccess: () => void qc.invalidateQueries({ queryKey: qk.mcp }),
	});
	// The sign-in happens in another tab: keep checking until it's done.
	const waiting = Boolean(flow) && live.status.state !== "connected";
	useEffect(() => {
		if (!waiting) return;
		const t = setInterval(() => void qc.invalidateQueries({ queryKey: qk.mcp }), 2000);
		return () => clearInterval(t);
	}, [waiting, qc]);
	const connected = live.status.state === "connected";
	useEffect(() => {
		if (connected && flow) onDone?.();
	}, [connected, flow, onDone]);
	const name = live.title;

	if (connected) {
		return (
			<div className="flex items-center gap-2 rounded-2xl bg-success/10 px-4 py-3 text-sm font-medium text-success">
				<Check className="size-4" /> Signed in. {live.status.tools.length} tools ready.
			</div>
		);
	}
	return (
		<div className="flex flex-col gap-3">
			<Button
				variant="primary"
				disabled={start.isPending}
				onClick={() => {
					// Opened in the click, so the browser doesn't block it; it goes to the sign-in page next.
					popup.current = window.open("about:blank", "_blank");
					// The sign-in page must not be able to steer this tab (reverse tabnabbing).
					if (popup.current) popup.current.opener = null;
					start.mutate();
				}}
			>
				{start.isPending ? <Spinner className="text-primary-foreground" /> : <LogIn />}
				{flow ? `Open ${name}'s sign-in again` : `Sign in to ${name}`}
			</Button>
			{start.error && <p className="text-[13px] text-destructive">{(start.error as Error).message}</p>}
			{flow?.url && !flow.pasteBack && (
				<p className="flex items-center gap-2 text-[13px] text-fg-subtle">
					<Spinner /> Waiting for you to approve Sekai in the other tab…{" "}
					<a
						href={flow.url}
						target="_blank"
						rel="noreferrer"
						className="font-medium text-brand-ink hover:underline"
					>
						Open it
					</a>
				</p>
			)}
			{flow?.pasteBack && (
				<div className="flex flex-col gap-2 rounded-2xl border border-border p-3">
					<p className="text-[13px] leading-5 text-fg-muted">
						{name} sends you back to a <code className="font-mono">localhost</code> address, which won't
						open from this device. That's fine: after approving, copy the whole address from the browser's
						address bar and paste it here.
					</p>
					<div className="flex gap-2">
						<Input
							value={pasted}
							onChange={(e) => setPasted(e.target.value)}
							placeholder="http://localhost:7420/api/mcp/oauth/callback?code=…"
							className="font-mono text-xs"
						/>
						<Button
							variant="secondary"
							disabled={!pasted.trim() || finish.isPending}
							onClick={() => finish.mutate()}
						>
							{finish.isPending ? <Spinner /> : "Finish"}
						</Button>
					</div>
					{finish.error && <p className="text-[13px] text-destructive">{(finish.error as Error).message}</p>}
				</div>
			)}
		</div>
	);
}

// ---------------------------------------------------------------- setting up an app

const SETUP_LABEL: Record<McpSetup["kind"], string> = {
	oauth: "Sign in",
	key: "API key",
	none: "Free",
	command: "On this server",
	"self-hosted": "Your server",
};

const slug = (s: string) =>
	s
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 40) || "app";

function Setup({
	entry,
	agent,
	onBack,
	onDone,
}: {
	entry: McpCatalogEntry;
	agent?: Agent;
	onBack: () => void;
	onDone: () => void;
}) {
	const qc = useQueryClient();
	const { data: agents = [] } = useAgents();
	const [setupAt, setSetupAt] = useState(0);
	const setup = entry.setups[setupAt] ?? entry.setups[0];
	const [values, setValues] = useState<Record<string, string>>({});
	const [access, setAccess] = useState<Access>(
		agent ? { scope: "agents", agentIds: [agent.id] } : { scope: "all", agentIds: [] },
	);
	const [ask, setAsk] = useState(false);
	const [created, setCreated] = useState<McpServerWithStatus | null>(null);
	const set = (k: string, v: string) => setValues((x) => ({ ...x, [k]: v }));

	const body = (): McpServerCreate | null => {
		if (!setup) return null;
		const base = {
			name: slug(entry.id),
			title: entry.name,
			description: entry.description,
			requireApproval: ask,
			scope: access.scope,
			agentIds: access.scope === "agents" ? access.agentIds : [],
			catalogId: entry.id,
		};
		let transport: McpTransportInput;
		switch (setup.kind) {
			case "oauth":
				return {
					...base,
					transport: { type: "http", url: setup.url, headers: {} },
					oauth: {
						clientId: values.clientId?.trim() ?? "",
						clientSecret: values.clientSecret?.trim() ?? "",
						scope: setup.scope ?? "",
						params: setup.authParams ?? {},
					},
				};
			case "key": {
				const key = values.key?.trim() ?? "";
				if (!key && !setup.help?.startsWith("Optional")) return null;
				if (setup.query) {
					const u = new URL(setup.url);
					if (key) u.searchParams.set(setup.query, key);
					transport = { type: "http", url: u.toString(), headers: {} };
				} else {
					transport = {
						type: "http",
						url: setup.url,
						headers: key ? { [setup.header ?? "Authorization"]: `${setup.prefix ?? ""}${key}` } : {},
					};
				}
				return { ...base, transport };
			}
			case "none":
				return { ...base, transport: { type: "http", url: setup.url, headers: {} } };
			case "command": {
				const args = setup.args.map((a) => {
					const p = setup.params?.find((x) => x.token === a);
					return p ? (values[p.token] ?? "").trim() : a;
				});
				if (args.some((a) => !a)) return null;
				const env: Record<string, string> = {};
				for (const e of setup.env ?? []) {
					const v = values[e.name]?.trim();
					if (v) env[e.name] = v;
					else if (!e.optional) return null;
				}
				return { ...base, transport: { type: "stdio", command: setup.command, args, env, cwd: null } };
			}
			case "self-hosted": {
				const host = values.host?.trim().replace(/\/+$/, "");
				const key = values.key?.trim();
				if (!host || !key) return null;
				const url = setup.urlTemplate.replace("{host}", /^https?:\/\//.test(host) ? host : `http://${host}`);
				return {
					...base,
					transport: { type: "http", url, headers: { [setup.header]: `${setup.prefix}${key}` } },
				};
			}
		}
	};

	const add = useMutation({
		mutationFn: async () => {
			const b = body();
			if (!b) throw new Error("Fill in the fields above first");
			return api.mcp.create(b);
		},
		onSuccess: (s) => {
			void qc.invalidateQueries({ queryKey: qk.mcp });
			void qc.invalidateQueries({ queryKey: qk.agents });
			if (setup?.kind === "oauth") setCreated(s);
			else onDone();
		},
	});
	const byo = setup?.kind === "oauth" ? setup.byoClient : undefined;
	const ready =
		Boolean(body()) &&
		(access.scope === "all" || access.agentIds.length > 0) &&
		(!byo || (values.clientId?.trim() && (!byo.secretRequired || values.clientSecret?.trim())));

	return (
		<div className="flex flex-col gap-5">
			<button
				type="button"
				onClick={onBack}
				className="flex items-center gap-1 self-start text-[13px] font-medium text-fg-muted hover:text-fg"
			>
				<ArrowLeft className="size-4" /> All apps
			</button>
			<div className="flex items-start gap-4">
				<AppIcon domain={entry.domain} name={entry.name} size={64} />
				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-center gap-2">
						<h3 className="text-lg font-semibold tracking-tight">{entry.name}</h3>
						{entry.badge && <Badge tone="info">{entry.badge}</Badge>}
						{entry.community && <Badge>Community</Badge>}
					</div>
					<div className="text-[13px] text-fg-subtle">{entry.publisher}</div>
					<p className="mt-1.5 text-sm leading-6 text-fg-muted">{entry.description}</p>
				</div>
			</div>
			<div className="flex flex-wrap gap-1.5">
				{entry.does.map((d) => (
					<span
						key={d}
						className="flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs text-fg-muted"
					>
						<Check className="size-3 text-success" /> {d}
					</span>
				))}
			</div>

			{created ? (
				<SignIn
					server={created}
					loopback={setup?.kind === "oauth" && setup.loopbackOnly}
					onDone={() => setTimeout(onDone, 1200)}
				/>
			) : (
				<>
					{entry.setups.length > 1 && (
						<Segmented<string>
							value={String(setupAt)}
							onValueChange={(v) => setSetupAt(Number(v))}
							options={entry.setups.map((s, i) => ({ value: String(i), label: SETUP_LABEL[s.kind] }))}
						/>
					)}
					{setup?.kind === "oauth" && (
						<div className="flex flex-col gap-3">
							{byo ? (
								<>
									<p className="text-[13px] leading-5 text-fg-muted">
										{entry.name} needs your own OAuth client.{" "}
										<a
											href={byo.url}
											target="_blank"
											rel="noreferrer"
											className="inline-flex items-center gap-0.5 font-medium text-brand-ink hover:underline"
										>
											Create one <ExternalLink className="size-3" />
										</a>
									</p>
									<p className="text-[13px] leading-5 text-fg-subtle">{byo.help}</p>
									<Field label="Redirect address to add">
										<CopyBox value={redirectAddress(setup.loopbackOnly)} />
									</Field>
									<div className="grid gap-3 sm:grid-cols-2">
										<Field label="Client ID">
											<Input
												value={values.clientId ?? ""}
												onChange={(e) => set("clientId", e.target.value)}
												className="font-mono text-[13px]"
											/>
										</Field>
										<Field
											label={byo.secretRequired ? "Client secret" : "Client secret (optional)"}
										>
											<Input
												type="password"
												autoComplete="off"
												value={values.clientSecret ?? ""}
												onChange={(e) => set("clientSecret", e.target.value)}
												className="font-mono text-[13px]"
											/>
										</Field>
									</div>
								</>
							) : (
								<p className="text-[13px] leading-5 text-fg-muted">
									You'll sign in on {entry.name}'s own page and choose what Sekai can access. Nothing
									to copy.
								</p>
							)}
						</div>
					)}
					{setup?.kind === "key" && (
						<Field
							label={setup.label}
							hint={setup.help}
							action={
								setup.keyUrl && (
									<a
										href={setup.keyUrl}
										target="_blank"
										rel="noreferrer"
										className="flex items-center gap-1 text-xs font-medium text-brand-ink hover:underline"
									>
										Get one <ExternalLink className="size-3" />
									</a>
								)
							}
						>
							<Input
								type="password"
								autoComplete="off"
								value={values.key ?? ""}
								onChange={(e) => set("key", e.target.value)}
								className="font-mono text-[13px]"
							/>
						</Field>
					)}
					{setup?.kind === "none" && (
						<p className="text-[13px] leading-5 text-fg-muted">Free to use: no account or key needed.</p>
					)}
					{setup?.kind === "command" && (
						<div className="flex flex-col gap-3">
							<p className="flex items-start gap-2 text-[13px] leading-5 text-fg-muted">
								<Terminal className="mt-0.5 size-4 shrink-0" />
								<span>
									Runs on your Sekai server with <code className="font-mono">{setup.command}</code>.{" "}
									{setup.help}
								</span>
							</p>
							{setup.params?.map((p) => (
								<Field key={p.token} label={p.label}>
									<Input
										value={values[p.token] ?? ""}
										onChange={(e) => set(p.token, e.target.value)}
										placeholder={p.placeholder}
										className="font-mono text-[13px]"
									/>
								</Field>
							))}
							{setup.env?.map((e) => (
								<Field
									key={e.name}
									label={e.optional ? `${e.label} (optional)` : e.label}
									action={
										e.url && (
											<a
												href={e.url}
												target="_blank"
												rel="noreferrer"
												className="flex items-center gap-1 text-xs font-medium text-brand-ink hover:underline"
											>
												Get one <ExternalLink className="size-3" />
											</a>
										)
									}
								>
									<Input
										type="password"
										autoComplete="off"
										value={values[e.name] ?? ""}
										onChange={(ev) => set(e.name, ev.target.value)}
										className="font-mono text-[13px]"
									/>
								</Field>
							))}
						</div>
					)}
					{setup?.kind === "self-hosted" && (
						<div className="flex flex-col gap-3">
							<p className="text-[13px] leading-5 text-fg-subtle">{setup.help}</p>
							<Field label={setup.hostLabel}>
								<Input
									value={values.host ?? ""}
									onChange={(e) => set("host", e.target.value)}
									placeholder={setup.hostPlaceholder}
									className="font-mono text-[13px]"
								/>
							</Field>
							<Field label={setup.label}>
								<Input
									type="password"
									autoComplete="off"
									value={values.key ?? ""}
									onChange={(e) => set("key", e.target.value)}
									className="font-mono text-[13px]"
								/>
							</Field>
						</div>
					)}

					<Field label="Who can use it">
						<AccessPicker value={access} onChange={setAccess} agents={agents} />
					</Field>
					<ToggleRow
						title="Ask before each use"
						description="Every action from this app waits for your OK, in every approval mode."
						checked={ask}
						onCheckedChange={setAsk}
					/>
					{add.error && <p className="text-[13px] text-destructive">{(add.error as Error).message}</p>}
					<Button variant="primary" disabled={!ready || add.isPending} onClick={() => add.mutate()}>
						{add.isPending && <Spinner className="text-primary-foreground" />}
						{setup?.kind === "oauth" ? `Add and sign in` : `Add ${entry.name}`}
					</Button>
				</>
			)}
		</div>
	);
}

// ---------------------------------------------------------------- the store

function StoreCard({ entry, added, onOpen }: { entry: McpCatalogEntry; added: number; onOpen: () => void }) {
	return (
		<button
			type="button"
			onClick={onOpen}
			className="group flex min-w-0 items-start gap-3 rounded-2xl border border-border bg-card p-3.5 text-left transition-[background-color,border-color,box-shadow] duration-150 hover:border-border-strong hover:shadow-sm"
		>
			<AppIcon domain={entry.domain} name={entry.name} size={44} />
			<span className="min-w-0 flex-1">
				<span className="flex items-center gap-1.5">
					<span className="truncate text-sm font-semibold">{entry.name}</span>
					{added > 0 && <Check className="size-3.5 shrink-0 text-success" aria-label="Added" />}
				</span>
				<span className="block truncate text-xs text-fg-subtle">{entry.publisher}</span>
				<span className="mt-1 line-clamp-2 text-[13px] leading-5 text-fg-muted">{entry.description}</span>
			</span>
		</button>
	);
}

/** Popular MCP apps to add in a few clicks. From a bot's panel, new apps go to that bot. */
export function AppStore({ agent, onAdded, onCustom }: { agent?: Agent; onAdded?: () => void; onCustom?: () => void }) {
	const { data: servers = [] } = useMcpServers();
	const [q, setQ] = useState("");
	const [category, setCategory] = useState<McpCategory | "all">("all");
	const [open, setOpen] = useState<McpCatalogEntry | null>(null);
	const added = (id: string) => servers.filter((s) => s.catalogId === id).length;
	const list = useMemo(() => {
		const needle = q.trim().toLowerCase();
		return MCP_CATALOG.filter(
			(e) =>
				(category === "all" || e.category === category) &&
				(!needle ||
					`${e.name} ${e.publisher} ${e.description} ${e.does.join(" ")}`.toLowerCase().includes(needle)),
		);
	}, [q, category]);
	const featured = MCP_CATALOG.filter((e) => e.featured);
	const browsing = !q.trim() && category === "all";

	if (open) {
		return (
			<Setup
				entry={open}
				agent={agent}
				onBack={() => setOpen(null)}
				onDone={() => {
					setOpen(null);
					onAdded?.();
				}}
			/>
		);
	}
	return (
		<div className="@container flex flex-col gap-4">
			<div className="relative">
				<Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-fg-subtle" />
				<Input
					value={q}
					onChange={(e) => setQ(e.target.value)}
					placeholder="Search apps"
					className="h-11 rounded-2xl pl-10"
				/>
			</div>
			<div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 scrollbar-none">
				{(["all", ...Object.keys(MCP_CATEGORIES)] as (McpCategory | "all")[]).map((c) => (
					<button
						key={c}
						type="button"
						onClick={() => setCategory(c)}
						className={cn(
							"h-8 shrink-0 rounded-full px-3 text-[13px] font-medium transition-colors",
							category === c ? "bg-foreground text-background" : "bg-muted text-fg-muted hover:text-fg",
						)}
					>
						{c === "all" ? "All" : MCP_CATEGORIES[c]}
					</button>
				))}
			</div>
			{browsing && (
				<section>
					<h4 className="mb-2 text-sm font-semibold">Popular</h4>
					<div className="grid grid-cols-1 gap-2 @[34rem]:grid-cols-2 @[52rem]:grid-cols-3">
						{featured.map((e) => (
							<StoreCard key={e.id} entry={e} added={added(e.id)} onOpen={() => setOpen(e)} />
						))}
					</div>
				</section>
			)}
			<section>
				{browsing && <h4 className="mb-2 text-sm font-semibold">All apps</h4>}
				{list.length === 0 ? (
					<p className="py-6 text-center text-sm text-fg-subtle">
						No apps match. You can add any MCP server as a custom one.
					</p>
				) : (
					<div className="grid grid-cols-1 gap-2 @[34rem]:grid-cols-2 @[52rem]:grid-cols-3">
						{(browsing ? list.filter((e) => !e.featured) : list).map((e) => (
							<StoreCard key={e.id} entry={e} added={added(e.id)} onOpen={() => setOpen(e)} />
						))}
					</div>
				)}
			</section>
			{onCustom && (
				<button
					type="button"
					onClick={onCustom}
					className="flex items-center gap-3 rounded-2xl border border-dashed border-border-strong p-3.5 text-left text-sm text-fg-muted hover:bg-muted/50"
				>
					<span className="flex size-11 items-center justify-center rounded-xl bg-muted">
						<Plug className="size-5" />
					</span>
					<span>
						<span className="block font-medium text-fg">Custom server</span>
						Any MCP server: a URL, or a command that runs on the Sekai server.
					</span>
				</button>
			)}
		</div>
	);
}

// ---------------------------------------------------------------- your apps

function accessSummary(s: McpServerWithStatus, agents: Agent[]): string {
	if (s.scope === "all") return "Every bot";
	const users = agents.filter((a) => a.mcp.some((b) => b.serverId === s.id));
	return users.length ? users.map((u) => u.name).join(", ") : "No bots yet";
}

/** The apps you've added, as tiles. */
export function InstalledApps({ onManage, empty }: { onManage: (s: McpServerWithStatus) => void; empty?: ReactNode }) {
	const { data: servers = [], isLoading } = useMcpServers();
	const { data: agents = [] } = useAgents();
	if (isLoading) return <Spinner />;
	if (servers.length === 0) return <>{empty}</>;
	return (
		<div className="@container">
			<div className="grid grid-cols-1 gap-2 @[30rem]:grid-cols-2 @[48rem]:grid-cols-3">
				{servers.map((s) => {
					const { domain } = appOf(s);
					const st = appState(s);
					return (
						<button
							key={s.id}
							type="button"
							onClick={() => onManage(s)}
							className="flex min-w-0 items-center gap-3 rounded-2xl border border-border bg-card p-3 text-left transition-colors hover:bg-muted/40"
						>
							<span className="relative">
								<AppIcon domain={domain} name={s.title} size={40} />
								<span
									className={cn(
										"absolute -right-0.5 -bottom-0.5 size-3 rounded-full ring-2 ring-card",
										DOT[st.tone],
									)}
								/>
							</span>
							<span className="min-w-0 flex-1">
								<span className="block truncate text-sm font-semibold">{s.title}</span>
								<span className="block truncate text-xs text-fg-subtle">
									{st.tone === "success" ? accessSummary(s, agents) : st.label}
									{st.tone === "success" ? ` · ${st.label}` : ""}
								</span>
							</span>
						</button>
					);
				})}
			</div>
		</div>
	);
}

/** One app: its status, sign-in, who can use it, its tools. */
export function ManageApp({
	server,
	onOpenChange,
	onEdit,
}: {
	server: McpServerWithStatus | null;
	onOpenChange: (o: boolean) => void;
	/** Edit the raw settings (custom servers, in Admin). */
	onEdit?: (s: McpServerWithStatus) => void;
}) {
	const qc = useQueryClient();
	const { data: servers = [] } = useMcpServers();
	const { data: agents = [] } = useAgents();
	const s = servers.find((x) => x.id === server?.id) ?? server;
	const [removing, setRemoving] = useState(false);
	const refresh = () => {
		void qc.invalidateQueries({ queryKey: qk.mcp });
		void qc.invalidateQueries({ queryKey: qk.agents });
		void qc.invalidateQueries({ queryKey: ["agentTools"] });
	};
	const update = useMutation({
		mutationFn: (patch: Parameters<typeof api.mcp.update>[1]) => api.mcp.update(s?.id ?? "", patch),
		onSuccess: refresh,
	});
	const bind = useMutation({
		mutationFn: async ({ agent, on }: { agent: Agent; on: boolean }) =>
			api.agents.update(agent.id, {
				mcp: on
					? [...agent.mcp, { serverId: s?.id ?? "", tools: null }]
					: agent.mcp.filter((b) => b.serverId !== s?.id),
			}),
		onSuccess: refresh,
	});
	const reconnect = useMutation({ mutationFn: () => api.mcp.connect(s?.id ?? ""), onSuccess: refresh });
	const signOut = useMutation({ mutationFn: () => api.mcp.signOut(s?.id ?? ""), onSuccess: refresh });
	const remove = useMutation({
		mutationFn: () => api.mcp.delete(s?.id ?? ""),
		onSuccess: () => {
			refresh();
			onOpenChange(false);
		},
	});
	if (!s) return null;
	const { entry, domain } = appOf(s);
	const st = appState(s);
	const needsSignIn = s.status.state === "needs_auth";
	const loopback = entry?.setups.some((x) => x.kind === "oauth" && x.loopbackOnly);

	return (
		<Dialog
			open={Boolean(server)}
			onOpenChange={onOpenChange}
			size="lg"
			title={s.title}
			description={
				entry?.publisher ?? (s.transport.type === "stdio" ? "Runs on the Sekai server" : s.transport.url)
			}
			icon={<AppIcon domain={domain} name={s.title} size={36} />}
		>
			<div className="flex flex-col gap-5">
				<div className="flex flex-wrap items-center gap-2">
					<span className={cn("size-2.5 rounded-full", DOT[st.tone])} />
					<span className="text-sm font-medium">
						{s.status.state === "connected"
							? `Connected · ${s.status.tools.length} tools`
							: needsSignIn
								? "Waiting for you to sign in"
								: st.label}
					</span>
					<div className="ml-auto flex items-center gap-2">
						<span className="text-[13px] text-fg-subtle">On</span>
						<Switch
							checked={s.enabled}
							onCheckedChange={(enabled) => update.mutate({ enabled })}
							label="Enabled"
						/>
					</div>
				</div>
				{s.status.state === "error" && s.status.error && (
					<div className="flex items-start gap-2 rounded-2xl bg-danger/8 p-3 text-[13px] text-danger">
						<CircleAlert className="mt-0.5 size-4 shrink-0" />
						<pre className="min-w-0 flex-1 overflow-auto font-sans whitespace-pre-wrap">
							{s.status.error}
						</pre>
					</div>
				)}
				{s.oauth && (needsSignIn ? <SignIn server={s} loopback={loopback} /> : null)}

				<Field label="Who can use it">
					<div className="flex flex-col gap-2.5">
						<Segmented<"all" | "agents">
							value={s.scope}
							onValueChange={(scope) => update.mutate({ scope })}
							options={[
								{ value: "all", label: "Every bot", icon: <Users /> },
								{ value: "agents", label: "Only some bots" },
							]}
						/>
						{s.scope === "agents" && (
							<div className="flex flex-wrap gap-1.5">
								{agents.map((a) => {
									const on = a.mcp.some((b) => b.serverId === s.id);
									return (
										<button
											key={a.id}
											type="button"
											aria-pressed={on}
											onClick={() => bind.mutate({ agent: a, on: !on })}
											className={cn(
												"flex h-9 items-center gap-1.5 rounded-full border pr-3 pl-1 text-[13px] font-medium transition-colors",
												on
													? "border-brand/50 bg-brand/8 text-fg"
													: "border-border text-fg-muted hover:bg-muted/60",
											)}
										>
											<AgentAvatar avatar={a.avatar} size={26} />
											{a.name}
											{on && <Check className="size-3.5 text-brand-ink" />}
										</button>
									);
								})}
							</div>
						)}
					</div>
				</Field>
				<ToggleRow
					title="Ask before each use"
					description="Every action from this app waits for your OK, in every approval mode."
					checked={s.requireApproval}
					onCheckedChange={(requireApproval) => update.mutate({ requireApproval })}
				/>
				{s.status.tools.length > 0 && (
					<details className="rounded-2xl border border-border">
						<summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium select-none">
							What it can do{" "}
							<span className="ml-1 font-normal text-fg-subtle">{s.status.tools.length} tools</span>
						</summary>
						<div className="flex max-h-72 flex-col gap-2 overflow-y-auto border-t border-border p-4 scrollbar-thin">
							{s.status.tools.map((t) => (
								<div key={t.name} className="text-[13px]">
									<span className="font-medium">{t.annotations.title ?? t.name}</span>
									{t.annotations.readOnlyHint && <Badge className="ml-1.5">read-only</Badge>}
									{t.annotations.destructiveHint && (
										<Badge tone="danger" className="ml-1.5">
											changes things
										</Badge>
									)}
									<p className="line-clamp-2 text-xs text-fg-subtle">{t.description}</p>
								</div>
							))}
						</div>
					</details>
				)}
				<div className="flex flex-wrap gap-2">
					<Button
						variant="secondary"
						size="sm"
						disabled={reconnect.isPending || !s.enabled}
						onClick={() => reconnect.mutate()}
					>
						<RefreshCw className={cn(reconnect.isPending && "animate-spin")} /> Reconnect
					</Button>
					{s.oauth?.signedIn && (
						<Button variant="ghost" size="sm" onClick={() => signOut.mutate()}>
							<KeyRound /> Sign out
						</Button>
					)}
					{onEdit && !entry && (
						<Button variant="ghost" size="sm" onClick={() => onEdit(s)}>
							Edit settings
						</Button>
					)}
					{entry && (
						<Button variant="ghost" size="sm" asChild>
							<a href={entry.docs} target="_blank" rel="noreferrer">
								<ExternalLink /> Docs
							</a>
						</Button>
					)}
					<Button variant="danger-ghost" size="sm" className="ml-auto" onClick={() => setRemoving(true)}>
						<Trash2 /> Remove
					</Button>
				</div>
			</div>
			<Confirm
				open={removing}
				onOpenChange={setRemoving}
				title={`Remove ${s.title}?`}
				description="Bots lose its tools. You can add it again from the store."
				confirmLabel="Remove"
				danger
				onConfirm={() => remove.mutate()}
			/>
		</Dialog>
	);
}
