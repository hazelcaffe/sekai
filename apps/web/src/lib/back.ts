import { mobile } from "@sekai/client";
import { useIsPhone } from "@sekai/ui";
import { useCallback, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router";

/*
 * Going back. The web app owns navigation; the phone apps own the gestures (DESIGN.md "The phone apps' bridge"):
 * the page reports what back would do (backState), and the app calls window.__sekaiBack() when a back gesture
 * commits. On phones every screen has a parent (a chat sits over Chats, a setting over Settings), so a direct link
 * still goes back somewhere sensible.
 */

const TAB_ROOTS = new Set(["/", "/inbox", "/activity", "/library"]);

/** The tab-bar screens on phones (Chats, Needs you, Activity, Library): nothing to go back to from them. */
export function isTabRoot(pathname: string): boolean {
	return TAB_ROOTS.has(pathname.replace(/\/+$/, "") || "/");
}

/**
 * The screen under this one on a phone, or null on a tab-bar screen: a chat and a bot's list of sections over
 * Chats, a bot's section over its list, a Settings section over Settings, Settings over Chats (its button is
 * there), a sub-page over its section.
 */
export function parentOf(pathname: string): string | null {
	const path = pathname.replace(/\/+$/, "") || "/";
	if (isTabRoot(path) || path === "/welcome") return null;
	if (path.startsWith("/c/")) return "/";
	const parts = path.split("/").filter(Boolean);
	if (parts[0] === "bots" && parts.length <= 2) return "/";
	if (parts[0] === "settings" && parts.length === 1) return "/";
	if (parts.length <= 1) return "/";
	return `/${parts.slice(0, -1).join("/")}`;
}

/** Where this entry sits in the app's own history (react-router keeps it in history.state.idx; 0 = the first). */
export function historyIndex(): number {
	const state = window.history.state as { idx?: unknown } | null;
	return typeof state?.idx === "number" ? state.idx : 0;
}

/**
 * Back one screen: through history when there's an earlier screen in the app, else up to `parent` (replacing this
 * entry, so a direct link builds its stack instead of piling one up). In-page back buttons use this, not a link.
 */
export function useGoBack(): (parent: string) => void {
	const navigate = useNavigate();
	return useCallback(
		(parent: string) => {
			if (historyIndex() > 0) navigate(-1);
			else navigate(parent, { replace: true });
		},
		[navigate],
	);
}

// ---------------------------------------------------------------- overlays

/** Overlays that aren't Radix layers (a docked side panel, a full-screen takeover), newest last. */
const layers: { id: number; close: () => void }[] = [];
let layerSeq = 0;
const layerListeners = new Set<() => void>();

/**
 * Registers something back should close first while `open` (a docked side panel, a takeover). Dialogs, sheets,
 * menus and popovers from @sekai/ui are found on their own.
 */
export function useBackLayer(open: boolean, close: () => void): void {
	const ref = useRef(close);
	ref.current = close;
	useEffect(() => {
		if (!open) return;
		const id = ++layerSeq;
		layers.push({ id, close: () => ref.current() });
		for (const l of layerListeners) l();
		return () => {
			const i = layers.findIndex((x) => x.id === id);
			if (i >= 0) layers.splice(i, 1);
			for (const l of layerListeners) l();
		};
	}, [open]);
}

/** Open Radix layers: dialogs and sheets, alert dialogs, menus, and popovers or selects (not tooltips). */
const RADIX_OPEN =
	'[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"][data-state="open"], [role="listbox"][data-state="open"], [data-radix-popper-content-wrapper]:not(:has([role="tooltip"]))';

function radixOverlayOpen(): boolean {
	try {
		return Boolean(document.querySelector(RADIX_OPEN));
	} catch {
		// :has() isn't supported: count tooltips too rather than miss a menu.
		return Boolean(
			document.querySelector(
				'[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"][data-state="open"], [data-radix-popper-content-wrapper]',
			),
		);
	}
}

export function overlayOpen(): boolean {
	return radixOverlayOpen() || layers.length > 0;
}

/** Closes the topmost overlay: a Radix layer (they're always on top) through Escape, else the newest other one. */
export function closeTopOverlay(): boolean {
	if (radixOverlayOpen()) {
		const target = document.activeElement ?? document.body;
		target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
		return true;
	}
	const top = layers.at(-1);
	if (!top) return false;
	top.close();
	return true;
}

// ---------------------------------------------------------------- the phone apps

/**
 * Wires the phone apps' back gesture: window.__sekaiBack() closes the topmost overlay or goes back one screen (and
 * says whether it did), and backState() tells the app, whenever it changes, whether there's anything to do.
 */
export function usePhoneAppBack(): void {
	const navigate = useNavigate();
	const goBack = useGoBack();
	const { pathname } = useLocation();
	const phone = useIsPhone();
	const canGoBack = phone ? parentOf(pathname) !== null : historyIndex() > 0;
	const state = useRef({ pathname, canGoBack, phone });
	state.current = { pathname, canGoBack, phone };

	useEffect(() => {
		window.__sekaiBack = () => {
			if (closeTopOverlay()) return true;
			const { pathname: path, phone: isPhone } = state.current;
			const parent = parentOf(path);
			if (isPhone && parent) {
				goBack(parent);
				return true;
			}
			if (!isPhone && historyIndex() > 0) {
				navigate(-1);
				return true;
			}
			return false;
		};
		return () => {
			window.__sekaiBack = undefined;
		};
	}, [goBack, navigate]);

	// Reports again when the screen changes (canGoBack), and whenever an overlay opens or closes.
	const reportNow = useRef<(() => void) | null>(null);
	useEffect(() => {
		if (canGoBack !== undefined) reportNow.current?.();
	}, [canGoBack]);
	useEffect(() => {
		const report = mobile?.backState;
		if (!report) return;
		let last = "";
		let frame = 0;
		const send = () => {
			frame = 0;
			const next = { overlay: overlayOpen(), canGoBack: state.current.canGoBack };
			const key = `${next.overlay}|${next.canGoBack}`;
			if (key === last) return;
			last = key;
			try {
				report.call(mobile, next);
			} catch {}
		};
		const schedule = () => {
			if (!frame) frame = requestAnimationFrame(send);
		};
		send();
		reportNow.current = schedule;
		const mo = new MutationObserver(schedule);
		mo.observe(document.body, {
			childList: true,
			subtree: true,
			attributes: true,
			attributeFilter: ["data-state"],
		});
		layerListeners.add(schedule);
		return () => {
			mo.disconnect();
			layerListeners.delete(schedule);
			reportNow.current = null;
			if (frame) cancelAnimationFrame(frame);
		};
	}, []);
}
