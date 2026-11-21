import { useAccess } from "@sekai/client";
import { Button, EmptyState } from "@sekai/ui";
import { Bot, Plus } from "lucide-react";
import { useUi } from "../../stores/ui.ts";

/** No bots yet: make one (people who may), or wait for someone to share one (everyone else). */
export function NoBots({ size = "md", className }: { size?: "sm" | "md"; className?: string }) {
	const { can } = useAccess();
	const mayMake = can("bots");
	return (
		<EmptyState
			size={size}
			className={className}
			icon={<Bot />}
			title="No bots yet"
			description={
				mayMake
					? "Make one to start chatting. Bots someone shares with you show up here too."
					: "Ask someone to share a bot with you. It shows up here."
			}
			action={
				mayMake ? (
					<Button variant="primary" onClick={() => useUi.getState().setNewAgentOpen(true)}>
						<Plus /> New bot
					</Button>
				) : undefined
			}
		/>
	);
}
