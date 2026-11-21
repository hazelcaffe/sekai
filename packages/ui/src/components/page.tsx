import { ArrowLeft, ChevronLeft } from "lucide-react";
import { createContext, type ReactNode, type Ref, useContext, useEffect, useRef, useState } from "react";
import { usePlatform } from "../lib/platform.ts";
import { cn } from "../lib/utils.ts";
import { InPageBar } from "../shadcn/button.tsx";
import { Link } from "./link.tsx";
import { PageStyleProvider } from "./page-style.tsx";

/** Set by SectionLayout: on wide screens its rail is the way back from a section's own page (back.phoneOnly). */
export const InSectionLayout = createContext(false);

export interface PageBack {
	/** Where back goes (through the app's router, see LinkProvider). */
	href?: string;
	/** Or what back does. */
	onClick?: () => void;
	/** The previous screen's title, shown beside the chevron on iOS ("‹ Settings") and in the link above the title. */
	label?: string;
	/**
	 * Only on phones: a section's own page inside a SectionLayout, whose rail is the way back from tablets up. Pages
	 * deeper than the rail's item (a person, a note) leave it off and show "‹ People" above their title everywhere.
	 */
	phoneOnly?: boolean;
}

export type PageWidth = "form" | "wide" | "full";

/** A form page sits in the wide frame too, its parts no wider than a form, so every page's title starts at one x. */
const widths: Record<PageWidth, string> = { form: "max-w-wide *:max-w-form", wide: "max-w-wide", full: "" };

export interface PageProps {
	title: ReactNode;
	/** One line under the title. */
	description?: ReactNode;
	/** One primary action at most; the rest in an overflow menu. On phones they become the bar's own buttons. */
	actions?: ReactNode;
	back?: PageBack;
	/** Something to lead the phone bar instead of back (the menu button that opens the sidebar). */
	leading?: ReactNode;
	/**
	 * form: 720px, for settings and forms. wide: 1080px, for lists and dashboards. full: the whole width. Form and wide
	 * pages share one left edge (a form page is the left part of the wide frame), so titles don't jump between them.
	 */
	width?: PageWidth;
	/**
	 * self (default): the page scrolls inside its own box (in an app shell that fills the screen). document: the
	 * window scrolls (a page in a plain document).
	 */
	scroll?: "self" | "document";
	children: ReactNode;
	className?: string;
}

/**
 * Every screen except a chat: title, one-line description, actions, back. Handles safe areas, padding (16 on
 * phones, 24 on tablets, 32 on desktops), scrolling and the phone header: a large title that shrinks into the bar
 * as you scroll (iOS and the web on phones), Material 3's top app bar with the title in it (Android).
 */
export function Page({
	title,
	description,
	actions,
	back,
	leading,
	width = "form",
	scroll = "self",
	children,
	className,
}: PageProps) {
	const platform = usePlatform();
	const inSections = useContext(InSectionLayout);
	const box = useRef<HTMLDivElement>(null);
	const heading = useRef<HTMLHeadingElement>(null);
	const top = useRef<HTMLDivElement>(null);
	const [titleGone, setTitleGone] = useState(false);
	const [scrolled, setScrolled] = useState(false);
	useEffect(() => {
		const root = scroll === "self" ? box.current : null;
		const watch = (el: Element | null, set: (v: boolean) => void, margin: string) => {
			if (!el) return () => {};
			const io = new IntersectionObserver(([e]) => set(!e?.isIntersecting), { root, rootMargin: margin });
			io.observe(el);
			return () => io.disconnect();
		};
		const a = watch(heading.current, setTitleGone, "-56px 0px 0px 0px");
		const b = watch(top.current, setScrolled, "0px");
		return () => {
			a();
			b();
		};
	}, [scroll]);

	const android = platform === "android";
	const backButton =
		back &&
		(android ? (
			<BackLink back={back} className="size-12">
				<ArrowLeft className="size-6" />
			</BackLink>
		) : (
			<BackLink back={back} className="h-11 gap-0.5 pr-2 pl-1 text-body text-brand-ink">
				<ChevronLeft className="size-6 shrink-0" />
				<span className="max-w-32 truncate">{back.label ?? "Back"}</span>
			</BackLink>
		));

	return (
		<PageStyleProvider value="page">
			<div
				ref={box}
				data-slot="page"
				className={cn(
					"flex flex-col",
					scroll === "self" && "min-h-0 flex-1 overflow-y-auto overscroll-contain scrollbar-thin",
					className,
				)}
			>
				{/* Phones: the bar. */}
				<header
					data-slot="page-bar"
					data-scrolled={scrolled || undefined}
					className={cn(
						"sticky top-0 z-sticky shrink-0 border-b pt-safe px-safe transition-colors duration-fast md:hidden",
						"bg-bg/85 backdrop-blur-xl",
						titleGone ? "border-border" : "border-transparent",
						android && "border-transparent bg-bg backdrop-blur-none data-scrolled:bg-surface-2",
					)}
				>
					<div className={cn("relative flex items-center gap-1 px-1", android ? "h-16" : "h-11")}>
						<div className="z-10 flex shrink-0 items-center">{leading ?? backButton}</div>
						<div
							aria-hidden
							className={cn(
								"min-w-0 truncate font-semibold text-fg transition-opacity duration-panel",
								android
									? cn("flex-1 text-title font-normal", leading || back ? "pl-1" : "pl-3")
									: "pointer-events-none absolute inset-x-24 text-center text-body",
								!android && (titleGone ? "opacity-100" : "opacity-0"),
							)}
						>
							{title}
						</div>
						{actions && (
							<div className="z-10 ml-auto flex shrink-0 items-center gap-0.5 pr-1">
								{/* The bar's own buttons: an icon or short text, never a filled button. */}
								<InPageBar.Provider value={android ? "android" : "ios"}>{actions}</InPageBar.Provider>
							</div>
						)}
					</div>
				</header>
				<div ref={top} aria-hidden className="h-0" />
				<div
					className={cn(
						"mx-auto flex w-full flex-col gap-8 px-(--page-px) pt-2 pb-safe-12 [--page-px:--spacing(4)] md:pt-8 md:[--page-px:--spacing(6)] lg:pt-10 lg:[--page-px:--spacing(8)]",
						widths[width],
					)}
				>
					<PageHeader
						title={title}
						description={description}
						actions={actions}
						headingRef={heading}
						back={back && !(inSections && back.phoneOnly) ? back : undefined}
						titleClassName={cn(android && "max-md:sr-only")}
					/>
					{children}
				</div>
			</div>
		</PageStyleProvider>
	);
}

function BackLink({ back, className, children }: { back: PageBack; className?: string; children: ReactNode }) {
	const base = cn(
		"flex items-center justify-center rounded-full outline-none transition-colors duration-fast hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-ring active:bg-surface-2",
		className,
	);
	const label = back.label ? `Back to ${back.label}` : "Back";
	if (back.href) {
		return (
			<Link href={back.href} aria-label={label} className={base}>
				{children}
			</Link>
		);
	}
	return (
		<button type="button" aria-label={label} onClick={back.onClick} className={base}>
			{children}
		</button>
	);
}

/**
 * A page's title block: the h1, its one-line description and actions (on the right from tablets up; on phones the
 * actions live in the bar). Page uses it; pages inside an older shell can use it alone.
 */
export function PageHeader({
	title,
	description,
	actions,
	back,
	headingRef,
	titleClassName,
	className,
}: {
	title: ReactNode;
	description?: ReactNode;
	actions?: ReactNode;
	/** A small "‹ Settings" link above the title, from tablets up. */
	back?: PageBack;
	headingRef?: Ref<HTMLHeadingElement>;
	titleClassName?: string;
	className?: string;
}) {
	return (
		<header data-slot="page-header" className={cn("flex flex-col gap-1", className)}>
			{back && (
				<div className="-mb-0.5 hidden md:block">
					{back.href ? (
						<Link
							href={back.href}
							className="inline-flex items-center gap-0.5 rounded-sm text-small font-medium text-brand-ink hover:underline"
						>
							<ChevronLeft className="size-4" />
							{back.label ?? "Back"}
						</Link>
					) : (
						<button
							type="button"
							onClick={back.onClick}
							className="inline-flex items-center gap-0.5 rounded-sm text-small font-medium text-brand-ink hover:underline"
						>
							<ChevronLeft className="size-4" />
							{back.label ?? "Back"}
						</button>
					)}
				</div>
			)}
			<div className="flex items-start justify-between gap-x-6 gap-y-3">
				<div className="min-w-0 flex-1">
					<h1
						ref={headingRef}
						data-page-title
						className={cn("text-title font-semibold tracking-tight text-fg ios:font-bold", titleClassName)}
					>
						{title}
					</h1>
					{description && <p className="mt-1 max-w-2xl text-body text-pretty text-fg-muted">{description}</p>}
				</div>
				{actions && <div className="hidden shrink-0 items-center gap-2 md:flex">{actions}</div>}
			</div>
		</header>
	);
}
