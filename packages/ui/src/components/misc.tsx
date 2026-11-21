import { ChevronRight, Loader2 } from "lucide-react";
import { type ComponentProps, type ReactNode, useId, useState } from "react";
import { cn } from "../lib/utils.ts";
import { Alert, AlertDescription, AlertTitle } from "../shadcn/alert.tsx";
import { Badge as BadgePrimitive } from "../shadcn/badge.tsx";

export { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "../shadcn/card.tsx";
export { Separator } from "../shadcn/separator.tsx";
export { Tabs, TabsContent, TabsList, TabsTrigger } from "../shadcn/tabs.tsx";

/** For a button that's working, or an action that takes over the screen. Lists and pages load with Skeleton presets. */
export function Spinner({ className, label }: { className?: string; label?: string }) {
	return (
		<Loader2
			data-slot="spinner"
			role={label ? "status" : undefined}
			aria-label={label}
			aria-hidden={label ? undefined : true}
			className={cn("size-4 animate-spin text-fg-subtle", className)}
		/>
	);
}

export type Tone = "neutral" | "brand" | "info" | "success" | "warning" | "danger";

/** A word of status. Colour never carries the meaning alone: the word does. */
export function Badge({
	children,
	tone = "neutral",
	className,
}: {
	children: ReactNode;
	tone?: Tone | "accent";
	className?: string;
}) {
	const variant = tone === "accent" ? "brand" : tone;
	return (
		<BadgePrimitive variant={variant} className={className}>
			{children}
		</BadgePrimitive>
	);
}

export type StatusTone = "success" | "brand" | "warning" | "danger" | "neutral";

const dotTones: Record<StatusTone, string> = {
	success: "bg-success",
	brand: "bg-brand",
	warning: "bg-warning",
	danger: "bg-danger",
	neutral: "bg-border-strong",
};

/**
 * Live state on avatars and rows: success (ready, running), brand (working, with a gentle pulse), warning (needs
 * you), danger (broken), neutral (off). `label` is what it means, for screen readers (and a tooltip if you add one).
 */
export function StatusDot({
	tone,
	label,
	pulse = tone === "brand",
	size = "md",
	className,
}: {
	tone: StatusTone;
	label: string;
	/** The gentle "working" pulse; on by default for brand. It stops under reduced motion. */
	pulse?: boolean;
	size?: "sm" | "md";
	className?: string;
}) {
	return (
		<span
			role="img"
			aria-label={label}
			data-slot="status-dot"
			className={cn("relative inline-flex shrink-0", size === "sm" ? "size-1.5" : "size-2", className)}
		>
			{pulse && (
				<span
					aria-hidden
					className={cn("absolute inset-0 animate-status-pulse rounded-full", dotTones[tone])}
				/>
			)}
			<span aria-hidden className={cn("relative size-full rounded-full", dotTones[tone])} />
		</span>
	);
}

export function Kbd({ children }: { children: ReactNode }) {
	return (
		<kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-border bg-surface-2 px-1 font-sans text-caption text-fg-muted coarse:hidden">
			{children}
		</kbd>
	);
}

const tileTones: Record<Tone, string> = {
	neutral: "bg-surface-2 text-fg-muted",
	brand: "bg-brand-soft text-brand-ink",
	info: "bg-info-soft text-info-ink",
	success: "bg-success-soft text-success-ink",
	warning: "bg-warning-soft text-warning-ink",
	danger: "bg-danger-soft text-danger-ink",
};

/** A small rounded tile holding an icon, tinted by tone. Used beside headings and in a Row's leading slot. */
export function IconTile({
	children,
	tone = "neutral",
	size = "md",
	className,
}: {
	children: ReactNode;
	tone?: Tone;
	size?: "sm" | "md" | "lg";
	className?: string;
}) {
	const sizes = {
		sm: "size-7 rounded-md [&_svg]:size-4",
		md: "size-9 rounded-md [&_svg]:size-5",
		lg: "size-14 rounded-xl [&_svg]:size-6",
	};
	return (
		<span
			aria-hidden
			className={cn("flex shrink-0 items-center justify-center", sizes[size], tileTones[tone], className)}
		>
			{children}
		</span>
	);
}

/**
 * Folded away: **Advanced** (rarely used settings, collapsed) and **Learn more** (an explanation that doesn't need to
 * be on screen). `variant="link"` is the small inline "Learn more" disclosure.
 */
export function Fold({
	title,
	summary,
	description,
	defaultOpen = false,
	children,
	className,
	variant = "section",
}: {
	title: ReactNode;
	/** Shown while folded, e.g. "3 custom rules". */
	summary?: ReactNode;
	description?: ReactNode;
	defaultOpen?: boolean;
	children: ReactNode;
	className?: string;
	variant?: "section" | "link";
}) {
	const [open, setOpen] = useState(defaultOpen);
	const id = useId();
	if (variant === "link") {
		return (
			<div className={cn("flex flex-col items-start", className)}>
				<button
					type="button"
					aria-expanded={open}
					aria-controls={id}
					onClick={() => setOpen((o) => !o)}
					className="inline-flex min-h-8 items-center gap-1 rounded-sm text-small font-medium text-brand-ink hover:underline coarse:min-h-11"
				>
					{title}
					<ChevronRight
						aria-hidden
						className={cn("size-4 transition-transform duration-fast", open && "rotate-90")}
					/>
				</button>
				{open && (
					<div id={id} className="pt-1 text-small text-fg-muted animate-in fade-in-0 duration-panel">
						{children}
					</div>
				)}
			</div>
		);
	}
	return (
		<section className={cn("flex flex-col", className)}>
			<button
				type="button"
				aria-expanded={open}
				aria-controls={id}
				onClick={() => setOpen((o) => !o)}
				className="-mx-2 flex min-h-9 items-center gap-1.5 rounded-md px-2 text-left transition-colors duration-fast hover:bg-surface-2 coarse:min-h-11"
			>
				<ChevronRight
					aria-hidden
					className={cn(
						"size-4 shrink-0 text-fg-subtle transition-transform duration-panel",
						open && "rotate-90",
					)}
				/>
				<span className="shrink-0 text-body font-semibold text-fg">{title}</span>
				{!open && summary && (
					<span className="ml-auto min-w-0 truncate pl-3 text-small text-fg-subtle">{summary}</span>
				)}
			</button>
			{open && (
				<div
					id={id}
					className="flex flex-col gap-3 pt-2 animate-in fade-in-0 slide-in-from-top-1 duration-panel"
				>
					{description && <p className="-mt-1 text-small text-fg-subtle">{description}</p>}
					{children}
				</div>
			)}
		</section>
	);
}

/** A tinted notice with an optional icon, title and action: a problem, or setup that's missing. */
export function Callout({
	tone = "neutral",
	icon,
	title,
	children,
	action,
	className,
}: {
	tone?: Tone;
	icon?: ReactNode;
	title?: ReactNode;
	children?: ReactNode;
	action?: ReactNode;
	className?: string;
}) {
	const variant = tone === "neutral" ? "default" : tone === "danger" ? "destructive" : tone;
	return (
		<Alert
			variant={variant}
			role={tone === "danger" ? "alert" : "note"}
			className={cn(action && "sm:flex sm:items-center sm:gap-3", className)}
		>
			{icon}
			<div className={cn("min-w-0", action && "sm:flex-1")}>
				{title && <AlertTitle>{title}</AlertTitle>}
				{children && <AlertDescription className={cn(title && "mt-0.5")}>{children}</AlertDescription>}
			</div>
			{action && <div className="col-start-2 mt-2 sm:mt-0">{action}</div>}
		</Alert>
	);
}

/** A bare coloured dot (decoration; for state with meaning, use StatusDot). */
export function Dot({ className, ...props }: ComponentProps<"span">) {
	return <span className={cn("inline-block size-2 shrink-0 rounded-full", className)} {...props} />;
}
