import { cn, isMac, useApprovals, useCredentialRequests, useEmailSenders, usePairings } from "@sekai/client";
import { IconButton, Kbd, SekaiMark, Tooltip } from "@sekai/ui";
import { Activity, Inbox, Library, PanelLeftClose, PanelLeftOpen, Plus, Search, X } from "lucide-react";
import type { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";
import { useShallow } from "zustand/react/shallow";
import { useLayout } from "../../lib/hooks.ts";
import { useUi } from "../../stores/ui.ts";
import { ChatList, RailChats } from "./ChatList.tsx";
import { NewMenu } from "./NewMenu.tsx";
import { PersonFooter } from "./PersonMenu.tsx";

const MOD = isMac ? "⌘" : "Ctrl";

/** How many things wait for you in Needs you: approvals, pairing and sign-in requests. */
export function useNeedsYouCount(): number {
	const { data: approvals = [] } = useApprovals();
	const { data: pairings = [] } = usePairings();
	const { data: logins = [] } = useCredentialRequests();
	const { data: senders = [] } = useEmailSenders();
	return approvals.length + pairings.length + logins.length + senders.length;
}

function NavItem({
	icon,
	label,
	to,
	badge,
	collapsed,
}: {
	icon: ReactNode;
	label: string;
	to: string;
	badge?: number;
	collapsed: boolean;
}) {
	const navigate = useNavigate();
	const { pathname } = useLocation();
	const active = pathname.startsWith(to);
	const item = (
		<button
			type="button"
			aria-current={active ? "page" : undefined}
			aria-label={collapsed ? (badge ? `${label}, ${badge} waiting` : label) : undefined}
			onClick={() => {
				useUi.getState().setSidebarOpen(false);
				navigate(to);
			}}
			className={cn(
				"relative flex items-center gap-3 rounded-lg text-body font-medium transition-colors [&_svg]:size-5",
				collapsed ? "size-11 justify-center" : "h-9 px-2.5 coarse:h-11",
				active ? "bg-selected text-fg" : "text-fg-muted hover:bg-surface-2/60 hover:text-fg",
			)}
		>
			{icon}
			{!collapsed && <span className="flex-1 text-left">{label}</span>}
			{badge ? (
				<span
					className={cn(
						"flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1.5 text-caption font-semibold text-danger-foreground tabular-nums",
						collapsed && "absolute -top-0.5 -right-0.5",
					)}
				>
					{badge}
				</span>
			) : null}
		</button>
	);
	return collapsed ? (
		<Tooltip content={label} side="right">
			{item}
		</Tooltip>
	) : (
		item
	);
}

/** Needs you (always there; its count only when something waits), Activity and Library. */
function MainNav({ collapsed }: { collapsed: boolean }) {
	const waiting = useNeedsYouCount();
	return (
		<div className={cn("flex flex-col gap-0.5", collapsed && "items-center gap-1")}>
			<NavItem collapsed={collapsed} icon={<Inbox />} label="Needs you" to="/inbox" badge={waiting} />
			<NavItem collapsed={collapsed} icon={<Activity />} label="Activity" to="/activity" />
			<NavItem collapsed={collapsed} icon={<Library />} label="Library" to="/library" />
		</div>
	);
}

/**
 * - full: the desktop sidebar (260px), collapsible to the rail.
 * - rail: the collapsed sidebar (tablets start with it): icons, bots and groups as avatars.
 * - overlay: the full sidebar opened over the screen from the rail (tablets); closes when you pick something.
 * - pane: one screen of a dual-screen device.
 */
export function Sidebar({ variant }: { variant: "full" | "rail" | "overlay" | "pane" }) {
	// Only what this reads: the whole store changes on every keystroke (drafts) and every step of a reply.
	const ui = useUi(
		useShallow((s) => ({
			setPaletteOpen: s.setPaletteOpen,
			setSidebarOpen: s.setSidebarOpen,
			toggleSidebarCollapsed: s.toggleSidebarCollapsed,
		})),
	);
	const navigate = useNavigate();
	const { tablet } = useLayout();

	if (variant === "rail") {
		return (
			<nav
				aria-label="Sekai"
				className="flex h-full w-[68px] shrink-0 flex-col items-center gap-1 border-r border-border bg-bg-subtle pt-safe-3 pb-safe-3"
			>
				<IconButton
					label="Expand sidebar"
					tooltipSide="right"
					// Tablets keep the rail and open the full sidebar over the screen.
					onClick={() => (tablet ? ui.setSidebarOpen(true) : ui.toggleSidebarCollapsed())}
				>
					<PanelLeftOpen />
				</IconButton>
				<NewMenu align="start">
					<IconButton label="New" tooltipSide="right">
						<Plus />
					</IconButton>
				</NewMenu>
				<IconButton
					label="Search"
					shortcut={`${MOD}K`}
					tooltipSide="right"
					onClick={() => ui.setPaletteOpen(true)}
				>
					<Search />
				</IconButton>
				<MainNav collapsed />
				<div className="my-2 h-px w-8 shrink-0 bg-border" />
				<div className="flex min-h-0 w-full flex-1 flex-col items-center gap-1.5 overflow-y-auto scrollbar-none">
					<RailChats />
				</div>
				<div className="mt-2">
					<PersonFooter collapsed />
				</div>
			</nav>
		);
	}

	return (
		<nav
			aria-label="Sekai"
			className={cn(
				"flex h-full flex-col bg-bg-subtle pt-safe pb-safe",
				variant === "full" ? "w-[260px] shrink-0 border-r border-border" : "w-full",
			)}
		>
			<div className="flex items-center gap-1 px-3 pt-3 pb-2">
				<button
					type="button"
					onClick={() => {
						ui.setSidebarOpen(false);
						navigate("/");
					}}
					className="flex items-center gap-2 rounded-md px-1.5 py-1"
				>
					<SekaiMark size={24} />
					<span className="text-heading font-semibold tracking-tight">sekai</span>
				</button>
				<div className="ml-auto flex items-center gap-0.5">
					<NewMenu>
						<IconButton label="New">
							<Plus />
						</IconButton>
					</NewMenu>
					{variant === "full" ? (
						<IconButton label="Collapse sidebar" shortcut={`${MOD}B`} onClick={ui.toggleSidebarCollapsed}>
							<PanelLeftClose />
						</IconButton>
					) : variant === "overlay" ? (
						<IconButton label="Close" onClick={() => ui.setSidebarOpen(false)}>
							<X />
						</IconButton>
					) : null}
				</div>
			</div>

			<div className="flex flex-col gap-1 px-3 pb-1">
				<button
					type="button"
					onClick={() => ui.setPaletteOpen(true)}
					className="mb-1 flex h-9 w-full items-center gap-2 rounded-md bg-surface-2/70 px-3 text-body text-fg-subtle transition-colors hover:bg-surface-2 coarse:h-11"
				>
					<Search className="size-4" />
					<span className="flex-1 text-left">Search</span>
					<Kbd>{MOD}K</Kbd>
				</button>
				<MainNav collapsed={false} />
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto px-3 pt-3 pb-3 scrollbar-thin">
				<ChatList />
			</div>

			<PersonFooter />
		</nav>
	);
}
