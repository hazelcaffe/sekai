import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type * as React from "react";
import { cn } from "../lib/utils.ts";

const primary =
	"bg-primary text-primary-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.14),0_1px_2px_rgb(0_0_0/0.14)] hover:bg-primary/88 dark:shadow-none";
const danger = "bg-destructive text-destructive-foreground hover:bg-destructive/90";
const md = "h-10 rounded-xl px-4 text-sm [&_svg]:size-4 coarse:h-11";

/** shadcn's button with Sekai's variants: a soft spring when pressed, brand focus ring, touch-sized on phones. */
const buttonVariants = cva(
	"group/button inline-flex shrink-0 items-center justify-center gap-2 font-medium whitespace-nowrap outline-none select-none transition-[background-color,color,border-color,box-shadow,opacity,scale] duration-200 ease-spring focus-visible:ring-[3px] focus-visible:ring-ring/45 active:not-aria-[haspopup]:scale-[0.97] disabled:pointer-events-none disabled:opacity-45 aria-invalid:ring-[3px] aria-invalid:ring-destructive/25 [&_svg]:pointer-events-none [&_svg]:shrink-0",
	{
		variants: {
			variant: {
				primary,
				default: primary,
				brand: "bg-brand text-brand-foreground hover:bg-brand/90",
				secondary: "bg-secondary text-secondary-foreground hover:bg-accent aria-expanded:bg-accent",
				outline:
					"border border-input bg-background text-foreground hover:bg-muted aria-expanded:bg-muted dark:bg-transparent",
				ghost: "bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground",
				danger,
				destructive: danger,
				"danger-ghost": "bg-transparent text-destructive hover:bg-destructive/10",
				link: "h-auto bg-transparent px-0 text-brand-ink underline-offset-4 hover:underline active:scale-100",
			},
			size: {
				xs: "h-7 rounded-lg px-2.5 text-xs [&_svg]:size-3.5",
				sm: "h-8 rounded-[10px] px-3 text-[13px] [&_svg]:size-4 coarse:h-10",
				md,
				default: md,
				lg: "h-12 rounded-2xl px-5 text-[15px] [&_svg]:size-5",
				icon: "size-9 rounded-xl [&_svg]:size-[18px] coarse:size-11",
				"icon-sm": "size-7 rounded-lg [&_svg]:size-4 coarse:size-10",
				"icon-xs": "size-6 rounded-md [&_svg]:size-3.5",
				"icon-lg": "size-11 rounded-2xl [&_svg]:size-5",
			},
			pill: { true: "rounded-full" },
		},
		defaultVariants: { variant: "secondary", size: "md" },
	},
);

type ButtonProps = React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean };

function Button({ className, variant, size, pill, asChild = false, type, ...props }: ButtonProps) {
	const Comp = asChild ? Slot.Root : "button";
	return (
		<Comp
			data-slot="button"
			data-variant={variant}
			data-size={size}
			type={asChild ? undefined : (type ?? "button")}
			className={cn(buttonVariants({ variant, size, pill }), className)}
			{...props}
		/>
	);
}

export { Button, type ButtonProps, buttonVariants };
