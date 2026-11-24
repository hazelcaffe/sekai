import {
	api,
	timeAgo,
	useAgentMap,
	useAgents,
	useChannelBindings,
	useChannels,
	useConversation,
	usePairings,
	useSignalAccount,
} from "@sekai/client";
import {
	type Agent,
	CHANNEL_DEFINITIONS,
	type ChannelBinding,
	type ChannelDelivery,
	type ChannelWithStatus,
	type DmPolicy,
	type GroupPolicy,
	signalChatLink,
	signalConfig,
	slackDmThreads,
} from "@sekai/shared";
import {
	Button,
	Callout,
	Confirm,
	cn,
	EmptyState,
	ErrorState,
	Field,
	Fold,
	FormGroup,
	IconButton,
	Input,
	List,
	Page,
	type PageBack,
	PasswordInput,
	Row,
	SaveState,
	Section,
	Select,
	SelectRow,
	SkeletonRows,
	Switch,
	ToggleRow,
	useAutosave,
	useFormValues,
} from "@sekai/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
	ExternalLink,
	Hash,
	Link2Off,
	MessageCircle,
	Plus,
	RefreshCw,
	ShieldAlert,
	Trash2,
	TriangleAlert,
	Users,
	X,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { saveForm } from "../../lib/forms.ts";
import { channelState, pairingsFor, StatusLine, signedOutOf } from "./accountStatus.tsx";
import { PairingNotice } from "./PairingNotice.tsx";
import { SignalAccountNotices, SignalAccountSection } from "./SignalAccount.tsx";
import { SlackSetup } from "./SlackSetup.tsx";

const DM_POLICIES: { value: DmPolicy; label: string; description: string }[] = [
	{
		value: "pairing",
		label: "Approve new people (recommended)",
		description: "Someone new gets a code, and you approve it in Needs you.",
	},
	{ value: "allowlist", label: "Only the list", description: "Only the IDs below can talk to it." },
	{ value: "open", label: "Anyone", description: "Not recommended: it acts with your tools and memory." },
	{ value: "disabled", label: "Nobody", description: "It ignores direct messages." },
];

const DELIVERY: { value: ChannelDelivery; label: string; description: string }[] = [
	{
		value: "smart",
		label: "Replies and updates",
		description: "Replies, plus reminders, routine results and handoffs.",
	},
	{ value: "replies", label: "Replies only", description: "Only answers to what you send there." },
	{ value: "all", label: "Everything", description: "Every message it posts in linked chats." },
];

const SLACK_DMS: { value: "on" | "off"; label: string; description: string }[] = [
	{
		value: "on",
		label: "A thread per message",
		description: "Each message you send starts its own thread and chat.",
	},
	{
		value: "off",
		label: "One ongoing chat",
		description: "It answers right in the DM. /new starts fresh.",
	},
];

/**
 * The IDs of the people (and test bots) it answers: chips you can remove, and a field to add one. The first is its
 * owner (the server's isOwner): commands that change the bot are theirs alone, so the chip says so.
 */
function AllowList({
	value,
	onChange,
	hint,
	names,
	example = "e.g. 8271 0394 1156",
}: {
	value: string[];
	onChange: (v: string[]) => void;
	hint: string;
	/** Their names on the platform, where it says (Signal). */
	names?: Record<string, string>;
	example?: string;
}) {
	const [draft, setDraft] = useState("");
	const add = () => {
		const v = draft.trim();
		if (!v || value.includes(v)) return;
		onChange([...value, v]);
		setDraft("");
	};
	return (
		<Field label="People it answers" hint={hint}>
			{value.length === 0 ? (
				<p className="text-small text-fg-subtle">Nobody yet. Add your ID, or let someone pair from the app.</p>
			) : (
				<ul className="flex flex-wrap gap-1.5">
					{value.map((id, i) => (
						<li
							key={id}
							className="flex min-w-0 max-w-full items-center gap-1 rounded-full bg-surface-2 py-0.5 pr-1 pl-3 text-small"
						>
							{names?.[id] && <span className="font-medium">{names[id]}</span>}
							{/* Long ids (Signal's) are shortened; the remove button names the whole one. */}
							<span className={cn("truncate font-mono", names?.[id] && "text-fg-muted")}>
								{id.length > 24 ? `${id.slice(0, 8)}…` : id}
							</span>
							{i === 0 && <span className="text-fg-muted">· owner</span>}
							<IconButton
								variant="ghost"
								size="icon-xs"
								label={`Remove ${id}`}
								onClick={() => onChange(value.filter((x) => x !== id))}
							>
								<X />
							</IconButton>
						</li>
					))}
				</ul>
			)}
			<div className="flex gap-2">
				<Input
					value={draft}
					onChange={(e) => setDraft(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") {
							e.preventDefault();
							add();
						}
					}}
					placeholder={example}
					aria-label="Add an ID"
					className="font-mono"
				/>
				<Button variant="secondary" disabled={!draft.trim()} onClick={add}>
					Add
				</Button>
			</div>
		</Field>
	);
}

/** Who may talk to the account: the list, direct messages and servers (or channels). One Save. */
function WhoCanUse({ channel }: { channel: ChannelWithStatus }) {
	const qc = useQueryClient();
	const def = CHANNEL_DEFINITIONS[channel.type];
	const signal = channel.type === "signal";
	const names = useSignalAccount(signal ? channel.id : null).data?.names;
	// Where several people talk: a Slack app's channels, a Discord bot's servers, a normal account's group chats too.
	const groups =
		channel.type === "slack"
			? "Channels"
			: channel.type === "discord-user"
				? "Servers and group chats"
				: signal
					? "Groups"
					: "Servers";
	const form = useFormValues({
		allowFrom: channel.allowFrom,
		dmPolicy: channel.dmPolicy,
		groupPolicy: channel.groupPolicy,
	});
	const { values } = form;
	return (
		<Section title="Who can use it" description="Only the people you allow can talk to it.">
			<FormGroup
				dirty={form.dirty}
				onCancel={() => form.reset()}
				onSubmit={async () => {
					await api.channels.update(channel.id, values);
					void qc.invalidateQueries({ queryKey: ["channels"] });
					form.reset(values);
				}}
			>
				<AllowList
					value={values.allowFrom}
					onChange={(allowFrom) => form.set("allowFrom", allowFrom)}
					names={names}
					example={signal ? "e.g. 3f9a1c2e-…" : undefined}
					hint={
						signal
							? `${def.idHint}. The first is its owner, the only one who can change it from Signal.`
							: `${def.idHint}. The first is its owner, the only one who can change it from ${def.title}. A bot's ID works too, for testing.`
					}
				/>
				<Field label="Direct messages">
					<Select
						value={values.dmPolicy}
						onValueChange={(v) => form.set("dmPolicy", v as DmPolicy)}
						options={DM_POLICIES}
					/>
				</Field>
				<Field
					label={groups}
					hint={
						signal
							? "Only people on the list, when they mention it or reply to it. It only stays in groups they add it to."
							: "Only people on the list, and only when they mention it (or it listens there)."
					}
				>
					<Select
						value={values.groupPolicy}
						onValueChange={(v) => form.set("groupPolicy", v as GroupPolicy)}
						options={[
							{ value: "mention", label: `Answer in ${groups.toLowerCase()}` },
							{ value: "disabled", label: `Ignore ${groups.toLowerCase()}` },
						]}
					/>
				</Field>
			</FormGroup>
		</Section>
	);
}

/** One chat the account is linked to: open it, let it answer every message (groups), or unlink it. */
function LinkedChat({ binding, signal }: { binding: ChannelBinding; signal: boolean }) {
	const { data: conversation } = useConversation(binding.conversationId);
	const agents = useAgentMap();
	const [unlinking, setUnlinking] = useState(false);
	const unlink = useMutation({ mutationFn: () => api.channels.unlink(binding.id) });
	const listen = useMutation({ mutationFn: (on: boolean) => api.channels.updateBinding(binding.id, { listen: on }) });
	const group = conversation?.kind === "group";
	const members = group ? conversation.memberIds.map((id) => agents.get(id)?.name ?? "?").join(", ") : "";
	const kind = group
		? `Group chat with ${members}`
		: binding.isGroup
			? signal
				? "Group"
				: "Channel or thread"
			: "Direct messages";
	return (
		<>
			<Row
				icon={group || (signal && binding.isGroup) ? <Users /> : binding.isGroup ? <Hash /> : <MessageCircle />}
				title={binding.chatName}
				subtitle={`${kind} · ${binding.lastInboundAt ? timeAgo(binding.lastInboundAt) : `linked ${timeAgo(binding.createdAt)}`}${binding.isGroup ? (binding.listen ? " · answers every message" : " · answers when mentioned") : ""}`}
				href={`/c/${binding.conversationId}`}
				chevron={false}
				trailing={
					binding.isGroup ? (
						<Switch
							checked={binding.listen}
							label={`Answer every message in ${binding.chatName}`}
							onCheckedChange={(on) => listen.mutate(on)}
						/>
					) : undefined
				}
				menu={[{ label: "Unlink", icon: <Link2Off />, danger: true, onSelect: () => setUnlinking(true) }]}
				menuLabel={`${binding.chatName} actions`}
			/>
			<Confirm
				open={unlinking}
				onOpenChange={setUnlinking}
				title={`Unlink ${binding.chatName}?`}
				description="It stops answering there. The chat and its history stay in Sekai."
				confirmLabel="Unlink"
				danger
				onConfirm={() => unlink.mutate()}
			/>
		</>
	);
}

function Chats({ channel }: { channel: ChannelWithStatus }) {
	const def = CHANNEL_DEFINITIONS[channel.type];
	const bindings = useChannelBindings(channel.id);
	const qc = useQueryClient();
	const save = useAutosave((v: "on" | "off") =>
		api.channels.update(channel.id, { config: { ...channel.config, dmThreads: v } }).then(() => {
			void qc.invalidateQueries({ queryKey: ["channels"] });
		}),
	);
	const list = bindings.data ?? [];
	return (
		<Section
			title="Chats"
			description={
				channel.type === "signal"
					? "Each DM and group keeps its own history."
					: "Each DM, channel and thread keeps its own history."
			}
			saveState={save.status !== "idle" ? <SaveState state={save} /> : undefined}
		>
			{channel.type === "slack" && (
				<List label="Slack DMs">
					<SelectRow
						title="Your DMs with it"
						description={
							SLACK_DMS.find((o) => o.value === (slackDmThreads(channel) ? "on" : "off"))?.description
						}
						value={slackDmThreads(channel) ? "on" : "off"}
						onValueChange={(v) => save.save(v as "on" | "off")}
						options={SLACK_DMS}
					/>
				</List>
			)}
			{bindings.isLoading ? (
				<SkeletonRows count={2} />
			) : bindings.isError ? (
				<ErrorState size="sm" error={bindings.error} onRetry={() => void bindings.refetch()} />
			) : list.length === 0 ? (
				<EmptyState size="sm" title="No chats yet" description={`Message it on ${def.title} to start one.`} />
			) : (
				<List label="Linked chats">
					{list.map((b) => (
						<LinkedChat key={b.id} binding={b} signal={channel.type === "signal"} />
					))}
				</List>
			)}
		</Section>
	);
}

/** How it speaks: which bot is behind the account, and what it sends you in DMs. */
function HowItSpeaks({ channel, onMoved }: { channel: ChannelWithStatus; onMoved: (agentId: string) => void }) {
	const def = CHANNEL_DEFINITIONS[channel.type];
	const qc = useQueryClient();
	// Only your own bots: an account can't go to a bot someone shared with you (it would be theirs to run).
	const agents = (useAgents().data ?? []).filter((a) => !a.sharedBy);
	const [moveTo, setMoveTo] = useState<Agent | null>(null);
	const current = agents.find((a) => a.id === channel.agentId);
	const save = useAutosave((delivery: ChannelDelivery) =>
		api.channels.update(channel.id, { delivery }).then(() => {
			void qc.invalidateQueries({ queryKey: ["channels"] });
		}),
	);
	const move = useMutation({
		mutationFn: (agentId: string) => api.channels.update(channel.id, { agentId }),
		onSuccess: (_c, agentId) => {
			toast.success(
				`${channel.status.botName ?? def.title} now speaks as ${agents.find((a) => a.id === agentId)?.name ?? "that bot"}.`,
			);
			void qc.invalidateQueries({ queryKey: ["channels"] });
			// It's that bot's account now: its page moves there too.
			onMoved(agentId);
		},
	});
	const platform =
		channel.type === "slack"
			? "Slack's app settings"
			: channel.type === "discord-user"
				? "Discord"
				: "the Discord Developer Portal";
	const rename =
		channel.type === "signal"
			? `Give it ${moveTo?.name ?? "its"}'s name and picture on Signal from this page.`
			: `Change its name and picture in ${platform} to match.`;
	return (
		<Section
			title="How it speaks"
			description="Which bot answers, and what it sends you in DMs."
			saveState={save.status !== "idle" ? <SaveState state={save} /> : undefined}
		>
			<List label="How it speaks">
				<SelectRow
					title="Speaks as"
					description="The bot behind this account: its personality, memory and tools."
					value={channel.agentId}
					onValueChange={(id) => {
						const to = agents.find((a) => a.id === id);
						if (to && id !== channel.agentId) setMoveTo(to);
					}}
					options={agents.map((a) => ({
						value: a.id,
						label: a.name,
						description: a.status !== "active" ? "Paused" : undefined,
					}))}
				/>
				<SelectRow
					title="Sends you in DMs"
					description={DELIVERY.find((d) => d.value === channel.delivery)?.description}
					value={channel.delivery}
					onValueChange={(v) => save.save(v as ChannelDelivery)}
					options={DELIVERY}
				/>
			</List>
			<Confirm
				open={moveTo !== null}
				onOpenChange={(o) => !o && setMoveTo(null)}
				title={`Give this account to ${moveTo?.name ?? ""}?`}
				description={`${channel.status.botName ?? "The account"} reconnects and answers as ${moveTo?.name ?? "it"} from now on, with ${moveTo?.name ?? "its"}'s personality and memory. Its chats start fresh; what was said with ${current?.name ?? "the old bot"} stays in Sekai. ${rename}`}
				confirmLabel="Switch"
				onConfirm={() => {
					if (moveTo) move.mutate(moveTo.id);
					setMoveTo(null);
				}}
			/>
		</Section>
	);
}

/** Its tokens, to change and reconnect with; and removing the account. */
function Connection({
	agent,
	channel,
	onRemoved,
}: {
	agent: Agent;
	channel: ChannelWithStatus;
	onRemoved: () => void;
}) {
	const def = CHANNEL_DEFINITIONS[channel.type];
	const qc = useQueryClient();
	const personal = channel.type === "discord-user";
	// New tokens only: the saved ones come back masked, so each field starts empty and shows what's saved.
	const form = useFormValues<Record<string, string>>({});
	const fresh = Object.fromEntries(Object.entries(form.values).filter(([, v]) => v.trim()));
	const [removing, setRemoving] = useState(false);
	const refresh = () => {
		void qc.invalidateQueries({ queryKey: ["channels"] });
		void qc.invalidateQueries({ queryKey: ["agentTools"] });
	};
	const restart = useMutation({ mutationFn: () => api.channels.restart(channel.id), onSuccess: refresh });
	const remove = useMutation({
		mutationFn: () => api.channels.delete(channel.id),
		onSuccess: () => {
			refresh();
			onRemoved();
		},
	});
	return (
		<>
			<Section
				title={personal ? "Sign-in" : "Connection"}
				description={
					personal
						? "Paste a fresh token when Discord signs the account out."
						: "Paste new tokens to reconnect with them."
				}
			>
				{channel.type === "slack" && <SlackSetup agent={agent} />}
				<FormGroup
					dirty={Object.keys(fresh).length > 0}
					onCancel={() => form.reset({})}
					submitLabel="Save and reconnect"
					onSubmit={() =>
						saveForm(async () => {
							const secrets = Object.fromEntries(Object.entries(fresh).map(([k, v]) => [k, v.trim()]));
							await api.channels.update(channel.id, { secrets });
							refresh();
							form.reset({});
						})
					}
					extra={
						<Button
							variant="secondary"
							loading={restart.isPending}
							disabled={!channel.enabled}
							onClick={() => restart.mutate()}
						>
							<RefreshCw /> Reconnect
						</Button>
					}
				>
					{/* Every field of a Discord or Slack account is a token (CHANNEL_DEFINITIONS). */}
					{def.fields.map((f) => {
						const saved = channel.secrets[f.key];
						return (
							<Field key={f.key} label={f.label} hint={f.hint}>
								<PasswordInput
									autoComplete="off"
									value={form.values[f.key] ?? ""}
									onChange={(e) => form.set(f.key, e.target.value)}
									placeholder={saved ? `${saved} (saved)` : f.placeholder}
									className="font-mono"
								/>
							</Field>
						);
					})}
				</FormGroup>
			</Section>
			<List label="Remove">
				<Row
					icon={<Trash2 />}
					iconTone="danger"
					title={personal ? "Remove the account" : `Remove ${def.title}`}
					subtitle={`${agent.name} disconnects. Chats in Sekai are kept.`}
					danger
					onClick={() => setRemoving(true)}
				/>
			</List>
			<Confirm
				open={removing}
				onOpenChange={setRemoving}
				title={`Remove ${channel.status.botName ?? def.title} from ${agent.name}?`}
				description={
					personal
						? "The account disconnects, its chats stay in Sekai, and its token is deleted."
						: `The bot disconnects and its chats stay in Sekai. Revoke its tokens in ${channel.type === "slack" ? "Slack's app settings" : "the Developer Portal"} too if you won't use it again.`
				}
				confirmLabel="Remove"
				danger
				onConfirm={() => remove.mutate()}
			/>
		</>
	);
}

/** How to use a Signal account: message it from your own Signal, groups, approvals. */
function SignalHowToUse({ channel, agent }: { channel: ChannelWithStatus; agent: Agent }) {
	const { number } = signalConfig(channel);
	return (
		<div className="flex flex-col gap-3">
			{number && (
				<div className="flex flex-wrap gap-2">
					<Button variant="secondary" size="sm" asChild>
						<a href={signalChatLink(number)} target="_blank" rel="noreferrer">
							<MessageCircle /> Message it <ExternalLink />
						</a>
					</Button>
				</div>
			)}
			<Fold variant="link" title="How to use it">
				Message {agent.name} from your own Signal{number ? ` (${number})` : ""}: the first time, it answers with
				a pairing code to approve in Needs you. In a group, add it (it stays only when someone it answers added
				it), then mention it or reply to one of its messages. To approve an action, react 👍 or 👎 to the
				request, or type <span className="font-mono text-fg">/approve CODE</span>;{" "}
				<span className="font-mono text-fg">/help</span> lists its commands.
			</Fold>
		</div>
	);
}

/** How to use it, once it's connected: the links and commands that depend on the platform. */
function HowToUse({ channel, agent }: { channel: ChannelWithStatus; agent: Agent }) {
	const s = channel.status;
	const slack = channel.type === "slack";
	if (channel.type === "signal") return <SignalHowToUse channel={channel} agent={agent} />;
	return (
		<div className="flex flex-col gap-3">
			<div className="flex flex-wrap gap-2">
				{s.inviteUrl && (
					<Button variant="secondary" size="sm" asChild>
						<a href={s.inviteUrl} target="_blank" rel="noreferrer">
							<Plus /> Add to a server
						</a>
					</Button>
				)}
				{s.botId && channel.type !== "discord-user" && (
					<Button variant="secondary" size="sm" asChild>
						<a
							href={
								slack
									? `slack://user?team=${s.workspaceId}&id=${s.botId}`
									: `https://discord.com/users/${s.botId}`
							}
							target="_blank"
							rel="noreferrer"
						>
							<MessageCircle /> Message it <ExternalLink />
						</a>
					</Button>
				)}
			</div>
			{channel.type !== "discord-user" && (
				<Fold variant="link" title="How to use it">
					{slack ? (
						<>
							Connected to {s.workspaceName ?? "your workspace"}. Invite it to a channel (
							<span className="font-mono text-fg">/invite @{agent.name}</span>), then mention it there.
							Each thread in a channel is its own chat, and /listen on lets it answer there without a
							mention.
						</>
					) : (
						<>
							{s.readsAll
								? "It can read every message in channels it's in, so /listen works."
								: "It sees DMs and messages that mention it. For /listen (answering without a mention), turn on Message Content Intent under Bot in the Developer Portal, then reconnect."}{" "}
							Type <span className="font-mono text-fg">/</span> in Discord for its commands, or
							right-click a reply → Apps → Retry.
						</>
					)}
				</Fold>
			)}
		</div>
	);
}

function ChannelAccountPage({
	agent,
	channel,
	back,
	onRemoved,
	onMoved,
}: {
	agent: Agent;
	channel: ChannelWithStatus;
	back: PageBack;
	onRemoved: () => void;
	onMoved: (agentId: string) => void;
}) {
	const def = CHANNEL_DEFINITIONS[channel.type];
	const qc = useQueryClient();
	const { data: pairings = [] } = usePairings();
	const personal = channel.type === "discord-user";
	const signal = channel.type === "signal";
	const s = channel.status;
	const enabled = useAutosave((on: boolean) =>
		api.channels.update(channel.id, { enabled: on }).then(() => {
			void qc.invalidateQueries({ queryKey: ["channels"] });
		}),
	);
	const restart = useMutation({
		mutationFn: () => api.channels.restart(channel.id),
		onSuccess: () => void qc.invalidateQueries({ queryKey: ["channels"] }),
	});
	return (
		<Page
			back={back}
			title={s.botName ?? (personal ? "Normal account" : signal ? "Signal account" : `${def.title} bot`)}
			description={<StatusLine state={channelState(channel)} />}
		>
			{channel.enabled && s.state === "error" && (
				<Callout
					tone="danger"
					icon={<TriangleAlert />}
					title={signedOutOf(channel) ? "Signed out of Signal" : "Couldn't connect"}
					action={
						// A Signal account that was signed out connects again below (Try again wouldn't help).
						signedOutOf(channel) ? undefined : (
							<Button
								variant="secondary"
								size="sm"
								loading={restart.isPending}
								onClick={() => restart.mutate()}
							>
								Try again
							</Button>
						)
					}
				>
					{s.error ?? (signal ? "Try again in a moment." : "Check its token below, then reconnect.")}
				</Callout>
			)}
			{personal && (
				<Callout tone="warning" icon={<ShieldAlert />}>
					Discord doesn't allow normal accounts to be used like this, so it could be limited. Use an account
					made for the bot, never your own.
				</Callout>
			)}
			{signal && <SignalAccountNotices agent={agent} channel={channel} />}
			<PairingNotice count={pairingsFor(pairings, [channel]).length} />
			<div className="flex flex-col gap-2">
				<List label="Status">
					<ToggleRow
						title="Enabled"
						description={channel.enabled ? "It answers there." : "Off: it's disconnected."}
						checked={channel.enabled}
						onCheckedChange={(on) => enabled.save(on)}
					/>
				</List>
				{enabled.status !== "idle" && <SaveState state={enabled} className="px-1" />}
			</div>
			{channel.enabled && s.state === "connected" && <HowToUse channel={channel} agent={agent} />}
			<Chats channel={channel} />
			<WhoCanUse channel={channel} />
			<HowItSpeaks channel={channel} onMoved={onMoved} />
			{signal ? (
				<SignalAccountSection agent={agent} channel={channel} onRemoved={onRemoved} />
			) : (
				<Connection agent={agent} channel={channel} onRemoved={onRemoved} />
			)}
		</Page>
	);
}

/** One Discord, Slack or Signal account's own page. */
export function ChannelAccount({
	agent,
	channelId,
	back,
	onRemoved,
	onMoved,
}: {
	agent: Agent;
	channelId: string;
	back: PageBack;
	onRemoved: () => void;
	/** "Speaks as" gave it to another of your bots: its page is under that bot now. */
	onMoved: (agentId: string) => void;
}) {
	const channels = useChannels(agent.id);
	const channel = channels.data?.find((c) => c.id === channelId);
	if (channels.isLoading) {
		return (
			<Page back={back} title="Account">
				<SkeletonRows count={3} />
			</Page>
		);
	}
	if (channels.isError) {
		return (
			<Page back={back} title="Account">
				<ErrorState error={channels.error} onRetry={() => void channels.refetch()} />
			</Page>
		);
	}
	if (!channel) {
		return (
			<Page back={back} title="Account">
				<EmptyState
					title="This account isn't here"
					description="It may have been removed."
					action={
						<Button variant="secondary" onClick={onRemoved}>
							Back to accounts
						</Button>
					}
				/>
			</Page>
		);
	}
	return (
		<ChannelAccountPage
			key={channel.id}
			agent={agent}
			channel={channel}
			back={back}
			onRemoved={onRemoved}
			onMoved={onMoved}
		/>
	);
}
