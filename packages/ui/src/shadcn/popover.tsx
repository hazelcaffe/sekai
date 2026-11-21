import { Popover as PopoverPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "../lib/utils.ts";

/** Shared motion for floating surfaces: a quick fade and a small spring from the side they open from. */
export const floatingMotion =
	"origin-(--radix-popper-transform-origin) duration-panel ease-out-soft data-[side=bottom]:slide-in-from-top-1.5 data-[side=left]:slide-in-from-right-1.5 data-[side=right]:slide-in-from-left-1.5 data-[side=top]:slide-in-from-bottom-1.5 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 data-closed:duration-100";

function Popover(props: React.ComponentProps<typeof PopoverPrimitive.Root>) {
	return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

function PopoverTrigger(props: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
	return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

function PopoverContent({
	className,
	align = "center",
	sideOffset = 8,
	collisionPadding = 12,
	...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
	return (
		<PopoverPrimitive.Portal>
			<PopoverPrimitive.Content
				data-slot="popover-content"
				align={align}
				sideOffset={sideOffset}
				collisionPadding={collisionPadding}
				className={cn(
					"z-menu max-h-(--radix-popover-content-available-height) w-72 overflow-y-auto rounded-lg border border-border bg-surface-raised p-1.5 text-body text-fg shadow-pop outline-none scrollbar-thin",
					floatingMotion,
					className,
				)}
				{...props}
			/>
		</PopoverPrimitive.Portal>
	);
}

function PopoverAnchor(props: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
	return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />;
}

function PopoverClose(props: React.ComponentProps<typeof PopoverPrimitive.Close>) {
	return <PopoverPrimitive.Close data-slot="popover-close" {...props} />;
}

export { Popover, PopoverAnchor, PopoverClose, PopoverContent, PopoverTrigger };
