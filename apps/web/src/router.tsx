import { ErrorState } from "@sekai/ui";
import { lazy, Suspense } from "react";
import { createBrowserRouter, Navigate, useRouteError } from "react-router";
import { AppRoot } from "./Root.tsx";
import type { ScreenName } from "./signed-in.tsx";

/** The building-blocks gallery at /dev/ui: only in the dev server (production builds leave it out entirely). */
const DevGallery = import.meta.env.DEV ? lazy(() => import("./dev/Gallery.tsx")) : null;

/*
 * The signed-in app is its own chunk, loaded when AppRoot lets someone in (sign-in, setup and invites don't need
 * it). Its screens come with the shell, so moving between them never waits.
 */
let app: typeof import("./signed-in.tsx") | null = null;
const loadApp = () =>
	import("./signed-in.tsx").then((m) => {
		app = m;
		return m;
	});
const AppShell = lazy(() => loadApp().then((m) => ({ default: m.AppShell })));
const Onboarding = lazy(() => loadApp().then((m) => ({ default: m.screens.OnboardingPage })));

/** One of the signed-in app's screens (inside AppShell, so its chunk is already here). */
function Screen({ name }: { name: ScreenName }) {
	const Component = app?.screens[name];
	return Component ? <Component /> : null;
}

/** What a route that crashed while loading shows (rendering crashes are caught by each screen's ErrorBoundary). */
function RouteError() {
	const error = useRouteError();
	return (
		<ErrorState
			className="min-h-dvh"
			title="This screen ran into a problem"
			error={error}
			onRetry={() => location.reload()}
		/>
	);
}

/**
 * The app's routes (DESIGN.md "Routes"). A data router, so leaving a form with unsaved changes can ask first
 * (useBlocker, in AppRoot). Every old address keeps working through redirectFor().
 */
export const router = createBrowserRouter([
	{
		element: <AppRoot />,
		errorElement: <RouteError />,
		children: [
			...(DevGallery
				? [
						{
							path: "dev/ui",
							element: (
								<Suspense fallback={null}>
									<DevGallery />
								</Suspense>
							),
						},
					]
				: []),
			// Before the app: the first bot (invites, resets, sign-in and setup are decided in AppRoot).
			{ path: "welcome", element: <Onboarding /> },
			{
				element: <AppShell />,
				children: [
					{ index: true, element: <Screen name="HomePage" /> },
					{ path: "c/:conversationId", element: <Screen name="ConversationPage" /> },
					{ path: "inbox", element: <Screen name="InboxPage" /> },
					{ path: "activity", element: <Screen name="ActivityPage" /> },
					{ path: "library", element: <Screen name="LibraryPage" /> },
					{ path: "bots/:agentId/:section?/*", element: <Screen name="BotPage" /> },
					{ path: "settings/*", element: <Screen name="Settings" /> },
					// Opens a bot's main chat (older links, and links from Settings).
					{ path: "bot/:agentId", element: <Screen name="OpenBotPage" /> },
					{ path: "apps", element: <Screen name="OldAddress" /> },
					{ path: "admin/*", element: <Screen name="OldAddress" /> },
					{ path: "*", element: <Navigate to="/" replace /> },
				],
			},
		],
	},
]);
