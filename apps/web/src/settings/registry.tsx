import {
	Archive,
	AudioLines,
	BarChart3,
	Bell,
	Blocks,
	Brain,
	Columns3,
	Download,
	Globe,
	Info,
	KeyRound,
	Laptop,
	LayoutDashboard,
	LockKeyhole,
	LogIn,
	LogOut,
	Mail,
	Monitor,
	Network,
	Palette,
	Puzzle,
	Server,
	ShieldCheck,
	Sparkles,
	UserCog,
	UserRound,
	Users,
} from "lucide-react";
import { type ComponentType, type LazyExoticComponent, lazy, type ReactNode } from "react";
import { allows, type Viewer, type Who } from "../lib/access.ts";
import { ranked } from "../lib/search.ts";
import type { SettingsSectionProps } from "./section.ts";

/*
 * Every Settings section, in order, in one list: what it's called, where it sits, who sees it and the file that
 * draws it. Navigation (the rail, the phone list), search (⌘K) and the old-address redirects all read this list, so
 * adding a section is one entry here and one file. See apps/web/AGENTS.md.
 */

export type SettingsGroupId = "you" | "bots" | "people" | "server";

export const SETTINGS_GROUPS: { id: SettingsGroupId; title: string }[] = [
	{ id: "you", title: "You" },
	{ id: "bots", title: "Bots" },
	{ id: "people", title: "People" },
	{ id: "server", title: "Server" },
];

export interface SettingsSectionDef {
	/** The address: /settings/<id>. */
	id: string;
	group: SettingsGroupId;
	title: string;
	icon: ReactNode;
	/** One line about what's there (search results). */
	blurb: string;
	/** More words it answers to in search. */
	keywords: string;
	/** Who may open it. */
	who: Who;
	/** Who may change things there (others see it read only). Defaults to `who`. */
	edit?: Who;
	/** Only in the desktop app, or only in the phone apps. */
	only?: "desktop-app" | "phone-app";
	/**
	 * A page inside another section (/settings/<parent>/<id>). It's listed on its own only for people who can't open
	 * the parent; everyone else reaches it from there.
	 */
	parent?: string;
	/** Not a page: something the row does (the phone app's server screen, signing out). */
	action?: "phone-server" | "get-apps" | "sign-out";
	component?: LazyExoticComponent<ComponentType<SettingsSectionProps>>;
}

/** A section's file, loaded when it's first opened. */
function load<K extends string>(
	file: () => Promise<Record<K, ComponentType<SettingsSectionProps>>>,
	name: K,
): LazyExoticComponent<ComponentType<SettingsSectionProps>> {
	return lazy(() => file().then((m) => ({ default: m[name] })));
}

export const SETTINGS_SECTIONS: SettingsSectionDef[] = [
	// ---------------------------------------------------------------- You
	{
		id: "profile",
		group: "you",
		title: "Profile",
		icon: <UserRound />,
		blurb: "Your name, username, email and time zone",
		keywords: "name username email phone time zone timezone role account",
		who: "everyone",
		component: load(() => import("./you/Profile.tsx"), "ProfileSection"),
	},
	{
		id: "sign-in-security",
		group: "you",
		title: "Sign-in & security",
		icon: <LockKeyhole />,
		blurb: "Password, passkeys, two-step sign-in, sessions and tokens",
		keywords:
			"password passkey face id touch id windows hello two-factor 2fa mfa recovery codes linked sign-ins sso google github sessions sign out everywhere api tokens desktop apps devices access",
		who: "everyone",
		component: load(() => import("./you/SignInSecurity.tsx"), "SignInSecuritySection"),
	},
	{
		id: "appearance",
		group: "you",
		title: "Appearance",
		icon: <Palette />,
		blurb: "A theme for each group, light and dark",
		keywords:
			"theme dark light mode colors colours virtual singers leo/need more more jump wonderlands showtime vivid bad squad nightcord install app",
		who: "everyone",
		component: load(() => import("./you/Appearance.tsx"), "AppearanceSection"),
	},
	{
		id: "notifications",
		group: "you",
		title: "Notifications",
		icon: <Bell />,
		blurb: "This device, push and your morning digest",
		keywords: "push alerts notify digest morning summary daily test",
		who: "everyone",
		component: load(() => import("./you/Notifications.tsx"), "NotificationsSection"),
	},
	{
		id: "browser-extension",
		group: "you",
		title: "Browser extension",
		icon: <Puzzle />,
		blurb: "Lend a bot the tabs you choose",
		keywords: "extension chrome firefox safari tabs browser token sidebar",
		who: "browser",
		component: load(() => import("./you/BrowserExtension.tsx"), "BrowserExtensionSection"),
	},
	{
		id: "this-computer",
		group: "you",
		title: "This computer",
		icon: <Laptop />,
		blurb: "Let bots work on the computer this app runs on",
		keywords: "lend desktop app local computer commands folder",
		who: "everyone",
		only: "desktop-app",
		component: load(() => import("./you/ThisComputer.tsx"), "ThisComputerSection"),
	},
	{
		id: "phone-server",
		group: "you",
		title: "Server address",
		icon: <Server />,
		blurb: "The Sekai server this app connects to",
		keywords: "server address url connect switch change app version",
		who: "everyone",
		only: "phone-app",
		action: "phone-server",
	},
	{
		id: "get-apps",
		group: "you",
		title: "Get the apps",
		icon: <Download />,
		blurb: "Sekai for your desktop, phone and browser",
		keywords: "download install desktop mac windows linux android iphone ipad ios apk ipa extension",
		who: "everyone",
		action: "get-apps",
	},
	{
		id: "sign-out",
		group: "you",
		title: "Sign out",
		icon: <LogOut />,
		blurb: "Sign out of Sekai on this device",
		keywords: "log out logout leave",
		who: "everyone",
		action: "sign-out",
	},

	// ---------------------------------------------------------------- Bots
	{
		id: "approvals",
		group: "bots",
		title: "Approvals",
		icon: <ShieldCheck />,
		blurb: "When bots must ask you first",
		keywords: "approve ask manual auto reviewer bypass rules permissions read-only timeout deny",
		who: "everyone",
		component: load(() => import("./bots/Approvals.tsx"), "ApprovalsSection"),
	},
	{
		id: "models",
		group: "bots",
		title: "Models",
		icon: <Sparkles />,
		blurb: "Default models, the gateway and API providers",
		keywords:
			"gateway api key base url providers openai anthropic gemini ollama openrouter refusals default background model",
		who: "admin",
		component: load(() => import("./bots/Models.tsx"), "ModelsSection"),
	},
	{
		id: "compare",
		group: "bots",
		title: "Compare models",
		icon: <Columns3 />,
		blurb: "One prompt, several models, side by side",
		keywords: "compare models benchmark test prompt playground side by side cost speed",
		who: "compare",
		parent: "models",
		component: load(() => import("./bots/Compare.tsx"), "CompareSection"),
	},
	{
		id: "subscriptions",
		group: "bots",
		title: "Subscriptions",
		icon: <KeyRound />,
		blurb: "Codex, Claude Code, Grok and others as bots' models",
		keywords:
			"codex claude code grok opencode pi devin antigravity muse cursor acp agent subscription sign in plan",
		who: "subscriptions",
		edit: "admin",
		component: load(() => import("./bots/Subscriptions.tsx"), "SubscriptionsSection"),
	},
	{
		id: "apps",
		group: "bots",
		title: "Apps & skills",
		icon: <Blocks />,
		blurb: "Connected apps and skills bots can use",
		keywords: "mcp connectors tools skills store linear github notion custom app",
		who: "apps",
		component: load(() => import("./bots/Apps.tsx"), "AppsSection"),
	},
	{
		id: "email",
		group: "bots",
		title: "Email",
		icon: <Mail />,
		blurb: "Give bots addresses on your mail server",
		keywords: "mailcow mailboxes domains inbox",
		who: "admin",
		component: load(() => import("./bots/Email.tsx"), "EmailSection"),
	},
	{
		id: "voice",
		group: "bots",
		title: "Voice",
		icon: <AudioLines />,
		blurb: "Voices, calls and dictation",
		keywords: "elevenlabs fish audio tts stt speech calls voices clone dictation transcription listen",
		who: "admin",
		component: load(() => import("./bots/Voice.tsx"), "VoiceSection"),
	},
	{
		id: "web-reading",
		group: "bots",
		title: "Web reading",
		icon: <Globe />,
		blurb: "How bots read web pages",
		keywords: "firecrawl local scrape crawl map search web fetch markdown pages browser cloud engine",
		who: "admin",
		component: load(() => import("./bots/WebReading.tsx"), "WebReadingSection"),
	},
	{
		id: "memory",
		group: "bots",
		title: "Memory",
		icon: <Brain />,
		blurb: "Check-ups and how much of a chat bots keep in mind",
		keywords: "memory check-up checkup context compaction summary messages",
		who: "admin",
		component: load(() => import("./bots/Memory.tsx"), "MemorySection"),
	},
	{
		id: "usage",
		group: "bots",
		title: "Usage",
		icon: <BarChart3 />,
		blurb: "Tokens and cost, by day, bot and model",
		keywords: "stats statistics tokens cost price spend dashboard chart replies limits export csv",
		who: "everyone",
		component: load(() => import("./bots/Usage.tsx"), "UsageSection"),
	},

	// ---------------------------------------------------------------- People
	{
		id: "people",
		group: "people",
		title: "People",
		icon: <Users />,
		blurb: "Everyone with an account here",
		keywords:
			"users accounts add invite members family team username password reset two-factor 2fa turn off disable delete sign out",
		who: "admin",
		component: load(() => import("./people/People.tsx"), "PeopleSection"),
	},
	{
		id: "roles",
		group: "people",
		title: "Roles",
		icon: <UserCog />,
		blurb: "What each role may do and use",
		keywords: "permissions features limits quota tokens cost budget models bots storage admin member two-factor",
		who: "admin",
		component: load(() => import("./people/Roles.tsx"), "RolesSection"),
	},
	{
		id: "sign-in-options",
		group: "people",
		title: "Sign-in options",
		icon: <LogIn />,
		blurb: "Single sign-on, email and text messages",
		keywords:
			"sso oauth oidc openid connect google github discord authentik keycloak smtp email mail text sms twilio webhook codes invites password reset",
		who: "admin",
		component: load(() => import("./people/SignInOptions.tsx"), "SignInOptionsSection"),
	},

	// ---------------------------------------------------------------- Server
	{
		id: "status",
		group: "server",
		title: "Status",
		icon: <LayoutDashboard />,
		blurb: "What needs setting up or fixing, and how things are",
		keywords: "home overview dashboard status health problems setup",
		who: "admin",
		component: load(() => import("./server/Status.tsx"), "StatusSection"),
	},
	{
		id: "computers",
		group: "server",
		title: "Computers",
		icon: <Monitor />,
		blurb: "Bots' own computers and devboxes",
		keywords: "proxmox vm devbox container machines cores ram disk screen relay",
		who: "admin",
		component: load(() => import("./server/Computers.tsx"), "ComputersSection"),
	},
	{
		id: "network",
		group: "server",
		title: "Network & devices",
		icon: <Network />,
		blurb: "This server's addresses and your devices bots can use",
		keywords: "tailscale tailnet devices ssh master key https serve hosts api auth key ip other servers",
		who: "admin",
		component: load(() => import("./server/Network.tsx"), "NetworkSection"),
	},
	{
		id: "backups",
		group: "server",
		title: "Backups",
		icon: <Archive />,
		blurb: "Every night, or now; restore in one go",
		keywords: "backup restore export import download move server data disaster recovery",
		who: "admin",
		component: load(() => import("./server/Backups.tsx"), "BackupsSection"),
	},
	{
		id: "about",
		group: "server",
		title: "About",
		icon: <Info />,
		blurb: "Version, data and credits",
		keywords: "version data directory time zone credits licenses",
		who: "everyone",
		component: load(() => import("./server/About.tsx"), "AboutSection"),
	},
];

const BY_ID = new Map(SETTINGS_SECTIONS.map((s) => [s.id, s]));

export function settingsSection(id: string): SettingsSectionDef | undefined {
	return BY_ID.get(id);
}

/** Whether this person may open a section here (and in this app: the desktop app, a phone app, a browser). */
export function canOpenSection(section: SettingsSectionDef, viewer: Viewer): boolean {
	if (section.only === "desktop-app" && !viewer.desktopApp) return false;
	if (section.only === "phone-app" && !viewer.phoneApp) return false;
	if (section.action === "sign-out" && !viewer.session) return false;
	return allows(section.who, viewer.access);
}

/** Whether they may change things there (else it's read only). */
export function canEditSection(section: SettingsSectionDef, viewer: Viewer): boolean {
	return allows(section.edit ?? section.who, viewer.access);
}

/** The sections this person sees in the list, in order: sub-pages only when they can't open the parent. */
export function listedSections(viewer: Viewer): SettingsSectionDef[] {
	return SETTINGS_SECTIONS.filter((s) => {
		if (!canOpenSection(s, viewer)) return false;
		const parent = s.parent ? BY_ID.get(s.parent) : undefined;
		return !parent || !canOpenSection(parent, viewer);
	});
}

/** The address of a section: /settings/<id>, or /settings/<parent>/<id> for a sub-page. */
export function sectionPath(id: string, rest = ""): string {
	const s = BY_ID.get(id);
	const base = s?.parent ? `/settings/${s.parent}/${id}` : `/settings/${id}`;
	return rest ? `${base}/${rest.replace(/^\/+/, "")}` : base;
}

/**
 * Which section an address under /settings shows, and the rest of it: "models/compare" → compare, "people/usr_1"
 * → people with rest "usr_1". Null for /settings itself or an unknown section.
 */
export function sectionFromPath(path: string): { section: SettingsSectionDef; rest: string } | null {
	const parts = path
		.replace(/^\/?settings\/?/, "")
		.split("/")
		.filter(Boolean);
	const [first, second, ...more] = parts;
	if (!first) return null;
	const child = second ? BY_ID.get(second) : undefined;
	if (child?.parent === first) return { section: child, rest: more.join("/") };
	const section = BY_ID.get(first);
	if (!section || section.parent || section.action) return null;
	return { section, rest: [second, ...more].filter(Boolean).join("/") };
}

/** Where /settings opens: Status for admins, your Profile for everyone else. */
export function homeSection(viewer: Viewer): SettingsSectionDef {
	const status = BY_ID.get("status");
	if (status && canOpenSection(status, viewer)) return status;
	return BY_ID.get("profile") ?? (SETTINGS_SECTIONS[0] as SettingsSectionDef);
}

/** Sections matching a search with how well each does (see matchScore), best first. Only ones this person may open. */
export function scoredSections(query: string, viewer: Viewer): { item: SettingsSectionDef; score: number }[] {
	const items = SETTINGS_SECTIONS.filter((s) => canOpenSection(s, viewer));
	if (!query.trim()) return items.map((item) => ({ item, score: 0 }));
	return ranked(query, items, (s) => [s.title, `${s.blurb} ${s.keywords}`]);
}

/**
 * Where a section's back goes and what it says: the section it's a page inside (Compare models → Models), when
 * that's where this person reaches it from, else Settings. `phoneOnly` for a section's own page: from tablets up
 * the rail beside it is the way back, while a page inside another shows "‹ Models" above its title.
 */
export function sectionBack(
	section: SettingsSectionDef,
	viewer: Viewer,
): { label: string; to: string; phoneOnly: boolean } {
	const parent = section.parent ? BY_ID.get(section.parent) : undefined;
	if (parent && canOpenSection(parent, viewer)) {
		return { label: parent.title, to: sectionPath(parent.id), phoneOnly: false };
	}
	return { label: "Settings", to: "/settings", phoneOnly: true };
}

/** Sections matching a search, by name first, then by what's in them. Only ones this person may open. */
export function searchSections(query: string, viewer: Viewer): SettingsSectionDef[] {
	return scoredSections(query, viewer).map((x) => x.item);
}
