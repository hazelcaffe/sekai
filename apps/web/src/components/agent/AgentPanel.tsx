import { AgentAvatar, api, cn } from "@sekai/client";
import type { Agent, Conversation } from "@sekai/shared";
import { Dialog, IconButton, Segmented, Tabs, TabsContent, TabsList, TabsTrigger } from "@sekai/ui";
import { useMutation } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useState } from "react";
import { type PanelTab, useAgentPresence, useUi } from "../../stores/ui.ts";
import { AvatarEditor } from "../avatar/AvatarEditor.tsx";
import { AccountsTab } from "./AccountsTab.tsx";
import { ActivityTab } from "./ActivityTab.tsx";
import { BrainTab } from "./BrainTab.tsx";
import { CodeTab } from "./CodeTab.tsx";
import { ModelTab } from "./ModelTab.tsx";
import { NotesTab } from "./NotesTab.tsx";
import { ProfileTab } from "./ProfileTab.tsx";
import { RoutinesTab } from "./RoutinesTab.tsx";
import { SharedAgentPanel } from "./SharedAgentPanel.tsx";
import { AppsTab, ToolsTab } from "./ToolsTab.tsx";
import { VoiceTab } from "./VoiceTab.tsx";

type Section = "profile" | "memory" | "routines" | "tools" | "activity";

/** Five tabs, each holding one or two closely related views. */
const TABS: { value: Section; label: string }[] = [
	{ value: "profile", label: "Profile" },
	{ value: "memory", label: "Memory" },
	{ value: "routines", label: "Routines" },
	{ value: "tools", label: "Tools" },
	{ value: "activity", label: "Activity" },
];

const SECTION_OF: Record<PanelTab, Section> = {
	profile: "profile",
	model: "profile",
	voice: "profile",
	brain: "memory",
	notes: "memory",
	code: "memory",
	routines: "routines",
	tools: "tools",
	apps: "tools",
	accounts: "tools",
	channels: "tools",
	"discord-user": "tools",
	x: "tools",
	instagram: "tools",
	tiktok: "tools",
	activity: "activity",
};

/** What each tab opens to. */
const FIRST_VIEW: Record<Section, PanelTab> = {
	profile: "profile",
	memory: "brain",
	routines: "routines",
	tools: "tools",
	activity: "activity",
};

/** The first view in a tab is its default; the switch at the top picks the second. */
function Sub<T extends PanelTab>({
	value,
	options,
	onChange,
}: {
	value: T;
	options: { value: T; label: string }[];
	onChange: (v: T) => void;
}) {
	return <Segmented value={value} onValueChange={onChange} options={options} className="mb-4" />;
}

/** The bot's details: who it is, how it thinks, what it remembers, what it runs and what it may do. */
export function AgentPanel({
	agent,
	conversation,
	onClose,
}: {
	agent: Agent;
	conversation: Conversation;
	onClose: () => void;
}) {
	// Someone else's bot, shared with you: a simpler panel (its setup is theirs).
	if (agent.sharedBy) return <SharedAgentPanel agent={agent} conversation={conversation} onClose={onClose} />;
	return <OwnAgentPanel agent={agent} conversation={conversation} onClose={onClose} />;
}

function OwnAgentPanel({
	agent,
	conversation,
	onClose,
}: {
	agent: Agent;
	conversation: Conversation;
	onClose: () => void;
}) {
	const view = useUi((s) => s.panelTab);
	const section = SECTION_OF[view] ?? "profile";
	const setView = (t: PanelTab) => useUi.setState({ panelTab: t });
	const [avatarOpen, setAvatarOpen] = useState(false);
	const presence = useAgentPresence(agent.id);
	const update = useMutation({
		mutationFn: (patch: Parameters<typeof api.agents.update>[1]) => api.agents.update(agent.id, patch),
	});

	return (
		<div className="flex h-full min-h-0 flex-col pt-safe">
			<div className="flex items-start gap-3 px-4 pt-4 pb-3">
				<button
					type="button"
					onClick={() => setAvatarOpen(true)}
					className="rounded-full"
					aria-label="Change picture"
				>
					<AgentAvatar
						avatar={agent.avatar}
						size={52}
						state={presence.state}
						alive
						title={presence.label ?? undefined}
					/>
				</button>
				<div className="min-w-0 flex-1 pt-1">
					<div className="truncate text-[17px] font-semibold tracking-tight">{agent.name}</div>
					<div
						className={cn(
							"truncate text-[13px]",
							presence.state === "thinking" || presence.state === "working"
								? "shimmer-text"
								: presence.state === "waiting"
									? "text-warning"
									: presence.state === "blocked"
										? "text-danger"
										: "text-fg-subtle",
						)}
					>
						{presence.state === "idle" || presence.state === "done"
							? agent.label || "Add a label"
							: presence.state === "thinking" || presence.state === "working"
								? `${presence.label ?? "Working"}…`
								: presence.label}
					</div>
				</div>
				<IconButton label="Close" onClick={onClose}>
					<X />
				</IconButton>
			</div>
			<Tabs
				value={section}
				onValueChange={(v) => setView(FIRST_VIEW[v as Section] ?? "profile")}
				className="flex min-h-0 flex-1 flex-col"
			>
				<TabsList className="border-b border-border px-3 pb-2">
					{TABS.map((t) => (
						<TabsTrigger key={t.value} value={t.value}>
							{t.label}
						</TabsTrigger>
					))}
				</TabsList>
				<div className="min-h-0 flex-1 overflow-y-auto pb-safe scrollbar-thin">
					<TabsContent value="profile" className="p-4">
						<Sub
							value={view === "model" || view === "voice" ? view : "profile"}
							onChange={setView}
							options={[
								{ value: "profile", label: "About" },
								{ value: "model", label: "Model" },
								{ value: "voice", label: "Voice" },
							]}
						/>
						{view === "model" ? (
							<ModelTab agent={agent} />
						) : view === "voice" ? (
							<VoiceTab agent={agent} />
						) : (
							<ProfileTab agent={agent} />
						)}
					</TabsContent>
					<TabsContent value="memory" className="p-4">
						<Sub
							value={view === "notes" || view === "code" ? view : "brain"}
							onChange={setView}
							options={[
								{ value: "brain", label: "Brain" },
								{ value: "notes", label: "Notes" },
								{ value: "code", label: "Code" },
							]}
						/>
						{view === "notes" ? (
							<NotesTab agent={agent} />
						) : view === "code" ? (
							<CodeTab key={agent.id} agent={agent} />
						) : (
							<BrainTab agent={agent} conversation={conversation} />
						)}
					</TabsContent>
					<TabsContent value="routines" className="p-4">
						<RoutinesTab agent={agent} conversation={conversation} />
					</TabsContent>
					<TabsContent value="tools" className="p-4">
						<Sub
							value={
								view === "apps"
									? "apps"
									: ["accounts", "channels", "x", "discord-user", "instagram", "tiktok"].includes(
												view,
											)
										? "accounts"
										: "tools"
							}
							onChange={setView}
							options={[
								{ value: "tools", label: "Access" },
								{ value: "apps", label: "Apps & skills" },
								{ value: "accounts", label: "Accounts" },
							]}
						/>
						{view === "apps" ? (
							<AppsTab agent={agent} />
						) : view === "accounts" ||
							view === "channels" ||
							view === "discord-user" ||
							view === "x" ||
							view === "instagram" ||
							view === "tiktok" ? (
							<AccountsTab agent={agent} view={view} onView={setView} />
						) : (
							<ToolsTab agent={agent} conversation={conversation} />
						)}
					</TabsContent>
					<TabsContent value="activity" className="p-4">
						<ActivityTab agent={agent} />
					</TabsContent>
				</div>
			</Tabs>
			<Dialog open={avatarOpen} onOpenChange={setAvatarOpen} title="Change picture">
				<AvatarEditor
					value={agent.avatar}
					agentId={agent.id}
					agentName={agent.name}
					onSave={(avatar) => {
						update.mutate({ avatar });
						setAvatarOpen(false);
					}}
				/>
			</Dialog>
		</div>
	);
}
