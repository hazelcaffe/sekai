import { IconButton } from "@sekai/ui";
import { Menu } from "lucide-react";
import type { ReactNode } from "react";
import { useLayout } from "../../lib/hooks.ts";
import { useUi } from "../../stores/ui.ts";

/** Header + scrollable body for full pages (Activity, Inbox, Apps, Settings). */
export function Page({
	title,
	description,
	actions,
	children,
	wide,
}: {
	title: string;
	description?: ReactNode;
	actions?: ReactNode;
	children: ReactNode;
	wide?: boolean;
}) {
	const { phone } = useLayout();
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<header className="flex h-14 shrink-0 items-center gap-2 border-b border-border/60 px-2 pt-safe md:px-4">
				{phone && (
					<IconButton label="Menu" onClick={() => useUi.getState().setSidebarOpen(true)}>
						<Menu />
					</IconButton>
				)}
				<h1 className="truncate px-1 text-[15px] font-semibold">{title}</h1>
				<div className="ml-auto flex items-center gap-1">{actions}</div>
			</header>
			<div className="min-h-0 flex-1 overflow-y-auto pb-safe scrollbar-thin">
				<div className={`mx-auto w-full px-4 py-6 md:px-8 md:py-8 ${wide ? "max-w-5xl" : "max-w-3xl"}`}>
					{description && <p className="mb-6 text-sm leading-6 text-fg-muted">{description}</p>}
					{children}
				</div>
			</div>
		</div>
	);
}
