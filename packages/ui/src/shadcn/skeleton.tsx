import type * as React from "react";
import { cn } from "../lib/utils.ts";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="skeleton"
			aria-hidden
			className={cn("animate-pulse rounded-md bg-surface-3/60", className)}
			{...props}
		/>
	);
}

export { Skeleton };
