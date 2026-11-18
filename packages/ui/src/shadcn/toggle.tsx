import { cva, type VariantProps } from "class-variance-authority";
import { Toggle as TogglePrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "../lib/utils.ts";

const toggleVariants = cva(
	"group/toggle inline-flex items-center justify-center gap-1.5 rounded-[10px] text-[13px] font-medium whitespace-nowrap text-muted-foreground outline-none transition-[background-color,color,box-shadow,scale] duration-200 ease-spring hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 active:scale-[0.96] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
	{
		variants: {
			variant: {
				default: "hover:bg-muted data-[state=on]:bg-muted data-[state=on]:text-foreground",
				outline:
					"border border-input hover:bg-muted data-[state=on]:border-brand/50 data-[state=on]:bg-brand/10 data-[state=on]:text-foreground",
				/** A segment inside a tinted track: the chosen one lifts out as a raised pill. */
				segmented:
					"data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-[0_1px_2px_rgb(0_0_0/0.08),0_2px_8px_-2px_rgb(0_0_0/0.1)] dark:data-[state=on]:bg-surface-3",
			},
			size: {
				default: "h-8 min-w-8 px-3 coarse:h-10",
				sm: "h-7 min-w-7 px-2.5 text-xs",
				lg: "h-10 min-w-10 px-3.5 text-sm",
			},
		},
		defaultVariants: { variant: "default", size: "default" },
	},
);

function Toggle({
	className,
	variant = "default",
	size = "default",
	...props
}: React.ComponentProps<typeof TogglePrimitive.Root> & VariantProps<typeof toggleVariants>) {
	return (
		<TogglePrimitive.Root
			data-slot="toggle"
			className={cn(toggleVariants({ variant, size }), className)}
			{...props}
		/>
	);
}

export { Toggle, toggleVariants };
