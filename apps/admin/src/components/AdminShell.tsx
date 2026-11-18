import { api, cn, isMac, queryClient, useApprovals, useAuth } from "@sekai/client";
import {
	DropdownContent,
	DropdownItem,
	DropdownLabel,
	DropdownMenu,
	DropdownSeparator,
	DropdownTrigger,
	IconButton,
	Kbd,
	SekaiMark,
} from "@sekai/ui";
import { ArrowLeft, ChevronLeft, LogOut, Moon, Search, Sun, UserRound } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import type { Attention } from "../lib/attention.ts";
import { type NavItem, navFor, navItem, searchNav, type Tab } from "../lib/nav.tsx";
import { useTheme } from "../lib/theme.ts";

const MOD = isMac ? "⌘" : "Ctrl";

export async function signOut(): Promise<void> {
	// Same as signing out in the app: this browser's push subscription goes too (it's the same origin).
	try {
		const reg = await navigator.serviceWorker?.getRegistration("/");
		const sub = await reg?.pushManager.getSubscription();
		if (sub) {
			await api.push.unsubscribe(sub.endpoint).catch(() => {});
			await sub.unsubscribe();
		}
		localStorage.removeItem("sekai.push");
	} catch {}
	await api.auth.logout().catch(() => {});
	queryClient.clear();
	location.assign("/");
}

export const pathOf = (tab: Tab) => `/${tab === "overview" ? "" : tab}`;

/** What a nav item shows on its right: pending approvals, or a dot when something on that page needs you. */
export function NavMark({ item, byTab }: { item: NavItem; byTab: Partial<Record<Tab, Attention["tone"]>> }) {
	const { data: approvals = [] } = useApprovals();
	if (item.value === "approvals" && approvals.length) {
		return (
			<span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-warning/15 px-1.5 text-[11px] font-semibold text-warning tabular-nums">
				{approvals.length}
			</span>
		);
	}
	const tone = byTab[item.value];
	if (!tone) return null;
	return (
		<span
			role="img"
			aria-label="Needs attention"
			className={cn("ml-auto size-2 shrink-0 rounded-full", tone === "danger" ? "bg-danger" : "bg-warning")}
		/>
	);
}

function NavButton({
	item,
	active,
	byTab,
	blurb,
	onPick,
}: {
	item: NavItem;
	active: boolean;
	byTab: Partial<Record<Tab, Attention["tone"]>>;
	blurb?: boolean;
	onPick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onPick}
			aria-current={active ? "page" : undefined}
			className={cn(
				"flex w-full items-center gap-2.5 rounded-xl px-2.5 text-left text-sm outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/30 [&_svg]:size-[18px] [&_svg]:shrink-0",
				blurb ? "py-2" : "h-9",
				active
					? "bg-surface-2 font-medium text-fg [&>svg]:text-brand-ink"
					: "text-fg-muted hover:bg-surface-2/60 hover:text-fg",
			)}
		>
			{item.icon}
			<span className="min-w-0 flex-1">
				<span className="block truncate">{item.label}</span>
				{blurb && <span className="block truncate text-xs font-normal text-fg-subtle">{item.blurb}</span>}
			</span>
			<NavMark item={item} byTab={byTab} />
		</button>
	);
}

function AccountMenu({ compact }: { compact?: boolean }) {
	const { data: auth } = useAuth();
	const navigate = useNavigate();
	const user = auth?.user;
	const initial = (
		<span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand/14 text-[13px] font-semibold text-brand-ink">
			{user?.name.slice(0, 1).toUpperCase() ?? "?"}
		</span>
	);
	return (
		<DropdownMenu>
			<DropdownTrigger asChild>
				{compact ? (
					<button
						type="button"
						aria-label="Account"
						className="rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30"
					>
						{initial}
					</button>
				) : (
					<button
						type="button"
						className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl px-1.5 py-1.5 text-left outline-none transition-colors hover:bg-surface-2/60 focus-visible:ring-[3px] focus-visible:ring-ring/30"
					>
						{initial}
						<span className="min-w-0 flex-1">
							<span className="block truncate text-sm font-medium">{user?.name ?? "Signed in"}</span>
							{user && <span className="block truncate text-xs text-fg-subtle">@{user.username}</span>}
						</span>
					</button>
				)}
			</DropdownTrigger>
			<DropdownContent align={compact ? "end" : "start"} side={compact ? "bottom" : "top"}>
				{compact && user && <DropdownLabel>@{user.username}</DropdownLabel>}
				<DropdownItem icon={<UserRound />} onSelect={() => navigate("/account")}>
					Account
				</DropdownItem>
				<DropdownItem icon={<ArrowLeft />} onSelect={() => location.assign("/")}>
					Back to chats
				</DropdownItem>
				<DropdownSeparator />
				<DropdownItem icon={<LogOut />} onSelect={() => void signOut()}>
					Sign out
				</DropdownItem>
			</DropdownContent>
		</DropdownMenu>
	);
}

function ThemeButton() {
	const { mode, toggle } = useTheme();
	return (
		<IconButton
			label={mode === "light" ? "Switch to Nightcord at 25:00" : "Switch to Virtual Singers"}
			onClick={toggle}
		>
			{mode === "light" ? <Moon /> : <Sun />}
		</IconButton>
	);
}

/** Search that jumps to a page: by its name or by what's on it. */
export function SettingsSearch({
	onPick,
	autoFocusKey,
	className,
	query,
	onQuery,
}: {
	onPick: (tab: Tab) => void;
	/** ⌘K (Ctrl+K) or "/" focuses it. */
	autoFocusKey?: boolean;
	className?: string;
	query: string;
	onQuery: (q: string) => void;
}) {
	const ref = useRef<HTMLInputElement>(null);
	const { data: auth } = useAuth();
	useEffect(() => {
		if (!autoFocusKey) return;
		const onKey = (e: KeyboardEvent) => {
			const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement)?.tagName ?? "");
			if (((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") || (e.key === "/" && !typing)) {
				e.preventDefault();
				ref.current?.focus();
				ref.current?.select();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [autoFocusKey]);
	return (
		<label
			className={cn(
				"flex h-9 items-center gap-2 rounded-xl bg-surface-2/70 px-3 text-sm transition-colors focus-within:bg-surface-2 coarse:h-11",
				className,
			)}
		>
			<Search className="size-4 shrink-0 text-fg-subtle" />
			<input
				ref={ref}
				value={query}
				onChange={(e) => onQuery(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Escape") {
						onQuery("");
						e.currentTarget.blur();
					}
					if (e.key === "Enter") {
						const first = searchNav(query, auth?.access)[0];
						if (first) {
							onPick(first.value);
							onQuery("");
							e.currentTarget.blur();
						}
					}
				}}
				placeholder="Search settings"
				aria-label="Search settings"
				className="min-w-0 flex-1 bg-transparent text-fg outline-none placeholder:text-fg-subtle"
			/>
			{autoFocusKey && !query && <Kbd>{MOD}K</Kbd>}
		</label>
	);
}

/** The side bar on large screens: grouped pages, search, and you. */
export function AdminSidebar({ tab, byTab }: { tab: Tab; byTab: Partial<Record<Tab, Attention["tone"]>> }) {
	const navigate = useNavigate();
	const { data: auth } = useAuth();
	const [query, setQuery] = useState("");
	const go = (t: Tab) => navigate(pathOf(t));
	const results = query.trim() ? searchNav(query, auth?.access) : null;
	return (
		<aside className="sticky top-0 hidden h-dvh w-[264px] shrink-0 flex-col border-r border-border bg-bg-subtle lg:flex">
			<div className="flex items-center gap-2 px-4 pt-4 pb-3">
				<a
					href="/"
					className="flex items-center gap-2 rounded-lg outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30"
					title="Back to chats"
				>
					<SekaiMark size={26} />
					<span className="text-[16px] font-semibold tracking-tight">sekai</span>
				</a>
				<span className="rounded-md bg-brand/12 px-1.5 py-0.5 text-[11px] font-semibold text-brand-ink">
					Admin
				</span>
			</div>
			<div className="px-3 pb-2">
				<SettingsSearch onPick={go} autoFocusKey query={query} onQuery={setQuery} />
			</div>
			<nav aria-label="Admin" className="min-h-0 flex-1 overflow-y-auto px-3 pt-1 pb-3 scrollbar-thin">
				{results ? (
					results.length ? (
						<div className="flex flex-col gap-0.5">
							{results.map((item) => (
								<NavButton
									key={item.value}
									item={item}
									active={item.value === tab}
									byTab={byTab}
									blurb
									onPick={() => {
										go(item.value);
										setQuery("");
									}}
								/>
							))}
						</div>
					) : (
						<p className="px-2.5 py-3 text-[13px] text-fg-subtle">Nothing matches “{query.trim()}”.</p>
					)
				) : (
					navFor(auth?.access).map((group, i) => (
						<div
							key={group.label ?? "top"}
							className={cn("flex flex-col gap-0.5", group.label && i > 0 && "mt-5")}
						>
							{group.label && (
								<div className="px-2.5 pb-1 text-[11px] font-medium tracking-wide text-fg-subtle">
									{group.label}
								</div>
							)}
							{group.items.map((item) => (
								<NavButton
									key={item.value}
									item={item}
									active={item.value === tab}
									byTab={byTab}
									onPick={() => go(item.value)}
								/>
							))}
						</div>
					))
				)}
			</nav>
			<div className="flex flex-col gap-1 border-t border-border p-3">
				<a
					href="/"
					className="flex h-9 items-center gap-2.5 rounded-xl px-2.5 text-sm text-fg-muted transition-colors hover:bg-surface-2/60 hover:text-fg [&_svg]:size-[18px]"
				>
					<ArrowLeft /> Back to chats
				</a>
				<div className="flex items-center gap-1">
					<AccountMenu />
					<ThemeButton />
				</div>
			</div>
		</aside>
	);
}

/**
 * The bar on phones and tablets. On a page: back to the list, with the page's name once its big title has
 * scrolled away. On the overview: Sekai, the theme and you.
 */
export function MobileBar({ tab }: { tab: Tab }) {
	const navigate = useNavigate();
	const [titleGone, setTitleGone] = useState(false);
	// biome-ignore lint/correctness/useExhaustiveDependencies: watch the new page's title when the page changes
	useEffect(() => {
		setTitleGone(false);
		const el = document.querySelector("[data-page-title]");
		if (!el) return;
		const io = new IntersectionObserver(([e]) => setTitleGone(!e?.isIntersecting), {
			rootMargin: "-56px 0px 0px 0px",
		});
		io.observe(el);
		return () => io.disconnect();
	}, [tab]);
	const item = navItem(tab);
	const home = tab === "overview";
	return (
		<header
			className={cn(
				"sticky top-0 z-40 border-b bg-background/85 pt-safe backdrop-blur-md transition-colors lg:hidden",
				titleGone || home ? "border-border" : "border-transparent",
			)}
		>
			<div className="relative flex h-14 items-center gap-1 px-2">
				{home ? (
					<a href="/" className="flex items-center gap-2 rounded-lg px-2 py-1">
						<SekaiMark size={26} />
						<span className="text-[16px] font-semibold tracking-tight">sekai</span>
						<span className="rounded-md bg-brand/12 px-1.5 py-0.5 text-[11px] font-semibold text-brand-ink">
							Admin
						</span>
					</a>
				) : (
					<button
						type="button"
						onClick={() => navigate("/")}
						className="z-10 flex h-10 items-center gap-0.5 rounded-xl pr-3 pl-1.5 text-[15px] font-medium text-brand-ink outline-none active:bg-surface-2"
					>
						<ChevronLeft className="size-5" /> Admin
					</button>
				)}
				{!home && (
					<div
						aria-hidden={!titleGone}
						className={cn(
							"pointer-events-none absolute inset-x-24 truncate text-center text-[15px] font-semibold transition-opacity duration-200",
							titleGone ? "opacity-100" : "opacity-0",
						)}
					>
						{item?.label}
					</div>
				)}
				<div className="z-10 ml-auto flex items-center gap-1 pr-1">
					{home && <ThemeButton />}
					{home && <AccountMenu compact />}
				</div>
			</div>
		</header>
	);
}

export function AdminFrame({
	tab,
	byTab,
	children,
}: {
	tab: Tab;
	byTab: Partial<Record<Tab, Attention["tone"]>>;
	children: ReactNode;
}) {
	return (
		<div className="flex min-h-dvh">
			<AdminSidebar tab={tab} byTab={byTab} />
			<div className="flex min-w-0 flex-1 flex-col">
				<MobileBar tab={tab} />
				<main className="mx-auto w-full max-w-[880px] flex-1 px-4 pt-5 pb-[max(4rem,env(safe-area-inset-bottom))] sm:px-6 lg:px-12 lg:pt-12">
					{children}
				</main>
			</div>
		</div>
	);
}
