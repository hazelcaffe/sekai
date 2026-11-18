import { ChevronRight, Loader2 } from "lucide-react";
import { type ComponentProps, createContext, type ReactNode, useContext, useId, useState } from "react";
import { cn } from "../lib/utils.ts";
import { Alert, AlertDescription, AlertTitle } from "../shadcn/alert.tsx";
import { Badge as BadgePrimitive } from "../shadcn/badge.tsx";
import { usePageStyle } from "./page-style.tsx";

export { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "../shadcn/card.tsx";
export { Separator } from "../shadcn/separator.tsx";
export { Skeleton } from "../shadcn/skeleton.tsx";
export { Tabs, TabsContent, TabsList, TabsTrigger } from "../shadcn/tabs.tsx";

export function Spinner({ className }: { className?: string }) {
	return <Loader2 aria-hidden className={cn("size-4 animate-spin text-fg-subtle", className)} />;
}

export type Tone = "neutral" | "brand" | "info" | "success" | "warning" | "danger";

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

export function Kbd({ children }: { children: ReactNode }) {
	return (
		<kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-border bg-muted px-1 font-sans text-[11px] text-muted-foreground shadow-[0_1px_0_var(--border)] coarse:hidden">
			{children}
		</kbd>
	);
}

const tileTones: Record<Tone, string> = {
	neutral: "bg-muted text-muted-foreground",
	brand: "bg-brand/12 text-brand-ink",
	info: "bg-info/12 text-info",
	success: "bg-success/12 text-success",
	warning: "bg-warning/14 text-warning",
	danger: "bg-destructive/12 text-destructive",
};

/** A small rounded tile holding an icon, tinted by tone. Used beside headings and list rows. */
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
		sm: "size-7 rounded-lg [&_svg]:size-3.5",
		md: "size-9 rounded-xl [&_svg]:size-[18px]",
		lg: "size-14 rounded-2xl [&_svg]:size-6",
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

export function EmptyState({
	icon,
	title,
	description,
	action,
	className,
	tone = "brand",
}: {
	icon?: ReactNode;
	title: ReactNode;
	description?: ReactNode;
	action?: ReactNode;
	className?: string;
	tone?: Tone;
}) {
	return (
		<div className={cn("flex flex-col items-center justify-center px-6 py-12 text-center", className)}>
			{icon && (
				<IconTile tone={tone} size="lg" className="mb-4 animate-float">
					{icon}
				</IconTile>
			)}
			<div className="text-[15px] font-semibold tracking-tight">{title}</div>
			{description && <div className="mt-1 max-w-sm text-sm leading-6 text-fg-subtle">{description}</div>}
			{action && <div className="mt-5">{action}</div>}
		</div>
	);
}

/** How deep a Section sits inside others (nested ones get smaller headings on full pages). */
const SectionDepth = createContext(0);

export function Section({
	title,
	description,
	action,
	children,
	className,
	icon,
}: {
	title?: ReactNode;
	description?: ReactNode;
	action?: ReactNode;
	children: ReactNode;
	className?: string;
	icon?: ReactNode;
}) {
	const style = usePageStyle();
	const depth = useContext(SectionDepth);
	if (style === "page") {
		const nested = depth > 0;
		return (
			<section className={cn("flex flex-col", nested ? "gap-3" : "gap-4", className)}>
				{(title || action) && (
					<div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
						<div className="min-w-0 flex-1 basis-64">
							{title &&
								(nested ? (
									<h3 className="text-sm leading-5 font-semibold tracking-tight">{title}</h3>
								) : (
									<h2 className="text-base leading-6 font-semibold tracking-tight">{title}</h2>
								))}
							{description && (
								<p
									className={cn(
										"mt-0.5 leading-5 text-pretty",
										nested ? "text-xs text-fg-subtle" : "text-[13px] text-fg-muted",
									)}
								>
									{description}
								</p>
							)}
						</div>
						{action}
					</div>
				)}
				<SectionDepth.Provider value={depth + 1}>{children}</SectionDepth.Provider>
			</section>
		);
	}
	return (
		<section className={cn("flex flex-col gap-3", className)}>
			{(title || action) && (
				<div className="flex items-end justify-between gap-3">
					<div className="flex min-w-0 items-center gap-2.5">
						{icon && (
							<IconTile size="sm" tone="neutral">
								{icon}
							</IconTile>
						)}
						<div className="min-w-0">
							{title && (
								<h3 className="text-[13px] font-semibold tracking-tight text-foreground">{title}</h3>
							)}
							{description && <p className="mt-0.5 text-xs leading-5 text-fg-subtle">{description}</p>}
						</div>
					</div>
					{action}
				</div>
			)}
			{children}
		</section>
	);
}

/**
 * A section that folds away: its title and, while folded, a short summary of what's inside. For settings you
 * rarely change, so the ones you do change stay in view.
 */
export function Fold({
	title,
	summary,
	description,
	defaultOpen = false,
	children,
	className,
}: {
	title: ReactNode;
	/** Shown while folded, e.g. "3 custom rules". */
	summary?: ReactNode;
	description?: ReactNode;
	defaultOpen?: boolean;
	children: ReactNode;
	className?: string;
}) {
	const [open, setOpen] = useState(defaultOpen);
	const id = useId();
	return (
		<section className={cn("flex flex-col", className)}>
			<button
				type="button"
				aria-expanded={open}
				aria-controls={id}
				onClick={() => setOpen((o) => !o)}
				className="-mx-2 flex min-h-9 items-center gap-1.5 rounded-xl px-2 text-left transition-colors hover:bg-muted/60"
			>
				<ChevronRight
					className={cn(
						"size-4 shrink-0 text-fg-subtle transition-transform duration-200",
						open && "rotate-90",
					)}
				/>
				<span className="shrink-0 text-[13px] font-semibold tracking-tight text-foreground">{title}</span>
				{!open && summary && (
					<span className="ml-auto min-w-0 truncate pl-3 text-xs text-fg-subtle">{summary}</span>
				)}
			</button>
			{open && (
				<div id={id} className="flex flex-col gap-3 pt-2 animate-in fade-in-0 slide-in-from-top-1 duration-200">
					{description && <p className="-mt-1 text-xs leading-5 text-fg-subtle">{description}</p>}
					{children}
				</div>
			)}
		</section>
	);
}

/** A tinted notice with an optional icon, title and action. */
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
		<Alert variant={variant} className={cn(action && "sm:flex sm:items-center sm:gap-3", className)}>
			{icon}
			<div className={cn("min-w-0", action && "sm:flex-1")}>
				{title && <AlertTitle>{title}</AlertTitle>}
				{children && <AlertDescription className={cn(title && "mt-0.5")}>{children}</AlertDescription>}
			</div>
			{action && <div className="col-start-2 mt-2 sm:mt-0">{action}</div>}
		</Alert>
	);
}

export function Dot({ className, ...props }: ComponentProps<"span">) {
	return <span className={cn("inline-block size-2 shrink-0 rounded-full", className)} {...props} />;
}
