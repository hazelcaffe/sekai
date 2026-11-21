import { useAccess, useAgents, useConversations } from "@sekai/client";
import { ApiError } from "@sekai/shared";
import { Button, EmptyState, ErrorState, Link, Spinner, useIsPhone } from "@sekai/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot } from "lucide-react";
import { Navigate, useParams } from "react-router";
import { NoBots } from "../components/layout/NoBots.tsx";
import { firstRunTarget } from "../lib/first-run.ts";
import { mainChatOf } from "../lib/navigation.ts";
import { useUi } from "../stores/ui.ts";
import { ChatsPage } from "./ChatsPage.tsx";

/** With no bots: the first-bot welcome for people who may make one (until they skip it), else the app. */
export function useFirstRun(): "welcome" | "app" | null {
	const { data: agents } = useAgents();
	const { access, can } = useAccess();
	const skippedBy = useUi((s) => s.welcomeSkippedBy);
	if (!agents || !access) return null;
	return firstRunTarget({
		bots: agents.length,
		canMakeBots: can("bots"),
		skipped: skippedBy === access.userId,
	});
}

function Opening() {
	return (
		<div className="flex flex-1 items-center justify-center">
			<Spinner className="size-6" />
		</div>
	);
}

/**
 * Opens a bot's main chat (asking the server when it has none here yet). A bot that isn't there for you (deleted,
 * or no longer shared) says so with a way to Chats; a connection problem offers Try again. Leaving first cancels it.
 */
function OpenBot({ agentId }: { agentId: string }) {
	const qc = useQueryClient();
	const chat = useQuery({
		queryKey: ["mainChat", agentId],
		queryFn: () => mainChatOf(qc, agentId),
		staleTime: 0,
		gcTime: 0,
	});
	if (chat.data) return <Navigate to={`/c/${chat.data.id}`} replace />;
	if (chat.isError) {
		const missing = chat.error instanceof ApiError && (chat.error.status === 404 || chat.error.status === 403);
		return (
			<div className="flex flex-1 items-center justify-center">
				{missing ? (
					<EmptyState
						icon={<Bot />}
						title="This bot isn't here"
						description="It may have been deleted, or it isn't shared with you anymore."
						action={
							<Button variant="secondary" asChild>
								<Link href="/">Chats</Link>
							</Button>
						}
					/>
				) : (
					<ErrorState
						title="Couldn't open this chat"
						error={chat.error}
						onRetry={() => void chat.refetch()}
					/>
				)}
			</div>
		);
	}
	return <Opening />;
}

/** "/" on wider screens: the chat you had open last, else your primary bot's; onboarding when there are no bots. */
function LastChat() {
	const { data: agents, isLoading } = useAgents();
	const { data: conversations, isLoading: loadingChats } = useConversations();
	const lastChatId = useUi((s) => s.lastChatId);
	const firstRun = useFirstRun();
	const last = lastChatId ? conversations?.find((c) => c.id === lastChatId && !c.archived) : undefined;
	// Your primary bot (not one someone shared with you, which is primary for its owner).
	const primary =
		agents?.find((a) => a.isPrimary && !a.sharedBy && !a.hidden) ??
		agents?.find((a) => !a.sharedBy && !a.hidden) ??
		agents?.find((a) => !a.hidden) ??
		agents?.[0];

	if (isLoading || loadingChats || !firstRun) return <Opening />;
	if (last) return <Navigate to={`/c/${last.id}`} replace />;
	if (primary) return <OpenBot key={primary.id} agentId={primary.id} />;
	if (firstRun === "welcome") return <Navigate to="/welcome" replace />;
	return (
		<div className="flex flex-1 items-center justify-center">
			<NoBots />
		</div>
	);
}

/** "/": Chats on phones (the first tab); the last chat on tablets and desktops. */
export function HomePage() {
	const phone = useIsPhone();
	const firstRun = useFirstRun();
	if (phone) {
		if (firstRun === "welcome") return <Navigate to="/welcome" replace />;
		return <ChatsPage />;
	}
	return <LastChat />;
}

/** /bot/:agentId opens that bot's main chat (older links, and links from Settings). */
export function OpenBotPage() {
	const { agentId } = useParams();
	if (!agentId) return <Navigate to="/" replace />;
	return <OpenBot key={agentId} agentId={agentId} />;
}
