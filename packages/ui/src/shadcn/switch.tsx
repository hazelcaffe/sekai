import { Switch as SwitchPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "../lib/utils.ts";

/** A brand-colored switch whose thumb squishes a little while it's pressed. */
function Switch({
	className,
	size = "default",
	...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & { size?: "sm" | "default" }) {
	return (
		<SwitchPrimitive.Root
			data-slot="switch"
			data-size={size}
			className={cn(
				"peer group/switch relative inline-flex shrink-0 items-center rounded-full p-0.5 outline-none transition-colors duration-200 after:absolute after:-inset-x-2 after:-inset-y-2 focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50 data-[size=default]:h-6 data-[size=default]:w-10 data-[size=sm]:h-5 data-[size=sm]:w-8 data-checked:bg-brand data-unchecked:bg-surface-3 dark:data-unchecked:bg-surface-3",
				className,
			)}
			{...props}
		>
			<SwitchPrimitive.Thumb
				data-slot="switch-thumb"
				className="pointer-events-none block rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/0.18)] transition-[translate,width] duration-200 ease-spring group-data-[size=default]/switch:size-5 group-data-[size=sm]/switch:size-4 group-data-[size=default]/switch:data-checked:translate-x-4 group-data-[size=sm]/switch:data-checked:translate-x-3 group-active/switch:group-data-[size=default]/switch:w-6 group-active/switch:group-data-[size=sm]/switch:w-5 group-data-[size=default]/switch:group-active/switch:data-checked:translate-x-3 group-data-[size=sm]/switch:group-active/switch:data-checked:translate-x-2"
			/>
		</SwitchPrimitive.Root>
	);
}

export { Switch };
