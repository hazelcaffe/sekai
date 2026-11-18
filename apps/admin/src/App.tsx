import { queryClient, ReauthHost, useAuth } from "@sekai/client";
import { PageStyleProvider, resolveTheme, Spinner, Tabs, Toaster, TooltipProvider } from "@sekai/ui";
import { QueryClientProvider } from "@tanstack/react-query";
import { type ComponentType, useEffect, useSyncExternalStore } from "react";
import { BrowserRouter, Navigate, Route, Routes, useNavigate, useParams } from "react-router";
import { AdminFrame, pathOf } from "./components/AdminShell.tsx";
import { useAttention } from "./lib/attention.ts";
import { connectAdminEvents } from "./lib/live.ts";
import { homeTab, navItem, type Tab, tabAllowed } from "./lib/nav.tsx";
import { useTheme } from "./lib/theme.ts";
import { AboutPanel } from "./pages/AboutPanel.tsx";
import { AccountPanel } from "./pages/AccountPanel.tsx";
import { ActivityPanel } from "./pages/ActivityPanel.tsx";
import { ApprovalsPanel } from "./pages/ApprovalsPanel.tsx";
import { AppsPanel } from "./pages/AppsPage.tsx";
import { BackupsPanel } from "./pages/BackupsPanel.tsx";
import { ComparePanel } from "./pages/ComparePanel.tsx";
import { ComputersPanel } from "./pages/ComputerSettings.tsx";
import { DevicesPanel } from "./pages/DevicesPanel.tsx";
import { MemoryPanel } from "./pages/MemoryPanel.tsx";
import { MobilePanel } from "./pages/MobilePanel.tsx";
import { ModelsPanel } from "./pages/ModelsPanel.tsx";
import { OverviewPanel } from "./pages/OverviewPanel.tsx";
import { PeoplePanel } from "./pages/PeoplePanel.tsx";
import { RolesPanel } from "./pages/RolesPanel.tsx";
import { SignInPanel } from "./pages/SignInPanel.tsx";
import { SubscriptionsPanel } from "./pages/SubscriptionsPage.tsx";
import { TailscalePanel } from "./pages/TailscalePanel.tsx";
import { UsagePanel } from "./pages/UsagePanel.tsx";
import { VoicePanel } from "./pages/VoicePanel.tsx";

const PANELS: Record<Exclude<Tab, "overview">, ComponentType> = {
	models: ModelsPanel,
	subscriptions: SubscriptionsPanel,
	apps: AppsPanel,
	voice: VoicePanel,
	memory: MemoryPanel,
	usage: UsagePanel,
	compare: ComparePanel,
	activity: ActivityPanel,
	backups: BackupsPanel,
	approvals: ApprovalsPanel,
	people: PeoplePanel,
	roles: RolesPanel,
	signin: SignInPanel,
	mobile: MobilePanel,
	computers: ComputersPanel,
	tailscale: TailscalePanel,
	account: AccountPanel,
	devices: DevicesPanel,
	about: AboutPanel,
};

/** Tailwind's lg: from here up there's the side bar; below it the overview is the list of pages. */
const large = () => window.matchMedia("(min-width: 64rem)");

function onLargeChange(onChange: () => void): () => void {
	const mq = large();
	mq.addEventListener("change", onChange);
	return () => mq.removeEventListener("change", onChange);
}

function useLargeScreen(): boolean {
	return useSyncExternalStore(onLargeChange, () => large().matches);
}

function AdminHome() {
	const { tab: raw = "overview" } = useParams();
	const navigate = useNavigate();
	const attention = useAttention();
	const { data: auth } = useAuth();
	const access = auth?.access;
	const wide = useLargeScreen();
	const item = navItem(raw);
	const tab = item?.value;
	useEffect(() => {
		window.scrollTo({ top: 0 });
		document.title = item && tab !== "overview" ? `${item.label} · Sekai Admin` : "Sekai Admin";
	}, [item, tab]);
	if (!tab) return <Navigate to="/" replace />;
	// Pages for admins only send everyone else to their own first page. On phones the overview stays: it's the
	// list of pages there (it shows only theirs).
	if (!tabAllowed(tab, access) && !(tab === "overview" && !wide)) {
		return <Navigate to={pathOf(homeTab(access))} replace />;
	}
	const Panel = tab === "overview" ? null : PANELS[tab];
	return (
		<AdminFrame tab={tab} byTab={attention.byTab}>
			<Tabs value={tab}>
				{Panel ? <Panel /> : <OverviewPanel attention={attention} onOpen={(t) => navigate(pathOf(t))} />}
			</Tabs>
		</AdminFrame>
	);
}

/** Signed out (or not set up yet): the main app handles sign-in, then sends you back here. */
function AdminGate() {
	const auth = useAuth();
	const signedIn = auth.data?.signedIn;
	useEffect(() => {
		if (auth.data && !signedIn) {
			location.replace(`/?next=${encodeURIComponent(location.pathname + location.search)}`);
		}
	}, [auth.data, signedIn]);
	// Live updates while signed in: lists change as soon as something is saved (here, by a bot, or elsewhere).
	useEffect(() => (signedIn ? connectAdminEvents(queryClient) : undefined), [signedIn]);
	if (auth.error) {
		return (
			<div className="flex h-dvh flex-col items-center justify-center gap-2 px-6 text-center">
				<div className="text-lg font-semibold">Can't reach the Sekai server</div>
				<p className="max-w-sm text-sm text-fg-muted">{auth.error.message}</p>
			</div>
		);
	}
	if (!signedIn) {
		return (
			<div className="flex h-dvh items-center justify-center">
				<Spinner className="size-6" />
			</div>
		);
	}
	return (
		<PageStyleProvider value="page">
			<Routes>
				<Route path="/" element={<AdminHome />} />
				<Route path="/:tab" element={<AdminHome />} />
				<Route path="*" element={<Navigate to="/" replace />} />
			</Routes>
		</PageStyleProvider>
	);
}

export function App() {
	const { theme } = useTheme();
	return (
		<QueryClientProvider client={queryClient}>
			<TooltipProvider>
				<BrowserRouter basename="/admin">
					<AdminGate />
				</BrowserRouter>
				<Toaster
					position="top-center"
					theme={theme === "auto" ? "system" : resolveTheme(theme).mode}
					offset={{ top: "max(env(safe-area-inset-top), 12px)" }}
				/>
				<ReauthHost />
			</TooltipProvider>
		</QueryClientProvider>
	);
}
