import { qk, queryClient, ReauthHost, useAuth } from "@sekai/client";
import type { AuthStatus } from "@sekai/shared";
import { Button, parseThemeChoice, resolveTheme, Spinner, THEME_KEY, Toaster, TooltipProvider } from "@sekai/ui";
import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { AppShell } from "./components/layout/AppShell.tsx";
import { ActivityPage } from "./pages/ActivityPage.tsx";
import { RestrictedPage } from "./pages/auth/RestrictedPage.tsx";
import { SetupPage } from "./pages/auth/SetupPage.tsx";
import { type SignedIn, SignInPage } from "./pages/auth/SignInPage.tsx";
import { TicketPage, ticketFromPath } from "./pages/auth/TicketPage.tsx";
import { ConversationPage } from "./pages/ConversationPage.tsx";
import { HomePage, OpenBotPage, ToAdmin } from "./pages/HomePage.tsx";
import { InboxPage } from "./pages/InboxPage.tsx";
import { LibraryPage } from "./pages/LibraryPage.tsx";
import { OnboardingPage } from "./pages/OnboardingPage.tsx";
import { SettingsPage } from "./pages/SettingsPage.tsx";
import { applyTheme, useUi } from "./stores/ui.ts";

/** After signing in, go where you were headed (for example the admin app, which sends you here to sign in). */
function continueTo(): string | null {
	const next = new URLSearchParams(location.search).get("next");
	// Only a page of this site (a "//" or "/\\" start would be another site).
	return next && /^\/(?![/\\])/.test(next) ? next : null;
}

function AuthGate() {
	const auth = useAuth();
	// Back online (or the server is back): try again on its own.
	const { refetch, error } = auth;
	useEffect(() => {
		if (!error) return;
		const again = () => void refetch();
		window.addEventListener("online", again);
		const t = setInterval(again, 15_000);
		return () => {
			window.removeEventListener("online", again);
			clearInterval(t);
		};
	}, [error, refetch]);
	const signedIn = ({ user, restriction }: SignedIn) => {
		const next = continueTo();
		if (next?.startsWith("/admin")) {
			location.assign(next);
			return;
		}
		queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== "auth" });
		if (next) history.replaceState(null, "", next);
		else if (location.pathname === "/login") history.replaceState(null, "", "/");
		queryClient.setQueryData(qk.auth, (s: AuthStatus | undefined) =>
			s ? { ...s, setupRequired: false, signedIn: true, user, via: "session", restriction } : s,
		);
		void queryClient.invalidateQueries({ queryKey: qk.auth });
	};
	const ticket = ticketFromPath();
	if (auth.isLoading) {
		return (
			<div className="flex h-dvh items-center justify-center">
				<Spinner className="size-6" />
			</div>
		);
	}
	if (auth.error || !auth.data) {
		const offline = !navigator.onLine;
		return (
			<div className="flex h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
				<div className="text-lg font-semibold">
					{offline ? "You're offline" : "Can't reach the Sekai server"}
				</div>
				<p className="max-w-sm text-sm text-fg-muted">
					{offline ? "Sekai opens as soon as you're back online." : auth.error?.message}
				</p>
				<Button variant="secondary" onClick={() => void auth.refetch()}>
					Try again
				</Button>
			</div>
		);
	}
	if (ticket) return <TicketPage kind={ticket.kind} token={ticket.token} onSignedIn={signedIn} />;
	if (auth.data.setupRequired) return <SetupPage status={auth.data} onDone={signedIn} />;
	if (!auth.data.signedIn) return <SignInPage status={auth.data} onSignedIn={signedIn} />;
	// Signed in, but a step first (a temporary password, or two-factor sign-in the role requires).
	if (auth.data.restriction) {
		return (
			<RestrictedPage
				status={auth.data}
				onDone={() => {
					queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== "auth" });
					void queryClient.invalidateQueries({ queryKey: qk.auth });
				}}
			/>
		);
	}
	return (
		<Routes>
			<Route element={<AppShell />}>
				<Route index element={<HomePage />} />
				<Route path="welcome" element={<OnboardingPage />} />
				<Route path="c/:conversationId" element={<ConversationPage />} />
				<Route path="activity" element={<ActivityPage />} />
				<Route path="library" element={<LibraryPage />} />
				<Route path="inbox" element={<InboxPage />} />
				<Route path="bot/:agentId" element={<OpenBotPage />} />
				<Route path="apps" element={<ToAdmin page="apps" />} />
				<Route path="settings" element={<SettingsPage />} />
				<Route path="*" element={<Navigate to="/" replace />} />
			</Route>
		</Routes>
	);
}

export function App() {
	const theme = useUi((s) => s.theme);
	useEffect(() => {
		applyTheme(theme);
		// Changed in Admin (another tab): follow it.
		const onStorage = (e: StorageEvent) => {
			if (e.key === THEME_KEY) useUi.getState().setTheme(parseThemeChoice(e.newValue));
		};
		window.addEventListener("storage", onStorage);
		if (theme !== "auto") return () => window.removeEventListener("storage", onStorage);
		const mql = matchMedia("(prefers-color-scheme: dark)");
		const onChange = () => applyTheme("auto");
		mql.addEventListener("change", onChange);
		return () => {
			mql.removeEventListener("change", onChange);
			window.removeEventListener("storage", onStorage);
		};
	}, [theme]);

	return (
		<QueryClientProvider client={queryClient}>
			<TooltipProvider>
				<BrowserRouter>
					<AuthGate />
				</BrowserRouter>
				<ReauthHost />
				<Toaster
					position="top-center"
					theme={theme === "auto" ? "system" : resolveTheme(theme).mode}
					offset={{ top: "max(env(safe-area-inset-top), 12px)" }}
					mobileOffset={{ top: "max(env(safe-area-inset-top), 8px)" }}
				/>
			</TooltipProvider>
		</QueryClientProvider>
	);
}
