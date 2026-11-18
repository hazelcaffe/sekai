import type { MobileFcmConfig, MobilePushToken } from "@sekai/shared";

/**
 * Bridge exposed by the iOS and Android apps (apps/mobile/shared/bridge.js) to the Sekai server's own pages.
 * Undefined in a normal browser.
 */
export interface SekaiMobile {
	platform: "android" | "ios";
	/** The app's version, e.g. "1.0.0". */
	version: string;
	/** Server origin the app connects to. */
	serverUrl: string;
	/** A system notification (the app shows it only while it isn't in front). */
	notify(
		title: string,
		body: string,
		data: { conversationId?: string | null; approval?: { toolCallId: string; alwaysAsk: boolean } | null },
	): void;
	/** The number on the app icon (iOS; Android launchers count notifications themselves). */
	setBadge(count: number): void;
	/** A notification or link was opened: go to this path. */
	onNavigate(callback: (path: string) => void): () => void;
	/** The app's own screen for switching servers. */
	openSettings(): void;
	/** Opens an http(s) address in the system browser. */
	openExternal(url: string): void;
	push: {
		/** Asks for permission if needed and returns this device's push address. Throws with a reason. */
		register(config: { fcm: MobileFcmConfig | null }): Promise<MobilePushToken>;
		/** The push address, if push was turned on before (never asks). */
		current(config: { fcm: MobileFcmConfig | null }): Promise<MobilePushToken | null>;
		/** Forgets the push address on this device. */
		unregister(): Promise<void>;
		/** Whether the app may show notifications. */
		permission(): Promise<"granted" | "denied" | "prompt">;
		/** Asks to show notifications (local ones too, without push); resolves with the answer. */
		requestPermission(): Promise<"granted" | "denied">;
		/** The push address changed (the page tells the server again). */
		onToken(callback: (token: MobilePushToken) => void): () => void;
	};
	/**
	 * Signs in through the system browser (passkeys, Google and other single sign-on don't work inside apps). With a
	 * provider id it goes straight to that provider. Resolves once the browser is open; the app reloads signed in.
	 */
	signInWithBrowser(options?: { provider?: string | null }): Promise<void>;
}

declare global {
	interface Window {
		sekaiMobile?: SekaiMobile;
	}
}

export const mobile: SekaiMobile | undefined = typeof window !== "undefined" ? window.sekaiMobile : undefined;
export const isMobileApp = Boolean(mobile);
