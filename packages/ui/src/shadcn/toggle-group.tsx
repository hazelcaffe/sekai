import type { VariantProps } from "class-variance-authority";
import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui";
import * as React from "react";
import { cn } from "../lib/utils.ts";
import { toggleVariants } from "./toggle.tsx";

const ToggleGroupContext = React.createContext<VariantProps<typeof toggleVariants>>({
	size: "default",
	variant: "default",
});

function ToggleGroup({
	className,
	variant,
	size,
	children,
	...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Root> & VariantProps<typeof toggleVariants>) {
	return (
		<ToggleGroupPrimitive.Root
			data-slot="toggle-group"
			data-variant={variant}
			data-size={size}
			className={cn(
				"group/toggle-group flex w-fit flex-row flex-wrap items-center gap-1",
				variant === "segmented" &&
					"rounded-lg bg-surface-2 p-1 android:gap-0 android:overflow-hidden android:rounded-full android:border android:border-border-strong android:bg-transparent android:p-0",
				className,
			)}
			{...props}
		>
			<ToggleGroupContext.Provider value={{ variant, size }}>{children}</ToggleGroupContext.Provider>
		</ToggleGroupPrimitive.Root>
	);
}

function ToggleGroupItem({
	className,
	children,
	variant,
	size,
	...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Item> & VariantProps<typeof toggleVariants>) {
	const context = React.useContext(ToggleGroupContext);
	const v = context.variant ?? variant;
	const s = context.size ?? size;
	return (
		<ToggleGroupPrimitive.Item
			data-slot="toggle-group-item"
			data-variant={v}
			data-size={s}
			className={cn(
				"hit-area-y relative shrink-0 focus-visible:z-10",
				toggleVariants({ variant: v, size: s }),
				className,
			)}
			{...props}
		>
			{children}
		</ToggleGroupPrimitive.Item>
	);
}

export { ToggleGroup, ToggleGroupItem };
