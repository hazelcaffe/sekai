import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "../lib/utils.ts";

const alertVariants = cva(
	"group/alert relative grid w-full gap-0.5 rounded-lg border px-4 py-3 text-left text-body has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-3 *:[svg]:row-span-2 *:[svg]:mt-0.5 *:[svg]:size-4 *:[svg]:text-current",
	{
		variants: {
			variant: {
				default: "border-border bg-bg-subtle text-fg *:[svg]:text-fg-muted",
				brand: "border-brand/25 bg-brand-soft text-fg *:[svg]:text-brand-ink",
				info: "border-info/25 bg-info-soft text-fg *:[svg]:text-info-ink",
				success: "border-success/25 bg-success-soft text-fg *:[svg]:text-success-ink",
				warning: "border-warning/30 bg-warning-soft text-fg *:[svg]:text-warning-ink",
				destructive: "border-danger/30 bg-danger-soft text-fg *:[svg]:text-danger-ink",
			},
		},
		defaultVariants: { variant: "default" },
	},
);

function Alert({ className, variant, ...props }: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
	return <div data-slot="alert" role="alert" className={cn(alertVariants({ variant }), className)} {...props} />;
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
	return <div data-slot="alert-title" className={cn("font-medium", className)} {...props} />;
}

function AlertDescription({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="alert-description"
			className={cn(
				"text-small text-fg-muted [&_a]:font-medium [&_a]:text-fg [&_a]:underline [&_a]:underline-offset-2",
				className,
			)}
			{...props}
		/>
	);
}

export { Alert, AlertDescription, AlertTitle, alertVariants };
