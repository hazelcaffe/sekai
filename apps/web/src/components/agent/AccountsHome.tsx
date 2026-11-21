import { useChannels, usePairings } from "@sekai/client";
import type { Agent } from "@sekai/shared";
import { Badge, Callout, ErrorState, List, Row, SkeletonRows } from "@sekai/ui";
import { AtSign } from "lucide-react";
import { botPath } from "../../bots/registry.tsx";
import { AccountMark } from "./AccountMark.tsx";
import {
	pairingsFor,
	platformState,
	type SocialPlatform,
	StatusLine,
	socialState,
	useSocialAccount,
} from "./accountStatus.tsx";

const SOCIAL: { id: SocialPlatform; title: string }[] = [
	{ id: "x", title: "X" },
	{ id: "instagram", title: "Instagram" },
	{ id: "tiktok", title: "TikTok" },
];

/** The bot's accounts on other apps: one row each, with how it's doing; each opens its own page. */
export function AccountsHome({ agent, mayEdit }: { agent: Agent; mayEdit: boolean }) {
	const channels = useChannels(agent.id);
	const x = useSocialAccount("x", agent.id);
	const instagram = useSocialAccount("instagram", agent.id);
	const tiktok = useSocialAccount("tiktok", agent.id);
	const social = { x, instagram, tiktok };
	const all = channels.data ?? [];
	const discord = all.filter((c) => c.type === "discord" || c.type === "discord-user");
	const slack = all.filter((c) => c.type === "slack");
	const { data: pairings = [] } = usePairings();
	const loading = channels.isLoading || x.isLoading || instagram.isLoading || tiktok.isLoading;
	const failed = channels.error ?? x.error ?? instagram.error ?? tiktok.error;
	const href = (path: string) => (mayEdit ? botPath(agent.id, "accounts", path) : undefined);
	const pairing = (n: number) => (n > 0 ? <Badge tone="warning">{n} to approve</Badge> : undefined);

	return (
		<>
			{!mayEdit && (
				<Callout tone="info" icon={<AtSign />}>
					Connecting accounts isn't part of your role. Ask an admin if you'd like {agent.name} to have its
					own.
				</Callout>
			)}
			{loading ? (
				<SkeletonRows count={5} />
			) : failed ? (
				<ErrorState
					size="sm"
					error={failed}
					onRetry={() => {
						void channels.refetch();
						void x.refetch();
						void instagram.refetch();
						void tiktok.refetch();
					}}
				/>
			) : (
				<List label="Accounts">
					<Row
						leading={<AccountMark platform="discord" />}
						title="Discord"
						subtitle={<StatusLine state={platformState(discord)} />}
						badge={pairing(pairingsFor(pairings, discord).length)}
						href={href("discord")}
					/>
					<Row
						leading={<AccountMark platform="slack" />}
						title="Slack"
						subtitle={<StatusLine state={platformState(slack)} />}
						badge={pairing(pairingsFor(pairings, slack).length)}
						href={href("slack")}
					/>
					{SOCIAL.map((p) => (
						<Row
							key={p.id}
							leading={<AccountMark platform={p.id} />}
							title={p.title}
							subtitle={<StatusLine state={socialState(social[p.id].data)} />}
							href={href(p.id)}
						/>
					))}
				</List>
			)}
		</>
	);
}
