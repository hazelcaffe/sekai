import { SekaiMark } from "@sekai/ui";
import type { ReactNode } from "react";

/**
 * The one centred card before the app: setup, sign-in, two-step, invites and resets.
 * Flat on purpose. The mark is the only decoration.
 */
export function AuthLayout({
	title,
	subtitle,
	children,
	footer,
}: {
	title: ReactNode;
	subtitle?: ReactNode;
	children: ReactNode;
	footer?: ReactNode;
}) {
	return (
		<div className="flex min-h-dvh flex-col items-center overflow-y-auto px-4 pt-safe pb-safe sm:px-6">
			<main className="flex w-full max-w-[420px] flex-1 flex-col justify-center py-10">
				<div className="mb-6 flex flex-col items-center text-center">
					<SekaiMark size={44} className="mb-5" />
					<h1 className="font-heading text-title font-semibold tracking-tight text-balance">{title}</h1>
					{subtitle && <p className="mt-2 max-w-sm text-body text-balance text-fg-muted">{subtitle}</p>}
				</div>
				<div className="rounded-xl border border-border bg-surface p-5 sm:p-6">{children}</div>
				{footer && <div className="mt-5 text-center text-small text-pretty text-fg-subtle">{footer}</div>}
			</main>
		</div>
	);
}

/** "or" between a passkey or linked sign-in and the password form. */
export function OrDivider() {
	return (
		<div className="my-5 flex items-center gap-3 text-small text-fg-subtle">
			<span className="h-px flex-1 bg-border" />
			or
			<span className="h-px flex-1 bg-border" />
		</div>
	);
}
