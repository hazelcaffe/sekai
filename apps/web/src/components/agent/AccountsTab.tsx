import { api, cn, useChannels } from "@sekai/client";
import type { Agent } from "@sekai/shared";
import { Spinner } from "@sekai/ui";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { ChannelIcon } from "../channels/ChannelIcon.tsx";
import { ChannelsTab } from "./ChannelsTab.tsx";
import { DiscordUserTab } from "./DiscordUserTab.tsx";
import { SocialIcon, SocialTab } from "./SocialTab.tsx";
import { XIcon, XTab } from "./XTab.tsx";

function Row({
	icon,
	title,
	status,
	tone,
	onClick,
}: {
	icon: ReactNode;
	title: string;
	status: ReactNode;
	tone: "on" | "off" | "warn";
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-surface-2/40"
		>
			{icon}
			<div className="min-w-0 flex-1">
				<div className="text-sm font-medium">{title}</div>
				<div className="flex items-center gap-1.5 text-xs text-fg-subtle">
					<span
						aria-hidden
						className={cn(
							"size-1.5 shrink-0 rounded-full",
							tone === "on" ? "bg-success" : tone === "warn" ? "bg-warning" : "bg-fg-subtle/40",
						)}
					/>
					<span className="truncate">{status}</span>
				</div>
			</div>
			<ChevronRight className="size-4 shrink-0 text-fg-subtle" />
		</button>
	);
}

/**
 * The bot's own accounts on other apps (its Discord bot, its X account): where it can talk to you, and post for
 * teammates who don't have one.
 */
export function AccountsTab({
	agent,
	view,
	onView,
}: {
	agent: Agent;
	view: "accounts" | "channels" | "discord-user" | "x" | "instagram" | "tiktok";
	onView: (v: "accounts" | "channels" | "discord-user" | "x" | "instagram" | "tiktok") => void;
}) {
	const { data: channels, isLoading } = useChannels(agent.id);
	const { data: x, isLoading: xLoading } = useQuery({
		queryKey: ["x", agent.id],
		queryFn: () => api.x.get(agent.id),
	});
	const { data: ig, isLoading: igLoading } = useQuery({
		queryKey: ["instagram", agent.id],
		queryFn: () => api.instagram.get(agent.id),
	});
	const { data: tt, isLoading: ttLoading } = useQuery({
		queryKey: ["tiktok", agent.id],
		queryFn: () => api.tiktok.get(agent.id),
	});

	if (view !== "accounts") {
		return (
			<div className="flex flex-col gap-4">
				<button
					type="button"
					onClick={() => onView("accounts")}
					className="-ml-1.5 flex items-center gap-0.5 self-start rounded-lg py-1 pr-2 pl-0.5 text-[13px] font-medium text-fg-muted hover:bg-muted hover:text-fg"
				>
					<ChevronLeft className="size-4" /> Accounts
				</button>
				{view === "channels" ? (
					<ChannelsTab key={agent.id} agent={agent} />
				) : view === "discord-user" ? (
					<DiscordUserTab key={agent.id} agent={agent} />
				) : view === "instagram" ? (
					<SocialTab key={`${agent.id}:instagram`} agent={agent} platform="instagram" />
				) : view === "tiktok" ? (
					<SocialTab key={`${agent.id}:tiktok`} agent={agent} platform="tiktok" />
				) : (
					<XTab key={agent.id} agent={agent} />
				)}
			</div>
		);
	}

	const accounts = (channels ?? []).filter((c) => c.type === "discord-user");
	const accountLive = accounts.filter((c) => c.enabled && c.status.state === "connected");
	const accountStatus =
		accounts.length === 0
			? "Not set up"
			: accountLive.length
				? `${accountLive.map((c) => c.status.botName ?? "Account").join(", ")} · connected`
				: (accounts[0]?.status.error ?? "Not connected");

	return (
		<div className="flex flex-col gap-3">
			<p className="text-xs leading-5 text-fg-subtle">
				{agent.name}'s own accounts on other apps. It can message you there, and teammates without one can ask
				it to post for them.
			</p>
			{isLoading || xLoading || igLoading || ttLoading ? (
				<Spinner />
			) : (
				<div className="flex flex-col divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
					{(["discord", "slack"] as const).map((type) => {
						const bots = (channels ?? []).filter((c) => c.type === type);
						const live = bots.filter((c) => c.enabled && c.status.state === "connected");
						const status =
							bots.length === 0
								? "Not set up"
								: live.length
									? `${live.map((c) => c.status.botName ?? "Bot").join(", ")} · connected`
									: (bots[0]?.status.error ?? "Not connected");
						return (
							<Row
								key={type}
								icon={<ChannelIcon type={type} size={34} />}
								title={type === "slack" ? "Slack" : "Discord"}
								status={status}
								tone={live.length ? "on" : bots.length ? "warn" : "off"}
								onClick={() => onView("channels")}
							/>
						);
					})}
					<Row
						icon={<ChannelIcon type="discord-user" size={34} />}
						title="Discord (personal account)"
						status={accountStatus}
						tone={accountLive.length ? "on" : accounts.length ? "warn" : "off"}
						onClick={() => onView("discord-user")}
					/>
					<Row
						icon={<XIcon />}
						title="X"
						status={x ? `@${x.handle} · ${x.error ? "signed out" : "signed in"}` : "Not set up"}
						tone={x ? (x.error ? "warn" : "on") : "off"}
						onClick={() => onView("x")}
					/>
					<Row
						icon={<SocialIcon platform="instagram" />}
						title="Instagram"
						status={ig ? `@${ig.handle} · ${ig.error ? "signed out" : "signed in"}` : "Not set up"}
						tone={ig ? (ig.error ? "warn" : "on") : "off"}
						onClick={() => onView("instagram")}
					/>
					<Row
						icon={<SocialIcon platform="tiktok" />}
						title="TikTok"
						status={tt ? `@${tt.handle} · ${tt.error ? "signed out" : "signed in"}` : "Not set up"}
						tone={tt ? (tt.error ? "warn" : "on") : "off"}
						onClick={() => onView("tiktok")}
					/>
				</div>
			)}
		</div>
	);
}
