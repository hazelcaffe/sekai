import { AgentAvatar } from "@sekai/client";
import type { Agent, Conversation } from "@sekai/shared";
import { Badge, Callout, IconButton, Section, Segmented, Tabs, TabsContent, TabsList, TabsTrigger } from "@sekai/ui";
import { Share2, X } from "lucide-react";
import { useState } from "react";
import { useAgentPresence } from "../../stores/ui.ts";
import { ActivityTab } from "./ActivityTab.tsx";
import { BrainTab } from "./BrainTab.tsx";
import { NotesTab } from "./NotesTab.tsx";
import { RoutinesTab } from "./RoutinesTab.tsx";

type View = "about" | "memory" | "routines" | "activity";

/**
 * A bot someone shared with you: who it is, what it remembers about you, your routines with it and what it did in
 * your chats. Its setup is its owner's, so there's nothing to change here.
 */
export function SharedAgentPanel({
	agent,
	conversation,
	onClose,
}: {
	agent: Agent;
	conversation: Conversation;
	onClose: () => void;
}) {
	const [tab, setTab] = useState<View>("about");
	const [memoryView, setMemoryView] = useState<"brain" | "notes">("brain");
	const presence = useAgentPresence(agent.id);
	return (
		<div className="flex h-full min-h-0 flex-col pt-safe">
			<div className="flex items-start gap-3 px-4 pt-4 pb-3">
				<AgentAvatar avatar={agent.avatar} size={52} state={presence.state} alive />
				<div className="min-w-0 flex-1 pt-1">
					<div className="truncate text-[17px] font-semibold tracking-tight">{agent.name}</div>
					<div className="flex items-center gap-1.5 truncate text-[13px] text-fg-subtle">
						<Badge tone="info">
							<Share2 /> Shared by {agent.sharedBy}
						</Badge>
						{agent.label && <span className="truncate">{agent.label}</span>}
					</div>
				</div>
				<IconButton label="Close" onClick={onClose}>
					<X />
				</IconButton>
			</div>
			<Tabs value={tab} onValueChange={(v) => setTab(v as View)} className="flex min-h-0 flex-1 flex-col">
				<TabsList className="border-b border-border px-3 pb-2">
					<TabsTrigger value="about">About</TabsTrigger>
					<TabsTrigger value="memory">Memory</TabsTrigger>
					<TabsTrigger value="routines">Routines</TabsTrigger>
					<TabsTrigger value="activity">Activity</TabsTrigger>
				</TabsList>
				<div className="min-h-0 flex-1 overflow-y-auto pb-safe scrollbar-thin">
					<TabsContent value="about" className="flex flex-col gap-6 p-4">
						<Callout tone="info" icon={<Share2 />}>
							{agent.sharedBy} shared {agent.name} with you. Your chats with it are yours, and it
							remembers you separately. Only {agent.sharedBy} can change how it works.
						</Callout>
						{agent.job && (
							<Section title="Job">
								<p className="px-1 text-sm whitespace-pre-wrap text-fg-muted">{agent.job}</p>
							</Section>
						)}
						{agent.personality && (
							<Section title="Personality">
								<p className="px-1 text-sm whitespace-pre-wrap text-fg-muted">{agent.personality}</p>
							</Section>
						)}
					</TabsContent>
					<TabsContent value="memory" className="p-4">
						<Segmented
							value={memoryView}
							onValueChange={setMemoryView}
							options={[
								{ value: "brain", label: "Memory" },
								{ value: "notes", label: "Notes" },
							]}
							className="mb-4"
						/>
						{memoryView === "notes" ? (
							<NotesTab agent={agent} />
						) : (
							<BrainTab agent={agent} conversation={conversation} shared />
						)}
					</TabsContent>
					<TabsContent value="routines" className="p-4">
						<RoutinesTab agent={agent} conversation={conversation} />
					</TabsContent>
					<TabsContent value="activity" className="p-4">
						<ActivityTab agent={agent} />
					</TabsContent>
				</div>
			</Tabs>
		</div>
	);
}
