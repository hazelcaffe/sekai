import {
	api,
	pluralize,
	qk,
	useAgents,
	useApprovals,
	useAuth,
	useChannels,
	useInfo,
	useMcpServers,
} from "@sekai/client";
import type { Tone } from "@sekai/ui";
import { useQuery } from "@tanstack/react-query";
import type { Tab } from "./nav.tsx";

/** Something on the server that needs you (or would be good to do), and where to sort it out. */
export interface Attention {
	id: string;
	tone: Extract<Tone, "danger" | "warning" | "brand">;
	title: string;
	detail: string;
	/** An admin page, or a link into the main app. */
	tab?: Tab;
	href?: string;
	action: string;
}

const DAY = 86_400_000;
const RANK = { danger: 0, warning: 1, brand: 2 } as const;

/** Everything that needs attention, worst first, and the worst tone per page (for dots in the nav). */
export function useAttention(): {
	items: Attention[];
	byTab: Partial<Record<Tab, Attention["tone"]>>;
	loading: boolean;
} {
	const { data: auth } = useAuth();
	// Server setup (subscriptions, Tailscale, devices, health) is only asked about by admins.
	const admin = Boolean(auth?.access?.admin);
	const { data: info, isLoading: infoLoading } = useInfo();
	const { data: approvals = [] } = useApprovals();
	const { data: providers = [] } = useQuery({
		queryKey: qk.providers,
		queryFn: api.providers.list,
		enabled: admin,
	});
	const { data: mcp = [] } = useMcpServers();
	const { data: channels = [] } = useChannels();
	const { data: agents = [] } = useAgents();
	const { data: ts } = useQuery({
		queryKey: ["tailscale"],
		queryFn: api.tailscale.overview,
		staleTime: 15_000,
		enabled: admin,
	});
	const { data: hosts = [] } = useQuery({
		queryKey: ["hosts"],
		queryFn: api.hosts.list,
		staleTime: 15_000,
		enabled: admin,
	});
	const passkeys = useQuery({ queryKey: qk.passkeys, queryFn: api.auth.passkeys, staleTime: 60_000 });
	const { data: health } = useQuery({
		queryKey: ["health"],
		queryFn: () => api.health(),
		staleTime: 60_000,
		enabled: admin,
	});
	const name = (id: string) => agents.find((a) => a.id === id)?.name ?? "A bot";

	const items: Attention[] = [];
	if (approvals.length) {
		items.push({
			id: "approvals",
			tone: "warning",
			title: `${pluralize(approvals.length, "request")} waiting for you`,
			detail: approvals
				.slice(0, 2)
				.map((a) => a.title)
				.join(" · "),
			href: "/inbox",
			action: "Review",
		});
	}
	if (info && !info.gateway.ok) {
		items.push({
			id: "gateway",
			tone: "danger",
			title: "Can't reach the model gateway",
			detail: info.gateway.error ?? info.gateway.url,
			tab: "models",
			action: "Check",
		});
	}
	for (const p of providers) {
		if (p.status.state !== "auth_required" && p.status.state !== "error") continue;
		items.push({
			id: `provider-${p.id}`,
			tone: "warning",
			title: p.status.state === "auth_required" ? `Sign in to ${p.title} again` : `${p.title} isn't working`,
			detail: p.status.error ?? "Bots using it fall back to the gateway",
			tab: "subscriptions",
			action: "Fix",
		});
	}
	for (const m of mcp) {
		if (m.status.state !== "needs_auth" && m.status.state !== "error") continue;
		items.push({
			id: `mcp-${m.id}`,
			tone: "warning",
			title: m.status.state === "needs_auth" ? `${m.name} needs you to sign in` : `${m.name} isn't connecting`,
			detail: m.status.error ?? "Its tools are unavailable until then",
			tab: "apps",
			action: "Fix",
		});
	}
	for (const c of channels) {
		if (!c.enabled || c.status.state !== "error") continue;
		items.push({
			id: `channel-${c.id}`,
			tone: "warning",
			title: `${name(c.agentId)}'s ${c.type === "discord" ? "Discord bot" : "Discord account"} is offline`,
			detail: c.status.error ?? "It can't send or receive messages",
			href: "/",
			action: "Open Sekai",
		});
	}
	if (ts) {
		if (ts.self.error && !ts.self.running) {
			items.push({
				id: "ts-self",
				tone: "warning",
				title: "Tailscale isn't running on this server",
				detail: ts.self.error,
				tab: "tailscale",
				action: "Open",
			});
		}
		if (ts.api.configured && ts.api.ok === false) {
			items.push({
				id: "ts-api",
				tone: "warning",
				title: "The Tailscale API key stopped working",
				detail: ts.api.error ?? "Sekai can't see your devices' details",
				tab: "tailscale",
				action: "Replace",
			});
		} else if (ts.api.expires && Date.parse(ts.api.expires) - Date.now() < 10 * DAY) {
			items.push({
				id: "ts-api-exp",
				tone: "warning",
				title: "Your Tailscale API key expires soon",
				detail: `On ${new Date(ts.api.expires).toLocaleDateString()}`,
				tab: "tailscale",
				action: "Replace",
			});
		}
		if (ts.authKey.set && (ts.authKey.expired || ts.authKey.revoked)) {
			items.push({
				id: "ts-authkey",
				tone: "warning",
				title: "Bots' new machines can't join your tailnet",
				detail: ts.authKey.revoked ? "The auth key was revoked" : "The auth key expired",
				tab: "tailscale",
				action: "Make a new one",
			});
		}
	}
	const refusing = hosts.filter(
		(h) => h.status.ok === false || Object.values(h.accountStatus ?? {}).some((s) => s.ok === false),
	);
	if (refusing.length) {
		items.push({
			id: "hosts",
			tone: "warning",
			title: `${pluralize(refusing.length, "device")} bots can't reach`,
			detail: refusing.map((h) => h.name).join(", "),
			tab: "tailscale",
			action: "Fix",
		});
	}
	for (const h of health?.issues ?? []) {
		const backups = h.id === "backups" || h.id === "backup-failed";
		items.push({
			id: `health-${h.id}`,
			tone: h.level,
			title: h.title,
			detail: h.detail,
			tab: h.id === "proxmox-storage" ? "computers" : backups || h.id === "disk" ? "backups" : "about",
			action: backups
				? "Open backups"
				: h.id === "disk"
					? "Free up space"
					: h.id === "memory"
						? "See how"
						: "Open",
		});
	}
	if (passkeys.data && passkeys.data.length === 0 && auth?.passkeysAvailable) {
		items.push({
			id: "passkey",
			tone: "brand",
			title: "Add a passkey",
			detail: "Sign in with Face ID, Touch ID or Windows Hello",
			tab: "account",
			action: "Add",
		});
	}
	items.sort((a, b) => RANK[a.tone] - RANK[b.tone]);

	const byTab: Partial<Record<Tab, Attention["tone"]>> = {};
	for (const i of items) {
		if (!i.tab || i.tone === "brand") continue;
		const was = byTab[i.tab];
		if (!was || RANK[i.tone] < RANK[was]) byTab[i.tab] = i.tone;
	}
	return { items, byTab, loading: infoLoading };
}
