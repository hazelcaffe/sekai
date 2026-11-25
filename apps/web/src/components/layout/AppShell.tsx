import { desktop, mobile } from "@sekai/client";
import { ErrorBoundary } from "@sekai/ui";
import { useQueryClient } from "@tanstack/react-query";
import { WifiOff } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { type RefObject, useEffect, useLayoutEffect, useRef } from "react";
import { Outlet, useLocation, useNavigate } from "react-router";
import { useShallow } from "zustand/react/shallow";
import { isTabRoot } from "../../lib/back.ts";
import { connectEvents } from "../../lib/events.ts";
import { useHotkey, useLayout } from "../../lib/hooks.ts";
import { syncPhonePush } from "../../lib/notifications.ts";
import { currentPath } from "../../lib/redirects.ts";
import { useUi } from "../../stores/ui.ts";
import { CredentialPrompt } from "../computer/CredentialPrompt.tsx";
import { CommandPalette } from "../dialogs/CommandPalette.tsx";
import { GetAppsDialog } from "../dialogs/GetAppsDialog.tsx";
import { ImportBotDialog } from "../dialogs/ImportBotDialog.tsx";
import { NewAgentDialog } from "../dialogs/NewAgentDialog.tsx";
import { NewChatDialog } from "../dialogs/NewChatDialog.tsx";
import { NewGroupDialog } from "../dialogs/NewGroupDialog.tsx";
import { CallProvider } from "../voice/CallProvider.tsx";
import { Sidebar, useNeedsYouCount } from "./Sidebar.tsx";
import { TabBar } from "./TabBar.tsx";

function OfflineBanner() {
	const connection = useUi((s) => s.connection);
	if (connection !== "offline") return null;
	return (
		<div className="flex items-center justify-center gap-2 bg-warning-soft px-4 py-1.5 pt-safe text-small font-medium text-warning-ink">
			<WifiOff className="size-4" />
			Reconnecting to Sekai…
		</div>
	);
}

/** The scrolling part of a screen: a Page's box, or a screen's own (data-scroll-root). */
function scrollRoot(main: HTMLElement | null): HTMLElement | null {
	return main?.querySelector<HTMLElement>('[data-scroll-root], [data-slot="page"]') ?? null;
}

/**
 * Phones: each tab-bar screen keeps its scroll position while you're on another tab (the screens themselves
 * unmount; drafts are in the store).
 */
function useTabScrollMemory(main: RefObject<HTMLElement | null>, enabled: boolean) {
	const { pathname, search } = useLocation();
	// Per address, view and filters included (Activity's Done and Log each keep their own).
	const where = `${pathname}${search}`;
	const saved = useRef(new Map<string, number>());
	useEffect(() => {
		const el = main.current;
		if (!el || !enabled || !isTabRoot(pathname)) return;
		const onScroll = (e: Event) => {
			const root = scrollRoot(el);
			if (e.target === root && root) saved.current.set(where, root.scrollTop);
		};
		el.addEventListener("scroll", onScroll, { capture: true, passive: true });
		return () => el.removeEventListener("scroll", onScroll, { capture: true });
	}, [main, enabled, pathname, where]);
	useLayoutEffect(() => {
		const top = saved.current.get(where);
		if (!enabled || !top || !isTabRoot(pathname)) return;
		// The list may still be loading: try for a moment until it's tall enough.
		let tries = 0;
		let frame = requestAnimationFrame(function restore() {
			const root = scrollRoot(main.current);
			if (root && root.scrollHeight - root.clientHeight >= top) root.scrollTop = top;
			else if (tries++ < 30) frame = requestAnimationFrame(restore);
		});
		return () => cancelAnimationFrame(frame);
	}, [main, enabled, pathname, where]);
}

/**
 * The app around every signed-in screen. Desktop: the sidebar (collapsible to the rail). Tablets: the rail, with
 * the full sidebar over the screen when you open it. Phones: no sidebar; the tab bar on the four top-level screens,
 * everything else pushed full screen.
 */
export function AppShell() {
	const layout = useLayout();
	const qc = useQueryClient();
	const navigate = useNavigate();
	// Only what this reads: the whole store changes on every keystroke (drafts) and every step of a reply.
	const ui = useUi(
		useShallow((s) => ({
			paletteOpen: s.paletteOpen,
			setNewChatOpen: s.setNewChatOpen,
			setNewGroupOpen: s.setNewGroupOpen,
			setPaletteOpen: s.setPaletteOpen,
			setSidebarOpen: s.setSidebarOpen,
			sidebarCollapsed: s.sidebarCollapsed,
			sidebarOpen: s.sidebarOpen,
			togglePanel: s.togglePanel,
			toggleSidebarCollapsed: s.toggleSidebarCollapsed,
		})),
	);
	const { pathname } = useLocation();
	const main = useRef<HTMLElement>(null);

	useEffect(() => connectEvents(qc), [qc]);
	// Phone app: keep the server told where to send this phone's pushes.
	useEffect(() => syncPhonePush(), []);

	// Desktop and phone apps: the dock/taskbar or app icon badge counts what's waiting for you.
	const waiting = useNeedsYouCount();
	useEffect(() => {
		desktop?.setBadge(waiting);
		mobile?.setBadge(waiting);
	}, [waiting]);

	// Notification clicks (browser, service worker, desktop or phone app) navigate inside the app; older addresses
	// (a push from before an update, the tray) go where they live now.
	useEffect(() => {
		const go = (path: string) => navigate(currentPath(path));
		const onNav = (e: Event) => go((e as CustomEvent<string>).detail);
		window.addEventListener("sekai:navigate", onNav);
		const off = desktop?.onNavigate(go);
		const offPhone = mobile?.onNavigate(go);
		return () => {
			window.removeEventListener("sekai:navigate", onNav);
			off?.();
			offPhone?.();
		};
	}, [navigate]);

	useHotkey("mod+k", () => ui.setPaletteOpen(!ui.paletteOpen), { allowInInputs: true });
	useHotkey("mod+n", () => ui.setNewChatOpen(true), { allowInInputs: true });
	useHotkey("mod+shift+n", () => ui.setNewGroupOpen(true), { allowInInputs: true });
	useHotkey("mod+b", () => ui.toggleSidebarCollapsed(), { allowInInputs: true });
	useHotkey("mod+.", () => ui.togglePanel(), { allowInInputs: true });
	useHotkey("mod+,", () => navigate("/settings"), { allowInInputs: true });

	// The tablet overlay closes when you go somewhere.
	// biome-ignore lint/correctness/useExhaustiveDependencies: on navigation
	useEffect(() => {
		useUi.getState().setSidebarOpen(false);
	}, [pathname]);

	useTabScrollMemory(main, layout.phone);

	const sidebar = layout.spanned
		? null
		: layout.phone
			? null
			: layout.tablet || ui.sidebarCollapsed
				? "rail"
				: "full";
	const tabBar = layout.phone && isTabRoot(pathname);

	return (
		<CallProvider>
			<div className="flex h-dvh w-full flex-col overflow-hidden pl-safe pr-safe">
				<OfflineBanner />
				<div className="flex min-h-0 flex-1">
					{layout.spanned ? (
						// Dual-screen: the sidebar fills the left screen exactly; the hinge stays empty.
						<>
							<div className="h-full shrink-0" style={{ width: "var(--fold-left)" }}>
								<Sidebar variant="pane" />
							</div>
							<div className="h-full shrink-0 bg-bg" style={{ width: "var(--fold-gap)" }} />
						</>
					) : (
						sidebar && <Sidebar variant={sidebar} />
					)}

					<main ref={main} className="relative flex min-w-0 flex-1 flex-col">
						{/* A crash on one screen shows what happened there, not a white app; going elsewhere clears it. */}
						<ErrorBoundary resetKey={pathname}>
							<Outlet />
						</ErrorBoundary>
					</main>
				</div>
				{tabBar && <TabBar />}

				{sidebar === "rail" && (
					<DialogPrimitive.Root open={ui.sidebarOpen} onOpenChange={ui.setSidebarOpen}>
						<DialogPrimitive.Portal>
							<DialogPrimitive.Overlay className="fixed inset-0 z-panel bg-overlay" />
							<DialogPrimitive.Content className="fixed inset-y-0 left-0 z-panel w-[min(86vw,300px)] shadow-pop outline-none pl-safe">
								<DialogPrimitive.Title className="sr-only">Chats</DialogPrimitive.Title>
								<DialogPrimitive.Description className="sr-only">
									Bots, groups and the rest of Sekai
								</DialogPrimitive.Description>
								<Sidebar variant="overlay" />
							</DialogPrimitive.Content>
						</DialogPrimitive.Portal>
					</DialogPrimitive.Root>
				)}

				<CredentialPrompt />
				<CommandPalette />
				<NewChatDialog />
				<NewAgentDialog />
				<ImportBotDialog />
				<NewGroupDialog />
				<GetAppsDialog />
			</div>
		</CallProvider>
	);
}
