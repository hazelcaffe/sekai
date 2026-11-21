import { isDesktop } from "./desktop.ts";
import { isMobileApp } from "./mobile.ts";

/**
 * Whether Sekai is running as an app rather than in a browser tab: the desktop app, the phone apps, or Sekai installed
 * from the browser (a home-screen or desktop web app). Places that offer to get the apps hide their entry then.
 */
export function runningAsApp(): boolean {
	if (isDesktop || isMobileApp) return true;
	if (typeof window === "undefined") return false;
	const standalone = ["standalone", "fullscreen", "minimal-ui", "window-controls-overlay"].some(
		(mode) => window.matchMedia?.(`(display-mode: ${mode})`).matches,
	);
	return standalone || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}
