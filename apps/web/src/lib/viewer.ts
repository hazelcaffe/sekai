import { desktop, mobile, useAuth } from "@sekai/client";
import type { Viewer } from "./access.ts";

/** Who's looking, and in which app (for which Settings sections and controls they see). */
export function useViewer(): Viewer {
	const { data: auth } = useAuth();
	return {
		access: auth?.access,
		desktopApp: Boolean(desktop?.localComputer),
		phoneApp: Boolean(mobile),
		session: auth?.via === "session",
	};
}
