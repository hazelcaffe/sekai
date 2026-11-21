import { DropdownContent, DropdownEntries, DropdownMenu, DropdownTrigger, IconButton, type MenuEntry } from "@sekai/ui";
import { Ellipsis } from "lucide-react";

/** A "…" button that opens a menu (an action sheet on phones): for the rest of a section's actions. */
export function MoreMenu({ entries, label = "More" }: { entries: MenuEntry[]; label?: string }) {
	return (
		<DropdownMenu>
			<DropdownTrigger asChild>
				<IconButton label={label} variant="ghost" size="icon-sm">
					<Ellipsis />
				</IconButton>
			</DropdownTrigger>
			<DropdownContent title={label}>
				<DropdownEntries entries={entries} />
			</DropdownContent>
		</DropdownMenu>
	);
}
