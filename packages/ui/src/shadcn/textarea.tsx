import type * as React from "react";
import { cn } from "../lib/utils.ts";
import { fieldStyles } from "./field-styles.ts";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
	return (
		<textarea
			data-slot="textarea"
			className={cn(fieldStyles, "min-h-24 resize-y py-2.5 leading-6", className)}
			{...props}
		/>
	);
}

export { Textarea };
