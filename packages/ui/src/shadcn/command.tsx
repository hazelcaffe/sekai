import { Command as CommandPrimitive } from "cmdk";
import { SearchIcon } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "../lib/utils.ts";
import { overlayStyles } from "./overlay-styles.ts";

function Command({ className, ...props }: React.ComponentProps<typeof CommandPrimitive>) {
	return (
		<CommandPrimitive
			data-slot="command"
			className={cn("flex size-full flex-col overflow-hidden text-fg", className)}
			{...props}
		/>
	);
}

/** A search palette that drops in near the top of the screen (⌘K). */
function CommandDialog({
	title = "Search",
	description = "Search for a command to run",
	children,
	className,
	...props
}: React.ComponentProps<typeof DialogPrimitive.Root> & {
	title?: string;
	description?: string;
	className?: string;
}) {
	return (
		<DialogPrimitive.Root {...props}>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Overlay className={cn(overlayStyles, "z-dialog")} />
				<DialogPrimitive.Content
					data-slot="command-dialog"
					className={cn(
						"fixed top-safe-2 left-1/2 z-dialog w-[min(620px,calc(100vw-16px))] -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-surface-raised shadow-pop outline-none duration-panel ease-out-soft data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-open:slide-in-from-top-2 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 data-closed:duration-fast md:top-[14vh] android:rounded-sheet",
						className,
					)}
				>
					<DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
					<DialogPrimitive.Description className="sr-only">{description}</DialogPrimitive.Description>
					{children}
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
}

function CommandInput({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Input>) {
	return (
		<div data-slot="command-input-wrapper" className="flex items-center gap-3 border-b border-border px-5">
			<SearchIcon className="size-5 shrink-0 text-fg-subtle" />
			<CommandPrimitive.Input
				data-slot="command-input"
				className={cn(
					"h-14 w-full bg-transparent text-body outline-none placeholder:text-fg-subtle disabled:cursor-not-allowed disabled:opacity-50",
					className,
				)}
				{...props}
			/>
		</div>
	);
}

function CommandList({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.List>) {
	return (
		<CommandPrimitive.List
			data-slot="command-list"
			className={cn("max-h-[min(60dvh,460px)] scroll-py-2 overflow-y-auto p-2 scrollbar-thin", className)}
			{...props}
		/>
	);
}

function CommandEmpty({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Empty>) {
	return (
		<CommandPrimitive.Empty
			data-slot="command-empty"
			className={cn("px-3 py-10 text-center text-body text-fg-subtle", className)}
			{...props}
		/>
	);
}

function CommandGroup({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Group>) {
	return (
		<CommandPrimitive.Group
			data-slot="command-group"
			className={cn(
				"overflow-hidden **:[[cmdk-group-heading]]:px-3 **:[[cmdk-group-heading]]:pt-2 **:[[cmdk-group-heading]]:pb-1.5 **:[[cmdk-group-heading]]:text-caption **:[[cmdk-group-heading]]:font-medium **:[[cmdk-group-heading]]:text-fg-subtle",
				className,
			)}
			{...props}
		/>
	);
}

function CommandSeparator({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Separator>) {
	return (
		<CommandPrimitive.Separator
			data-slot="command-separator"
			className={cn("mx-1 my-1 h-px bg-border", className)}
			{...props}
		/>
	);
}

function CommandItem({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Item>) {
	return (
		<CommandPrimitive.Item
			data-slot="command-item"
			className={cn(
				"group/command-item relative flex cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 text-body outline-none select-none data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 data-[selected=true]:bg-surface-2 coarse:py-3 [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-fg-muted data-[selected=true]:[&>svg]:text-brand-ink",
				className,
			)}
			{...props}
		/>
	);
}

function CommandShortcut({ className, ...props }: React.ComponentProps<"span">) {
	return (
		<span
			data-slot="command-shortcut"
			className={cn("ml-auto truncate text-caption text-fg-subtle", className)}
			{...props}
		/>
	);
}

export {
	Command,
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandSeparator,
	CommandShortcut,
};
