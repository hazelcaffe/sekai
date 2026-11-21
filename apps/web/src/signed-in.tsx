import { Navigate, useLocation } from "react-router";
import { BotPage } from "./bots/BotPage.tsx";
import { AppShell } from "./components/layout/AppShell.tsx";
import { redirectFor } from "./lib/redirects.ts";
import { ActivityPage } from "./pages/ActivityPage.tsx";
import { ConversationPage } from "./pages/ConversationPage.tsx";
import { HomePage, OpenBotPage } from "./pages/HomePage.tsx";
import { InboxPage } from "./pages/InboxPage.tsx";
import { LibraryPage } from "./pages/LibraryPage.tsx";
import { OnboardingPage } from "./pages/OnboardingPage.tsx";
import { SettingsPage } from "./settings/SettingsPage.tsx";

/*
 * The signed-in app, loaded only once someone is signed in (router.tsx): the shell and every screen in it, so the
 * sign-in page doesn't download chats, Settings and what they draw with.
 */

/** An old address (the admin app's pages, /apps, /settings?tab=…): where it lives now. */
function OldAddress() {
	const { pathname, search, hash } = useLocation();
	return <Navigate to={redirectFor(pathname, search, hash) ?? "/"} replace />;
}

/** /settings: older ?tab= and #this-computer addresses first, then Settings. */
function Settings() {
	const { pathname, search, hash } = useLocation();
	const to = redirectFor(pathname, search, hash);
	return to ? <Navigate to={to} replace /> : <SettingsPage />;
}

export { AppShell };

export const screens = {
	HomePage,
	ConversationPage,
	InboxPage,
	ActivityPage,
	LibraryPage,
	BotPage,
	Settings,
	OpenBotPage,
	OldAddress,
	OnboardingPage,
};
export type ScreenName = keyof typeof screens;
