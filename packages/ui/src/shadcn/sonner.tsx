import { CircleCheckIcon, InfoIcon, Loader2Icon, OctagonXIcon, TriangleAlertIcon } from "lucide-react";
import type * as React from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import { useIsPhone } from "../lib/platform.ts";

/**
 * Toasts dressed as Sekai cards: rounded, soft shadow, tinted status icons. At the bottom on phones (above the safe
 * area, plus --toast-lift when a bar or the composer sits there), where `position` says elsewhere; Material 3
 * snackbars on Android (the inverse surface, no icon).
 */
function Toaster({ theme = "system", toastOptions, position = "top-center", ...props }: ToasterProps) {
	const phone = useIsPhone();
	return (
		<Sonner
			theme={theme}
			className="toaster group"
			position={phone ? "bottom-center" : position}
			offset={{ top: "calc(var(--safe-top) + 12px)", bottom: "calc(var(--safe-bottom) + 16px)" }}
			mobileOffset={{
				top: "calc(var(--safe-top) + 8px)",
				bottom: "calc(var(--safe-bottom) + var(--toast-lift, 0px) + 8px)",
				left: "12px",
				right: "12px",
			}}
			icons={{
				success: <CircleCheckIcon className="size-4 text-success-ink" />,
				info: <InfoIcon className="size-4 text-info-ink" />,
				warning: <TriangleAlertIcon className="size-4 text-warning-ink" />,
				error: <OctagonXIcon className="size-4 text-danger-ink" />,
				loading: <Loader2Icon className="size-4 animate-spin text-fg-subtle" />,
			}}
			style={
				{
					"--normal-bg": "var(--surface-raised)",
					"--normal-text": "var(--fg)",
					"--normal-border": "var(--border)",
					"--border-radius": "12px",
				} as React.CSSProperties
			}
			{...props}
			toastOptions={{
				...toastOptions,
				classNames: {
					toast: "!rounded-lg !border-border !bg-surface-raised !text-fg !shadow-pop !gap-2.5 !text-body android:!rounded-sm android:!border-transparent android:!bg-fg android:!text-bg android:[&_[data-icon]]:!hidden",
					title: "!font-medium",
					description: "!text-small !text-fg-muted android:!text-bg/80",
					actionButton:
						"!rounded-md !bg-primary !text-primary-foreground !font-medium android:!bg-transparent android:!text-brand-soft",
					cancelButton: "!rounded-md !bg-surface-2 !text-fg",
					...toastOptions?.classNames,
				},
			}}
		/>
	);
}

export { Toaster };
