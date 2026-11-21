import { CircleAlert } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { cn } from "../lib/utils.ts";
import { Button } from "../shadcn/button.tsx";
import { Skeleton } from "../shadcn/skeleton.tsx";
import { IconTile, type Tone } from "./misc.tsx";

export { Skeleton };

/** Nothing here yet: an optional icon, one sentence, an optional one-line description, one action. */
export function EmptyState({
	icon,
	title,
	description,
	action,
	className,
	tone = "neutral",
	size = "md",
}: {
	icon?: ReactNode;
	/** One sentence. */
	title: ReactNode;
	description?: ReactNode;
	/** One action, usually a Button. */
	action?: ReactNode;
	className?: string;
	tone?: Tone;
	/** "sm" inside a section or panel; "md" for a page. */
	size?: "sm" | "md";
}) {
	return (
		<div
			data-slot="empty-state"
			className={cn(
				"flex flex-col items-center justify-center text-center",
				size === "sm" ? "px-4 py-8" : "px-6 py-12",
				className,
			)}
		>
			{icon && (
				<IconTile tone={tone} size={size === "sm" ? "md" : "lg"} className="mb-4">
					{icon}
				</IconTile>
			)}
			<div className="text-heading font-semibold text-fg">{title}</div>
			{description && <div className="mt-1 max-w-sm text-small text-fg-muted">{description}</div>}
			{action && <div className="mt-5">{action}</div>}
		</div>
	);
}

/**
 * What went wrong, in words people understand: network failures become "couldn't reach Sekai"; Sekai's own errors
 * (full sentences from the server) pass through; anything else gets a general sentence.
 */
export function errorMessage(error: unknown): string {
	const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
	if (!raw) return "Something went wrong. Try again in a moment.";
	if (/failed to fetch|networkerror|network request failed|load failed|err_network/i.test(raw)) {
		return "Couldn't reach Sekai. Check your connection and try again.";
	}
	// A bare status line ("502 Bad Gateway") from the server or a proxy in front of it.
	if (/^5\d\d(\s|$)/.test(raw)) return "Sekai's server had a problem. Try again in a moment.";
	if (/^\s*(\{|<|TypeError|ReferenceError|SyntaxError)|is not a function|undefined|null/i.test(raw)) {
		return "Something went wrong on this screen. Try again, or reload the app.";
	}
	return raw;
}

/** A query that failed (or a screen that crashed): what happened, and Try again. */
export function ErrorState({
	title = "This didn't load",
	error,
	description,
	onRetry,
	className,
	size = "md",
}: {
	title?: ReactNode;
	/** The error, turned into a sentence with errorMessage() unless `description` says it. */
	error?: unknown;
	description?: ReactNode;
	onRetry?: () => void;
	className?: string;
	size?: "sm" | "md";
}) {
	return (
		<div
			role="alert"
			data-slot="error-state"
			className={cn(
				"flex flex-col items-center justify-center text-center",
				size === "sm" ? "px-4 py-8" : "px-6 py-12",
				className,
			)}
		>
			<IconTile tone="danger" size={size === "sm" ? "md" : "lg"} className="mb-4">
				<CircleAlert />
			</IconTile>
			<div className="text-heading font-semibold text-fg">{title}</div>
			<div className="mt-1 max-w-sm text-small text-fg-muted">{description ?? errorMessage(error)}</div>
			{onRetry && (
				<Button variant="secondary" className="mt-5" onClick={onRetry}>
					Try again
				</Button>
			)}
		</div>
	);
}

/**
 * Catches a crash below it and shows ErrorState instead of a white screen. Put one around each route; `resetKey`
 * (the route's path) clears it when you go somewhere else.
 */
export class ErrorBoundary extends Component<
	{ children: ReactNode; resetKey?: unknown; fallback?: (error: unknown, reset: () => void) => ReactNode },
	{ error: unknown; key: unknown }
> {
	override state: { error: unknown; key: unknown } = { error: null, key: this.props.resetKey };

	static getDerivedStateFromError(error: unknown) {
		return { error };
	}

	static getDerivedStateFromProps(
		props: { resetKey?: unknown },
		state: { error: unknown; key: unknown },
	): { error: unknown; key: unknown } | null {
		return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null;
	}

	override componentDidCatch(error: unknown, info: ErrorInfo) {
		console.error("A screen crashed", error, info.componentStack);
	}

	reset = () => this.setState({ error: null });

	override render() {
		if (!this.state.error) return this.props.children;
		if (this.props.fallback) return this.props.fallback(this.state.error, this.reset);
		return (
			<ErrorState
				className="min-h-[50dvh]"
				title="This screen ran into a problem"
				description="Try again, or reload the app if it keeps happening."
				onRetry={this.reset}
			/>
		);
	}
}

/** Loading a list: rows shaped like the real ones (an optional leading circle, a title and a muted line). */
export function SkeletonRows({
	count = 4,
	leading = true,
	inset = true,
	className,
}: {
	count?: number;
	leading?: boolean;
	/** Inside a List-like group (rounded surface, hairlines), as the loaded rows will be. */
	inset?: boolean;
	className?: string;
}) {
	return (
		<div
			role="status"
			aria-label="Loading"
			className={cn(inset && "divide-y divide-border rounded-lg border border-border bg-surface", className)}
		>
			{Array.from({ length: count }, (_, i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: placeholders are positional
				<div key={i} className="flex items-center gap-3 px-4 py-3">
					{leading && <Skeleton className="size-8 shrink-0 rounded-full" />}
					<div className="flex min-w-0 flex-1 flex-col gap-1.5">
						<Skeleton className="h-3.5" style={{ width: `${[46, 62, 38, 54][i % 4]}%` }} />
						<Skeleton className="h-3 w-1/4 opacity-70" />
					</div>
				</div>
			))}
		</div>
	);
}

/** Loading a page: a title, a line, then a section of rows. */
export function SkeletonPage({ className }: { className?: string }) {
	return (
		<div role="status" aria-label="Loading" className={cn("flex flex-col gap-8", className)}>
			<div className="flex flex-col gap-2">
				<Skeleton className="h-7 w-48" />
				<Skeleton className="h-4 w-80 max-w-full opacity-70" />
			</div>
			<div className="flex flex-col gap-3">
				<Skeleton className="h-4 w-32" />
				<SkeletonRows count={3} />
			</div>
		</div>
	);
}

/** Loading a chat: a few message shapes, the bot's as text lines and yours as a bubble. */
export function SkeletonChat({ className }: { className?: string }) {
	return (
		<div role="status" aria-label="Loading" className={cn("flex flex-col gap-8 px-4 py-6", className)}>
			{[0, 1, 2].map((i) => (
				<div key={i} className="flex flex-col gap-6">
					<div className="flex justify-end">
						<Skeleton className="h-10 w-2/5 rounded-xl" />
					</div>
					<div className="flex gap-3">
						<Skeleton className="size-8 shrink-0 rounded-full" />
						<div className="flex flex-1 flex-col gap-2">
							<Skeleton className="h-4 w-11/12" />
							<Skeleton className="h-4 w-4/5" />
							<Skeleton className="h-4 w-3/5" />
						</div>
					</div>
				</div>
			))}
		</div>
	);
}
