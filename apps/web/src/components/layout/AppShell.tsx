import { desktop, useApprovals, useCredentialRequests, usePairings } from "@sekai/client";
import { useQueryClient } from "@tanstack/react-query";
import { WifiOff } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useEffect, useRef } from "react";
import { Outlet, useNavigate } from "react-router";
import { connectEvents } from "../../lib/events.ts";
import { useHotkey, useLayout } from "../../lib/hooks.ts";
import { useUi } from "../../stores/ui.ts";
import { CredentialPrompt } from "../computer/CredentialPrompt.tsx";
import { CommandPalette } from "../dialogs/CommandPalette.tsx";
import { ImportBotDialog } from "../dialogs/ImportBotDialog.tsx";
import { NewAgentDialog } from "../dialogs/NewAgentDialog.tsx";
import { NewGroupDialog } from "../dialogs/NewGroupDialog.tsx";
import { CallProvider } from "../voice/CallProvider.tsx";
import { Sidebar } from "./Sidebar.tsx";

/** Swipe in from the left edge to open the drawer on phones. */
function useEdgeSwipe(enabled: boolean, onOpen: () => void) {
	const start = useRef<{ x: number; y: number } | null>(null);
	useEffect(() => {
		if (!enabled) return;
		const down = (e: TouchEvent) => {
			const t = e.touches[0];
			start.current = t && t.clientX < 24 ? { x: t.clientX, y: t.clientY } : null;
		};
		const move = (e: TouchEvent) => {
			const t = e.touches[0];
			if (!start.current || !t) return;
			const dx = t.clientX - start.current.x;
			const dy = Math.abs(t.clientY - start.current.y);
			if (dx > 60 && dy < 40) {
				start.current = null;
				onOpen();
			}
		};
		window.addEventListener("touchstart", down, { passive: true });
		window.addEventListener("touchmove", move, { passive: true });
		return () => {
			window.removeEventListener("touchstart", down);
			window.removeEventListener("touchmove", move);
		};
	}, [enabled, onOpen]);
}

function OfflineBanner() {
	const connection = useUi((s) => s.connection);
	if (connection !== "offline") return null;
	return (
		<div className="flex items-center justify-center gap-2 bg-warning/15 px-4 py-1.5 pt-safe text-xs font-medium text-warning">
			<WifiOff className="size-3.5" />
			Reconnecting to Sekai…
		</div>
	);
}

export function AppShell() {
	const layout = useLayout();
	const qc = useQueryClient();
	const navigate = useNavigate();
	const ui = useUi();

	useEffect(() => connectEvents(qc), [qc]);

	// Desktop app: the dock/taskbar badge counts approvals waiting for you.
	const { data: approvals } = useApprovals();
	const { data: pairings } = usePairings();
	const { data: logins } = useCredentialRequests();
	const waiting = (approvals?.length ?? 0) + (pairings?.length ?? 0) + (logins?.length ?? 0);
	useEffect(() => desktop?.setBadge(waiting), [waiting]);

	// Notification clicks (browser, service worker or desktop app) navigate inside the app.
	useEffect(() => {
		const onNav = (e: Event) => navigate((e as CustomEvent<string>).detail);
		window.addEventListener("sekai:navigate", onNav);
		const off = desktop?.onNavigate((path) => navigate(path));
		return () => {
			window.removeEventListener("sekai:navigate", onNav);
			off?.();
		};
	}, [navigate]);

	useHotkey("mod+k", () => ui.setPaletteOpen(!ui.paletteOpen), { allowInInputs: true });
	useHotkey("mod+n", () => ui.setNewAgentOpen(true), { allowInInputs: true });
	useHotkey("mod+shift+n", () => ui.setNewGroupOpen(true), { allowInInputs: true });
	useHotkey("mod+b", () => ui.toggleSidebarCollapsed(), { allowInInputs: true });
	useHotkey("mod+.", () => ui.togglePanel(), { allowInInputs: true });
	useHotkey("mod+,", () => navigate("/settings"), { allowInInputs: true });

	useEdgeSwipe(layout.phone, () => ui.setSidebarOpen(true));

	const sidebarVariant = layout.spanned
		? "full"
		: layout.phone
			? null
			: layout.tablet || ui.sidebarCollapsed
				? "rail"
				: "full";

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
						sidebarVariant && <Sidebar variant={sidebarVariant} />
					)}

					<main className="relative flex min-w-0 flex-1 flex-col">
						<Outlet />
					</main>
				</div>

				{layout.phone && (
					<DialogPrimitive.Root open={ui.sidebarOpen} onOpenChange={ui.setSidebarOpen}>
						<DialogPrimitive.Portal>
							<DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-overlay" />
							<DialogPrimitive.Content className="fixed inset-y-0 left-0 z-50 w-[min(86vw,340px)] shadow-soft outline-none pl-safe">
								<DialogPrimitive.Title className="sr-only">Navigation</DialogPrimitive.Title>
								<DialogPrimitive.Description className="sr-only">
									Bots, group chats and settings
								</DialogPrimitive.Description>
								<Sidebar variant="drawer" />
							</DialogPrimitive.Content>
						</DialogPrimitive.Portal>
					</DialogPrimitive.Root>
				)}

				<CredentialPrompt />
				<CommandPalette />
				<NewAgentDialog />
				<ImportBotDialog />
				<NewGroupDialog />
			</div>
		</CallProvider>
	);
}
