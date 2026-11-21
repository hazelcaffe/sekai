import { cva, type VariantProps } from "class-variance-authority";
import { Toggle as TogglePrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "../lib/utils.ts";

const toggleVariants = cva(
	"group/toggle inline-flex items-center justify-center gap-1.5 rounded-md text-small font-medium whitespace-nowrap text-fg-muted transition-[background-color,color,box-shadow,scale] duration-fast ease-out hover:text-fg active:scale-[0.96] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
	{
		variants: {
			variant: {
				default: "hover:bg-surface-2 data-[state=on]:bg-surface-2 data-[state=on]:text-fg",
				outline:
					"border border-border-strong/50 hover:bg-surface-2 data-[state=on]:border-brand-ink data-[state=on]:bg-brand-soft data-[state=on]:text-fg",
				/**
				 * A segment inside a tinted track: the chosen one lifts out as a raised pill (iOS). On Android, Material
				 * 3's segmented buttons: outlined, the chosen one filled with the brand's soft tint.
				 */
				segmented:
					"data-[state=on]:bg-bg data-[state=on]:text-fg data-[state=on]:shadow-soft dark:data-[state=on]:bg-surface-3 android:flex-auto android:rounded-none android:border-border-strong android:not-first:border-l android:data-[state=on]:bg-brand-soft android:data-[state=on]:text-brand-ink android:data-[state=on]:shadow-none",
			},
			size: {
				default: "h-8 min-w-8 px-3 coarse:h-10",
				sm: "h-7 min-w-7 px-2.5 text-caption",
				lg: "h-10 min-w-10 px-3.5 text-body",
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
