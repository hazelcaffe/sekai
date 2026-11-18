import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type * as React from "react";
import { cn } from "../lib/utils.ts";

const badgeVariants = cva(
	"group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-md px-1.5 text-[11px] font-medium whitespace-nowrap [&>svg]:pointer-events-none [&>svg]:size-3",
	{
		variants: {
			variant: {
				neutral: "bg-muted text-muted-foreground",
				secondary: "bg-muted text-muted-foreground",
				brand: "bg-brand/14 text-brand-ink",
				default: "bg-primary text-primary-foreground",
				info: "bg-info/12 text-info",
				success: "bg-success/12 text-success",
				warning: "bg-warning/14 text-warning",
				danger: "bg-destructive/12 text-destructive",
				destructive: "bg-destructive/12 text-destructive",
				outline: "border border-input text-muted-foreground",
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
