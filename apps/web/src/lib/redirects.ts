/**
 * Addresses from before Settings held the admin pages (emails, notifications, bookmarks, the desktop app's tray,
 * redirects from the server) and where they live now. Pure, so the tests cover every one.
 */

/** The admin app's pages (/admin/<tab>) → Settings sections (or another page). */
export const ADMIN_TABS: Record<string, string> = {
	"": "/settings/status",
	overview: "/settings/status",
	models: "/settings/models",
	subscriptions: "/settings/subscriptions",
	apps: "/settings/apps",
	voice: "/settings/voice",
	web: "/settings/web-reading",
	memory: "/settings/memory",
	compare: "/settings/models/compare",
	usage: "/settings/usage",
	approvals: "/settings/approvals",
	activity: "/activity?view=log",
	people: "/settings/people",
	roles: "/settings/roles",
	signin: "/settings/sign-in-options",
	computers: "/settings/computers",
	tailscale: "/settings/network",
	account: "/settings/sign-in-security",
	devices: "/settings/sign-in-security#sessions",
	backups: "/settings/backups",
	about: "/settings/about",
};

/** The web app's old Settings tabs (/settings?tab=…). */
const SETTINGS_TABS: Record<string, string> = {
	profile: "profile",
	appearance: "appearance",
	notifications: "notifications",
	browser: "browser-extension",
	computer: "this-computer",
};

/** Joins a target that may carry its own query and hash with the query (and hash) the old address had. */
function withQuery(target: string, params: URLSearchParams, hash: string): string {
	const [beforeHash, targetHash = ""] = target.split("#", 2) as [string, string?];
	const [path, targetQuery = ""] = beforeHash.split("?", 2) as [string, string?];
	const merged = new URLSearchParams(targetQuery);
	for (const [k, v] of params) if (!merged.has(k)) merged.append(k, v);
	const query = merged.toString();
	const fragment = targetHash ? `#${targetHash}` : hash && hash !== "#" ? hash : "";
	return `${path}${query ? `?${query}` : ""}${fragment}`;
}

/**
 * Where an old address goes now, or null when it's current. Keeps the query (the server's `signin_error`,
 * `sso_linked`…) and the hash.
 */
export function redirectFor(pathname: string, search = "", hash = ""): string | null {
	const path = pathname.replace(/\/+$/, "") || "/";
	const params = new URLSearchParams(search);

	// The admin app (/admin, /admin/<tab>): every page is a Settings section now. Unknown pages go to Status
	// (Settings sends people who can't open it to their own first section).
	if (path === "/admin" || path.startsWith("/admin/")) {
		const tab = path.slice("/admin".length).replace(/^\//, "").split("/")[0] ?? "";
		return withQuery(ADMIN_TABS[tab] ?? "/settings/status", params, hash);
	}

	// /apps was the web app's link into the admin app's Apps & skills and Subscriptions.
	if (path === "/apps") {
		const tab = params.get("tab");
		params.delete("tab");
		return withQuery(tab === "subscriptions" ? "/settings/subscriptions" : "/settings/apps", params, hash);
	}

	// /settings?tab=… and the desktop app's /settings#this-computer.
	if (path === "/settings") {
		const tab = params.get("tab");
		const fromHash = hash.replace(/^#/, "");
		const section = (tab && SETTINGS_TABS[tab]) ?? (fromHash === "this-computer" ? "this-computer" : null);
		if (tab !== null) params.delete("tab");
		if (section) return withQuery(`/settings/${section}`, params, fromHash === "this-computer" ? "" : hash);
		if (tab !== null) return withQuery("/settings", params, hash);
	}

	return null;
}

/** An in-app path from outside (a notification, the tray, a deep link): where it goes now. */
export function currentPath(path: string): string {
	try {
		const url = new URL(path, "http://sekai.invalid");
		return redirectFor(url.pathname, url.search, url.hash) ?? path;
	} catch {
		return path;
	}
}
