import { ChevronRight, Ellipsis } from "lucide-react";
import { createContext, type ReactNode, useContext, useId, useState } from "react";
import { cn } from "../lib/utils.ts";
import { Switch as SwitchPrimitive } from "../shadcn/switch.tsx";
import { IconButton } from "./button.tsx";
import { Select, type SelectOption } from "./form.tsx";
import { Link } from "./link.tsx";
import { IconTile, type Tone } from "./misc.tsx";
import {
	ContextMenu,
	DropdownContent,
	DropdownEntries,
	DropdownMenu,
	DropdownTrigger,
	type MenuEntry,
} from "./overlay.tsx";
import { usePageStyle } from "./page-style.tsx";

// ---------------------------------------------------------------- Section

/** How deep a Section sits inside others (nested ones get smaller headings). */
const SectionDepth = createContext(0);

/** Sections inside this get the smaller, nested headings (for a titled block that isn't a Section itself). */
export function SectionNesting({ children }: { children: ReactNode }) {
	const depth = useContext(SectionDepth);
	return <SectionDepth.Provider value={depth + 1}>{children}</SectionDepth.Provider>;
}

export interface SectionProps {
	title?: ReactNode;
	/** One line, at most about 90 characters. Longer explanations go in a Fold ("Learn more"). */
	description?: ReactNode;
	/** One action on the right (a small button, or a menu). */
	action?: ReactNode;
	/** Beside the title: a SaveState for settings that save themselves. */
	saveState?: ReactNode;
	children: ReactNode;
	className?: string;
	/** An icon in a small tile beside the title (in panels; a page's sections don't show it). */
	icon?: ReactNode;
	id?: string;
}

/** A titled block in a page: title, an optional one-line description, an optional action on the right. */
export function Section({ title, description, action, saveState, children, className, icon, id }: SectionProps) {
	const depth = useContext(SectionDepth);
	const style = usePageStyle();
	const headingId = useId();
	// Top-level sections of a page get section headings; nested ones and those in a panel, body-sized ones.
	const big = style === "page" && depth === 0;
	const Heading = big ? "h2" : "h3";
	return (
		<section
			id={id}
			aria-labelledby={title ? headingId : undefined}
			className={cn("flex flex-col", big ? "gap-3" : "gap-2.5", className)}
		>
			{(title || action) && (
				<div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
					<div className="flex min-w-0 flex-1 basis-56 items-center gap-2.5">
						{icon && !big && (
							<IconTile size="sm" tone="neutral">
								{icon}
							</IconTile>
						)}
						<div className="min-w-0 flex-1">
							{title && (
								<div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5">
									<Heading
										id={headingId}
										className={cn("font-semibold text-fg", big ? "text-heading" : "text-body")}
									>
										{title}
									</Heading>
									{saveState}
								</div>
							)}
							{description && (
								<p className="mt-0.5 text-small text-pretty text-fg-muted">{description}</p>
							)}
						</div>
					</div>
					{action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
				</div>
			)}
			<SectionDepth.Provider value={depth + 1}>{children}</SectionDepth.Provider>
		</section>
	);
}

// ---------------------------------------------------------------- List and Row

/** Rows inside a List get its padding and hairlines between them; outside one they're plain. */
const InList = createContext(false);

/**
 * Any list of things or settings: an inset group (a rounded surface with hairlines between rows) on the web and
 * iOS; on Android, Material 3's flat list, edge to edge in a page. Put Rows in it (Row, ToggleRow, SelectRow, or
 * anything wrapped in a Row).
 */
export function List({
	children,
	className,
	label,
}: {
	children: ReactNode;
	className?: string;
	/** What the list is, for screen readers, when no Section title says it. */
	label?: string;
}) {
	return (
		<InList.Provider value={true}>
			{/* biome-ignore lint/a11y/useSemanticElements: rows are divs and labels (a <ul> would need <li>s) */}
			<div
				role="list"
				aria-label={label}
				data-slot="list"
				className={cn(
					"overflow-hidden rounded-lg border border-border bg-surface",
					"android:-mx-(--page-px) android:rounded-none android:border-0 android:bg-transparent",
					className,
				)}
			>
				{children}
			</div>
		</InList.Provider>
	);
}

/**
 * Row heights: 36 with a mouse (40 with a second line), 48 on touch screens (56), 44pt on iOS, and Material 3's 56
 * (72) on Android.
 */
/** A quiet "…": with a mouse it shows on hover, keyboard focus or while open; on touch screens touch and hold. */
const QUIET =
	"transition-opacity duration-fast fine:opacity-0 fine:group-hover/row:opacity-100 fine:group-has-[:focus-visible]/row:opacity-100 fine:has-[[data-state=open]]:opacity-100 coarse:sr-only coarse:has-[:focus-visible]:not-sr-only";
const ONE_LINE = "min-h-9 coarse:min-h-12 ios:min-h-11 android:min-h-14";
const TWO_LINES = "min-h-10 coarse:min-h-14 ios:min-h-11 android:min-h-18";
/** Android's lists lead with a plain icon, not a tinted tile. */
const ANDROID_ICON = "android:size-6 android:bg-transparent android:[&_svg]:size-6";

export interface RowProps {
	/** An avatar, a brand tile or anything else that leads the row. For a plain icon use `icon`. */
	leading?: ReactNode;
	/** An icon, shown in a small tinted tile. */
	icon?: ReactNode;
	iconTone?: Tone;
	title: ReactNode;
	/** One muted line under the title. */
	subtitle?: ReactNode;
	/** A value on the right, in muted text ("Haiku 4.5", "3 bots"). */
	value?: ReactNode;
	/** A Badge (or StatusDot) on the right. */
	badge?: ReactNode;
	/** Controls on the right: a Switch, a button, a Select. */
	trailing?: ReactNode;
	/** A chevron: the row opens something. On by default for rows with `href`. */
	chevron?: boolean;
	/** A "…" button with these entries; right-click and touch-and-hold open the same menu. */
	menu?: MenuEntry[];
	menuLabel?: string;
	/**
	 * always (default): the "…" button is always there. hover, for dense lists like the chat list and for rows that
	 * open their details (which hold the same actions) beside a switch: with a mouse it shows on hover, keyboard
	 * focus or while its menu is open, over the row's end (taking no room) or beside the control; on touch screens
	 * touch and hold opens the menu, and the button is there only for screen readers and keyboards.
	 */
	menuButton?: "always" | "hover";
	/** A link row: the whole row opens it. */
	href?: string;
	/** A button row: the whole row does it. */
	onClick?: () => void;
	/**
	 * An expandable row: what it shows under itself when opened. The whole row is then the button that opens and
	 * closes it (with a turning chevron); `open` and `onOpenChange` control it, else it keeps its own state.
	 */
	details?: ReactNode;
	open?: boolean;
	defaultOpen?: boolean;
	onOpenChange?: (open: boolean) => void;
	/** Destructive (the title in danger ink). */
	danger?: boolean;
	disabled?: boolean;
	/** The current item in a list that picks one. */
	selected?: boolean;
	/** On narrow screens, put the trailing controls on their own line under the text. */
	wrap?: boolean;
	className?: string;
	/** Extra content under the subtitle (for example a progress bar). */
	children?: ReactNode;
}

/**
 * One row: leading (icon or avatar), title, one optional muted line, and on the right a value, a badge, controls,
 * a chevron or a menu. Link and button rows are tappable as a whole; an expandable row (`details`) opens to show
 * more under itself. Heights: 36 with a mouse, 44 on iOS, 48 on touch screens and 56 on Android (each more with a
 * second line); no chevron on Android.
 */
export function Row({
	leading,
	icon,
	iconTone = "neutral",
	title,
	subtitle,
	value,
	badge,
	trailing,
	chevron,
	menu,
	menuLabel,
	menuButton = "always",
	href,
	onClick,
	details,
	open: openProp,
	defaultOpen = false,
	onOpenChange,
	danger,
	disabled,
	selected,
	wrap,
	className,
	children,
}: RowProps) {
	const inList = useContext(InList);
	const detailsId = useId();
	const [openState, setOpenState] = useState(defaultOpen);
	const expandable = details != null;
	const open = expandable && (openProp ?? openState);
	const toggle = () => {
		setOpenState(!open);
		onOpenChange?.(!open);
	};
	const interactive = Boolean(href || onClick || expandable) && !disabled;
	const showChevron = !expandable && (chevron ?? Boolean(href));
	const quietMenu = menu && menuButton === "hover";
	// A quiet menu beside a control (a switch) takes its own place there instead of covering the control.
	const besideControl = Boolean(quietMenu && trailing != null);
	// On phones, a badge beside a menu or a control goes under the text, so the title keeps its room.
	const crowded = Boolean(menu && !quietMenu && (trailing || badge));
	const lead =
		leading ??
		(icon ? (
			<IconTile size="sm" tone={iconTone} className={ANDROID_ICON}>
				{icon}
			</IconTile>
		) : null);
	// The whole row is the link or button: its title stretches an invisible hit area over the row, so controls on
	// the right (which sit above it) stay separately tappable.
	const stretch =
		"outline-none after:absolute after:inset-0 after:z-0 focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-ring";
	const titleText = (
		<span className={cn("block text-body font-medium", danger ? "text-danger-ink" : "text-fg")}>{title}</span>
	);
	const titleNode = expandable ? (
		<button
			type="button"
			onClick={toggle}
			disabled={disabled}
			aria-expanded={open}
			aria-controls={detailsId}
			className={cn("w-full text-left", stretch)}
		>
			{titleText}
		</button>
	) : href ? (
		<Link href={href} className={stretch} aria-current={selected ? "page" : undefined}>
			{titleText}
		</Link>
	) : onClick ? (
		<button type="button" onClick={onClick} disabled={disabled} className={cn("text-left", stretch)}>
			{titleText}
		</button>
	) : (
		titleText
	);
	const menuNode = menu && (
		<DropdownMenu>
			<DropdownTrigger asChild>
				<IconButton
					label={menuLabel ?? "More"}
					size="icon-sm"
					className={cn(
						"-mr-1.5",
						quietMenu && !besideControl && "fine:bg-surface-2 fine:hover:bg-surface-3",
					)}
				>
					<Ellipsis />
				</IconButton>
			</DropdownTrigger>
			<DropdownContent title={menuLabel}>
				<DropdownEntries entries={menu} />
			</DropdownContent>
		</DropdownMenu>
	);
	const right = (value != null || badge || trailing || showChevron || expandable || (menu && !quietMenu)) && (
		<div
			className={cn(
				"relative z-10 flex shrink-0 items-center gap-2",
				wrap && "max-sm:w-full max-sm:basis-full max-sm:pb-1",
				!trailing && !(menu && !quietMenu) && "pointer-events-none",
			)}
		>
			{value != null && <span className="max-w-48 truncate text-body text-fg-muted">{value}</span>}
			{badge && (crowded ? <span className="flex max-sm:hidden">{badge}</span> : badge)}
			{trailing}
			{!quietMenu && menuNode}
			{besideControl && <div className={cn("flex", QUIET)}>{menuNode}</div>}
			{showChevron && <ChevronRight aria-hidden className="size-4 shrink-0 text-fg-subtle android:hidden" />}
			{expandable && (
				<ChevronRight
					aria-hidden
					className={cn(
						"size-4 shrink-0 text-fg-subtle transition-transform duration-fast",
						open && "rotate-90",
					)}
				/>
			)}
		</div>
	);
	// A quiet menu sits over the row's end: hidden until hover, keyboard focus or while it's open with a mouse;
	// on touch screens it's visually hidden (touch and hold opens the menu) but still reachable by keyboard.
	const quietMenuNode = quietMenu && !besideControl && (
		<div className={cn("absolute inset-y-0 right-2 z-10 flex items-center", QUIET)}>{menuNode}</div>
	);
	const line = (
		<>
			{lead && <div className="flex shrink-0 items-center py-2 pr-3">{lead}</div>}
			<div
				className={cn(
					"flex min-w-0 flex-1 items-center gap-x-3 py-2",
					subtitle ? TWO_LINES : ONE_LINE,
					"coarse:py-2.5",
					wrap && "flex-wrap gap-y-2",
					inList && "pr-4 group-not-first/row:border-t group-not-first/row:border-border",
				)}
			>
				<div className="min-w-0 flex-1 basis-40">
					{titleNode}
					{subtitle && <div className="mt-0.5 text-small text-fg-muted">{subtitle}</div>}
					{crowded && badge && <div className="mt-1 flex sm:hidden">{badge}</div>}
					{children}
				</div>
				{right}
			</div>
			{quietMenuNode}
		</>
	);
	const hover = interactive && !selected && "transition-colors duration-fast hover:bg-surface-2 active:bg-surface-2";
	const row = expandable ? (
		<div
			role={inList ? "listitem" : undefined}
			data-slot="row"
			data-state={open ? "open" : "closed"}
			aria-disabled={disabled || undefined}
			className={cn("group/row flex flex-col text-left", disabled && "opacity-50", className)}
		>
			<div className={cn("relative flex items-stretch", inList && "pl-4", hover, selected && "bg-selected")}>
				{line}
			</div>
			{open && (
				<div
					id={detailsId}
					className={cn(
						"pt-1 pb-3 text-small animate-in fade-in-0 slide-in-from-top-1 duration-panel",
						inList && "px-4",
					)}
				>
					{details}
				</div>
			)}
		</div>
	) : (
		<div
			role={inList ? "listitem" : undefined}
			data-slot="row"
			aria-disabled={disabled || undefined}
			className={cn(
				"group/row relative flex items-stretch text-left",
				inList && "pl-4",
				hover,
				selected && "bg-selected",
				disabled && "opacity-50",
				className,
			)}
		>
			{line}
		</div>
	);
	return menu ? (
		<ContextMenu entries={menu} label={menuLabel}>
			{row}
		</ContextMenu>
	) : (
		row
	);
}

/** A Row with a switch: tapping anywhere on it flips the switch. Saves itself (see useAutosave). */
export function ToggleRow({
	title,
	description,
	checked,
	onCheckedChange,
	disabled,
	icon,
	leading,
	className,
}: {
	title: ReactNode;
	/** One muted line under the title. */
	description?: ReactNode;
	checked: boolean;
	onCheckedChange: (v: boolean) => void;
	disabled?: boolean;
	icon?: ReactNode;
	leading?: ReactNode;
	className?: string;
}) {
	const id = useId();
	const inList = useContext(InList);
	return (
		<label
			htmlFor={id}
			role={inList ? "listitem" : undefined}
			data-slot="row"
			className={cn(
				"group/row relative flex cursor-pointer items-stretch",
				inList && "pl-4 transition-colors duration-fast active:bg-surface-2",
				disabled && "cursor-default opacity-50",
				className,
			)}
		>
			{(leading ?? icon) && (
				<div className="flex shrink-0 items-center py-2 pr-3">
					{leading ?? (
						<IconTile size="sm" tone="neutral" className={ANDROID_ICON}>
							{icon}
						</IconTile>
					)}
				</div>
			)}
			<div
				className={cn(
					"flex min-w-0 flex-1 items-center gap-x-4 py-2 coarse:py-2.5",
					description ? TWO_LINES : ONE_LINE,
					inList && "pr-4 group-not-first/row:border-t group-not-first/row:border-border",
				)}
			>
				<div className="min-w-0 flex-1">
					<div className="text-body font-medium text-fg">{title}</div>
					{description && <div className="mt-0.5 text-small text-fg-muted">{description}</div>}
				</div>
				<SwitchPrimitive id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
			</div>
		</label>
	);
}

/** A Row with a choice on the right (its value and a chevron; a menu of options). Saves itself. */
export function SelectRow({
	title,
	description,
	value,
	onValueChange,
	options,
	disabled,
	icon,
	className,
}: {
	title: string;
	description?: ReactNode;
	value: string;
	onValueChange: (v: string) => void;
	options: SelectOption[];
	disabled?: boolean;
	icon?: ReactNode;
	className?: string;
}) {
	return (
		<Row
			icon={icon}
			title={title}
			subtitle={description}
			className={className}
			trailing={
				<Select
					variant="plain"
					size="sm"
					label={title}
					value={value}
					onValueChange={onValueChange}
					options={options}
					disabled={disabled}
					className="-mr-2"
				/>
			}
		/>
	);
}
