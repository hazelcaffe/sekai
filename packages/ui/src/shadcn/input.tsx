import type * as React from "react";
import { cn } from "../lib/utils.ts";
import { fieldStyles } from "./field-styles.ts";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
	return (
		<input
			type={type}
			data-slot="input"
			className={cn(
				fieldStyles,
				"h-10 coarse:h-11 file:mr-3 file:inline-flex file:h-7 file:rounded-sm file:border-0 file:bg-bg file:px-2.5 file:text-small file:font-medium file:text-fg",
				className,
			)}
			{...props}
		/>
	);
}

export { Input };
