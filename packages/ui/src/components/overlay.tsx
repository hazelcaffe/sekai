import { TriangleAlert } from "lucide-react";
import { Dialog as DialogPrimitive, Slot } from "radix-ui";
import {
	type ComponentProps,
	createContext,
	Fragment,
	type ReactNode,
	type PointerEvent as ReactPointerEvent,
	useContext,
	useRef,
	useState,
} from "react";
import { useActionSheets } from "../lib/platform.ts";
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
import { overlayStyles } from "../shadcn/overlay-styles.ts";
import { PopoverClose, PopoverContent, Popover as PopoverRoot, PopoverTrigger } from "../shadcn/popover.tsx";
import { SheetContent, SheetDescription, Sheet as SheetRoot, SheetTitle } from "../shadcn/sheet.tsx";

const dialogWidths = { sm: "md:max-w-sm", md: "md:max-w-lg", lg: "md:max-w-2xl", xl: "md:max-w-4xl" };

/**
 * A short, single decision or creating something small, and confirmations: a centred card on tablets and desktops,
 * a bottom sheet with a grabber on phones. Longer flows are a page or steps, not a dialog.
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
	/** One sentence under the title. */
	description?: ReactNode;
	children: ReactNode;
	/** The actions, e.g. Cancel and the one primary button. */
	footer?: ReactNode;
	className?: string;
	/** Width on tablets and desktops: sm 24rem, md 32rem, lg 42rem, xl 56rem. */
	size?: "sm" | "md" | "lg" | "xl";
	/** Shown in a tinted tile beside the title. */
	icon?: ReactNode;
}) {
	return (
		<DialogRoot open={open} onOpenChange={onOpenChange}>
			<DialogContent className={cn(dialogWidths[size], className)}>
				<DialogHeader className={cn(icon && "flex-row items-center gap-3")}>
					{icon && (
						<span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand-ink [&_svg]:size-5">
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

/**
 * Before anything with consequences (delete, remove a person, revoke, restart, restore, reset). The description
 * names what will happen ("Nori's computer and its files will be deleted."); the button says the action ("Delete").
 */
export function Confirm({
	open,
	onOpenChange,
	title,
	description,
	confirmLabel = "Confirm",
	cancelLabel = "Cancel",
	danger,
	onConfirm,
	icon,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** A question: "Delete this chat?" */
	title: string;
	/** The consequence, in a sentence. */
	description?: ReactNode;
	/** The action, as a verb: "Delete", "Remove", "Restart". */
	confirmLabel?: string;
	cancelLabel?: string;
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
						<AlertDialogMedia className={cn(danger && "bg-danger-soft text-danger-ink")}>
							{media}
						</AlertDialogMedia>
					)}
					<AlertDialogTitle>{title}</AlertDialogTitle>
					{description && <AlertDialogDescription>{description}</AlertDialogDescription>}
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>{cancelLabel}</AlertDialogCancel>
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

// ---------------------------------------------------------------- menus: a dropdown, or an action sheet on phones

/**
 * Menus adapt: a dropdown with a mouse or on wide screens; on phone-sized touch screens the same parts render an
 * action sheet (a bottom sheet of big rows with Cancel). App code writes one menu either way.
 */
const SheetMenu = createContext<{ close: () => void } | null>(null);

/** The rows of an action sheet. */
const sheetItem =
	"flex min-h-12 w-full items-center gap-3 rounded-md px-4 text-left text-body text-fg outline-none transition-colors duration-fast active:bg-surface-2 focus-visible:bg-surface-2 disabled:pointer-events-none disabled:opacity-40 ios:min-h-14 ios:justify-center [&_svg]:size-5 [&_svg]:shrink-0 [&_svg:not([class*='text-'])]:text-fg-muted";

function SheetMenuContent({ children, title }: { children: ReactNode; title?: string }) {
	const menu = useContext(SheetMenu);
	return (
		<DialogPrimitive.Portal>
			<DialogPrimitive.Overlay className={cn(overlayStyles, "z-menu")} />
			<DialogPrimitive.Content
				data-slot="action-sheet"
				aria-describedby={undefined}
				onClick={(e) => e.stopPropagation()}
				className="fixed inset-x-0 bottom-0 z-menu flex max-h-[85dvh] flex-col gap-2 px-2 pb-safe-2 outline-none duration-panel ease-standard data-open:animate-in data-open:slide-in-from-bottom data-closed:animate-out data-closed:slide-out-to-bottom"
			>
				<DialogPrimitive.Title className="sr-only">{title ?? "Menu"}</DialogPrimitive.Title>
				<div className="flex min-h-0 flex-col overflow-y-auto rounded-xl bg-surface-raised p-1.5 shadow-pop android:rounded-t-sheet android:rounded-b-none">
					<div
						aria-hidden
						className="mx-auto mt-0.5 mb-1.5 h-1 w-9 shrink-0 rounded-full bg-border-strong/50"
					/>
					{children}
				</div>
				<button
					type="button"
					onClick={() => menu?.close()}
					className="flex min-h-12 shrink-0 items-center justify-center rounded-xl bg-surface-raised text-body font-semibold text-brand-ink shadow-pop ios:min-h-14 android:hidden"
				>
					Cancel
				</button>
			</DialogPrimitive.Content>
		</DialogPrimitive.Portal>
	);
}

function SheetMenuRoot({
	open: controlled,
	defaultOpen,
	onOpenChange,
	children,
}: {
	open?: boolean;
	defaultOpen?: boolean;
	onOpenChange?: (open: boolean) => void;
	children: ReactNode;
}) {
	const [own, setOwn] = useState(defaultOpen ?? false);
	const open = controlled ?? own;
	const set = (o: boolean) => {
		if (controlled === undefined) setOwn(o);
		onOpenChange?.(o);
	};
	return (
		<SheetMenu.Provider value={{ close: () => set(false) }}>
			<DialogPrimitive.Root open={open} onOpenChange={set}>
				{children}
			</DialogPrimitive.Root>
		</SheetMenu.Provider>
	);
}

export function DropdownMenu({
	open,
	defaultOpen,
	onOpenChange,
	children,
	modal,
}: {
	open?: boolean;
	defaultOpen?: boolean;
	onOpenChange?: (open: boolean) => void;
	children: ReactNode;
	modal?: boolean;
}) {
	const sheets = useActionSheets();
	if (sheets) {
		return (
			<SheetMenuRoot open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
				{children}
			</SheetMenuRoot>
		);
	}
	return (
		<SheetMenu.Provider value={null}>
			<DropdownMenuRoot open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange} modal={modal}>
				{children}
			</DropdownMenuRoot>
		</SheetMenu.Provider>
	);
}

export function DropdownTrigger(props: ComponentProps<typeof DropdownMenuTrigger>) {
	const menu = useContext(SheetMenu);
	if (menu) return <DialogPrimitive.Trigger {...props} />;
	return <DropdownMenuTrigger {...props} />;
}

export const DropdownSub = ({ children }: { children: ReactNode }) => {
	const menu = useContext(SheetMenu);
	if (menu) return <>{children}</>;
	return <DropdownMenuSub>{children}</DropdownMenuSub>;
};

export function DropdownContent({
	align = "end",
	children,
	title,
	...props
}: ComponentProps<typeof DropdownMenuContent> & {
	/** What the menu is for; shown to screen readers when it opens as an action sheet. */
	title?: string;
}) {
	const menu = useContext(SheetMenu);
	if (menu) return <SheetMenuContent title={title}>{children}</SheetMenuContent>;
	return (
		<DropdownMenuContent align={align} {...props}>
			{children}
		</DropdownMenuContent>
	);
}

export function DropdownItem({
	danger,
	icon,
	children,
	shortcut,
	onSelect,
	disabled,
	className,
	...props
}: ComponentProps<typeof DropdownMenuItem> & { danger?: boolean; icon?: ReactNode; shortcut?: string }) {
	const menu = useContext(SheetMenu);
	if (menu) {
		return (
			<button
				type="button"
				disabled={disabled}
				className={cn(sheetItem, danger && "text-danger-ink [&_svg]:text-danger-ink", className)}
				onClick={() => {
					const e = new Event("select", { cancelable: true });
					onSelect?.(e);
					if (!e.defaultPrevented) menu.close();
				}}
			>
				{icon}
				<span className="min-w-0 truncate ios:flex-none">{children}</span>
			</button>
		);
	}
	return (
		<DropdownMenuItem
			variant={danger ? "destructive" : "default"}
			onSelect={onSelect}
			disabled={disabled}
			className={className}
			{...props}
		>
			{icon}
			<span className="flex-1 truncate">{children}</span>
			{shortcut && <DropdownMenuShortcut>{shortcut}</DropdownMenuShortcut>}
		</DropdownMenuItem>
	);
}

export function DropdownSubTrigger({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
	const menu = useContext(SheetMenu);
	if (menu) {
		return (
			<div className="flex items-center gap-2 px-4 pt-3 pb-1 text-caption font-medium text-fg-subtle [&_svg]:size-4">
				{icon}
				{children}
			</div>
		);
	}
	return (
		<DropdownMenuSubTrigger>
			{icon}
			<span className="flex-1">{children}</span>
		</DropdownMenuSubTrigger>
	);
}

export function DropdownSubContent({ children, ...props }: ComponentProps<typeof DropdownMenuSubContent>) {
	const menu = useContext(SheetMenu);
	if (menu) return <>{children}</>;
	return <DropdownMenuSubContent {...props}>{children}</DropdownMenuSubContent>;
}

export function DropdownLabel({ children }: { children: ReactNode }) {
	const menu = useContext(SheetMenu);
	if (menu) {
		return (
			<div className="px-4 pt-2 pb-1.5 text-caption font-medium text-fg-subtle ios:text-center">{children}</div>
		);
	}
	return <DropdownMenuLabel>{children}</DropdownMenuLabel>;
}

export function DropdownSeparator() {
	const menu = useContext(SheetMenu);
	if (menu) return <hr className="mx-2 my-1 h-px shrink-0 border-0 bg-border" />;
	return <DropdownMenuSeparator />;
}

// ---------------------------------------------------------------- menus from a list (right-click, long-press and "…")

/** One thing a menu can do. */
export interface MenuAction {
	label: ReactNode;
	icon?: ReactNode;
	onSelect: () => void;
	/** Destructive: shown last, after a separator, in danger ink. */
	danger?: boolean;
	disabled?: boolean;
	shortcut?: string;
}

/** A menu's entries: actions and "-" separators. false, null and undefined are skipped (conditional entries). */
export type MenuEntry = MenuAction | "-" | false | null | undefined;

/**
 * Drops skipped entries and stray separators, and moves destructive entries to the end, after a separator, so
 * "Delete" is never between ordinary actions.
 */
export function tidyMenu(entries: MenuEntry[]): (MenuAction | "-")[] {
	const safe: (MenuAction | "-")[] = [];
	const danger: MenuAction[] = [];
	for (const e of entries) {
		if (!e) continue;
		if (e !== "-" && e.danger) danger.push(e);
		else safe.push(e);
	}
	const all: (MenuAction | "-")[] = danger.length ? [...safe, "-", ...danger] : safe;
	const out: (MenuAction | "-")[] = [];
	for (const e of all) {
		if (e === "-" && (out.length === 0 || out.at(-1) === "-")) continue;
		out.push(e);
	}
	if (out.at(-1) === "-") out.pop();
	return out;
}

/** The entries as dropdown items, for a "…" button's menu (the same list a right-click shows). */
export function DropdownEntries({ entries }: { entries: MenuEntry[] }) {
	return tidyMenu(entries).map((e, i) =>
		e === "-" ? (
			// biome-ignore lint/suspicious/noArrayIndexKey: separators have nothing else to tell them apart
			<DropdownSeparator key={i} />
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

/** Touch and hold: fires after half a second without moving; the click that follows is swallowed. */
function useLongPress(onLongPress: () => void) {
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const start = useRef<{ x: number; y: number } | null>(null);
	const fired = useRef(false);
	const clear = () => {
		if (timer.current) clearTimeout(timer.current);
		timer.current = null;
		start.current = null;
	};
	return {
		onPointerDown: (e: ReactPointerEvent) => {
			if (e.pointerType === "mouse") return;
			fired.current = false;
			start.current = { x: e.clientX, y: e.clientY };
			timer.current = setTimeout(() => {
				fired.current = true;
				clear();
				onLongPress();
			}, 500);
		},
		onPointerMove: (e: ReactPointerEvent) => {
			const s = start.current;
			if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 8) clear();
		},
		onPointerUp: clear,
		onPointerCancel: clear,
		onClickCapture: (e: { preventDefault: () => void; stopPropagation: () => void }) => {
			if (!fired.current) return;
			fired.current = false;
			e.preventDefault();
			e.stopPropagation();
		},
		onContextMenu: (e: { preventDefault: () => void }) => {
			e.preventDefault();
			clear();
			if (!fired.current) {
				fired.current = true;
				onLongPress();
			}
		},
	};
}

/**
 * Right-click (or touch and hold) anywhere on `children` for a menu: at the pointer with a mouse, an action sheet on
 * phones. The child must take a ref and props (a DOM element); other props given here are passed on to it, so this
 * composes with Tooltip.
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
	const sheets = useActionSheets();
	const list = tidyMenu(entries);
	const [open, setOpen] = useState(false);
	const set = (o: boolean) => {
		setOpen(o);
		onOpenChange?.(o);
	};
	const press = useLongPress(() => {
		if (list.length === 0) return;
		navigator.vibrate?.(10);
		set(true);
	});
	if (sheets) {
		const { disabled: _disabled, ...rest } = props;
		return (
			<>
				<Slot.Root {...rest} {...press} style={{ WebkitTouchCallout: "none" }}>
					{children}
				</Slot.Root>
				<SheetMenuRoot open={open} onOpenChange={set}>
					<SheetMenuContent title={typeof label === "string" ? label : undefined}>
						{label && <DropdownLabel>{label}</DropdownLabel>}
						{list.map((e, i) => (
							<Fragment
								// biome-ignore lint/suspicious/noArrayIndexKey: entries are rebuilt each render in a fixed order
								key={i}
							>
								{e === "-" ? (
									<DropdownSeparator />
								) : (
									<DropdownItem
										icon={e.icon}
										danger={e.danger}
										disabled={e.disabled}
										onSelect={e.onSelect}
									>
										{e.label}
									</DropdownItem>
								)}
							</Fragment>
						))}
					</SheetMenuContent>
				</SheetMenuRoot>
			</>
		);
	}
	return (
		<ContextMenuRoot
			onOpenChange={(o) => {
				if (o) navigator.vibrate?.(10);
				onOpenChange?.(o);
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
