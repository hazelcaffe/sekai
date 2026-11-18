import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "../lib/utils.ts";

const alertVariants = cva(
	"group/alert relative grid w-full gap-0.5 rounded-2xl border px-4 py-3 text-left text-sm has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-3 *:[svg]:row-span-2 *:[svg]:mt-0.5 *:[svg]:size-4 *:[svg]:text-current",
	{
		variants: {
			variant: {
				default: "border-border bg-bg-subtle text-foreground *:[svg]:text-muted-foreground",
				brand: "border-brand/25 bg-brand/8 text-foreground *:[svg]:text-brand-ink",
				info: "border-info/25 bg-info/8 text-foreground *:[svg]:text-info",
				success: "border-success/25 bg-success/8 text-foreground *:[svg]:text-success",
				warning: "border-warning/30 bg-warning/8 text-foreground *:[svg]:text-warning",
				destructive: "border-destructive/30 bg-destructive/8 text-foreground *:[svg]:text-destructive",
			},
		},
		defaultVariants: { variant: "default" },
	},
);

function Alert({ className, variant, ...props }: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
	return <div data-slot="alert" role="alert" className={cn(alertVariants({ variant }), className)} {...props} />;
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
	return <div data-slot="alert-title" className={cn("font-medium leading-5", className)} {...props} />;
}

function AlertDescription({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="alert-description"
			className={cn(
				"text-[13px] leading-5 text-muted-foreground [&_a]:font-medium [&_a]:text-foreground [&_a]:underline [&_a]:underline-offset-2",
				className,
			)}
			{...props}
		/>
	);
}

export { Alert, AlertDescription, AlertTitle, alertVariants };
