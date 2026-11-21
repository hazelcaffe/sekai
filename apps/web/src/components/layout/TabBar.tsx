import { cn, haptic } from "@sekai/client";
import { Activity, Inbox, Library, MessageCircle } from "lucide-react";
import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router";
import { useToastLift } from "../../lib/hooks.ts";
import { useNeedsYouCount } from "./Sidebar.tsx";

const TABS = [
	{ to: "/", label: "Chats", icon: MessageCircle },
	{ to: "/inbox", label: "Needs you", icon: Inbox },
	{ to: "/activity", label: "Activity", icon: Activity },
	{ to: "/library", label: "Library", icon: Library },
] as const;

/** Where each tab was last (its view and filters, like Activity's ?view=done&bot=…), to go back to it. */
const lastRoute = new Map<string, string>();

const isOn = (to: string, pathname: string) => (to === "/" ? pathname === "/" : pathname.startsWith(to));

/**
 * Phones: the bottom bar on the four top-level screens. An iOS tab bar (translucent, icon over label), Material 3's
 * navigation bar on Android (the pill behind the chosen icon). Switching tabs doesn't pile up history: back from a
 * tab leaves the app, as in native apps. Each tab opens where you left it (its view and filters).
 */
export function TabBar() {
	const { pathname, search } = useLocation();
	const navigate = useNavigate();
	const waiting = useNeedsYouCount();
	const ref = useToastLift<HTMLElement>();
	useEffect(() => {
		const tab = TABS.find((t) => isOn(t.to, pathname));
		if (tab) lastRoute.set(tab.to, `${pathname}${search}`);
	}, [pathname, search]);
	return (
		<nav
			ref={ref}
			aria-label="Sekai"
			className={cn(
				"z-sticky flex shrink-0 border-t border-border pb-safe px-safe",
				"bg-bg/85 backdrop-blur-xl",
				"android:border-transparent android:bg-surface-2 android:backdrop-blur-none",
			)}
		>
			{TABS.map(({ to, label, icon: Icon }) => {
				const active = isOn(to, pathname);
				const badge = to === "/inbox" && waiting > 0 ? waiting : 0;
				return (
					<button
						key={to}
						type="button"
						aria-current={active ? "page" : undefined}
						aria-label={badge ? `${label}, ${badge} waiting` : label}
						onClick={() => {
							if (active) {
								// Again on the tab you're on: back to its top.
								document
									.querySelector('main [data-scroll-root], main [data-slot="page"]')
									?.scrollTo({ top: 0, behavior: "smooth" });
								return;
							}
							haptic("selection");
							navigate(lastRoute.get(to) ?? to, { replace: true });
						}}
						className={cn(
							"group relative flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl pt-1 pb-0.5 -outline-offset-2",
							"h-[50px] android:h-20 android:gap-1 android:pt-3 android:pb-4",
							active ? "text-brand-ink" : "text-fg-subtle",
							"android:text-fg-muted",
						)}
					>
						<span
							className={cn(
								"relative flex items-center justify-center",
								"android:h-8 android:w-16 android:rounded-full android:transition-colors android:duration-fast",
								active && "android:bg-brand-soft android:text-brand-ink",
							)}
						>
							<Icon className="size-6" strokeWidth={active ? 2.25 : 1.75} aria-hidden />
							{badge > 0 && (
								<span className="absolute -top-1 left-1/2 ml-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-danger px-1 text-caption font-semibold text-danger-foreground tabular-nums android:ml-2">
									{badge > 99 ? "99+" : badge}
								</span>
							)}
						</span>
						<span
							className={cn(
								"max-w-full truncate px-1 text-caption",
								active ? "font-semibold" : "font-medium",
								active && "android:text-fg",
							)}
						>
							{label}
						</span>
					</button>
				);
			})}
		</nav>
	);
}
