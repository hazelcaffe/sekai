import { XIcon } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "../lib/utils.ts";
import { Button } from "./button.tsx";
import { overlayStyles } from "./overlay-styles.ts";

function Dialog(props: React.ComponentProps<typeof DialogPrimitive.Root>) {
	return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger(props: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
	return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal(props: React.ComponentProps<typeof DialogPrimitive.Portal>) {
	return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose(props: React.ComponentProps<typeof DialogPrimitive.Close>) {
	return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
	return (
		<DialogPrimitive.Overlay
			data-slot="dialog-overlay"
			className={cn(overlayStyles, "z-dialog", className)}
			{...props}
		/>
	);
}

/**
 * Sekai's responsive dialog shell: a bottom sheet with a grab handle on phones that slides up,
 * a centered card on tablets and desktops that springs in.
 */
function DialogContent({
	className,
	children,
	showCloseButton = true,
	...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & { showCloseButton?: boolean }) {
	return (
		<DialogPortal>
			<DialogOverlay />
			<DialogPrimitive.Content
				data-slot="dialog-content"
				className={cn(
					"fixed z-dialog flex flex-col bg-surface-raised text-fg shadow-pop outline-none",
					"inset-x-0 bottom-0 max-h-[92dvh] rounded-t-xl border-t border-border pb-safe android:rounded-t-sheet",
					"md:inset-auto md:top-1/2 md:left-1/2 md:max-h-[min(88dvh,860px)] md:w-[calc(100vw-48px)] md:max-w-lg md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-xl md:border md:pb-0 md:android:rounded-sheet",
					"duration-panel ease-standard data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 data-closed:duration-fast max-md:data-open:slide-in-from-bottom max-md:data-closed:slide-out-to-bottom md:ease-out-soft md:data-open:zoom-in-95 md:data-open:slide-in-from-bottom-2 md:data-closed:zoom-out-95",
					className,
				)}
				{...props}
			>
				<div
					aria-hidden
					data-slot="grabber"
					className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-border-strong/50 md:hidden"
				/>
				{children}
				{showCloseButton && (
					<DialogPrimitive.Close data-slot="dialog-close" asChild>
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label="Close"
							className="absolute top-4 right-3 md:top-4 md:right-4"
						>
							<XIcon />
						</Button>
					</DialogPrimitive.Close>
				)}
			</DialogPrimitive.Content>
		</DialogPortal>
	);
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="dialog-header"
			className={cn("flex shrink-0 flex-col gap-1 px-5 pt-4 pr-14 pb-2 md:px-6 md:pt-5 md:pr-14", className)}
			{...props}
		/>
	);
}

function DialogBody({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="dialog-body"
			className={cn("min-h-0 flex-1 overflow-y-auto px-5 pt-2 pb-5 scrollbar-thin md:px-6", className)}
			{...props}
		/>
	);
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="dialog-footer"
			className={cn(
				"flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-3.5 md:px-6",
				className,
			)}
			{...props}
		/>
	);
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
	return (
		<DialogPrimitive.Title
			data-slot="dialog-title"
			className={cn("font-heading text-heading font-semibold tracking-tight", className)}
			{...props}
		/>
	);
}

function DialogDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) {
	return (
		<DialogPrimitive.Description
			data-slot="dialog-description"
			className={cn("text-small text-fg-muted *:[a]:underline *:[a]:underline-offset-3", className)}
			{...props}
		/>
	);
}

export {
	Dialog,
	DialogBody,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogOverlay,
	DialogPortal,
	DialogTitle,
	DialogTrigger,
};
