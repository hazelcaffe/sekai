import { AgentAvatar, cn, useAgents } from "@sekai/client";
import { Button, EmptyState, ErrorBoundary, Link, SectionLayout, useIsPhone } from "@sekai/ui";
import { Activity, MessageSquareText } from "lucide-react";
import { Suspense, useEffect } from "react";
import { Navigate, useNavigate, useParams } from "react-router";
import { PageLoading } from "../components/layout/Loading.tsx";
import { historyIndex, useGoBack } from "../lib/back.ts";
import { useOpenAgent } from "../lib/navigation.ts";
import { useAgentPresence } from "../stores/ui.ts";
import { botPath, botSectionsFor, ownsBot } from "./registry.tsx";

/** The bot at the top of its sections: who it is, what it's doing, and the way to its chat and its activity. */
function BotCard({ agentId }: { agentId: string }) {
	const { data: agents = [] } = useAgents();
	const agent = agents.find((a) => a.id === agentId);
	const presence = useAgentPresence(agentId);
	const openAgent = useOpenAgent();
	if (!agent) return null;
	const busy = presence.state === "thinking" || presence.state === "working";
	return (
		<div className="flex flex-col gap-3 px-1 md:px-2.5">
			<div className="flex items-center gap-3">
				<AgentAvatar avatar={agent.avatar} size={44} state={presence.state} alive />
				<div
					className={cn(
						"min-w-0 flex-1 text-small",
						busy ? "shimmer-text" : presence.state === "waiting" ? "text-warning-ink" : "text-fg-muted",
					)}
				>
					{busy
						? `${presence.label ?? "Working"}…`
						: presence.state === "waiting" || presence.state === "blocked"
							? presence.label
							: agent.sharedBy
								? `Shared by ${agent.sharedBy}`
								: agent.label || "Your bot"}
				</div>
			</div>
			<div className="flex gap-2">
				<Button variant="secondary" size="sm" className="flex-1" onClick={() => void openAgent(agent.id)}>
					<MessageSquareText /> Chat
				</Button>
				<Button variant="secondary" size="sm" className="flex-1" asChild>
					<Link href={`/activity?bot=${agent.id}`}>
						<Activity /> Activity
					</Link>
				</Button>
			</div>
		</div>
	);
}

/** /bots/:agentId/:section: a bot's settings, in sections (the list of them on phones). */
export function BotPage() {
	const { agentId = "", section: sectionId, "*": rest = "" } = useParams();
	const { data: agents, isLoading } = useAgents();
	const agent = agents?.find((a) => a.id === agentId);
	const phone = useIsPhone();
	const goBack = useGoBack();
	const navigate = useNavigate();
	useEffect(() => {
		if (!agent) return;
		document.title = `${agent.name} · Sekai`;
		return () => {
			document.title = "Sekai";
		};
	}, [agent]);

	if (isLoading) return <PageLoading />;
	if (!agent) {
		return (
			<EmptyState
				className="flex-1"
				title="This bot isn't here"
				description="It may have been deleted, or it isn't shared with you anymore."
				action={
					<Button variant="secondary" onClick={() => navigate("/")}>
						Back to chats
					</Button>
				}
			/>
		);
	}

	const sections = botSectionsFor(agent);
	const def = sectionId ? sections.find((s) => s.id === sectionId) : undefined;
	// A section that isn't there (or not for you): the bot's first one. On wider screens there's always one open.
	if (sectionId && !def) return <Navigate to={botPath(agent.id)} replace />;
	if (!def && !phone) return <Navigate to={botPath(agent.id, sections[0]?.id ?? "profile")} replace />;

	const Section = def?.component;
	return (
		<SectionLayout
			title={agent.name}
			groups={[
				{
					id: "bot",
					items: sections.map((s) => ({
						id: s.id,
						title: s.title,
						icon: s.icon,
						href: botPath(agent.id, s.id),
					})),
				},
			]}
			active={def?.id ?? null}
			header={<BotCard agentId={agent.id} />}
			// Back goes to the screen before (usually this bot's chat, whose title is its name), or to Chats.
			back={{ label: historyIndex() > 0 ? agent.name : "Chats", onClick: () => goBack("/") }}
		>
			{Section && def && (
				<ErrorBoundary resetKey={`${agent.id}/${def.id}/${rest}`}>
					<Suspense fallback={<PageLoading />}>
						<Section
							key={agent.id}
							agent={agent}
							back={{ label: agent.name, onClick: () => goBack(botPath(agent.id)), phoneOnly: true }}
							rest={rest}
							readOnly={!ownsBot(agent) && Boolean(def.viewerReadOnly)}
						/>
					</Suspense>
				</ErrorBoundary>
			)}
		</SectionLayout>
	);
}
