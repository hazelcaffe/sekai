import { CircleCheckIcon, InfoIcon, Loader2Icon, OctagonXIcon, TriangleAlertIcon } from "lucide-react";
import type * as React from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

/** Sonner toasts dressed as Sekai cards: rounded, soft shadow, tinted status icons. */
function Toaster({ theme = "system", toastOptions, ...props }: ToasterProps) {
	return (
		<Sonner
			theme={theme}
			className="toaster group"
			icons={{
				success: <CircleCheckIcon className="size-4 text-success" />,
				info: <InfoIcon className="size-4 text-info" />,
				warning: <TriangleAlertIcon className="size-4 text-warning" />,
				error: <OctagonXIcon className="size-4 text-destructive" />,
				loading: <Loader2Icon className="size-4 animate-spin text-fg-subtle" />,
			}}
			style={
				{
					"--normal-bg": "var(--popover)",
					"--normal-text": "var(--popover-foreground)",
					"--normal-border": "var(--border)",
					"--border-radius": "1rem",
				} as React.CSSProperties
			}
			{...props}
			toastOptions={{
				...toastOptions,
				classNames: {
					toast: "!rounded-2xl !border-border !bg-popover !text-popover-foreground !shadow-pop !gap-2.5",
					description: "!text-muted-foreground",
					actionButton: "!rounded-lg !bg-primary !text-primary-foreground !font-medium",
					cancelButton: "!rounded-lg !bg-muted !text-foreground",
					...toastOptions?.classNames,
				},
			}}
		/>
	);
}

export { Toaster };
