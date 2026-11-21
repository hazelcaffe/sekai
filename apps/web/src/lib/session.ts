import { api, queryClient } from "@sekai/client";
import { disablePush } from "./notifications.ts";

/** Signs out of this browser: its push subscription goes too (with message previews), then the sign-in page. */
export async function signOut(): Promise<void> {
	await disablePush().catch(() => {});
	await api.auth.logout().catch(() => {});
	queryClient.clear();
	location.assign("/");
}
