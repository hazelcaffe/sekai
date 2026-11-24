import { useChannels, usePairings } from "@sekai/client";
import { type Agent, type ChannelType, signalConfig } from "@sekai/shared";
import { Badge, Button, EmptyState, ErrorState, Link, List, Page, type PageBack, Row, SkeletonRows } from "@sekai/ui";
import { AtSign, Plus } from "lucide-react";
import { botPath } from "../../bots/registry.tsx";
import { AccountMark } from "./AccountMark.tsx";
import { channelState, pairingsFor, StatusLine } from "./accountStatus.tsx";
import { PairingNotice } from "./PairingNotice.tsx";

const TEXT = {
	discord: {
		title: "Discord",
		description: "Message it from Discord, or let it join your servers.",
		empty: "isn't on Discord yet",
		emptyHelp: "Connect a bot or a normal account to chat in DMs, channels and group chats.",
	},
	slack: {
		title: "Slack",
		description: "Message it from Slack, in DMs and channels.",
		empty: "isn't on Slack yet",
		emptyHelp: "Connect its own Slack app to chat in DMs and channels, and approve actions with a tap.",
	},
	signal: {
		title: "Signal",
		description: "Message it on Signal, in DMs and groups.",
		empty: "isn't on Signal yet",
		emptyHelp: "Give it its own Signal account: link a phone made for it, or register a number.",
	},
} as const;

/** Which accounts a platform's page lists. */
const ON: Record<"discord" | "slack" | "signal", (type: ChannelType) => boolean> = {
	discord: (t) => t === "discord" || t === "discord-user",
	slack: (t) => t === "slack",
	signal: (t) => t === "signal",
};

/** The bot's accounts on Discord, Slack or Signal (a bot can have several), with a way to connect another. */
export function PlatformPage({
	agent,
	platform,
	back,
}: {
	agent: Agent;
	platform: "discord" | "slack" | "signal";
	back: PageBack;
}) {
	const channels = useChannels(agent.id);
	const { data: pairings = [] } = usePairings();
	const t = TEXT[platform];
	const list = (channels.data ?? []).filter((c) => ON[platform](c.type));
	const waiting = pairingsFor(pairings, list).length;
	const connect = botPath(agent.id, "accounts", `${platform}/new`);

	return (
		<Page back={back} title={t.title} description={t.description}>
			<PairingNotice count={waiting} />
			{channels.isLoading ? (
				<SkeletonRows count={2} />
			) : channels.isError ? (
				<ErrorState error={channels.error} onRetry={() => void channels.refetch()} />
			) : list.length === 0 ? (
				<EmptyState
					icon={<AtSign />}
					title={`${agent.name} ${t.empty}`}
					description={t.emptyHelp}
					action={
						<Button variant="primary" asChild>
							<Link href={connect}>
								<Plus /> Connect {t.title}
							</Link>
						</Button>
					}
				/>
			) : (
				<List label={`${agent.name}'s ${t.title} accounts`}>
					{list.map((c) => {
						const waitingHere = pairingsFor(pairings, [c]).length;
						return (
							<Row
								key={c.id}
								leading={<AccountMark platform={platform} />}
								title={
									c.status.botName ??
									(c.type === "discord-user"
										? "Normal account"
										: c.type === "signal"
											? signalConfig(c).number || "Signal account"
											: `${t.title} bot`)
								}
								subtitle={
									<>
										<StatusLine state={channelState(c)} />
										{c.type === "discord-user" && " · Normal account"}
										{c.type === "signal" &&
											(signalConfig(c).mode === "linked"
												? " · Linked to a phone"
												: " · Own number")}
									</>
								}
								badge={
									waitingHere > 0 ? <Badge tone="warning">{waitingHere} to approve</Badge> : undefined
								}
								href={botPath(agent.id, "accounts", `${platform}/${c.id}`)}
							/>
						);
					})}
					<Row icon={<Plus />} title={`Connect another ${t.title} account`} href={connect} />
				</List>
			)}
		</Page>
	);
}
