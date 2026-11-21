import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { Select as SelectPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "../lib/utils.ts";
import { fieldStyles } from "./field-styles.ts";
import { floatingMotion } from "./popover.tsx";

function Select(props: React.ComponentProps<typeof SelectPrimitive.Root>) {
	return <SelectPrimitive.Root data-slot="select" {...props} />;
}

function SelectGroup({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.Group>) {
	return <SelectPrimitive.Group data-slot="select-group" className={cn("scroll-my-1", className)} {...props} />;
}

function SelectValue(props: React.ComponentProps<typeof SelectPrimitive.Value>) {
	return <SelectPrimitive.Value data-slot="select-value" {...props} />;
}

function SelectTrigger({
	className,
	size = "default",
	children,
	...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & { size?: "sm" | "default" }) {
	return (
		<SelectPrimitive.Trigger
			data-slot="select-trigger"
			data-size={size}
			className={cn(
				fieldStyles,
				"group hit-area relative flex items-center justify-between gap-2 text-left whitespace-nowrap data-placeholder:text-fg-subtle data-[size=default]:h-10 data-[size=default]:coarse:h-11 data-[size=sm]:h-8 data-[size=sm]:px-2.5 data-[size=sm]:text-small data-[size=sm]:coarse:h-10 data-open:border-ring data-open:bg-bg data-open:ring-[3px] data-open:ring-ring/15 *:data-[slot=select-value]:truncate [&_svg]:pointer-events-none [&_svg]:shrink-0",
				className,
			)}
			{...props}
		>
			{children}
			<SelectPrimitive.Icon asChild>
				<ChevronDownIcon className="size-4 text-fg-subtle transition-transform duration-panel group-data-open:rotate-180" />
			</SelectPrimitive.Icon>
		</SelectPrimitive.Trigger>
	);
}

function SelectContent({
	className,
	children,
	position = "popper",
	sideOffset = 6,
	...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
	return (
		<SelectPrimitive.Portal>
			<SelectPrimitive.Content
				data-slot="select-content"
				position={position}
				sideOffset={sideOffset}
				className={cn(
					"relative z-menu max-h-[min(var(--radix-select-content-available-height),420px)] max-w-[min(var(--radix-select-content-available-width),28rem)] min-w-[max(var(--radix-select-trigger-width),8rem)] overflow-hidden rounded-lg border border-border bg-surface-raised p-1 text-fg shadow-pop",
					floatingMotion,
					className,
				)}
				{...props}
			>
				<SelectScrollUpButton />
				<SelectPrimitive.Viewport data-position={position} className="scrollbar-thin">
					{children}
				</SelectPrimitive.Viewport>
				<SelectScrollDownButton />
			</SelectPrimitive.Content>
		</SelectPrimitive.Portal>
	);
}

function SelectLabel({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.Label>) {
	return (
		<SelectPrimitive.Label
			data-slot="select-label"
			className={cn("px-3 pt-2 pb-1 text-caption font-medium text-fg-subtle", className)}
			{...props}
		/>
	);
}

function SelectItem({
	className,
	children,
	description,
	...props
}: React.ComponentProps<typeof SelectPrimitive.Item> & { description?: React.ReactNode }) {
	return (
		<SelectPrimitive.Item
			data-slot="select-item"
			className={cn(
				"relative flex w-full cursor-pointer flex-col rounded-md py-2 pr-9 pl-3 text-body outline-none select-none transition-colors duration-fast data-disabled:pointer-events-none data-disabled:opacity-40 data-highlighted:bg-surface-2 coarse:py-3",
				className,
			)}
			{...props}
		>
			<SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
			{description && <span className="text-small text-fg-subtle">{description}</span>}
			<span className="pointer-events-none absolute top-2.5 right-3 flex size-4 items-center justify-center coarse:top-3.5">
				<SelectPrimitive.ItemIndicator>
					<CheckIcon className="size-4 text-brand-ink" />
				</SelectPrimitive.ItemIndicator>
			</span>
		</SelectPrimitive.Item>
	);
}

function SelectSeparator({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.Separator>) {
	return (
		<SelectPrimitive.Separator
			data-slot="select-separator"
			className={cn("pointer-events-none mx-1 my-1 h-px bg-border", className)}
			{...props}
		/>
	);
}

function SelectScrollUpButton({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
	return (
		<SelectPrimitive.ScrollUpButton
			data-slot="select-scroll-up-button"
			className={cn("flex cursor-default items-center justify-center py-1 text-fg-subtle", className)}
			{...props}
		>
			<ChevronUpIcon className="size-4" />
		</SelectPrimitive.ScrollUpButton>
	);
}

function SelectScrollDownButton({
	className,
	...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
	return (
		<SelectPrimitive.ScrollDownButton
			data-slot="select-scroll-down-button"
			className={cn("flex cursor-default items-center justify-center py-1 text-fg-subtle", className)}
			{...props}
		>
			<ChevronDownIcon className="size-4" />
		</SelectPrimitive.ScrollDownButton>
	);
}

export {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectScrollDownButton,
	SelectScrollUpButton,
	SelectSeparator,
	SelectTrigger,
	SelectValue,
};
