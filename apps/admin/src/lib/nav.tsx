import type { Access, Permission } from "@sekai/shared";
import type { Tone } from "@sekai/ui";
import {
	Archive,
	AudioLines,
	BarChart3,
	Blocks,
	Brain,
	Columns3,
	Info,
	KeyRound,
	LayoutDashboard,
	LogIn,
	MonitorSmartphone,
	Network,
	ScrollText,
	Server,
	ShieldCheck,
	Smartphone,
	Sparkles,
	UserCog,
	UserRound,
	Users,
} from "lucide-react";
import type { ReactNode } from "react";

export type Tab =
	| "overview"
	| "models"
	| "subscriptions"
	| "apps"
	| "voice"
	| "memory"
	| "compare"
	| "usage"
	| "approvals"
	| "activity"
	| "people"
	| "roles"
	| "signin"
	| "mobile"
	| "computers"
	| "tailscale"
	| "account"
	| "devices"
	| "backups"
	| "about";

export interface NavItem {
	value: Tab;
	label: string;
	icon: ReactNode;
	/** The tint of its icon in lists. */
	tone: Tone;
	/** One line about what's there (phone list, search results). */
	blurb: string;
	/** More words it answers to in search. */
	keywords: string;
}

export interface NavGroup {
	label: string | null;
	items: NavItem[];
}

export const NAV: NavGroup[] = [
	{
		label: null,
		items: [
			{
				value: "overview",
				label: "Overview",
				icon: <LayoutDashboard />,
				tone: "neutral",
				blurb: "How everything's doing",
				keywords: "home dashboard status health",
			},
		],
	},
	{
		label: "Bots",
		items: [
			{
				value: "models",
				label: "Models",
				icon: <Sparkles />,
				tone: "info",
				blurb: "Gateway, default models, API providers",
				keywords:
					"gateway api key base url providers openai anthropic ollama openrouter refusals default background",
			},
			{
				value: "subscriptions",
				label: "Subscriptions",
				icon: <KeyRound />,
				tone: "warning",
				blurb: "Codex, Claude, Grok… as brains",
				keywords: "codex claude code grok gemini cursor acp agent subscription sign in",
			},
			{
				value: "apps",
				label: "Apps & skills",
				icon: <Blocks />,
				tone: "brand",
				blurb: "Connected apps (MCP) and skills",
				keywords: "mcp connectors tools skills store linear github notion",
			},
			{
				value: "voice",
				label: "Voice",
				icon: <AudioLines />,
				tone: "danger",
				blurb: "Voices, calls and dictation",
				keywords: "elevenlabs fish audio tts stt speech calls voices clone dictation transcription",
			},
			{
				value: "memory",
				label: "Memory",
				icon: <Brain />,
				tone: "success",
				blurb: "How much of a chat bots keep in mind",
				keywords: "context compaction summary messages",
			},
			{
				value: "compare",
				label: "Compare models",
				icon: <Columns3 />,
				tone: "info",
				blurb: "One prompt, several models, side by side",
				keywords: "compare models benchmark test prompt playground side by side cost speed",
			},
			{
				value: "usage",
				label: "Usage",
				icon: <BarChart3 />,
				tone: "info",
				blurb: "Tokens and cost, by day, bot and model",
				keywords: "stats statistics tokens cost price spend dashboard chart replies",
			},
		],
	},
	{
		label: "Safety",
		items: [
			{
				value: "approvals",
				label: "Approvals",
				icon: <ShieldCheck />,
				tone: "warning",
				blurb: "What bots may do without asking",
				keywords: "approve yolo manual auto reviewer rules permissions read-only",
			},
			{
				value: "activity",
				label: "Activity log",
				icon: <ScrollText />,
				tone: "warning",
				blurb: "Everything bots did, and who allowed it",
				keywords: "audit log history actions tools decisions approvals export csv",
			},
		],
	},
	{
		label: "People",
		items: [
			{
				value: "people",
				label: "People",
				icon: <Users />,
				tone: "brand",
				blurb: "Who can use Sekai, and their accounts",
				keywords:
					"users accounts add invite members family team username password reset two-factor 2fa mfa turn off disable delete sign out",
			},
			{
				value: "roles",
				label: "Roles",
				icon: <UserCog />,
				tone: "info",
				blurb: "What each role can do, and its limits",
				keywords:
					"permissions features limits quota tokens cost budget models bots storage admin member two-factor",
			},
			{
				value: "signin",
				label: "Sign-in options",
				icon: <LogIn />,
				tone: "success",
				blurb: "Single sign-on, email and text messages",
				keywords:
					"sso oauth oidc openid connect google github discord authentik keycloak smtp email mail text sms twilio webhook codes invites password reset",
			},
			{
				value: "mobile",
				label: "Phone apps",
				icon: <Smartphone />,
				tone: "success",
				blurb: "Push for the iOS and Android apps",
				keywords: "mobile app ios iphone ipad android push notifications firebase fcm apple apns p8",
			},
		],
	},
	{
		label: "Machines",
		items: [
			{
				value: "computers",
				label: "Computers",
				icon: <Server />,
				tone: "info",
				blurb: "Bots' own computers on Proxmox",
				keywords: "proxmox vm devbox container machines cores ram disk",
			},
			{
				value: "tailscale",
				label: "Tailscale",
				icon: <Network />,
				tone: "brand",
				blurb: "Your tailnet and devices bots can use",
				keywords: "tailnet devices ssh master key https serve root account hosts api auth key ip",
			},
		],
	},
	{
		label: "You",
		items: [
			{
				value: "account",
				label: "Account",
				icon: <UserRound />,
				tone: "neutral",
				blurb: "Name, password and passkeys",
				keywords: "password passkey username face id touch id sign in",
			},
			{
				value: "devices",
				label: "Sign-ins & tokens",
				icon: <MonitorSmartphone />,
				tone: "neutral",
				blurb: "Where you're signed in, API tokens",
				keywords: "sessions sign out tokens api desktop app devices access",
			},
			{
				value: "backups",
				label: "Backups",
				icon: <Archive />,
				tone: "neutral",
				blurb: "Every night, or now; restore in one go",
				keywords: "backup restore export import download move server data disaster recovery",
			},
			{
				value: "about",
				label: "About",
				icon: <Info />,
				tone: "neutral",
				blurb: "Version and data",
				keywords: "version data directory time zone credits",
			},
		],
	},
];

export const NAV_ITEMS: NavItem[] = NAV.flatMap((g) => g.items);

export function navItem(tab: string): NavItem | undefined {
	return NAV_ITEMS.find((i) => i.value === tab);
}

/** Pages everyone signed in can open (about their own account and bots). The rest are for admins. */
const EVERYONE: readonly Tab[] = ["usage", "approvals", "activity", "account", "devices", "about"];
/** Pages a role's feature opens for people who aren't admins. */
const BY_PERMISSION: Partial<Record<Tab, Permission>> = { apps: "apps", compare: "compare" };

/**
 * Whether you may open a page (just what Admin shows: the server checks every request). Without access info
 * (it shouldn't happen when signed in) only the pages everyone has.
 */
export function tabAllowed(tab: Tab, access: Access | null | undefined): boolean {
	if (access?.admin) return true;
	if (EVERYONE.includes(tab)) return true;
	const permission = BY_PERMISSION[tab];
	return Boolean(permission && access?.permissions.includes(permission));
}

/** The pages you may open, in nav order. */
export function allowedTabs(access: Access | null | undefined): Tab[] {
	return NAV_ITEMS.filter((i) => tabAllowed(i.value, access)).map((i) => i.value);
}

/** Where "/" takes you: the overview for admins, your usage for everyone else. */
export function homeTab(access: Access | null | undefined): Tab {
	return (["overview", "usage", "account"] as const).find((t) => tabAllowed(t, access)) ?? "account";
}

/** The nav groups with only the pages you may open (empty groups dropped). */
export function navFor(access: Access | null | undefined): NavGroup[] {
	return NAV.map((g) => ({ ...g, items: g.items.filter((i) => tabAllowed(i.value, access)) })).filter(
		(g) => g.items.length > 0,
	);
}

/** Items matching a search: by name first, then by what's on the page. Only pages you may open. */
export function searchNav(query: string, access: Access | null | undefined): NavItem[] {
	const items = NAV_ITEMS.filter((i) => tabAllowed(i.value, access));
	const q = query.trim().toLowerCase();
	if (!q) return items;
	const words = q.split(/\s+/);
	const score = (i: NavItem) => {
		const name = i.label.toLowerCase();
		if (name.startsWith(q)) return 3;
		if (name.includes(q)) return 2;
		const hay = `${name} ${i.blurb.toLowerCase()} ${i.keywords}`;
		return words.every((w) => hay.includes(w)) ? 1 : 0;
	};
	return items
		.map((i) => ({ i, s: score(i) }))
		.filter((x) => x.s > 0)
		.sort((a, b) => b.s - a.s)
		.map((x) => x.i);
}
