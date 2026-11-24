import { AgentAvatar, api, timeAgo, useSignalAccount, useSignalStatus } from "@sekai/client";
import { type Agent, type ChannelWithStatus, type SignalIdentityChange, signalConfig } from "@sekai/shared";
import { Button, Confirm, ErrorState, List, Row, Section, SkeletonRows } from "@sekai/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Phone, RefreshCw, ShieldAlert, Smartphone, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { actionError } from "../../lib/forms.ts";
import { signedOutOf } from "./accountStatus.tsx";
import { profilePicture, SignalEngineNotice, SignalLinkFlow, SignalRegisterFlow } from "./SignalSetup.tsx";

/** A safety number that changed: trust it (once you know it's them) and their messages come through. */
function ChangedIdentity({ channelId, change }: { channelId: string; change: SignalIdentityChange }) {
	const qc = useQueryClient();
	const [asking, setAsking] = useState(false);
	const who = change.name ?? change.number ?? "Someone";
	const trust = useMutation({
		mutationFn: () => api.signal.trust(channelId, change.id),
		onSuccess: () => {
			toast.success(`${who}'s messages come through again.`);
			void qc.invalidateQueries({ queryKey: ["signal", "account", channelId] });
		},
		onError: actionError,
	});
	return (
		<>
			<Row
				icon={<ShieldAlert />}
				iconTone="warning"
				title={who}
				subtitle={`Safety number changed${change.at ? ` ${timeAgo(change.at)}` : ""}. Their messages wait until you trust it.`}
				wrap
				trailing={
					<Button variant="secondary" size="sm" loading={trust.isPending} onClick={() => setAsking(true)}>
						Trust it
					</Button>
				}
			/>
			<Confirm
				open={asking}
				onOpenChange={setAsking}
				title={`Trust ${who}'s new safety number?`}
				description="Only if you're sure it's them: a new phone or reinstalling Signal changes it, but so does someone taking over their number."
				confirmLabel="Trust it"
				onConfirm={() => trust.mutate()}
			/>
		</>
	);
}

/**
 * The top of a Signal account's page when something needs doing: signal-cli isn't running here, or Signal signed the
 * account out (then it links, or registers, again right here, keeping its chats).
 */
export function SignalAccountNotices({ agent, channel }: { agent: Agent; channel: ChannelWithStatus }) {
	const qc = useQueryClient();
	const cfg = signalConfig(channel);
	const info = useSignalAccount(channel.id);
	const status = useSignalStatus();
	const refresh = () => {
		void qc.invalidateQueries({ queryKey: ["channels"] });
		void qc.invalidateQueries({ queryKey: ["signal", "account", channel.id] });
	};
	const lost = signedOutOf(channel) || info.data?.present === false;
	return (
		<>
			{status.data && <SignalEngineNotice status={status.data} />}
			{lost &&
				(cfg.mode === "linked" ? (
					<SignalLinkFlow agent={agent} channelId={channel.id} onLinked={refresh} />
				) : (
					<SignalRegisterFlow
						agent={agent}
						channelId={channel.id}
						number={cfg.number}
						onRegistered={refresh}
					/>
				))}
		</>
	);
}

/**
 * A Signal account's own part of its page: the account it speaks as (linked to a phone or registered here), its
 * name and picture on Signal, safety numbers that changed, reconnecting, and removing it.
 */
export function SignalAccountSection({
	agent,
	channel,
	onRemoved,
}: {
	agent: Agent;
	channel: ChannelWithStatus;
	onRemoved: () => void;
}) {
	const qc = useQueryClient();
	const cfg = signalConfig(channel);
	const info = useSignalAccount(channel.id);
	const avatar = useRef<HTMLDivElement>(null);
	const [removing, setRemoving] = useState(false);
	const refresh = () => {
		void qc.invalidateQueries({ queryKey: ["channels"] });
		void qc.invalidateQueries({ queryKey: ["signal", "account", channel.id] });
	};
	const restart = useMutation({ mutationFn: () => api.channels.restart(channel.id), onSuccess: refresh });
	const profile = useMutation({
		mutationFn: async () =>
			api.signal.setProfile(channel.id, {
				name: agent.name,
				avatar: await profilePicture(avatar.current, agent),
			}),
		onSuccess: () => {
			toast.success(`It's ${agent.name} on Signal now.`);
			refresh();
		},
		onError: actionError,
	});
	const remove = useMutation({
		mutationFn: () => api.channels.delete(channel.id),
		onSuccess: () => {
			refresh();
			onRemoved();
		},
		onError: actionError,
	});
	const linked = cfg.mode === "linked";
	const lost = signedOutOf(channel) || info.data?.present === false;
	const shownAs = channel.status.botName && channel.status.botName !== cfg.number ? channel.status.botName : null;
	// Signal keeps 26 characters of a name (as the server cuts it).
	const named = cfg.profileName === [...agent.name.trim()].slice(0, 26).join("");

	return (
		<>
			<Section title="Signal account" description="The account it speaks as on Signal.">
				<List label="Signal account">
					<Row
						icon={linked ? <Smartphone /> : <Phone />}
						title={cfg.number || "Its number isn't shared"}
						subtitle={linked ? "Linked to Signal on a phone" : "Its own number, registered here"}
					/>
					<Row
						leading={
							<div ref={avatar}>
								<AgentAvatar avatar={agent.avatar} size={32} />
							</div>
						}
						title="Name and picture on Signal"
						subtitle={
							named
								? `${agent.name}'s`
								: shownAs
									? `Shown as ${shownAs}`
									: "Whatever the account had before"
						}
						wrap
						trailing={
							<Button
								variant="secondary"
								size="sm"
								loading={profile.isPending}
								disabled={lost || channel.status.state !== "connected"}
								onClick={() => profile.mutate()}
							>
								{named ? "Update" : `Use ${agent.name}'s`}
							</Button>
						}
					/>
				</List>
				{agent.avatar.kind === "gallery" && (
					<p className="text-caption text-fg-subtle">
						© SEGA / © Colorful Palette Inc. / © Crypton Future Media, INC. www.piapro.net
					</p>
				)}
				<div className="flex flex-wrap gap-2">
					<Button
						variant="secondary"
						loading={restart.isPending}
						disabled={!channel.enabled}
						onClick={() => restart.mutate()}
					>
						<RefreshCw /> Reconnect
					</Button>
				</div>
			</Section>
			{info.isLoading ? (
				<SkeletonRows count={1} />
			) : info.isError ? (
				<ErrorState size="sm" error={info.error} onRetry={() => void info.refetch()} />
			) : info.data?.changed.length ? (
				<Section
					title="Safety numbers that changed"
					description="Signal holds back their messages until you trust the new number."
				>
					<List label="Safety numbers that changed">
						{info.data.changed.map((c) => (
							<ChangedIdentity key={c.id} channelId={channel.id} change={c} />
						))}
					</List>
				</Section>
			) : null}
			<List label="Remove">
				<Row
					icon={<Trash2 />}
					iconTone="danger"
					title="Remove the account"
					subtitle={`${agent.name} leaves Signal. Chats in Sekai are kept.`}
					danger
					onClick={() => setRemoving(true)}
				/>
			</List>
			<Confirm
				open={removing}
				onOpenChange={setRemoving}
				title={`Remove ${channel.status.botName ?? "this Signal account"} from ${agent.name}?`}
				description={
					linked
						? "Sekai unlinks from it and forgets its keys; its chats stay in Sekai. Remove Sekai from Linked devices on the phone too."
						: `The number is unregistered from Signal and its keys are deleted here, so ${cfg.number || "it"} stops getting Signal messages. Its chats stay in Sekai.`
				}
				confirmLabel="Remove"
				danger
				onConfirm={() => remove.mutate()}
			/>
		</>
	);
}
