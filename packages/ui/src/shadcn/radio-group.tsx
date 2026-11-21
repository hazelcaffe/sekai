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
				"peer relative flex aspect-square size-4.5 shrink-0 items-center justify-center rounded-full border-[1.5px] border-border-strong bg-bg transition-[border-color,box-shadow] hit-area hit-pad-2 hover:border-brand-ink disabled:cursor-not-allowed disabled:opacity-50 data-checked:border-brand",
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
