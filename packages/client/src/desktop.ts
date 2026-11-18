import type { LocalComputerSettings } from "@sekai/shared";

/** This computer, as the desktop app sees it (lending it to bots). */
export interface LocalComputerInfo {
	settings: LocalComputerSettings;
	status: {
		state: "off" | "connecting" | "online" | "offline" | "problem";
		message: string | null;
		activeAgent: string | null;
	};
	computerName: string;
	platform: string;
	stopShortcut: string | null;
	/** The app has a token for the server (older apps don't say). */
	hasToken?: boolean;
	/** You said no in the confirmation dialog. */
	cancelled?: boolean;
}

/** Bridge exposed by the Electron preload script. Undefined in a normal browser. */
export interface SekaiDesktop {
	platform: string;
	version: string;
	/** Server origin the desktop app connects to. */
	serverUrl: string;
	notify(title: string, body: string, data: { conversationId?: string | null }): void;
	setBadge(count: number): void;
	onNavigate(callback: (path: string) => void): () => void;
	openSettings(): void;
	/** Missing in desktop apps older than this feature. */
	localComputer?: {
		get(): Promise<LocalComputerInfo>;
		/**
		 * Widening access (lending, another bot) opens a confirmation dialog on the computer. A token replaces the
		 * app's server token; undefined keeps it.
		 */
		set(
			patch: Partial<LocalComputerSettings>,
			token: string | null | undefined,
			names: Record<string, string>,
		): Promise<LocalComputerInfo>;
		onChange(callback: (info: LocalComputerInfo) => void): () => void;
	};
}

declare global {
	interface Window {
		sekaiDesktop?: SekaiDesktop;
	}
}

export const desktop: SekaiDesktop | undefined = typeof window !== "undefined" ? window.sekaiDesktop : undefined;
export const isDesktop = Boolean(desktop);
export const isMac =
	typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
