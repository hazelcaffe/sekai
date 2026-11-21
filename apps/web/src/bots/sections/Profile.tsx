import { AgentAvatar } from "@sekai/client";
import { Badge, Button, Callout, Dialog, List, Page, Row, SaveState, Section, ToggleRow, useAutosave } from "@sekai/ui";
import { useMutation } from "@tanstack/react-query";
import { Share2 } from "lucide-react";
import { useState } from "react";
import { BotActions } from "../../components/agent/BotActions.tsx";
import { ProfileForm } from "../../components/agent/ProfileForm.tsx";
import { Sharing } from "../../components/agent/Sharing.tsx";
import { AvatarEditor } from "../../components/avatar/AvatarEditor.tsx";
import type { BotSectionProps } from "../section.ts";
import { useAgentUpdate } from "../useAgentUpdate.ts";

/** Who the bot is: its picture, name, job, personality and instructions; sharing; duplicate, export, delete. */
export function ProfileSection({ agent, back, readOnly }: BotSectionProps) {
	const update = useAgentUpdate(agent);
	const status = useAutosave(update);
	const picture = useMutation({ mutationFn: update });
	const [pictureOpen, setPictureOpen] = useState(false);

	if (readOnly) {
		// Someone else's bot: who it is, read only (its setup, including its standing instructions, is theirs).
		return (
			<Page back={back} title="Profile">
				<div className="flex items-center gap-4">
					<AgentAvatar avatar={agent.avatar} size={72} />
					<div className="min-w-0">
						<div className="truncate text-heading font-semibold">{agent.name}</div>
						{agent.label && <div className="truncate text-body text-fg-muted">{agent.label}</div>}
					</div>
				</div>
				<Callout tone="info" icon={<Share2 />}>
					Your chats with {agent.name} are yours, and it remembers you separately. Only {agent.sharedBy} can
					change how it works.
				</Callout>
				{agent.job && (
					<Section title="Job">
						<p className="text-body whitespace-pre-wrap text-fg-muted">{agent.job}</p>
					</Section>
				)}
				{agent.personality && (
					<Section title="Personality">
						<p className="text-body whitespace-pre-wrap text-fg-muted">{agent.personality}</p>
					</Section>
				)}
			</Page>
		);
	}

	return (
		<Page back={back} title="Profile" description={`Who ${agent.name} is and how it works with you.`}>
			<div className="flex items-center gap-4">
				<AgentAvatar avatar={agent.avatar} size={72} />
				<Button variant="secondary" size="sm" onClick={() => setPictureOpen(true)}>
					Change picture
				</Button>
			</div>
			<ProfileForm agent={agent} />
			<Section title="Status" saveState={<SaveState state={status} />}>
				<List label="Status">
					{agent.isPrimary ? (
						<Row
							title="Primary bot"
							subtitle="Your main contact. Make another bot primary to change it."
							badge={<Badge tone="brand">Primary</Badge>}
						/>
					) : (
						<ToggleRow
							title="Primary bot"
							description="Your main contact. It coordinates the other bots."
							checked={false}
							onCheckedChange={(on) => on && status.save({ isPrimary: true })}
						/>
					)}
					<ToggleRow
						title="Active"
						description="Paused bots don't reply and their routines don't run."
						checked={agent.status === "active"}
						onCheckedChange={(on) => status.save({ status: on ? "active" : "paused" })}
					/>
				</List>
			</Section>
			<Sharing agent={agent} />
			<BotActions agent={agent} />
			<Dialog open={pictureOpen} onOpenChange={setPictureOpen} title="Change picture">
				<AvatarEditor
					value={agent.avatar}
					agentId={agent.id}
					agentName={agent.name}
					onSave={(avatar) => {
						picture.mutate({ avatar });
						setPictureOpen(false);
					}}
				/>
			</Dialog>
		</Page>
	);
}
