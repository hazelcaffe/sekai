import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "../lib/utils.ts";

function RadioGroup({ className, ...props }: React.ComponentProps<typeof RadioGroupPrimitive.Root>) {
	return (
		<RadioGroupPrimitive.Root data-slot="radio-group" className={cn("grid w-full gap-2", className)} {...props} />
	);
}

function RadioGroupItem({ className, ...props }: React.ComponentProps<typeof RadioGroupPrimitive.Item>) {
	return (
		<RadioGroupPrimitive.Item
			data-slot="radio-group-item"
			className={cn(
				"peer relative flex aspect-square size-[18px] shrink-0 items-center justify-center rounded-full border-[1.5px] border-input bg-background outline-none transition-[border-color,box-shadow] after:absolute after:-inset-2 hover:border-brand/60 focus-visible:ring-[3px] focus-visible:ring-ring/35 disabled:cursor-not-allowed disabled:opacity-50 data-checked:border-brand",
				className,
			)}
			{...props}
		>
			<RadioGroupPrimitive.Indicator
				data-slot="radio-group-indicator"
				className="size-2.5 rounded-full bg-brand data-checked:animate-in data-checked:zoom-in-0"
			/>
		</RadioGroupPrimitive.Item>
	);
}

export { RadioGroup, RadioGroupItem };
