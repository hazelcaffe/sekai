import { CheckIcon } from "lucide-react";
import { Checkbox as CheckboxPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "../lib/utils.ts";

function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
	return (
		<CheckboxPrimitive.Root
			data-slot="checkbox"
			className={cn(
				"peer relative flex size-4.5 shrink-0 items-center justify-center rounded-sm border-[1.5px] border-border-strong bg-bg text-brand-foreground transition-[background-color,border-color,box-shadow,scale] duration-fast ease-spring hit-area hit-pad-2 hover:border-brand-ink active:scale-90 disabled:cursor-not-allowed disabled:opacity-50 data-checked:border-brand data-checked:bg-brand",
				className,
			)}
			{...props}
		>
			<CheckboxPrimitive.Indicator
				data-slot="checkbox-indicator"
				className="grid place-content-center text-current data-checked:animate-in data-checked:zoom-in-50 [&>svg]:size-3.5 [&>svg]:stroke-[3]"
			>
				<CheckIcon />
			</CheckboxPrimitive.Indicator>
		</CheckboxPrimitive.Root>
	);
}

export { Checkbox };
