import { TriangleAlert } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "../lib/utils.ts";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogMedia,
	AlertDialogTitle,
} from "../shadcn/alert-dialog.tsx";
import {
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuLabel,
	ContextMenu as ContextMenuRoot,
	ContextMenuSeparator,
	ContextMenuShortcut,
	ContextMenuTrigger,
} from "../shadcn/context-menu.tsx";
import {
	DialogBody,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	Dialog as DialogRoot,
	DialogTitle,
} from "../shadcn/dialog.tsx";
import {
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenu as DropdownMenuRoot,
	DropdownMenuSeparator,
	DropdownMenuShortcut,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "../shadcn/dropdown-menu.tsx";
import { PopoverClose, PopoverContent, Popover as PopoverRoot, PopoverTrigger } from "../shadcn/popover.tsx";
import { SheetContent, SheetDescription, Sheet as SheetRoot, SheetTitle } from "../shadcn/sheet.tsx";

/**
 * Responsive dialog: a centered card on tablets/desktops, a bottom sheet with a grab handle on phones.
 */
export function Dialog({
	open,
	onOpenChange,
	title,
	description,
	children,
	footer,
	className,
	size = "md",
	icon,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: ReactNode;
	description?: ReactNode;
	children: ReactNode;
	footer?: ReactNode;
	className?: string;
	size?: "sm" | "md" | "lg" | "xl";
	/** Shown in a tinted tile beside the title. */
	icon?: ReactNode;
}) {
	const widths = { sm: "md:max-w-sm", md: "md:max-w-lg", lg: "md:max-w-2xl", xl: "md:max-w-4xl" };
	return (
		<DialogRoot open={open} onOpenChange={onOpenChange}>
			<DialogContent className={cn(widths[size], className)}>
				<DialogHeader className={cn(icon && "flex-row items-center gap-3")}>
					{icon && (
						<span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-brand/12 text-brand-ink [&_svg]:size-5">
							{icon}
						</span>
					)}
					<div className="min-w-0">
						<DialogTitle>{title}</DialogTitle>
						{description ? (
							<DialogDescription className="mt-1">{description}</DialogDescription>
						) : (
							<DialogDescription className="sr-only">{String(title)}</DialogDescription>
						)}
					</div>
				</DialogHeader>
				<DialogBody>{children}</DialogBody>
				{footer && <DialogFooter>{footer}</DialogFooter>}
			</DialogContent>
		</DialogRoot>
	);
}

/** Slide-over panel from the right (tablets) or full screen (phones). */
export function Sheet({
	open,
	onOpenChange,
	title,
	children,
	className,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	children: ReactNode;
	className?: string;
}) {
	return (
		<SheetRoot open={open} onOpenChange={onOpenChange}>
			<SheetContent side="right" className={className}>
				<SheetTitle className="sr-only">{title}</SheetTitle>
				<SheetDescription className="sr-only">{title}</SheetDescription>
				{children}
			</SheetContent>
		</SheetRoot>
	);
}

export function Confirm({
	open,
	onOpenChange,
	title,
	description,
	confirmLabel = "Confirm",
	danger,
	onConfirm,
	icon,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	description?: ReactNode;
	confirmLabel?: string;
	danger?: boolean;
	onConfirm: () => void;
	icon?: ReactNode;
}) {
	const media = icon ?? (danger ? <TriangleAlert /> : null);
	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					{media && (
						<AlertDialogMedia className={cn(danger && "bg-destructive/12 text-destructive")}>
							{media}
						</AlertDialogMedia>
					)}
					<AlertDialogTitle>{title}</AlertDialogTitle>
					{description && <AlertDialogDescription>{description}</AlertDialogDescription>}
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>Cancel</AlertDialogCancel>
					<AlertDialogAction variant={danger ? "danger" : "primary"} onClick={onConfirm}>
						{confirmLabel}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

export function Popover({
	trigger,
	children,
	align = "start",
	side = "bottom",
	className,
	open,
	onOpenChange,
}: {
	trigger: ReactNode;
	children: ReactNode;
	align?: "start" | "center" | "end";
	side?: "top" | "bottom" | "left" | "right";
	className?: string;
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
}) {
	return (
		<PopoverRoot open={open} onOpenChange={onOpenChange}>
			<PopoverTrigger asChild>{trigger}</PopoverTrigger>
			<PopoverContent align={align} side={side} className={cn("w-[min(340px,calc(100vw-24px))]", className)}>
				{children}
			</PopoverContent>
		</PopoverRoot>
	);
}

export { PopoverClose };

// ---------------------------------------------------------------- dropdown menu

export const DropdownMenu = DropdownMenuRoot;
export const DropdownTrigger = DropdownMenuTrigger;
export const DropdownSub = DropdownMenuSub;

export function DropdownContent({ align = "end", ...props }: ComponentProps<typeof DropdownMenuContent>) {
	return <DropdownMenuContent align={align} {...props} />;
}

export function DropdownItem({
	danger,
	icon,
	children,
	shortcut,
	...props
}: ComponentProps<typeof DropdownMenuItem> & { danger?: boolean; icon?: ReactNode; shortcut?: string }) {
	return (
		<DropdownMenuItem variant={danger ? "destructive" : "default"} {...props}>
			{icon}
			<span className="flex-1 truncate">{children}</span>
			{shortcut && <DropdownMenuShortcut>{shortcut}</DropdownMenuShortcut>}
		</DropdownMenuItem>
	);
}

export function DropdownSubTrigger({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
	return (
		<DropdownMenuSubTrigger>
			{icon}
			<span className="flex-1">{children}</span>
		</DropdownMenuSubTrigger>
	);
}

export function DropdownSubContent(props: ComponentProps<typeof DropdownMenuSubContent>) {
	return <DropdownMenuSubContent {...props} />;
}

export function DropdownLabel({ children }: { children: ReactNode }) {
	return <DropdownMenuLabel>{children}</DropdownMenuLabel>;
}

export function DropdownSeparator() {
	return <DropdownMenuSeparator />;
}

// ---------------------------------------------------------------- menus from a list (right-click and "…")

/** One thing a menu can do. */
export interface MenuAction {
	label: ReactNode;
	icon?: ReactNode;
	onSelect: () => void;
	danger?: boolean;
	disabled?: boolean;
	shortcut?: string;
}

/** A menu's entries: actions and "-" separators. false, null and undefined are skipped (conditional entries). */
export type MenuEntry = MenuAction | "-" | false | null | undefined;

/** Drops skipped entries and separators at the ends or next to each other. */
function tidy(entries: MenuEntry[]): (MenuAction | "-")[] {
	const out: (MenuAction | "-")[] = [];
	for (const e of entries) {
		if (!e) continue;
		if (e === "-" && (out.length === 0 || out.at(-1) === "-")) continue;
		out.push(e);
	}
	if (out.at(-1) === "-") out.pop();
	return out;
}

/** The entries as dropdown items, for a "…" button's menu (the same list a right-click shows). */
export function DropdownEntries({ entries }: { entries: MenuEntry[] }) {
	return tidy(entries).map((e, i) =>
		e === "-" ? (
			// biome-ignore lint/suspicious/noArrayIndexKey: separators have nothing else to tell them apart
			<DropdownMenuSeparator key={i} />
		) : (
			<DropdownItem
				// biome-ignore lint/suspicious/noArrayIndexKey: entries are rebuilt each render in a fixed order
				key={i}
				icon={e.icon}
				danger={e.danger}
				disabled={e.disabled}
				shortcut={e.shortcut}
				onSelect={e.onSelect}
			>
				{e.label}
			</DropdownItem>
		),
	);
}

/**
 * Right-click (or long-press on touch) anywhere on `children` for a menu at the pointer. The child must take a
 * ref and props (a DOM element); other props given here are passed on to it, so this composes with Tooltip.
 */
export function ContextMenu({
	entries,
	label,
	children,
	onOpenChange,
	...props
}: {
	entries: MenuEntry[];
	/** A small heading at the top (what the menu is for). */
	label?: ReactNode;
	children: ReactNode;
	onOpenChange?: (open: boolean) => void;
} & Omit<ComponentProps<typeof ContextMenuTrigger>, "children" | "asChild">) {
	const list = tidy(entries);
	return (
		<ContextMenuRoot
			onOpenChange={(open) => {
				if (open) navigator.vibrate?.(10);
				onOpenChange?.(open);
			}}
		>
			<ContextMenuTrigger asChild disabled={list.length === 0} {...props}>
				{children}
			</ContextMenuTrigger>
			<ContextMenuContent onClick={(e) => e.stopPropagation()}>
				{label && <ContextMenuLabel>{label}</ContextMenuLabel>}
				{list.map((e, i) =>
					e === "-" ? (
						// biome-ignore lint/suspicious/noArrayIndexKey: separators have nothing else to tell them apart
						<ContextMenuSeparator key={i} />
					) : (
						<ContextMenuItem
							// biome-ignore lint/suspicious/noArrayIndexKey: entries are rebuilt each render in a fixed order
							key={i}
							variant={e.danger ? "destructive" : "default"}
							disabled={e.disabled}
							onSelect={e.onSelect}
						>
							{e.icon}
							<span className="flex-1 truncate">{e.label}</span>
							{e.shortcut && <ContextMenuShortcut>{e.shortcut}</ContextMenuShortcut>}
						</ContextMenuItem>
					),
				)}
			</ContextMenuContent>
		</ContextMenuRoot>
	);
}
