import {
	api,
	cn,
	timeAgo,
	useAgentMap,
	useAgents,
	useChannelBindings,
	useChannels,
	useConversation,
	usePairings,
} from "@sekai/client";
import {
	type Agent,
	CHANNEL_DEFINITIONS,
	CHANNEL_TYPES,
	type ChannelBinding,
	type ChannelDelivery,
	type ChannelType,
	type ChannelWithStatus,
	type DmPolicy,
	type GroupPolicy,
} from "@sekai/shared";
import {
	Badge,
	Button,
	Confirm,
	Dialog,
	EmptyState,
	Field,
	IconButton,
	Input,
	Section,
	Select,
	Spinner,
	Switch,
	Tooltip,
} from "@sekai/ui";
import { useMutation } from "@tanstack/react-query";
import {
	ArrowLeft,
	Check,
	Ear,
	ExternalLink,
	Hash,
	Link2Off,
	MessageCircle,
	Plus,
	RefreshCw,
	Trash2,
	Users,
	X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { ChannelIcon } from "../channels/ChannelIcon.tsx";
import { SlackSetup } from "./SlackSetup.tsx";

const DM_POLICIES: { value: DmPolicy; label: string; description: string }[] = [
	{ value: "pairing", label: "Pairing (recommended)", description: "Unknown senders get a code you approve here." },
	{ value: "allowlist", label: "Allowlist only", description: "Only the IDs below can talk to the bot." },
	{ value: "open", label: "Anyone", description: "Not recommended: the bot acts with your tools and memory." },
	{ value: "disabled", label: "Off", description: "Ignore direct messages." },
];

const DELIVERY: { value: ChannelDelivery; label: string; description: string }[] = [
	{
		value: "smart",
		label: "Replies + updates",
		description: "Replies, plus reminders, routine results and handoffs in your DMs.",
	},
	{ value: "replies", label: "Replies only", description: "Only answers to what you send here." },
	{ value: "all", label: "Everything", description: "Mirror every message the bot posts in linked chats." },
];

function StatusLine({ channel }: { channel: ChannelWithStatus }) {
	const s = channel.status;
	if (!channel.enabled) return <span className="text-xs text-fg-subtle">Off</span>;
	if (s.state === "connected")
		return (
			<span className="flex items-center gap-1.5 text-xs text-success">
				<span className="size-1.5 rounded-full bg-success" /> Connected
			</span>
		);
	if (s.state === "starting") return <span className="text-xs text-fg-subtle">Connecting…</span>;
	if (s.state === "error") return <span className="line-clamp-2 text-xs text-danger">{s.error}</span>;
	return <span className="text-xs text-fg-subtle">Stopped</span>;
}

function AllowList({ channel }: { channel: ChannelWithStatus }) {
	const [value, setValue] = useState("");
	const update = useMutation({ mutationFn: (allowFrom: string[]) => api.channels.update(channel.id, { allowFrom }) });
	const add = () => {
		const v = value.trim();
		if (!v || channel.allowFrom.includes(v)) return;
		update.mutate([...channel.allowFrom, v]);
		setValue("");
	};
	return (
		<Field
			label="People (and test bots) it answers"
			hint={`${CHANNEL_DEFINITIONS[channel.type].idHint}. Add a bot's ID to let it drive this bot, e.g. for testing.`}
		>
			<div className="flex flex-wrap gap-1.5">
				{channel.allowFrom.length === 0 && (
					<span className="text-xs text-fg-subtle">Nobody yet. Pair from the app, or add your ID.</span>
				)}
				{channel.allowFrom.map((id) => (
					<span
						key={id}
						className="flex items-center gap-1 rounded-full bg-surface-2 py-0.5 pr-1 pl-2.5 font-mono text-xs"
					>
						{id}
						<button
							type="button"
							aria-label={`Remove ${id}`}
							onClick={() => update.mutate(channel.allowFrom.filter((x) => x !== id))}
							className="rounded-full p-0.5 hover:bg-surface-3"
						>
							<X className="size-3" />
						</button>
					</span>
				))}
			</div>
			<div className="flex gap-2">
				<Input
					value={value}
					onChange={(e) => setValue(e.target.value)}
					onKeyDown={(e) => e.key === "Enter" && add()}
					placeholder="Add an ID"
					className="font-mono text-[13px]"
				/>
				<Button variant="secondary" onClick={add} disabled={!value.trim()}>
					Add
				</Button>
			</div>
		</Field>
	);
}

function LinkedChat({ binding }: { binding: ChannelBinding }) {
	const { data: conversation } = useConversation(binding.conversationId);
	const agents = useAgentMap();
	const unlink = useMutation({ mutationFn: () => api.channels.unlink(binding.id) });
	const listen = useMutation({ mutationFn: (on: boolean) => api.channels.updateBinding(binding.id, { listen: on }) });
	const group = conversation?.kind === "group";
	const members = group ? conversation.memberIds.map((id) => agents.get(id)?.name ?? "?").join(", ") : "";
	const Icon = group ? Users : binding.isGroup ? Hash : MessageCircle;
	return (
		<div className="flex items-center gap-3 rounded-xl px-2.5 py-2 hover:bg-surface-2/50">
			<Icon className="size-4 shrink-0 text-fg-subtle" />
			<Link to={`/c/${binding.conversationId}`} className="min-w-0 flex-1">
				<div className="truncate text-[13px] font-medium">{binding.chatName}</div>
				<div className="truncate text-xs text-fg-subtle">
					{group ? `Group chat with ${members}` : binding.isGroup ? "Channel or thread" : "Direct messages"} ·{" "}
					{binding.lastInboundAt ? timeAgo(binding.lastInboundAt) : `linked ${timeAgo(binding.createdAt)}`}
				</div>
			</Link>
			{binding.isGroup && (
				<Tooltip content={binding.listen ? "Answers every message" : "Answers when mentioned"}>
					<span className="flex items-center gap-1.5 text-xs text-fg-subtle">
						<Ear className="size-3.5" />
						<Switch
							checked={binding.listen}
							onCheckedChange={(on) => listen.mutate(on)}
							label="Answer every message"
						/>
					</span>
				</Tooltip>
			)}
			<IconButton label="Unlink" size="icon-sm" onClick={() => unlink.mutate()}>
				<Link2Off />
			</IconButton>
		</div>
	);
}

function ChannelDetail({ channel, onBack }: { channel: ChannelWithStatus; onBack: () => void }) {
	const def = CHANNEL_DEFINITIONS[channel.type];
	const { data: bindings = [] } = useChannelBindings(channel.id);
	const { data: pairings = [] } = usePairings();
	const [secrets, setSecrets] = useState<Record<string, string>>(channel.secrets);
	const [config, setConfig] = useState<Record<string, string>>(channel.config);
	const [confirm, setConfirm] = useState(false);
	const { data: agents = [] } = useAgents();
	const [moveTo, setMoveTo] = useState<Agent | null>(null);
	useEffect(() => {
		setSecrets(channel.secrets);
		setConfig(channel.config);
	}, [channel.secrets, channel.config]);
	const update = useMutation({
		mutationFn: (patch: Parameters<typeof api.channels.update>[1]) => api.channels.update(channel.id, patch),
	});
	const restart = useMutation({ mutationFn: () => api.channels.restart(channel.id) });
	const remove = useMutation({ mutationFn: () => api.channels.delete(channel.id), onSuccess: onBack });
	const move = useMutation({
		mutationFn: (agentId: string) => api.channels.update(channel.id, { agentId }),
		onSuccess: (_c, agentId) => {
			const to = agents.find((a) => a.id === agentId);
			toast.success(`${s.botName ?? def.title} now speaks as ${to?.name ?? "that bot"}`);
			onBack();
		},
		onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
	});
	const current = agents.find((a) => a.id === channel.agentId);
	const decide = useMutation({
		mutationFn: (p: { code: string; approve: boolean }) => api.channels.decidePairing(p.code, p.approve),
	});
	const mine = pairings.filter((p) => p.channelId === channel.id);
	const credsDirty = def.fields.some(
		(f) =>
			(f.secret ? secrets[f.key] : config[f.key]) !== (f.secret ? channel.secrets[f.key] : channel.config[f.key]),
	);
	const s = channel.status;
	const connected = channel.enabled && s.state === "connected";

	return (
		<div className="flex flex-col gap-6">
			<div className="flex items-center gap-3">
				<IconButton label="Back" size="icon-sm" onClick={onBack}>
					<ArrowLeft />
				</IconButton>
				<ChannelIcon type={channel.type} size={36} />
				<div className="min-w-0 flex-1">
					<div className="truncate text-sm font-semibold">{s.botName ?? def.title}</div>
					<StatusLine channel={channel} />
				</div>
				<Switch
					checked={channel.enabled}
					onCheckedChange={(enabled) => update.mutate({ enabled })}
					label="Enabled"
				/>
			</div>

			{connected && (
				<div className="flex flex-col gap-3">
					<div className="flex flex-wrap gap-2">
						{s.inviteUrl && (
							<Button variant="secondary" size="sm" asChild>
								<a href={s.inviteUrl} target="_blank" rel="noreferrer">
									<Plus /> Add to a server
								</a>
							</Button>
						)}
						{s.botId && (
							<Button variant="ghost" size="sm" asChild>
								<a
									href={
										channel.type === "slack"
											? `slack://user?team=${s.workspaceId}&id=${s.botId}`
											: `https://discord.com/users/${s.botId}`
									}
									target="_blank"
									rel="noreferrer"
								>
									<MessageCircle /> Message it
								</a>
							</Button>
						)}
					</div>
					{channel.type === "slack" ? (
						<p className="text-xs leading-5 text-fg-subtle">
							Connected to {s.workspaceName ?? "your workspace"}. Invite it to a channel (
							<span className="font-mono text-fg-muted">/invite @{current?.name ?? "it"}</span>), then
							mention it there. Each thread is its own chat, and /listen on lets it answer there without a
							mention.
						</p>
					) : (
						<p className="text-xs leading-5 text-fg-subtle">
							{s.readsAll
								? "It can read every message in channels it's in, so /listen works."
								: "It sees DMs and messages that mention it. For /listen (answering without a mention), turn on Message Content Intent under Bot in the Developer Portal, then reconnect."}{" "}
							Type <span className="font-mono text-fg-muted">/</span> in Discord for its commands, or
							right-click a reply → Apps → Retry.
						</p>
					)}
				</div>
			)}

			{mine.length > 0 && (
				<Section title="Pairing requests">
					{mine.map((p) => (
						<div
							key={p.code}
							className="flex items-center gap-3 rounded-2xl border border-warning/40 bg-warning/[0.06] px-3.5 py-3"
						>
							<div className="min-w-0 flex-1">
								<div className="truncate text-sm font-medium">{p.senderName}</div>
								<div className="text-xs text-fg-subtle">
									Code <span className="font-mono font-semibold text-fg">{p.code}</span> ·{" "}
									{timeAgo(p.createdAt)}
								</div>
							</div>
							<Button
								variant="primary"
								size="sm"
								onClick={() => decide.mutate({ code: p.code, approve: true })}
							>
								<Check /> Approve
							</Button>
							<IconButton
								label="Reject"
								size="icon-sm"
								onClick={() => decide.mutate({ code: p.code, approve: false })}
							>
								<X />
							</IconButton>
						</div>
					))}
					<p className="text-xs text-fg-subtle">
						Only approve codes you just requested yourself. An approved sender can use this bot with your
						tools and memory.
					</p>
				</Section>
			)}

			<Section
				title="Chats"
				description="Each DM, channel and thread keeps its own history. Use /group link to bring several bots into one conversation."
			>
				{bindings.length === 0 ? (
					<p className="text-[13px] text-fg-subtle">No chats yet. Message the bot on {def.title}.</p>
				) : (
					<div className="-mx-2.5 flex flex-col">
						{bindings.map((b) => (
							<LinkedChat key={b.id} binding={b} />
						))}
					</div>
				)}
			</Section>

			<Section title="Who can use it">
				<AllowList channel={channel} />
				<Field label="Direct messages">
					<Select
						value={channel.dmPolicy}
						onValueChange={(v) => update.mutate({ dmPolicy: v as DmPolicy })}
						options={DM_POLICIES.map((p) => ({
							value: p.value,
							label: p.label,
							description: p.description,
						}))}
					/>
				</Field>
				<Field
					label={channel.type === "slack" ? "Channels" : "Servers"}
					hint="Only people on the list, and only when they mention it (or it listens there)."
				>
					<Select
						value={channel.groupPolicy}
						onValueChange={(v) => update.mutate({ groupPolicy: v as GroupPolicy })}
						options={[
							{
								value: "mention",
								label: channel.type === "slack" ? "Answer in channels" : "Answer in servers",
							},
							{
								value: "disabled",
								label: channel.type === "slack" ? "Ignore channels" : "Ignore servers",
							},
						]}
					/>
				</Field>
				<Field label="What it sends you in DMs">
					<Select
						value={channel.delivery}
						onValueChange={(v) => update.mutate({ delivery: v as ChannelDelivery })}
						options={DELIVERY.map((d) => ({ value: d.value, label: d.label, description: d.description }))}
					/>
				</Field>
			</Section>

			<Section
				title="Speaks as"
				description="The Sekai bot behind this account: its name, personality, memory and tools. Switch it to give another bot this account."
			>
				<Select
					value={channel.agentId}
					onValueChange={(id) => {
						const to = agents.find((a) => a.id === id);
						if (to && id !== channel.agentId) setMoveTo(to);
					}}
					options={agents.map((a) => ({
						value: a.id,
						label: a.name,
						description: a.id === channel.agentId ? "Now" : a.status !== "active" ? "Paused" : undefined,
					}))}
				/>
			</Section>

			<Section title="Connection">
				{channel.type === "slack" && current && <SlackSetup agent={current} />}
				{def.fields.map((f) => (
					<Field key={f.key} label={f.label} hint={f.hint}>
						<Input
							type={f.secret ? "password" : "text"}
							autoComplete="off"
							value={(f.secret ? secrets[f.key] : config[f.key]) ?? ""}
							onChange={(e) =>
								f.secret
									? setSecrets({ ...secrets, [f.key]: e.target.value })
									: setConfig({ ...config, [f.key]: e.target.value })
							}
							placeholder={f.placeholder}
							className="font-mono text-[13px]"
						/>
					</Field>
				))}
				<div className="flex flex-wrap gap-2">
					{credsDirty && (
						<Button variant="primary" size="sm" onClick={() => update.mutate({ secrets, config })}>
							Save and reconnect
						</Button>
					)}
					<Button
						variant="secondary"
						size="sm"
						onClick={() => restart.mutate()}
						disabled={restart.isPending || !channel.enabled}
					>
						<RefreshCw className={cn(restart.isPending && "animate-spin")} /> Reconnect
					</Button>
					<Button variant="danger-ghost" size="sm" onClick={() => setConfirm(true)}>
						<Trash2 /> Remove
					</Button>
				</div>
			</Section>

			<Confirm
				open={confirm}
				onOpenChange={setConfirm}
				title={`Remove ${def.title}?`}
				description={`The bot disconnects. Chats in Sekai are kept. Revoke its tokens in ${channel.type === "slack" ? "Slack's app settings" : "the Developer Portal"} too if you won't use it again.`}
				confirmLabel="Remove"
				danger
				onConfirm={() => remove.mutate()}
			/>
			<Confirm
				open={moveTo !== null}
				onOpenChange={(o) => !o && setMoveTo(null)}
				title={`Give this account to ${moveTo?.name ?? ""}?`}
				description={`${s.botName ?? "The bot"} reconnects and answers as ${moveTo?.name ?? "it"} from now on, with ${moveTo?.name ?? "its"}'s personality and memory. Its chats start fresh; what was said with ${current?.name ?? "the old bot"} stays in Sekai. Rename the bot and change its picture in ${channel.type === "slack" ? "Slack's app settings" : "the Discord Developer Portal"} to match.`}
				confirmLabel="Switch"
				onConfirm={() => {
					if (moveTo) move.mutate(moveTo.id);
					setMoveTo(null);
				}}
			/>
		</div>
	);
}

/** Bot platforms only; a personal account is added from its own view (Discord (personal account)). */
const BOT_TYPES = CHANNEL_TYPES.filter((t) => t !== "discord-user");
const only: ChannelType | null = BOT_TYPES.length === 1 ? (BOT_TYPES[0] ?? null) : null;

function AddChannelDialog({
	agent,
	open,
	onOpenChange,
}: {
	agent: Agent;
	open: boolean;
	onOpenChange: (o: boolean) => void;
}) {
	const [type, setType] = useState<ChannelType | null>(only);
	const [values, setValues] = useState<Record<string, string>>({});
	const [owner, setOwner] = useState("");
	useEffect(() => {
		if (open) {
			setType(only);
			setValues({});
			setOwner("");
		}
	}, [open]);
	const def = type ? CHANNEL_DEFINITIONS[type] : null;
	const create = useMutation({
		mutationFn: () => {
			if (!def || !type) throw new Error("Pick a platform");
			const secrets: Record<string, string> = {};
			const config: Record<string, string> = {};
			for (const f of def.fields) (f.secret ? secrets : config)[f.key] = (values[f.key] ?? "").trim();
			return api.channels.create({
				agentId: agent.id,
				type,
				secrets,
				config,
				allowFrom: owner.trim() ? [owner.trim()] : [],
			});
		},
		onSuccess: () => onOpenChange(false),
	});
	const ready = def?.fields.every((f) => !f.required || values[f.key]?.trim());

	return (
		<Dialog
			open={open}
			onOpenChange={onOpenChange}
			title={def ? `Connect ${agent.name} to ${def.title}` : `Give ${agent.name} its own bot`}
			description={
				def
					? "Uses the platform's official bot API with credentials you create."
					: "Message your bot from the chat apps you already use."
			}
			size="lg"
			footer={
				def && (
					<>
						<Button variant="secondary" onClick={() => (only ? onOpenChange(false) : setType(null))}>
							{only ? "Cancel" : "Back"}
						</Button>
						<Button variant="primary" disabled={!ready || create.isPending} onClick={() => create.mutate()}>
							{create.isPending ? <Spinner /> : null} Connect
						</Button>
					</>
				)
			}
		>
			{!def ? (
				<div className="grid gap-2 xs:grid-cols-2">
					{BOT_TYPES.map((t) => (
						<button
							key={t}
							type="button"
							onClick={() => setType(t)}
							className="flex items-center gap-3 rounded-2xl border border-border px-4 py-3.5 text-left transition-colors hover:bg-surface-2"
						>
							<ChannelIcon type={t} size={36} />
							<div>
								<div className="text-sm font-medium">{CHANNEL_DEFINITIONS[t].title}</div>
								<div className="text-xs text-fg-subtle">
									{CHANNEL_DEFINITIONS[t].approvals === "buttons"
										? "Approvals with buttons"
										: "Approvals with reactions"}
								</div>
							</div>
						</button>
					))}
				</div>
			) : (
				<div className="flex flex-col gap-5">
					{type === "slack" && <SlackSetup agent={agent} />}
					<ol className="flex flex-col gap-2 rounded-2xl bg-surface-2/50 p-4 text-[13px] leading-6">
						{def.setup.map((step, i) => (
							<li key={step} className="flex gap-3">
								<span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-3 text-[11px] font-semibold">
									{i + 1}
								</span>
								<span>{step}</span>
							</li>
						))}
						<li>
							<a
								href={def.docsUrl}
								target="_blank"
								rel="noreferrer"
								className="inline-flex items-center gap-1 text-info"
							>
								Official docs <ExternalLink className="size-3" />
							</a>
						</li>
					</ol>
					{def.fields.map((f) => (
						<Field key={f.key} label={f.label} hint={f.hint}>
							<Input
								type={f.secret ? "password" : "text"}
								autoComplete="off"
								value={values[f.key] ?? ""}
								onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
								placeholder={f.placeholder}
								className="font-mono text-[13px]"
							/>
						</Field>
					))}
					<Field label="Your ID (optional)" hint={`${def.idHint}. Leave empty to pair by messaging the bot.`}>
						<Input
							value={owner}
							onChange={(e) => setOwner(e.target.value)}
							className="font-mono text-[13px]"
						/>
					</Field>
				</div>
			)}
		</Dialog>
	);
}

/** Give the agent its own bot on chat platforms, so you can message it from there. */
export function ChannelsTab({ agent }: { agent: Agent }) {
	const { data: channels = [], isLoading } = useChannels(agent.id);
	const { data: pairings = [] } = usePairings();
	const [openId, setOpenId] = useState<string | null>(null);
	const [adding, setAdding] = useState(false);
	const open = channels.find((c) => c.id === openId);
	if (open) return <ChannelDetail channel={open} onBack={() => setOpenId(null)} />;

	return (
		<div className="flex flex-col gap-4">
			<div className="flex items-start justify-between gap-3">
				<p className="text-xs leading-5 text-fg-subtle">
					Give {agent.name} its own Discord or Slack bot: chat in DMs or channels, use slash commands, and
					approve actions with buttons. Only you (and anyone you allow) can use it.
				</p>
				<Button variant="secondary" size="xs" onClick={() => setAdding(true)} className="shrink-0">
					<Plus /> Add
				</Button>
			</div>
			{isLoading ? (
				<Spinner />
			) : channels.length === 0 ? (
				<EmptyState
					title="No channels yet"
					description="Chat from Discord or Slack on any device, get reminders there, and approve actions with a tap."
					action={
						<Button variant="primary" size="sm" onClick={() => setAdding(true)}>
							<Plus /> Connect a platform
						</Button>
					}
				/>
			) : (
				channels.map((c) => {
					const pending = pairings.filter((p) => p.channelId === c.id).length;
					return (
						<button
							key={c.id}
							type="button"
							onClick={() => setOpenId(c.id)}
							className="flex items-center gap-3 rounded-2xl border border-border px-3.5 py-3 text-left hover:bg-surface-2/40"
						>
							<ChannelIcon type={c.type} size={34} />
							<div className="min-w-0 flex-1">
								<div className="flex items-center gap-2">
									<span className="truncate text-sm font-medium">
										{c.status.botName ?? CHANNEL_DEFINITIONS[c.type].title}
									</span>
									{pending > 0 && <Badge tone="warning">{pending} pairing</Badge>}
								</div>
								<StatusLine channel={c} />
							</div>
							<span className="shrink-0 text-xs text-fg-subtle">{c.allowFrom.length} allowed</span>
						</button>
					);
				})
			)}
			<AddChannelDialog agent={agent} open={adding} onOpenChange={setAdding} />
		</div>
	);
}
