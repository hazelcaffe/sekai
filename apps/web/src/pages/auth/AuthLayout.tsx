import { SekaiMark } from "@sekai/ui";
import type { ReactNode } from "react";

/** The calm, centered frame around sign-in and setup, with a soft brand glow behind it. */
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
		<div className="relative flex min-h-dvh flex-col items-center overflow-y-auto px-5 pt-safe pb-safe">
			<div
				aria-hidden
				className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(60%_60%_at_50%_0%,color-mix(in_oklab,var(--brand)_18%,transparent),transparent)]"
			/>
			<main className="relative flex w-full max-w-[400px] flex-1 flex-col justify-center py-10">
				<div className="mb-7 flex flex-col items-center text-center">
					<SekaiMark
						size={48}
						className="mb-5 animate-float drop-shadow-[0_8px_18px_color-mix(in_oklab,var(--brand)_35%,transparent)]"
					/>
					<h1 className="font-heading text-2xl font-semibold tracking-tight">{title}</h1>
					{subtitle && (
						<p className="mt-2 max-w-xs text-sm leading-6 text-balance text-muted-foreground">{subtitle}</p>
					)}
				</div>
				<div className="rounded-[28px] border border-border bg-card p-5 shadow-soft sm:p-6">{children}</div>
				{footer && <div className="mt-6 text-center text-xs leading-5 text-fg-subtle">{footer}</div>}
			</main>
		</div>
	);
}

/** "or" between the passkey button and the password form. */
export function OrDivider() {
	return (
		<div className="my-5 flex items-center gap-3 text-xs font-medium text-fg-subtle">
			<span className="h-px flex-1 bg-border" />
			or
			<span className="h-px flex-1 bg-border" />
		</div>
	);
}
