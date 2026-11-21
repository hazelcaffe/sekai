import {
	api,
	pluralize,
	qk,
	settingsUrl,
	useAccess,
	useAgents,
	useAuth,
	useChannels,
	useInfo,
	useMcpServers,
	useSettings,
	useWebEngine,
} from "@sekai/client";
import { type ProviderWithStatus, VOICE_KINDS } from "@sekai/shared";
import type { Tone } from "@sekai/ui";
import { useQuery } from "@tanstack/react-query";

/** Something on the server that's broken or missing setup, and where to sort it out. */
export interface Attention {
	id: string;
	tone: Extract<Tone, "danger" | "warning" | "brand">;
	title: string;
	detail: string;
	/** The Settings section that sorts it out (its id in settings/registry.tsx; it gets the dot). */
	section?: string;
	/** The exact page that sorts it out, when it's more than the section (a subscription's own page), or another page. */
	href?: string;
	action: string;
}

const DAY = 86_400_000;
const RANK = { danger: 0, warning: 1, brand: 2 } as const;

/**
 * A service's error, as reported by the server, in plain words for Status: the usual network failures become a
 * sentence, and anything that isn't readable (JSON, HTML, a stack) gives way to the fallback.
 */
export function friendlyAttentionDetail(raw: string | null | undefined, fallback: string): string {
	const text = raw?.trim();
	if (!text) return fallback;
	const dns = text.match(/ENOTFOUND\s+([^\s:]+)/i);
	if (dns?.[1]) return `Couldn't reach ${dns[1]}. Check its address.`;
	if (/ECONNREFUSED/i.test(text)) return "Connection refused. Check that the service is running.";
	if (/ETIMEDOUT|timeout|timed out/i.test(text)) return "Timed out waiting for a response.";
	if (/CERT_|certificate|unable to verify/i.test(text)) return "Its security certificate couldn't be verified.";
	if (/fetch failed|failed to fetch|unable to connect|ECONNRESET|socket/i.test(text)) {
		return "Couldn't connect. Check the address and that it's running.";
	}
	if (/^[{[<]|\n\s+at\s|^\w*Error:/.test(text)) return fallback;
	return text.length > 160 ? `${text.slice(0, 159)}…` : text;
}

/** Subscriptions that need signing in again or stopped working; Fix opens that subscription's own page. */
export function subscriptionAttention(providers: ProviderWithStatus[]): Attention[] {
	return providers
		.filter((p) => p.status.state === "auth_required" || p.status.state === "error")
		.map((p) => ({
			id: `provider-${p.id}`,
			tone: "warning",
			title: p.status.state === "auth_required" ? `Sign in to ${p.title} again` : `${p.title} isn't working`,
			detail: friendlyAttentionDetail(p.status.error, "Bots using it fall back to the default model."),
			section: "subscriptions",
			href: settingsUrl("subscriptions", p.id),
			action: "Fix",
		}));
}

/**
 * Everything on the server that's broken or missing setup, worst first, and the worst problem tone per Settings
 * section (for dots in the nav, filtered to sections the viewer may open). Waiting requests live in Needs you, not here.
 */
export function useAttention(): {
	items: Attention[];
	bySection: Partial<Record<string, Attention["tone"]>>;
	loading: boolean;
} {
	const { data: auth } = useAuth();
	const { admin, can } = useAccess();
	const { data: info, isLoading: infoLoading } = useInfo();
	const { data: settings } = useSettings();
	const { data: providers = [] } = useQuery({
		queryKey: qk.providers,
		queryFn: api.providers.list,
		enabled: admin,
	});
	const { data: mcp = [] } = useMcpServers();
	const { data: channels = [] } = useChannels();
	const { data: agents = [] } = useAgents();
	const { data: apiProviders } = useQuery({
		queryKey: qk.apiProviders,
		queryFn: api.apiProviders.list,
		staleTime: 60_000,
		enabled: admin,
	});
	const { data: web } = useWebEngine(admin);
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
	if (admin && info && !info.gateway.ok) {
		items.push({
			id: "gateway",
			tone: "danger",
			title: "Can't reach the model service",
			detail: friendlyAttentionDetail(info.gateway.error, "Check the connection in Models."),
			section: "models",
			action: "Check",
		});
	}
	items.push(...subscriptionAttention(providers));
	if (can("apps")) {
		for (const m of mcp) {
			if (m.status.state !== "needs_auth" && m.status.state !== "error") continue;
			items.push({
				id: `mcp-${m.id}`,
				tone: "warning",
				title:
					m.status.state === "needs_auth"
						? `${m.title || m.name} needs you to sign in`
						: `${m.title || m.name} isn't connecting`,
				detail: friendlyAttentionDetail(m.status.error, "Its tools are unavailable until it reconnects."),
				section: "apps",
				action: "Fix",
			});
		}
	}
	if (admin && web && (web.state === "error" || web.state === "missing")) {
		items.push({
			id: "web-engine",
			tone: "warning",
			title: web.state === "missing" ? "Web reading needs to be installed" : "Web reading isn't working",
			detail: friendlyAttentionDetail(web.error, "Bots read pages the simple way until it's fixed."),
			section: "web-reading",
			action: "Fix",
		});
	}
	for (const c of channels) {
		if (!c.enabled || c.status.state !== "error") continue;
		items.push({
			id: `channel-${c.id}`,
			tone: "warning",
			title: `${name(c.agentId)}'s ${c.type === "slack" ? "Slack bot" : c.type === "discord" ? "Discord bot" : "Discord account"} is offline`,
			detail: friendlyAttentionDetail(c.status.error, "It can't send or receive messages right now."),
			href: `/bots/${c.agentId}/accounts`,
			action: "Open",
		});
	}
	if (admin && ts) {
		if (ts.self.error && !ts.self.running) {
			items.push({
				id: "ts-self",
				tone: "warning",
				title: "Private network isn't running on this server",
				detail: friendlyAttentionDetail(ts.self.error, "Check Network & devices."),
				section: "network",
				action: "Open",
			});
		}
		if (ts.api.configured && ts.api.ok === false) {
			items.push({
				id: "ts-api",
				tone: "warning",
				title: "Your network key stopped working",
				detail: friendlyAttentionDetail(ts.api.error, "Sekai can't read your devices' details."),
				section: "network",
				action: "Replace",
			});
		} else if (ts.api.expires && Date.parse(ts.api.expires) - Date.now() < 10 * DAY) {
			items.push({
				id: "ts-api-exp",
				tone: "warning",
				title: "Your network key expires soon",
				detail: `Expires ${new Date(ts.api.expires).toLocaleDateString()}.`,
				section: "network",
				action: "Replace",
			});
		}
		if (ts.authKey.set && (ts.authKey.expired || ts.authKey.revoked)) {
			items.push({
				id: "ts-authkey",
				tone: "warning",
				title: "New bot computers can't join your network",
				detail: ts.authKey.revoked ? "The connection key was revoked." : "The connection key expired.",
				section: "network",
				action: "Replace",
			});
		}
	}
	const refusing = hosts.filter(
		(h) => h.status.ok === false || Object.values(h.accountStatus ?? {}).some((s) => s.ok === false),
	);
	if (admin && refusing.length) {
		items.push({
			id: "hosts",
			tone: "warning",
			title: `${pluralize(refusing.length, "device")} bots can't reach`,
			detail: refusing.map((h) => h.name).join(", "),
			section: "network",
			href: settingsUrl("network", "devices"),
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
			section: h.id === "proxmox-storage" ? "computers" : backups || h.id === "disk" ? "backups" : "about",
			action: backups
				? "Open backups"
				: h.id === "disk"
					? "Free up space"
					: h.id === "memory"
						? "See how"
						: "Open",
		});
	}

	// Optional setup that hasn't been configured yet (shown calmly on Status, never as error dots).
	if (admin && settings && !settings.machines.proxmox.url) {
		items.push({
			id: "setup-computers",
			tone: "brand",
			title: "Set up bots' computers",
			detail: "Connect a host so bots can have their own full desktop.",
			section: "computers",
			action: "Set up",
		});
	}
	if (admin && ts && !ts.self.running && !ts.self.error) {
		items.push({
			id: "setup-network",
			tone: "brand",
			title: "Set up remote access",
			detail: "Reach Sekai and your devices from anywhere.",
			section: "network",
			action: "Set up",
		});
	}
	if (admin && apiProviders && !apiProviders.some((p) => VOICE_KINDS.includes(p.kind))) {
		items.push({
			id: "setup-voice",
			tone: "brand",
			title: "Set up voice and calls",
			detail: "Connect a voice service so bots can speak and take calls.",
			section: "voice",
			action: "Set up",
		});
	}
	if (admin && web && web.state === "off") {
		items.push({
			id: "setup-web",
			tone: "brand",
			title: "Set up web reading",
			detail: "Help bots read JavaScript-heavy web pages cleanly.",
			section: "web-reading",
			action: "Set up",
		});
	}
	if (passkeys.data && passkeys.data.length === 0 && auth?.passkeysAvailable) {
		items.push({
			id: "passkey",
			tone: "brand",
			title: "Add a passkey",
			detail: "Sign in with Face ID, Touch ID or Windows Hello.",
			section: "sign-in-security",
			action: "Add",
		});
	}
	items.sort((a, b) => RANK[a.tone] - RANK[b.tone]);

	const bySection: Partial<Record<string, Attention["tone"]>> = {};
	for (const i of items) {
		if (!i.section || i.tone === "brand") continue;
		const was = bySection[i.section];
		if (!was || RANK[i.tone] < RANK[was]) bySection[i.section] = i.tone;
	}
	return { items, bySection, loading: infoLoading };
}
