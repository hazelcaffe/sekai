import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type * as React from "react";
import { cn } from "../lib/utils.ts";

/** A word of status: a soft tint with its ink-coloured text (4.5:1). */
const badgeVariants = cva(
	"group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-sm px-1.5 text-caption font-medium whitespace-nowrap [&>svg]:pointer-events-none [&>svg]:size-3",
	{
		variants: {
			variant: {
				neutral: "bg-surface-2 text-fg-muted",
				brand: "bg-brand-soft text-brand-ink",
				info: "bg-info-soft text-info-ink",
				success: "bg-success-soft text-success-ink",
				warning: "bg-warning-soft text-warning-ink",
				danger: "bg-danger-soft text-danger-ink",
				outline: "border border-border-strong/50 text-fg-muted",
			},
		},
		defaultVariants: { variant: "neutral" },
	},
);

function Badge({
	className,
	variant = "neutral",
	asChild = false,
	...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
	const Comp = asChild ? Slot.Root : "span";
	return (
		<Comp
			data-slot="badge"
			data-variant={variant}
			className={cn(badgeVariants({ variant }), className)}
			{...props}
		/>
	);
}

export { Badge, badgeVariants };
