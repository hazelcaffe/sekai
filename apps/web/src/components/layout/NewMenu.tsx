import { isMac, useAccess, useAgents } from "@sekai/client";
import { DropdownContent, DropdownEntries, DropdownMenu, DropdownTrigger, type MenuEntry } from "@sekai/ui";
import { Bot, FileUp, MessageSquarePlus, Users } from "lucide-react";
import type { ReactNode } from "react";
import { useUi } from "../../stores/ui.ts";

const NEW_CHAT = isMac ? "⌘N" : "Ctrl+N";
const NEW_GROUP = isMac ? "⌘⇧N" : "Ctrl+Shift+N";

/** New chat (pick a bot), New bot, New group, Import a bot: the [+] menu's entries. */
export function useNewEntries(): MenuEntry[] {
	const { data: agents = [] } = useAgents();
	const { can } = useAccess();
	const ui = useUi();
	return [
		{
			label: "New chat",
			icon: <MessageSquarePlus />,
			disabled: agents.length === 0,
			shortcut: NEW_CHAT,
			onSelect: () => ui.setNewChatOpen(true),
		},
		{ label: "New bot", icon: <Bot />, onSelect: () => ui.setNewAgentOpen(true) },
		{
			label: "New group",
			icon: <Users />,
			shortcut: NEW_GROUP,
			disabled: agents.length < 2,
			onSelect: () => ui.setNewGroupOpen(true),
		},
		can("bots") && { label: "Import a bot", icon: <FileUp />, onSelect: () => ui.setImportBotOpen(true) },
	];
}

/** The [+] button's menu (an action sheet on phones). `children` is the trigger. */
export function NewMenu({ children, align = "end" }: { children: ReactNode; align?: "start" | "end" }) {
	const entries = useNewEntries();
	return (
		<DropdownMenu>
			<DropdownTrigger asChild>{children}</DropdownTrigger>
			<DropdownContent align={align}>
				<DropdownEntries entries={entries} />
			</DropdownContent>
		</DropdownMenu>
	);
}
