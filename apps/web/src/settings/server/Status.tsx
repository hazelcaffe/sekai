import {
	AvatarStack,
	api,
	formatBytes,
	pluralize,
	useAgents,
	useApprovals,
	useAuth,
	useCredentialRequests,
	useInfo,
	useMachines,
	useMcpServers,
	usePairings,
	useProviders,
	useSkills,
} from "@sekai/client";
import { Badge, Button, Fold, List, Page, Row, Section, SkeletonRows } from "@sekai/ui";
import { useQuery } from "@tanstack/react-query";
import {
	Blocks,
	CircleAlert,
	CircleCheck,
	HardDrive,
	Inbox,
	KeyRound,
	MessageCircle,
	Monitor,
	Network,
	Sparkles,
	TriangleAlert,
} from "lucide-react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router";
import { sectionPath } from "../registry.tsx";
import type { SettingsSectionProps } from "../section.ts";
import { type Attention, useAttention } from "./attention.ts";

function greeting(): string {
	const h = new Date().getHours();
	return h < 5 ? "Good evening" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

const ATTENTION_ICON: Record<Attention["tone"], ReactNode> = {
	danger: <CircleAlert />,
	warning: <TriangleAlert />,
	brand: <Sparkles />,
};

function AttentionList({ items, label }: { items: Attention[]; label: string }) {
	const navigate = useNavigate();
	return (
		<List label={label}>
			{items.map((i) => {
				const go = () => (i.href ? navigate(i.href) : i.section && navigate(sectionPath(i.section)));
				return (
					<Row
						key={i.id}
						icon={ATTENTION_ICON[i.tone]}
						iconTone={i.tone}
						title={i.title}
						subtitle={i.detail}
						trailing={
							<Button size="sm" variant={i.tone === "danger" ? "primary" : "secondary"} onClick={go}>
								{i.action}
							</Button>
						}
					/>
				);
			})}
		</List>
	);
}

function AtAGlance() {
	const { data: approvals = [] } = useApprovals();
	const { data: pairings = [] } = usePairings();
	const { data: logins = [] } = useCredentialRequests();
	const waiting = approvals.length + pairings.length + logins.length;

	const { data: agents = [] } = useAgents();
	const { data: info } = useInfo();
	const { data: providers = [] } = useProviders();
	const { data: skills = [] } = useSkills();
	const { data: mcp = [] } = useMcpServers();
	const { data: machines = [] } = useMachines();
	const { data: hosts = [] } = useQuery({ queryKey: ["hosts"], queryFn: api.hosts.list, staleTime: 15_000 });
	const { data: ts } = useQuery({ queryKey: ["tailscale"], queryFn: api.tailscale.overview, staleTime: 15_000 });
	const { data: health } = useQuery({ queryKey: ["health"], queryFn: () => api.health(), staleTime: 60_000 });

	const visible = agents.filter((a) => !a.hidden);
	const ready = providers.filter((p) => p.status.state === "ready").length;
	const connected = mcp.filter((m) => m.status.state === "connected").length;
	const reachable = hosts.filter((h) => h.status.ok).length;

	const botComputers = machines.filter((m) => m.kind !== "device");
	const running = botComputers.filter((m) => m.status === "running").length;
	const computersCount = botComputers.filter((m) => m.kind === "computer").length;
	const devboxesCount = botComputers.filter((m) => m.kind === "devbox").length;
	const computerSubtitle =
		computersCount || devboxesCount
			? [
					computersCount ? pluralize(computersCount, "computer") : null,
					devboxesCount ? pluralize(devboxesCount, "devbox", "devboxes") : null,
				]
					.filter(Boolean)
					.join(" · ")
			: "Give a bot its own desktop";

	const disk = health?.disk;
	const diskProblem = health?.issues.find((i) => i.id === "disk");

	return (
		<List label="At a glance">
			<Row
				icon={<Inbox />}
				iconTone={waiting > 0 ? "warning" : "neutral"}
				title="Needs you"
				subtitle={
					waiting > 0
						? `${pluralize(waiting, "request")} waiting for your answer`
						: "Approvals, pairing and sign-in requests"
				}
				badge={waiting > 0 ? <Badge tone="warning">{waiting}</Badge> : undefined}
				value={waiting === 0 ? "All caught up" : undefined}
				href="/inbox"
			/>
			<Row
				icon={<MessageCircle />}
				iconTone="brand"
				title="Bots"
				subtitle="Open your chats"
				value={pluralize(visible.length, "bot")}
				trailing={
					visible.length > 0 ? (
						<span className="max-sm:hidden">
							<AvatarStack avatars={visible.map((a) => a.avatar)} size={22} max={5} />
						</span>
					) : undefined
				}
				href="/"
			/>
			<Row
				icon={<Sparkles />}
				iconTone={info && !info.gateway.ok ? "danger" : "info"}
				title="Models"
				subtitle={info ? (info.gateway.ok ? "Connected and ready" : "Model service offline") : "Checking…"}
				value={info ? (info.gateway.ok ? pluralize(info.gateway.models, "model") : undefined) : "…"}
				badge={info && !info.gateway.ok ? <Badge tone="danger">Offline</Badge> : undefined}
				href={sectionPath("models")}
			/>
			<Row
				icon={<KeyRound />}
				iconTone="warning"
				title="Subscriptions"
				subtitle={
					providers.length ? providers.map((p) => p.title).join(", ") : "Use your own AI plans as models"
				}
				value={providers.length ? `${ready} of ${providers.length} ready` : "None"}
				href={sectionPath("subscriptions")}
			/>
			<Row
				icon={<Blocks />}
				iconTone="brand"
				title="Apps & skills"
				subtitle={mcp.length ? `${connected} of ${mcp.length} apps connected` : "Connect tools bots can use"}
				value={`${pluralize(mcp.length, "app")} · ${pluralize(skills.length, "skill")}`}
				href={sectionPath("apps")}
			/>
			<Row
				icon={<Monitor />}
				iconTone="info"
				title="Computers"
				subtitle={computerSubtitle}
				value={botComputers.length ? `${running} running` : "None"}
				href={sectionPath("computers")}
			/>
			<Row
				icon={<Network />}
				iconTone="brand"
				title="Your devices"
				subtitle={
					ts?.self.running ? `${ts.self.name ?? "This server"} connected` : "Reach your devices from Sekai"
				}
				value={hosts.length ? `${reachable} of ${hosts.length} reachable` : "None"}
				href={sectionPath("network")}
			/>
			<Row
				icon={<HardDrive />}
				iconTone={diskProblem ? diskProblem.level : "neutral"}
				title="Backups & storage"
				subtitle={
					health && (disk || health.database)
						? [
								disk ? `Disk ${formatBytes(disk.total)}` : null,
								health.database ? `database ${formatBytes(health.database.size)}` : null,
							]
								.filter(Boolean)
								.join(" · ")
						: "Whole-server backups"
				}
				value={disk ? `${formatBytes(disk.free)} free` : "…"}
				href={sectionPath("backups")}
			/>
		</List>
	);
}

export function StatusSection({ back }: SettingsSectionProps) {
	const attention = useAttention();
	const { data: auth } = useAuth();
	const { data: info } = useInfo();
	const first = auth?.user?.name.split(" ")[0];
	const broken = attention.items.filter((i) => i.tone !== "brand");
	const setup = attention.items.filter((i) => i.tone === "brand");

	return (
		<Page
			back={back}
			title={`${greeting()}${first ? `, ${first}` : ""}`}
			description={
				attention.loading
					? "Checking on everything…"
					: broken.length > 0
						? `${pluralize(broken.length, "issue")} ${broken.length === 1 ? "needs" : "need"} fixing.`
						: `Sekai ${info?.version ?? ""} is running smoothly.`
			}
		>
			<Section title="Needs attention">
				{attention.loading ? (
					<SkeletonRows count={2} />
				) : broken.length > 0 ? (
					<AttentionList items={broken} label="Issues needing attention" />
				) : (
					<List label="Server health">
						<Row
							icon={<CircleCheck />}
							iconTone="success"
							title="Everything is running smoothly"
							subtitle="Connections, storage and backups look healthy."
						/>
					</List>
				)}
				{!attention.loading && setup.length > 0 && (
					<Fold
						title="Optional setup"
						summary={pluralize(setup.length, "feature")}
						defaultOpen={broken.length === 0}
					>
						<AttentionList items={setup} label="Optional setup" />
					</Fold>
				)}
			</Section>

			<Section title="At a glance">
				<AtAGlance />
			</Section>
		</Page>
	);
}
