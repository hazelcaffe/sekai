import { useAccess } from "@sekai/client";
import { Page } from "@sekai/ui";
import { Navigate, useNavigate } from "react-router";
import { AccountsHome } from "../../components/agent/AccountsHome.tsx";
import { ChannelAccount } from "../../components/agent/ChannelAccount.tsx";
import { ConnectChannel } from "../../components/agent/ConnectChannel.tsx";
import { PlatformPage } from "../../components/agent/PlatformPage.tsx";
import { SocialAccount } from "../../components/agent/SocialAccount.tsx";
import { useGoBack } from "../../lib/back.ts";
import { accountsView } from "../paths.ts";
import { botPath } from "../registry.tsx";
import type { BotSectionProps } from "../section.ts";

/**
 * Its own accounts on Discord, Slack, X, Instagram and TikTok: a list, each opening its own page (bots/paths.ts
 * says which address is which).
 */
export function AccountsSection({ agent, back, rest }: BotSectionProps) {
	const { can } = useAccess();
	const navigate = useNavigate();
	const goBack = useGoBack();
	const home = botPath(agent.id, "accounts");
	const where = accountsView(rest);
	const mayEdit = can("channels");

	// Without the accounts feature there's only the list, read only.
	if (!mayEdit && where.view !== "home") return <Navigate to={home} replace />;

	const up = (to: string, label: string) => ({ label, onClick: () => goBack(to) });

	if (where.view === "platform" || where.view === "connect" || where.view === "account") {
		const list = botPath(agent.id, "accounts", where.platform);
		const title = where.platform === "slack" ? "Slack" : "Discord";
		if (where.view === "connect") {
			return (
				<ConnectChannel
					agent={agent}
					platform={where.platform}
					back={up(list, title)}
					onConnected={(id) => navigate(`${list}/${id}`, { replace: true })}
				/>
			);
		}
		if (where.view === "account") {
			return (
				<ChannelAccount
					agent={agent}
					channelId={where.id}
					back={up(list, title)}
					onRemoved={() => navigate(list, { replace: true })}
					onMoved={(to) =>
						navigate(botPath(to, "accounts", `${where.platform}/${where.id}`), { replace: true })
					}
				/>
			);
		}
		// The older /accounts/channels and /accounts/discord-user addresses land here too.
		if (rest !== where.platform) return <Navigate to={list} replace />;
		return <PlatformPage agent={agent} platform={where.platform} back={up(home, "Accounts")} />;
	}
	if (where.view === "social") {
		return <SocialAccount agent={agent} platform={where.platform} back={up(home, "Accounts")} />;
	}
	return (
		<Page back={back} title="Accounts" description={`${agent.name}'s own accounts on other apps.`}>
			<AccountsHome agent={agent} mayEdit={mayEdit} />
		</Page>
	);
}
