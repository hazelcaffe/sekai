import { qk, queryClient, useAuth } from "@sekai/client";
import type { AuthStatus } from "@sekai/shared";
import {
	Button,
	errorMessage,
	hasUnsavedChanges,
	LeaveConfirm,
	type LinkProps,
	LinkProvider,
	Spinner,
} from "@sekai/ui";
import { Suspense, useEffect } from "react";
import { Link, Outlet, useBlocker, useLocation, useNavigate } from "react-router";
import { usePhoneAppBack } from "./lib/back.ts";
import { currentPath } from "./lib/redirects.ts";
import { AuthLayout } from "./pages/auth/AuthLayout.tsx";
import { RestrictedPage } from "./pages/auth/RestrictedPage.tsx";
import { SetupPage } from "./pages/auth/SetupPage.tsx";
import { type SignedIn, SignInPage } from "./pages/auth/SignInPage.tsx";
import { TicketPage, ticketFromPath } from "./pages/auth/TicketPage.tsx";

/** @sekai/ui's links (Row href, Page back, SectionLayout) go through the router; the server's own pages don't. */
function RouterLink({ href, ...props }: LinkProps) {
	if (href.startsWith("/api/")) return <a href={href} {...props} />;
	return <Link to={href} {...props} />;
}

/** After signing in, go where you were headed (a link that needed you signed in, the phone app's sign-in). */
function continueTo(): string | null {
	const next = new URLSearchParams(location.search).get("next");
	// Only a page of this site (a "//" or "/\\" start would be another site).
	return next && /^\/(?![/\\])/.test(next) ? next : null;
}

/** Leaving a page with unsaved changes (a FormGroup, useUnsavedChanges) asks first. */
function LeaveGuard() {
	const blocker = useBlocker(
		({ currentLocation, nextLocation }) =>
			hasUnsavedChanges() &&
			(currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search),
	);
	return (
		<LeaveConfirm
			open={blocker.state === "blocked"}
			onStay={() => blocker.reset?.()}
			onLeave={() => blocker.proceed?.()}
		/>
	);
}

/** Signed in: the app (its own chunk, loaded now), with the leave guard and the phone apps' back gesture. */
function SignedInApp() {
	usePhoneAppBack();
	return (
		<>
			<Suspense fallback={<Loading />}>
				<Outlet />
			</Suspense>
			<LeaveGuard />
		</>
	);
}

function Loading() {
	return (
		<div className="flex h-dvh items-center justify-center">
			<Spinner className="size-6" />
		</div>
	);
}

/** Who you are decides what shows: setup, sign-in, a step you owe (a new password, two-step sign-in), or the app. */
function AuthGate() {
	const auth = useAuth();
	const navigate = useNavigate();
	const { pathname } = useLocation();
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
		// The server itself (signing in to the phone app through this browser).
		if (next?.startsWith("/api/auth/app/")) {
			location.assign(next);
			return;
		}
		queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== "auth" });
		// Old addresses (an /admin page that sent you here to sign in) go where they live now.
		if (next) navigate(currentPath(next), { replace: true });
		else if (location.pathname === "/login") navigate("/", { replace: true });
		queryClient.setQueryData(qk.auth, (s: AuthStatus | undefined) =>
			s ? { ...s, setupRequired: false, signedIn: true, user, via: "session", restriction } : s,
		);
		void queryClient.invalidateQueries({ queryKey: qk.auth });
	};
	const ticket = ticketFromPath(pathname);
	if (auth.isLoading) return <Loading />;
	if (auth.error || !auth.data) {
		const offline = !navigator.onLine;
		return (
			<AuthLayout
				title={offline ? "You're offline" : "Can't reach Sekai"}
				subtitle={
					offline
						? "Sekai opens as soon as you're back online."
						: errorMessage(auth.error ?? "Couldn't reach Sekai. Check your connection and try again.")
				}
			>
				<Button variant="primary" className="w-full" onClick={() => void auth.refetch()}>
					Try again
				</Button>
			</AuthLayout>
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
	return <SignedInApp />;
}

/** The root route: the router's links for @sekai/ui, then the gate (the gallery at /dev/ui needs no sign-in). */
export function AppRoot() {
	const { pathname } = useLocation();
	return (
		<LinkProvider component={RouterLink}>
			{import.meta.env.DEV && pathname === "/dev/ui" ? <Outlet /> : <AuthGate />}
		</LinkProvider>
	);
}
