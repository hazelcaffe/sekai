import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";

export function useMediaQuery(query: string): boolean {
	const subscribe = useCallback(
		(cb: () => void) => {
			const mql = matchMedia(query);
			mql.addEventListener("change", cb);
			return () => mql.removeEventListener("change", cb);
		},
		[query],
	);
	return useSyncExternalStore(
		subscribe,
		() => matchMedia(query).matches,
		() => false,
	);
}

/**
 * Layout tiers:
 * - phone: < 640px (phones, folded covers). Drawer sidebar, full-screen sheets.
 * - tablet: 640–1023px (tablets, unfolded foldables, phones in landscape). Icon rail sidebar, overlay panels.
 * - desktop: ≥ 1024px. Full sidebar.
 * - wide: ≥ 1280px. Agent details docked as a third column.
 */
export function useLayout() {
	const sm = useMediaQuery("(min-width: 640px)");
	const lg = useMediaQuery("(min-width: 1024px)");
	const xl = useMediaQuery("(min-width: 1280px)");
	const touch = useMediaQuery("(pointer: coarse)");
	const spanned = useMediaQuery("(horizontal-viewport-segments: 2)");
	return {
		phone: !sm && !spanned,
		tablet: sm && !lg,
		desktop: lg,
		wide: xl,
		touch,
		/** Dual-screen device spanned across both screens: list on one, chat on the other. */
		spanned,
	};
}

export function useHotkey(
	combo: string,
	handler: (e: KeyboardEvent) => void,
	opts: { enabled?: boolean; allowInInputs?: boolean } = {},
): void {
	const ref = useRef(handler);
	ref.current = handler;
	useEffect(() => {
		if (opts.enabled === false) return;
		const parts = combo.toLowerCase().split("+");
		const key = parts.at(-1);
		const needMod = parts.includes("mod");
		const needShift = parts.includes("shift");
		const needAlt = parts.includes("alt");
		const onKey = (e: KeyboardEvent) => {
			const mod = e.metaKey || e.ctrlKey;
			if (needMod !== mod || needShift !== e.shiftKey || needAlt !== e.altKey) return;
			if (e.key.toLowerCase() !== key) return;
			const target = e.target as HTMLElement | null;
			const inInput = target?.closest("input, textarea, [contenteditable=true]");
			if (inInput && !opts.allowInInputs && !needMod) return;
			e.preventDefault();
			ref.current(e);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [combo, opts.enabled, opts.allowInInputs]);
}

export function useAutosize(ref: RefObject<HTMLTextAreaElement | null>, value: string, maxPx = 320): void {
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-measure whenever the text changes
	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		el.style.height = "0px";
		el.style.height = `${Math.min(el.scrollHeight, maxPx)}px`;
		el.style.overflowY = el.scrollHeight > maxPx ? "auto" : "hidden";
	}, [ref, value, maxPx]);
}

/**
 * Keeps a scroll container pinned to the bottom while new content streams in, unless the reader scrolled up.
 * Give the container `ref={attach}`: the container can appear after the first render (a chat that was still
 * loading), and the hook has to see it when it does.
 */
export function useStickToBottom(ref: RefObject<HTMLElement | null>, deps: unknown[]) {
	const pinned = useRef(true);
	const [atBottom, setAtBottom] = useState(true);
	const [el, setEl] = useState<HTMLElement | null>(null);
	const attach = useCallback(
		(node: HTMLElement | null) => {
			ref.current = node;
			setEl(node);
		},
		[ref],
	);
	useEffect(() => {
		if (!el) return;
		// A container that just appeared starts at the newest message.
		pinned.current = true;
		el.scrollTop = el.scrollHeight;
		setAtBottom(true);
		const onScroll = () => {
			const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
			pinned.current = distance < 80;
			setAtBottom(distance < 80);
		};
		el.addEventListener("scroll", onScroll, { passive: true });
		return () => el.removeEventListener("scroll", onScroll);
	}, [el]);
	// Re-runs when the container appears and whenever the callers' values (what changes the content height) do.
	useLayoutEffect(() => {
		if (el && pinned.current) el.scrollTop = el.scrollHeight;
	}, [el, ...deps]);
	const scrollToBottom = useCallback(
		(smooth = true) => {
			const el = ref.current;
			if (!el) return;
			pinned.current = true;
			el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
		},
		[ref],
	);
	return { atBottom, scrollToBottom, attach };
}

export function useNow(intervalMs = 30_000): number {
	const [now, setNow] = useState(Date.now());
	useEffect(() => {
		const t = setInterval(() => setNow(Date.now()), intervalMs);
		return () => clearInterval(t);
	}, [intervalMs]);
	return now;
}

/** Long-press for touch screens (opens message menus where there's no hover or right-click). */
export function useLongPress(onLongPress: () => void, ms = 450) {
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const clear = () => {
		if (timer.current) clearTimeout(timer.current);
		timer.current = null;
	};
	return {
		onTouchStart: () => {
			clear();
			timer.current = setTimeout(() => {
				navigator.vibrate?.(10);
				onLongPress();
			}, ms);
		},
		onTouchEnd: clear,
		onTouchMove: clear,
		onTouchCancel: clear,
	};
}
