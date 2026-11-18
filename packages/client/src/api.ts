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

/** A page of the admin app (a separate app, served at /admin), e.g. adminUrl("subscriptions"). */
export function adminUrl(path = ""): string {
	return api.url(`/admin/${path.replace(/^\/+/, "")}`);
}

/** Upload and avatar URLs come back relative ("/api/uploads/…"); make them absolute for remote servers. */
export function assetUrl(url: string): string {
	if (/^(https?:|data:|blob:)/.test(url)) return url;
	return api.url(url);
}
