import { adminUrl, useAgents } from "@sekai/client";
import { Spinner } from "@sekai/ui";
import { useEffect } from "react";
import { Navigate, useParams } from "react-router";
import { useOpenAgent } from "../lib/navigation.ts";

/** "/" opens the primary bot's chat, or onboarding when there are no bots yet. */
export function HomePage() {
	const { data: agents, isLoading } = useAgents();
	const openAgent = useOpenAgent();
	const target = agents?.find((a) => a.isPrimary && !a.hidden) ?? agents?.find((a) => !a.hidden) ?? agents?.[0];

	useEffect(() => {
		if (target) void openAgent(target.id);
	}, [target, openAgent]);

	if (isLoading || target) {
		return (
			<div className="flex flex-1 items-center justify-center">
				<Spinner className="size-6" />
			</div>
		);
	}
	return <Navigate to="/welcome" replace />;
}

/** /bot/:agentId opens that bot's chat (the admin app links here). */
export function OpenBotPage() {
	const { agentId } = useParams();
	const openAgent = useOpenAgent();
	useEffect(() => {
		if (agentId) void openAgent(agentId);
	}, [agentId, openAgent]);
	return (
		<div className="flex flex-1 items-center justify-center">
			<Spinner className="size-6" />
		</div>
	);
}

/** Old links to pages that moved to the admin app. */
export function ToAdmin({ page }: { page: string }) {
	useEffect(() => {
		const tab = new URLSearchParams(location.search).get("tab");
		location.replace(
			adminUrl(tab === "subscriptions" ? "subscriptions" : tab === "mcp" ? `${page}?tab=mcp` : page),
		);
	}, [page]);
	return (
		<div className="flex flex-1 items-center justify-center">
			<Spinner className="size-6" />
		</div>
	);
}
