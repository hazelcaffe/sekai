import {
	AvatarStack,
	api,
	formatBytes,
	pluralize,
	useAgents,
	useAuth,
	useInfo,
	useMachines,
	useMcpServers,
	useProviders,
	useSkills,
} from "@sekai/client";
import { Button, IconTile, SettingsPanel, Skeleton, type Tone } from "@sekai/ui";
import { useQuery } from "@tanstack/react-query";
import {
	Blocks,
	ChevronRight,
	CircleAlert,
	CircleCheck,
	HardDrive,
	KeyRound,
	MessageCircle,
	Network,
	Server,
	Sparkles,
	TriangleAlert,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { NavMark, SettingsSearch } from "../components/AdminShell.tsx";
import type { Attention } from "../lib/attention.ts";
import { navFor, searchNav, type Tab, tabAllowed } from "../lib/nav.tsx";

type Open = (tab: Tab) => void;

function greeting(): string {
	const h = new Date().getHours();
	return h < 5 ? "Good evening" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

const ATTENTION_ICON: Record<Attention["tone"], ReactNode> = {
	danger: <CircleAlert />,
	warning: <TriangleAlert />,
	brand: <Sparkles />,
};

/** What needs you, worst first, each with the button that sorts it out. */
function NeedsYou({ items, onOpen }: { items: Attention[]; onOpen: Open }) {
	if (items.length === 0) {
		return (
			<div className="flex items-center gap-3 rounded-2xl border border-success/25 bg-success/6 px-4 py-3.5">
				<IconTile tone="success">
					<CircleCheck />
				</IconTile>
				<div className="min-w-0">
					<div className="text-sm font-medium">All good</div>
					<div className="text-[13px] text-fg-muted">Nothing needs you right now.</div>
				</div>
			</div>
		);
	}
	return (
		<div className="flex flex-col divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
			{items.map((i) => {
				const go = () => (i.tab ? onOpen(i.tab) : i.href && location.assign(i.href));
				return (
					<div key={i.id} className="flex items-center gap-3 px-4 py-3">
						<IconTile tone={i.tone}>{ATTENTION_ICON[i.tone]}</IconTile>
						<div className="min-w-0 flex-1">
							<div className="truncate text-sm font-medium">{i.title}</div>
							{i.detail && <div className="truncate text-[13px] text-fg-muted">{i.detail}</div>}
						</div>
						<Button size="sm" variant={i.tone === "danger" ? "primary" : "secondary"} onClick={go}>
							{i.action}
						</Button>
					</div>
				);
			})}
		</div>
	);
}

function Stat({
	icon,
	tone,
	title,
	value,
	detail,
	extra,
	onClick,
	href,
}: {
	icon: ReactNode;
	tone: Tone;
	title: string;
	value: ReactNode;
	detail?: ReactNode;
	extra?: ReactNode;
	onClick?: () => void;
	href?: string;
}) {
	const body = (
		<>
			<IconTile tone={tone}>{icon}</IconTile>
			<div className="min-w-0 flex-1">
				<div className="text-[13px] text-fg-muted">{title}</div>
				<div className="flex items-center gap-2 text-[17px] leading-6 font-semibold tracking-tight">
					<span className="truncate">{value}</span>
					{extra}
				</div>
				{detail && <div className="truncate text-xs text-fg-subtle">{detail}</div>}
			</div>
			<ChevronRight className="size-4 shrink-0 text-fg-subtle transition-transform duration-200 group-hover:translate-x-0.5" />
		</>
	);
	const cls =
		"group flex items-center gap-3.5 rounded-2xl border border-border bg-card p-4 text-left outline-none transition-colors hover:bg-surface-2/50 focus-visible:ring-[3px] focus-visible:ring-ring/30";
	return href ? (
		<a href={href} className={cls}>
			{body}
		</a>
	) : (
		<button type="button" onClick={onClick} className={cls}>
			{body}
		</button>
	);
}

function AtAGlance({ onOpen }: { onOpen: Open }) {
	const { data: agents = [] } = useAgents();
	const { data: info } = useInfo();
	const { data: providers = [] } = useProviders();
	const { data: skills = [] } = useSkills();
	const { data: mcp = [] } = useMcpServers();
	const { data: machines = [] } = useMachines();
	const { data: hosts = [] } = useQuery({ queryKey: ["hosts"], queryFn: api.hosts.list, staleTime: 15_000 });
	const { data: ts } = useQuery({ queryKey: ["tailscale"], queryFn: api.tailscale.overview, staleTime: 15_000 });
	const visible = agents.filter((a) => !a.hidden);
	const ready = providers.filter((p) => p.status.state === "ready").length;
	const running = machines.filter((m) => m.status === "running").length;
	const connected = mcp.filter((m) => m.status.state === "connected").length;
	const reachable = hosts.filter((h) => h.status.ok).length;
	const { data: health } = useQuery({ queryKey: ["health"], queryFn: () => api.health(), staleTime: 60_000 });
	const disk = health?.disk;
	const diskProblem = health?.issues.find((i) => i.id === "disk");
	return (
		<div className="grid gap-3 sm:grid-cols-2">
			<Stat
				icon={<MessageCircle />}
				tone="brand"
				title="Bots"
				value={visible.length}
				extra={<AvatarStack avatars={visible.map((a) => a.avatar)} size={20} max={5} />}
				detail="Open your chats"
				href="/"
			/>
			<Stat
				icon={<Sparkles />}
				tone={info && !info.gateway.ok ? "danger" : "info"}
				title="Models"
				value={info ? (info.gateway.ok ? pluralize(info.gateway.models, "model") : "Gateway offline") : "…"}
				detail={info?.gateway.url}
				onClick={() => onOpen("models")}
			/>
			<Stat
				icon={<KeyRound />}
				tone="warning"
				title="Subscriptions"
				value={providers.length ? `${ready} of ${providers.length} ready` : "None yet"}
				detail={providers.map((p) => p.title).join(", ") || "Use Codex, Claude, Grok… as brains"}
				onClick={() => onOpen("subscriptions")}
			/>
			<Stat
				icon={<Blocks />}
				tone="brand"
				title="Apps & skills"
				value={`${pluralize(mcp.length, "app")} · ${pluralize(skills.length, "skill")}`}
				detail={mcp.length ? `${connected} of ${mcp.length} apps connected` : "Connect apps over MCP"}
				onClick={() => onOpen("apps")}
			/>
			<Stat
				icon={<Server />}
				tone="info"
				title="Computers"
				value={machines.length ? `${running} running` : "None yet"}
				detail={machines.length ? pluralize(machines.length, "machine") : "Give a bot its own computer"}
				onClick={() => onOpen("computers")}
			/>
			<Stat
				icon={<Network />}
				tone="brand"
				title="Devices bots can use"
				value={hosts.length ? `${reachable} of ${hosts.length} reachable` : "None yet"}
				detail={
					ts?.self.running
						? `${ts.self.name ?? "This server"} on ${ts.self.tailnet ?? "your tailnet"}`
						: "Turn devices on in Tailscale"
				}
				onClick={() => onOpen("tailscale")}
			/>
			<Stat
				icon={<HardDrive />}
				tone={diskProblem ? diskProblem.level : "neutral"}
				title="This server"
				value={disk ? `${formatBytes(disk.free)} free` : "…"}
				detail={
					health
						? [
								disk ? `of ${formatBytes(disk.total)}` : null,
								health.database ? `database ${formatBytes(health.database.size)}` : null,
							]
								.filter(Boolean)
								.join(" · ")
						: undefined
				}
				onClick={() => onOpen("backups")}
			/>
		</div>
	);
}

/** On phones and tablets the overview is also the way into every page (like a phone's Settings). */
function PageList({ onOpen, byTab }: { onOpen: Open; byTab: Partial<Record<Tab, Attention["tone"]>> }) {
	const { data: auth } = useAuth();
	const [query, setQuery] = useState("");
	const results = query.trim() ? searchNav(query, auth?.access).filter((i) => i.value !== "overview") : null;
	const groups = results
		? [{ label: results.length ? null : "", items: results }]
		: navFor(auth?.access)
				.filter((g) => g.label)
				.map((g) => ({ label: g.label, items: g.items }));
	return (
		<div className="flex flex-col gap-5 lg:hidden">
			<SettingsSearch onPick={onOpen} query={query} onQuery={setQuery} className="bg-surface-2" />
			{results && results.length === 0 && (
				<p className="px-1 text-[13px] text-fg-subtle">Nothing matches “{query.trim()}”.</p>
			)}
			{groups.map(
				(g) =>
					g.items.length > 0 && (
						<div key={g.label ?? "results"}>
							{g.label && (
								<div className="px-1 pb-1.5 text-[13px] font-medium text-fg-subtle">{g.label}</div>
							)}
							<div className="flex flex-col divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
								{g.items.map((item) => (
									<button
										key={item.value}
										type="button"
										onClick={() => onOpen(item.value)}
										className="flex items-center gap-3 px-3.5 py-3 text-left transition-colors active:bg-surface-2"
									>
										<IconTile tone={item.tone}>{item.icon}</IconTile>
										<span className="min-w-0 flex-1">
											<span className="block truncate text-[15px] font-medium">{item.label}</span>
											<span className="block truncate text-[13px] text-fg-subtle">
												{item.blurb}
											</span>
										</span>
										<NavMark item={item} byTab={byTab} />
										<ChevronRight className="size-4 shrink-0 text-fg-subtle" />
									</button>
								))}
							</div>
						</div>
					),
			)}
		</div>
	);
}

export function OverviewPanel({
	attention,
	onOpen,
}: {
	attention: { items: Attention[]; byTab: Partial<Record<Tab, Attention["tone"]>>; loading: boolean };
	onOpen: Open;
}) {
	const { data: auth } = useAuth();
	const { data: info } = useInfo();
	const access = auth?.access;
	const admin = access?.admin ?? false;
	const first = auth?.user?.name.split(" ")[0];
	// Not an admin (this shows on phones only, as the way into your pages): just what's yours to sort out.
	const items = admin ? attention.items : attention.items.filter((i) => !i.tab || tabAllowed(i.tab, access));
	const needs = items.filter((i) => i.tone !== "brand").length;
	return (
		<SettingsPanel
			value="overview"
			title={`${greeting()}${first ? `, ${first}` : ""}`}
			description={
				!admin
					? "Your usage, sign-ins, and what your bots may do without asking."
					: attention.loading
						? "Checking on everything…"
						: needs
							? `${pluralize(needs, "thing")} ${needs === 1 ? "needs" : "need"} you. Everything else is running.`
							: `Sekai ${info?.version ?? ""} is running smoothly.`
			}
		>
			{(admin || items.length > 0) && (
				<section className="flex flex-col gap-3">
					<h2 className="text-base font-semibold tracking-tight">Needs you</h2>
					{attention.loading ? (
						<Skeleton className="h-16 rounded-2xl" />
					) : (
						<NeedsYou items={items} onOpen={onOpen} />
					)}
				</section>
			)}
			{admin && (
				<section className="hidden flex-col gap-3 lg:flex">
					<h2 className="text-base font-semibold tracking-tight">At a glance</h2>
					<AtAGlance onOpen={onOpen} />
				</section>
			)}
			<PageList onOpen={onOpen} byTab={attention.byTab} />
		</SettingsPanel>
	);
}
