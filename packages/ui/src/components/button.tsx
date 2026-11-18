import type { ReactNode } from "react";
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

export function Tooltip({
	content,
	children,
	side = "top",
	shortcut,
}: {
	content: ReactNode;
	children: ReactNode;
	side?: "top" | "bottom" | "left" | "right";
	shortcut?: string;
}) {
	return (
		<TooltipRoot>
			<TooltipTrigger asChild>{children}</TooltipTrigger>
			<TooltipContent side={side}>
				{content}
				{shortcut && <kbd className="font-sans text-[11px] opacity-60">{shortcut}</kbd>}
			</TooltipContent>
		</TooltipRoot>
	);
}

/** An icon-only button that always explains itself: the label is both its accessible name and its tooltip. */
export function IconButton({
	label,
	shortcut,
	tooltipSide,
	variant = "ghost",
	size = "icon",
	...props
}: ButtonProps & { label: string; shortcut?: string; tooltipSide?: "top" | "bottom" | "left" | "right" }) {
	return (
		<Tooltip content={label} shortcut={shortcut} side={tooltipSide}>
			<Button aria-label={label} variant={variant} size={size} {...props} />
		</Tooltip>
	);
}
