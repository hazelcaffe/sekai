import { useSyncExternalStore } from "react";

/**
 * Where the web app is running: in the iPhone or Android app (their bridge, window.sekaiMobile, says which) or a
 * browser. <html data-platform> drives the ios: and android: variants, so components adapt and screens don't fork.
 */
export type Platform = "ios" | "android" | "web";

const DEV_KEY = "sekai.platform";

function bridgePlatform(): Platform | null {
	if (typeof window === "undefined") return null;
	const p = (window as { sekaiMobile?: { platform?: unknown } }).sekaiMobile?.platform;
	return p === "ios" || p === "android" ? p : null;
}

/**
 * Sets <html data-platform> before the first render: the bridge's platform, else what the page already says (the
 * apps' bridge sets it at document start), else "web". With `dev`, `?platform=ios|android|web` in the address
 * previews another platform (remembered for the tab), for checking the variants in a browser.
 */
export function applyPlatform({ dev = false }: { dev?: boolean } = {}): Platform {
	const html = document.documentElement;
	let preview: string | null = null;
	if (dev) {
		try {
			const asked = new URLSearchParams(location.search).get("platform");
			if (asked) sessionStorage.setItem(DEV_KEY, asked);
			preview = sessionStorage.getItem(DEV_KEY);
		} catch {}
	}
	const current = html.dataset.platform;
	const platform: Platform =
		preview === "ios" || preview === "android" || preview === "web"
			? preview
			: (bridgePlatform() ?? (current === "ios" || current === "android" ? current : "web"));
	html.dataset.platform = platform;
	return platform;
}

export function currentPlatform(): Platform {
	if (typeof document === "undefined") return "web";
	const p = document.documentElement.dataset.platform;
	return p === "ios" || p === "android" ? p : "web";
}

/** The platform, for the few things CSS can't do (which icon a back button shows). */
export function usePlatform(): Platform {
	return useSyncExternalStore(
		(onChange) => {
			const mo = new MutationObserver(onChange);
			mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-platform"] });
			return () => mo.disconnect();
		},
		currentPlatform,
		() => "web",
	);
}

/** A media query, live. */
export function useMediaQuery(query: string): boolean {
	return useSyncExternalStore(
		(onChange) => {
			const mq = matchMedia(query);
			mq.addEventListener("change", onChange);
			return () => mq.removeEventListener("change", onChange);
		},
		() => matchMedia(query).matches,
		() => false,
	);
}

/** Phones: narrower than Tailwind's md (768px). Section layouts push pages and menus open as action sheets here. */
export const PHONE_QUERY = "(max-width: 47.99rem)";

export function useIsPhone(): boolean {
	return useMediaQuery(PHONE_QUERY);
}

/** A phone-sized touch screen: where menus open as an action sheet instead of a dropdown. */
export function useActionSheets(): boolean {
	return useMediaQuery(`${PHONE_QUERY} and (pointer: coarse)`);
}
