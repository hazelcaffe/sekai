import { type ReactNode, useEffect, useRef } from "react";
import { cn } from "../lib/utils.ts";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../shadcn/tabs.tsx";
import { usePageStyle } from "./page-style.tsx";

export interface SettingsTab {
	value: string;
	label: string;
	icon: ReactNode;
	/** A small count or dot after the label (for example pending approvals). */
	badge?: ReactNode;
}

/**
 * Tabbed settings: icon chips that scroll sideways on phones and tablets, a side rail on large screens.
 * Put a SettingsPanel for each tab inside.
 */
export function SettingsTabs({
	tabs,
	value,
	onValueChange,
	children,
	className,
	railFooter,
}: {
	tabs: SettingsTab[];
	value: string;
	onValueChange: (value: string) => void;
	children: ReactNode;
	className?: string;
	/** Extra content under the rail on large screens (for example a sign-out button). */
	railFooter?: ReactNode;
}) {
	const list = useRef<HTMLDivElement>(null);
	// On phones the chips scroll sideways: keep the chosen one in view.
	// biome-ignore lint/correctness/useExhaustiveDependencies: runs when the chosen tab changes
	useEffect(() => {
		const el = list.current?.querySelector<HTMLElement>(`[data-state="active"]`);
		const box = list.current;
		if (!el || !box || box.scrollWidth <= box.clientWidth) return;
		box.scrollTo({ left: el.offsetLeft - (box.clientWidth - el.offsetWidth) / 2, behavior: "smooth" });
	}, [value]);
	return (
		<Tabs
			value={value}
			onValueChange={onValueChange}
			className={cn("lg:grid lg:grid-cols-[210px_minmax(0,1fr)] lg:items-start lg:gap-10", className)}
		>
			<div className="-mx-4 px-4 md:mx-0 md:px-0 lg:sticky lg:top-4">
				<TabsList ref={list} variant="rail" aria-label="Settings sections" className="pb-1 lg:pb-0">
					{tabs.map((t) => (
						<TabsTrigger key={t.value} value={t.value}>
							{t.icon}
							<span>{t.label}</span>
							{t.badge != null && <span className="lg:ml-auto">{t.badge}</span>}
						</TabsTrigger>
					))}
				</TabsList>
				{railFooter && <div className="mt-4 hidden border-t border-border pt-4 lg:block">{railFooter}</div>}
			</div>
			<div className="mt-6 min-w-0 lg:mt-0">{children}</div>
		</Tabs>
	);
}

/** One settings tab's content, with its own heading. */
export function SettingsPanel({
	value,
	title,
	description,
	action,
	children,
	className,
}: {
	value: string;
	title: ReactNode;
	description?: ReactNode;
	action?: ReactNode;
	children: ReactNode;
	className?: string;
}) {
	const style = usePageStyle();
	if (style === "page") {
		return (
			<TabsContent value={value} className={cn("flex max-w-3xl flex-col gap-10", className)}>
				<header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
					<div className="min-w-0">
						<h1 data-page-title className="font-heading text-[26px] leading-8 font-semibold tracking-tight">
							{title}
						</h1>
						{description && (
							<p className="mt-2 max-w-2xl text-[15px] leading-6 text-pretty text-fg-muted">
								{description}
							</p>
						)}
					</div>
					{action}
				</header>
				{children}
			</TabsContent>
		);
	}
	return (
		<TabsContent value={value} className={cn("flex max-w-2xl flex-col gap-8", className)}>
			<header className="flex items-start justify-between gap-4">
				<div className="min-w-0">
					<h2 className="font-heading text-xl font-semibold tracking-tight">{title}</h2>
					{description && <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>}
				</div>
				{action}
			</header>
			{children}
		</TabsContent>
	);
}

/** A bordered group of rows, divided by hairlines, like an iOS settings list. */
export function SettingsGroup({ children, className }: { children: ReactNode; className?: string }) {
	return (
		<div className={cn("divide-y divide-border rounded-2xl border border-border bg-card", className)}>
			{children}
		</div>
	);
}

/** A row inside a SettingsGroup: icon, title and description on the left, a control on the right. */
export function SettingsRow({
	icon,
	title,
	description,
	children,
	className,
}: {
	icon?: ReactNode;
	title: ReactNode;
	description?: ReactNode;
	children?: ReactNode;
	className?: string;
}) {
	return (
		<div className={cn("flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3.5", className)}>
			<div className="flex min-w-0 flex-1 basis-56 items-center gap-3">
				{icon && (
					<span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground [&_svg]:size-[18px]">
						{icon}
					</span>
				)}
				<div className="min-w-0">
					<div className="text-sm font-medium">{title}</div>
					{description && <div className="mt-0.5 text-xs leading-5 text-fg-subtle">{description}</div>}
				</div>
			</div>
			{children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
		</div>
	);
}
