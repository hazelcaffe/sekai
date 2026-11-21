import type { ComponentProps, ReactNode } from "react";
import { Button, type ButtonProps, buttonVariants } from "../shadcn/button.tsx";
import {
	TooltipContent,
	TooltipProvider as TooltipProviderPrimitive,
	Tooltip as TooltipRoot,
	TooltipTrigger,
} from "../shadcn/tooltip.tsx";

export { Button, type ButtonProps, buttonVariants };

export function TooltipProvider({ children }: { children: ReactNode }) {
	return <TooltipProviderPrimitive>{children}</TooltipProviderPrimitive>;
}

/**
 * A short label on hover and keyboard focus (never on touch: nothing may depend on it). Use it instead of a title=
 * attribute. The child must take a ref (a DOM element or a component that forwards one). Other props are passed to
 * the child, so it can sit inside another asChild trigger (a Popover's or a menu's).
 */
export function Tooltip({
	content,
	children,
	side = "top",
	shortcut,
	...props
}: {
	content: ReactNode;
	children: ReactNode;
	side?: "top" | "bottom" | "left" | "right";
	shortcut?: string;
} & Omit<ComponentProps<typeof TooltipTrigger>, "content" | "children" | "asChild">) {
	return (
		<TooltipRoot>
			<TooltipTrigger asChild {...props}>
				{children}
			</TooltipTrigger>
			<TooltipContent side={side}>
				{content}
				{shortcut && <kbd className="font-sans text-caption opacity-60">{shortcut}</kbd>}
			</TooltipContent>
		</TooltipRoot>
	);
}

export type IconButtonProps = ButtonProps & {
	/** Required: the button's accessible name and its tooltip. */
	label: string;
	shortcut?: string;
	tooltipSide?: "top" | "bottom" | "left" | "right";
};

/** An icon-only button that always explains itself: the label is both its accessible name and its tooltip. */
export function IconButton({
	label,
	shortcut,
	tooltipSide,
	variant = "ghost",
	size = "icon",
	...props
}: IconButtonProps) {
	return (
		<Tooltip content={label} shortcut={shortcut} side={tooltipSide}>
			<Button aria-label={label} variant={variant} size={size} {...props} />
		</Tooltip>
	);
}
