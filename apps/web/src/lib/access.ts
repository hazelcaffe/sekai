import type { Access, Permission } from "@sekai/shared";

/**
 * Who may open a part of the app (a Settings section, a bot's section), in one place for navigation, search and the
 * sections themselves. The server checks every request either way; this only decides what's shown.
 *
 * - "everyone": anyone signed in.
 * - "admin": admins only.
 * - a permission: admins, and people whose role has it.
 * - a list of permissions: admins, and people whose role has any of them.
 */
export type Who = "everyone" | "admin" | Permission | Permission[];

/** Where the app runs: the desktop app can lend this computer, the phone apps have their own server screen. */
export interface Viewer {
	access: Access | null | undefined;
	/** The desktop app, with the bridge that lends this computer to bots. */
	desktopApp?: boolean;
	/** The iPhone or Android app. */
	phoneApp?: boolean;
	/** Signed in with a session (not an API token): Sign out applies. */
	session?: boolean;
}

/** Whether this person may use a feature: admins may do everything. */
export function can(access: Access | null | undefined, permission: Permission): boolean {
	if (!access) return false;
	return access.admin || access.permissions.includes(permission);
}

/** Whether `who` lets this person in. Without access info (it shouldn't happen when signed in) only "everyone". */
export function allows(who: Who, access: Access | null | undefined): boolean {
	if (who === "everyone") return true;
	if (!access) return false;
	if (access.admin) return true;
	if (who === "admin") return false;
	const list = Array.isArray(who) ? who : [who];
	return list.some((p) => access.permissions.includes(p));
}
