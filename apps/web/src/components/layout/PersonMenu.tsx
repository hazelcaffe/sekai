import { cn, runningAsApp, useAuth } from "@sekai/client";
import {
	DropdownContent,
	DropdownEntries,
	DropdownLabel,
	DropdownMenu,
	DropdownTrigger,
	IconButton,
	type MenuEntry,
	StatusDot,
} from "@sekai/ui";
import { Download, LogOut, Palette, Settings } from "lucide-react";
import { useNavigate } from "react-router";
import { signOut } from "../../lib/session.ts";
import { useAttention } from "../../settings/server/attention.ts";
import { useUi } from "../../stores/ui.ts";

/** You, as a round initial (people don't have pictures; bots do). */
export function PersonAvatar({ size = 32, className }: { size?: number; className?: string }) {
	const { data: auth } = useAuth();
	const name = auth?.user?.name ?? "";
	return (
		<span
			aria-hidden
			style={{ width: size, height: size }}
			className={cn(
				"flex shrink-0 items-center justify-center rounded-full bg-brand-soft font-semibold text-brand-ink",
				size >= 40 ? "text-heading" : "text-body",
				className,
			)}
		>
			{name.slice(0, 1).toUpperCase() || "?"}
		</span>
	);
}

/** Whether something in Settings needs you (an admin's broken or missing setup): a dot on the way there. */
export function useSettingsAttention(): "danger" | "warning" | null {
	const { bySection } = useAttention();
	const tones = Object.values(bySection);
	return tones.includes("danger") ? "danger" : tones.includes("warning") ? "warning" : null;
}

function usePersonEntries(): MenuEntry[] {
	const navigate = useNavigate();
	const { data: auth } = useAuth();
	const go = (path: string) => {
		useUi.getState().setSidebarOpen(false);
		navigate(path);
	};
	return [
		{ label: "Settings", icon: <Settings />, shortcut: "Ctrl+,", onSelect: () => go("/settings") },
		{ label: "Appearance", icon: <Palette />, onSelect: () => go("/settings/appearance") },
		// Inside the desktop and phone apps (or Sekai installed from the browser) it's only in Settings.
		!runningAsApp() && {
			label: "Get the apps",
			icon: <Download />,
			onSelect: () => {
				useUi.getState().setSidebarOpen(false);
				useUi.getState().setGetAppsOpen(true);
			},
		},
		auth?.via === "session" && "-",
		auth?.via === "session" && { label: "Sign out", icon: <LogOut />, onSelect: () => void signOut() },
	];
}

/** The sidebar's footer: you (a menu with Settings, Appearance and Sign out) and a Settings button. */
export function PersonFooter({ collapsed = false }: { collapsed?: boolean }) {
	const { data: auth } = useAuth();
	const navigate = useNavigate();
	const entries = usePersonEntries();
	const attention = useSettingsAttention();
	const user = auth?.user;
	const settings = (
		<span className="relative">
			<IconButton
				label="Settings"
				tooltipSide={collapsed ? "right" : "top"}
				onClick={() => {
					useUi.getState().setSidebarOpen(false);
					navigate("/settings");
				}}
			>
				<Settings />
			</IconButton>
			{attention && (
				<StatusDot
					tone={attention}
					label="Something in Settings needs you"
					className="pointer-events-none absolute top-1.5 right-1.5"
				/>
			)}
		</span>
	);
	const menu = (
		<DropdownMenu>
			<DropdownTrigger asChild>
				{collapsed ? (
					<button
						type="button"
						aria-label={user ? `${user.name}: your menu` : "Your menu"}
						className="rounded-full p-1 outline-none focus-visible:ring-2 focus-visible:ring-brand-ink/40"
					>
						<PersonAvatar size={32} />
					</button>
				) : (
					<button
						type="button"
						className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-1.5 py-1.5 text-left outline-none transition-colors hover:bg-surface-2/60 focus-visible:ring-2 focus-visible:ring-brand-ink/40"
					>
						<PersonAvatar size={32} />
						<span className="min-w-0 flex-1">
							<span className="block truncate text-body font-medium">{user?.name ?? "Signed in"}</span>
							{user && <span className="block truncate text-small text-fg-subtle">@{user.username}</span>}
						</span>
					</button>
				)}
			</DropdownTrigger>
			<DropdownContent align="start" side={collapsed ? "right" : "top"}>
				{collapsed && user && <DropdownLabel>{user.name}</DropdownLabel>}
				<DropdownEntries entries={entries} />
			</DropdownContent>
		</DropdownMenu>
	);
	if (collapsed) {
		return (
			<div className="flex flex-col items-center gap-1">
				{settings}
				{menu}
			</div>
		);
	}
	return (
		<div className="flex items-center gap-1 px-3 py-2">
			{menu}
			{settings}
		</div>
	);
}
