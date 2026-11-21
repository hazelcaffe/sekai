import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { Slot } from "radix-ui";
import * as React from "react";
import { cn } from "../lib/utils.ts";
import { TooltipContent, Tooltip as TooltipRoot, TooltipTrigger } from "./tooltip.tsx";

/**
 * shadcn's button with Sekai's variants: a soft press, the global focus ring, touch-sized on phones (and, drawn
 * smaller than a fingertip, an invisible hit area of 44pt on iOS and 48dp elsewhere: hit-area).
 */
const buttonVariants = cva(
	"group/button hit-area relative inline-flex shrink-0 items-center justify-center gap-2 font-medium whitespace-nowrap select-none transition-[background-color,color,border-color,box-shadow,opacity,scale] duration-fast ease-out active:not-aria-[haspopup]:scale-[0.97] disabled:pointer-events-none disabled:opacity-45 aria-invalid:ring-[3px] aria-invalid:ring-danger/25 [&_svg]:pointer-events-none [&_svg]:shrink-0 *:data-[slot=spinner]:text-current",
	{
		variants: {
			variant: {
				/** The one main action of a view: the near-black (light) or near-white (dark) fill. */
				primary: "bg-primary text-primary-foreground hover:bg-primary/88",
				/** The brand fill, for the rare hero action (welcome, a call). */
				brand: "bg-brand text-brand-foreground hover:bg-brand/90",
				secondary: "bg-surface-2 text-fg hover:bg-surface-hover aria-expanded:bg-surface-hover",
				outline:
					"border border-border-strong/50 bg-transparent text-fg hover:bg-surface-2 aria-expanded:bg-surface-2",
				ghost: "bg-transparent text-fg-muted hover:bg-surface-2 hover:text-fg aria-expanded:bg-surface-2 aria-expanded:text-fg",
				danger: "bg-danger text-danger-foreground hover:bg-danger/90",
				"danger-ghost": "bg-transparent text-danger-ink hover:bg-danger-soft",
				link: "h-auto bg-transparent px-0 text-brand-ink underline-offset-4 after:hidden hover:underline active:scale-100",
			},
			size: {
				xs: "h-7 rounded-md px-2.5 text-small [&_svg]:size-4 coarse:h-9",
				sm: "h-8 rounded-md px-3 text-small [&_svg]:size-4 coarse:h-10",
				md: "h-10 rounded-md px-4 text-body [&_svg]:size-4 coarse:h-11",
				lg: "h-12 rounded-lg px-5 text-body [&_svg]:size-5",
				icon: "size-9 rounded-md [&_svg]:size-5 coarse:size-11",
				"icon-sm": "size-8 rounded-md [&_svg]:size-4 coarse:size-10",
				"icon-xs": "size-6 rounded-sm [&_svg]:size-4 coarse:size-8",
				"icon-lg": "size-11 rounded-lg [&_svg]:size-5",
			},
			pill: { true: "rounded-full" },
		},
		defaultVariants: { variant: "secondary", size: "md" },
	},
);

type ButtonProps = React.ComponentProps<"button"> &
	VariantProps<typeof buttonVariants> & {
		asChild?: boolean;
		/** Working: shows a spinner in place of the icon and stops further presses. */
		loading?: boolean;
	};

/**
 * Set by Page around the actions in its phone bar: buttons there are the platform's bar buttons (an icon, or short
 * text, tinted on iOS; Material 3's top app bar icons on Android), never a filled button spanning the bar.
 */
export const InPageBar = React.createContext<"ios" | "android" | null>(null);

/** A button's icon (any element that isn't plain markup) and its words. */
export function splitLabel(children: React.ReactNode): { icon: React.ReactNode[]; text: string } {
	const icon: React.ReactNode[] = [];
	let text = "";
	React.Children.forEach(children, (c) => {
		if (typeof c === "string" || typeof c === "number") text += String(c);
		else if (React.isValidElement(c) && (typeof c.type !== "string" || c.type === "svg")) icon.push(c);
	});
	return { icon, text: text.trim() };
}

const BAR_ICON = {
	ios: "size-11 rounded-full text-brand-ink hover:text-brand-ink [&_svg]:size-6",
	android: "size-12 rounded-full text-fg hover:text-fg [&_svg]:size-6",
};
const BAR_TEXT = {
	ios: "h-11 px-2 text-body font-normal text-brand-ink hover:text-brand-ink",
	android: "h-10 rounded-full px-3 text-body text-brand-ink hover:text-brand-ink",
};

/** A button in a Page's phone bar: its icon alone (its words become its name), or its words when it has no icon. */
function BarButton({
	bar,
	className,
	variant,
	size,
	type,
	loading,
	disabled,
	children,
	...props
}: ButtonProps & { bar: "ios" | "android" }) {
	const { icon, text } = splitLabel(children);
	const iconOnly = icon.length > 0;
	const label = props["aria-label"] ?? (text || undefined);
	const button = (
		<button
			data-slot="button"
			data-variant={variant}
			data-size={size}
			type={type ?? "button"}
			className={cn(
				buttonVariants({ variant: "ghost", size: iconOnly ? "icon" : "md" }),
				iconOnly ? BAR_ICON[bar] : BAR_TEXT[bar],
				className,
			)}
			disabled={disabled || loading}
			aria-busy={loading || undefined}
			{...props}
			aria-label={iconOnly ? label : props["aria-label"]}
		>
			{loading ? <Loader2 aria-hidden data-slot="spinner" className="animate-spin" /> : iconOnly ? icon : text}
		</button>
	);
	// Icon-only, it says what it does on hover too (a narrow window with a mouse).
	if (!iconOnly || !text) return button;
	return (
		<TooltipRoot>
			<TooltipTrigger asChild>{button}</TooltipTrigger>
			<TooltipContent>{text}</TooltipContent>
		</TooltipRoot>
	);
}

function Button({
	className,
	variant,
	size,
	pill,
	asChild = false,
	type,
	loading,
	disabled,
	children,
	...props
}: ButtonProps) {
	const bar = React.useContext(InPageBar);
	if (bar && !asChild && variant !== "link") {
		return (
			<BarButton
				bar={bar}
				className={className}
				variant={variant}
				size={size}
				type={type}
				loading={loading}
				disabled={disabled}
				{...props}
			>
				{children}
			</BarButton>
		);
	}
	const Comp = asChild ? Slot.Root : "button";
	return (
		<Comp
			data-slot="button"
			data-variant={variant}
			data-size={size}
			type={asChild ? undefined : (type ?? "button")}
			className={cn(buttonVariants({ variant, size, pill }), className)}
			disabled={disabled || loading}
			aria-busy={loading || undefined}
			{...props}
		>
			{loading && !asChild ? (
				<>
					<Loader2 aria-hidden data-slot="spinner" className="animate-spin" />
					{/* The icon gives way to the spinner; the words stay. */}
					<span className="contents [&>svg:first-child]:hidden">{children}</span>
				</>
			) : (
				children
			)}
		</Comp>
	);
}

export { Button, type ButtonProps, buttonVariants };
