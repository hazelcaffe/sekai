import { AgentAvatar } from "@sekai/client";
import type { Agent, Conversation } from "@sekai/shared";
import { IconButton, List, Row, Section } from "@sekai/ui";
import { SlidersHorizontal, X } from "lucide-react";
import { useNavigate } from "react-router";
import { GroupPanel } from "../group/GroupPanel.tsx";
import { ContextMeter } from "./ContextMeter.tsx";

/**
 * A chat's details, beside it (or a sheet on phones): for a bot's chat, what the bot reads on its next turn (the
 * context, the full prompt, compact, reset) and the way to the bot's settings; for a group, its name, purpose,
 * members, reply limits and routing model.
 */
export function ChatDetails({
	conversation,
	agent,
	members,
	onClose,
}: {
	conversation: Conversation;
	agent: Agent | null;
	members: Agent[];
	onClose: () => void;
}) {
	const navigate = useNavigate();
	const group = conversation.kind === "group";
	return (
		<div className="flex h-full min-h-0 flex-col pt-safe">
			<div className="flex items-center gap-2 border-b border-border px-4 py-2">
				<h2 className="min-w-0 flex-1 truncate text-heading font-semibold">
					{group ? "Group details" : "Chat details"}
				</h2>
				<IconButton label="Close details" onClick={onClose}>
					<X />
				</IconButton>
			</div>
			<div className="flex min-h-0 flex-1 flex-col gap-7 overflow-y-auto px-4 pt-4 pb-safe-6 scrollbar-thin">
				{group && <GroupPanel conversation={conversation} members={members} />}
				{agent && (
					<List>
						<Row
							leading={<AgentAvatar avatar={agent.avatar} size={32} />}
							title={agent.name}
							subtitle={agent.sharedBy ? `Shared by ${agent.sharedBy}` : agent.label || undefined}
							trailing={<SlidersHorizontal className="size-4 text-fg-subtle" />}
							onClick={() => navigate(`/bots/${agent.id}`)}
						/>
					</List>
				)}
				{agent && !agent.sharedBy ? (
					<Section title="Context" description="What the bot reads before its next reply.">
						<ContextMeter agent={agent} conversation={conversation} />
					</Section>
				) : agent ? (
					<p className="text-small text-fg-subtle">
						{agent.name} is {agent.sharedBy}'s bot: what it reads on each turn is theirs to see.
					</p>
				) : null}
			</div>
		</div>
	);
}
