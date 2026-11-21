import { createApiClient } from "@sekai/shared";
import { desktop } from "./desktop.ts";

const TOKEN_KEY = "sekai.token";
const SERVER_KEY = "sekai.server";

/** Same origin by default; the desktop app or a saved remote server can point elsewhere. */
function serverBase(): string {
	if (desktop?.serverUrl) return desktop.serverUrl;
	try {
		return localStorage.getItem(SERVER_KEY) ?? "";
	} catch {
		return "";
	}
}

export function getToken(): string | null {
	try {
		return localStorage.getItem(TOKEN_KEY);
	} catch {
		return null;
	}
}

export function setToken(token: string | null): void {
	if (token) localStorage.setItem(TOKEN_KEY, token);
	else localStorage.removeItem(TOKEN_KEY);
}

type ReauthHandler = () => Promise<boolean>;
let reauthHandler: ReauthHandler | null = null;

/** The app's "confirm it's you" dialog (ReauthHost) registers here; the API client asks it when the server wants. */
export function setReauthHandler(handler: ReauthHandler | null): void {
	reauthHandler = handler;
}

export const api = createApiClient({
	baseUrl: serverBase(),
	getToken,
	onReauth: () => (reauthHandler ? reauthHandler() : Promise.resolve(false)),
});

/**
 * A Settings section of the app, e.g. settingsUrl("subscriptions") → "/settings/subscriptions" (ids are in the web
 * app's src/settings/registry.tsx). An in-app path: open it with the router (a Link, navigate()).
 */
export function settingsUrl(section: SettingsSectionId = "", rest = ""): string {
	const base = section ? `/settings/${section}` : "/settings";
	return rest ? `${base}/${rest.replace(/^\/+/, "")}` : base;
}

/** The Settings sections other packages link to. */
export type SettingsSectionId =
	| ""
	| "profile"
	| "sign-in-security"
	| "appearance"
	| "notifications"
	| "browser-extension"
	| "this-computer"
	| "approvals"
	| "models"
	| "subscriptions"
	| "apps"
	| "voice"
	| "web-reading"
	| "memory"
	| "usage"
	| "people"
	| "roles"
	| "sign-in-options"
	| "status"
	| "computers"
	| "network"
	| "backups"
	| "about";

/** Upload and avatar URLs come back relative ("/api/uploads/…"); make them absolute for remote servers. */
export function assetUrl(url: string): string {
	if (/^(https?:|data:|blob:)/.test(url)) return url;
	return api.url(url);
}
