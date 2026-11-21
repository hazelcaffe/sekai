import { cn } from "@sekai/client";
import { Search } from "lucide-react";
import { useUi } from "../../stores/ui.ts";

/** A phone screen's search field (Chats, Settings): opens search (⌘K), scoped to Settings from there. */
export function SearchButton({
	label = "Search",
	scope = "all",
	className,
}: {
	label?: string;
	scope?: "all" | "settings";
	className?: string;
}) {
	return (
		<button
			type="button"
			onClick={() => useUi.getState().setPaletteOpen(true, scope)}
			className={cn(
				"flex h-10 w-full items-center gap-2 rounded-lg bg-surface-2 px-3 text-body text-fg-subtle android:h-12 android:rounded-full android:px-4",
				className,
			)}
		>
			<Search className="size-4" />
			{label}
		</button>
	);
}
