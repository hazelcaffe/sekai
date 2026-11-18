import { api, cn, timeAgo, useChannelBindings, useChannels } from "@sekai/client";
import { type Agent, CHANNEL_DEFINITIONS, type ChannelWithStatus } from "@sekai/shared";
import { Badge, Button, Callout, Confirm, Dialog, Field, IconButton, Input, Section, Spinner, Switch } from "@sekai/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus, RefreshCw, ShieldAlert, Trash2, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { ChannelIcon } from "../channels/ChannelIcon.tsx";

const def = CHANNEL_DEFINITIONS["discord-user"];
const tokenField = def.fields[0];

function AddAccountDialog({
	agent,
	open,
	onOpenChange,
}: {
	agent: Agent;
	open: boolean;
	onOpenChange: (o: boolean) => void;
}) {
	const qc = useQueryClient();
	const [token, setToken] = useState("");
	const [owner, setOwner] = useState("");
	useEffect(() => {
		if (open) {
			setToken("");
			setOwner("");
		}
	}, [open]);
	const create = useMutation({
		mutationFn: () =>
			api.channels.create({
				agentId: agent.id,
				type: "discord-user",
				secrets: { userToken: token.trim() },
				config: {},
				allowFrom: owner.trim() ? [owner.trim()] : [],
			}),
		onSuccess: () => {
			void qc.invalidateQueries({ queryKey: ["channels"] });
			void qc.invalidateQueries({ queryKey: ["agentTools"] });
			onOpenChange(false);
		},
		onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
	});
	return (
		<Dialog
			open={open}
			onOpenChange={onOpenChange}
			title={`Give ${agent.name} a Discord account`}
			description="A normal account you made for it, not a bot application."
			size="lg"
			footer={
				<>
					<Button variant="secondary" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button
						variant="primary"
						disabled={token.trim().length < 20 || create.isPending}
						onClick={() => create.mutate()}
					>
						{create.isPending ? <Spinner /> : null} Connect
					</Button>
				</>
			}
		>
			<div className="flex flex-col gap-5">
				<ol className="flex flex-col gap-2 rounded-2xl bg-surface-2/50 p-4 text-[13px] leading-6">
					{def.setup.map((step, i) => (
						<li key={step} className="flex gap-3">
							<span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-3 text-[11px] font-semibold">
								{i + 1}
							</span>
							<span>{step}</span>
						</li>
					))}
				</ol>
				<Field label={tokenField?.label ?? "Account token"} hint={tokenField?.hint}>
					<Input
						type="password"
						autoComplete="off"
						value={token}
						onChange={(e) => setToken(e.target.value)}
						placeholder={tokenField?.placeholder}
						className="font-mono text-[13px]"
					/>
				</Field>
				<Field
					label="Your ID (optional)"
					hint={`${def.idHint}. Only you can talk to it until you change that.`}
				>
					<Input value={owner} onChange={(e) => setOwner(e.target.value)} className="font-mono text-[13px]" />
				</Field>
			</div>
		</Dialog>
	);
}

function AccountDetail({ agent, channel, onBack }: { agent: Agent; channel: ChannelWithStatus; onBack: () => void }) {
	const qc = useQueryClient();
	const { data: bindings = [] } = useChannelBindings(channel.id);
	const [token, setToken] = useState("");
	const [removing, setRemoving] = useState(false);
	const invalidate = () => void qc.invalidateQueries({ queryKey: ["channels"] });
	const update = useMutation({
		mutationFn: (patch: Parameters<typeof api.channels.update>[1]) => api.channels.update(channel.id, patch),
		onSuccess: () => {
			invalidate();
			setToken("");
		},
		onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
	});
	const restart = useMutation({ mutationFn: () => api.channels.restart(channel.id), onSuccess: invalidate });
	const remove = useMutation({
		mutationFn: () => api.channels.delete(channel.id),
		onSuccess: () => {
			invalidate();
			void qc.invalidateQueries({ queryKey: ["agentTools"] });
			onBack();
		},
	});
	const s = channel.status;
	const connected = channel.enabled && s.state === "connected";

	return (
		<div className="flex flex-col gap-6">
			<div className="flex items-center gap-3">
				<IconButton label="Back" size="icon-sm" onClick={onBack}>
					<ArrowLeft />
				</IconButton>
				<ChannelIcon type="discord-user" size={36} />
				<div className="min-w-0 flex-1">
					<div className="truncate text-sm font-semibold">{s.botName ?? "Personal account"}</div>
					<div className="flex items-center gap-1.5 text-xs text-fg-subtle">
						<span
							aria-hidden
							className={cn(
								"size-1.5 shrink-0 rounded-full",
								connected ? "bg-success" : s.state === "error" ? "bg-danger" : "bg-fg-subtle/40",
							)}
						/>
						<span className="truncate">
							{!channel.enabled
								? "Off"
								: s.state === "connected"
									? s.connectedAt
										? `Connected ${timeAgo(s.connectedAt)}`
										: "Connected"
									: (s.error ?? s.state)}
						</span>
					</div>
				</div>
				<Switch
					checked={channel.enabled}
					onCheckedChange={(enabled) => update.mutate({ enabled })}
					label="Enabled"
				/>
			</div>

			<Callout tone="warning" icon={<ShieldAlert />}>
				Discord doesn't allow accounts to be used like this. It's fine for the bot's own account, but Discord
				could limit it — don't use your own.
			</Callout>

			<Section
				title="Chats"
				description="The account's DMs and group chats, linked to chats in Sekai. What it answers there is sent as the account."
			>
				{bindings.length === 0 ? (
					<p className="text-[13px] text-fg-subtle">
						No chats yet. Message the account on Discord, or add it to a group chat.
					</p>
				) : (
					<div className="-mx-2.5 flex flex-col">
						{bindings.map((b) => (
							<Link
								key={b.id}
								to={`/c/${b.conversationId}`}
								className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm hover:bg-surface-2/60"
							>
								<span className="min-w-0 flex-1 truncate font-medium">{b.chatName}</span>
								<span className="text-xs text-fg-subtle">{b.isGroup ? "Group chat" : "DM"}</span>
							</Link>
						))}
					</div>
				)}
			</Section>

			<Section
				title="Sign-in"
				description="Paste a fresh token when Discord logs the account out (password change, new device, or Discord itself)."
			>
				<Field label={tokenField?.label ?? "Account token"} hint={tokenField?.hint}>
					<div className="flex gap-2">
						<Input
							type="password"
							autoComplete="off"
							value={token}
							onChange={(e) => setToken(e.target.value)}
							placeholder="Paste a new token"
							className="font-mono text-[13px]"
						/>
						<Button
							variant="secondary"
							disabled={token.trim().length < 20 || update.isPending}
							onClick={() => update.mutate({ secrets: { userToken: token.trim() } })}
						>
							{update.isPending ? <Spinner /> : "Update"}
						</Button>
					</div>
				</Field>
				<div className="flex flex-wrap gap-2">
					<Button
						variant="secondary"
						size="sm"
						onClick={() => restart.mutate()}
						disabled={restart.isPending || !channel.enabled}
					>
						<RefreshCw className={cn(restart.isPending && "animate-spin")} /> Reconnect
					</Button>
					<Button variant="danger-ghost" size="sm" onClick={() => setRemoving(true)}>
						<Trash2 /> Remove the account
					</Button>
				</div>
			</Section>

			<Confirm
				open={removing}
				onOpenChange={setRemoving}
				title={`Remove ${s.botName ?? "the account"} from ${agent.name}?`}
				description="The account disconnects; its chats stay in Sekai. The token is deleted."
				confirmLabel="Remove"
				danger
				onConfirm={() => remove.mutate()}
			/>
		</div>
	);
}

/** The bot's own Discord account (a normal user account), for group chats, DMs, voice and its own profile. */
export function DiscordUserTab({ agent }: { agent: Agent }) {
	const { data: channels = [], isLoading } = useChannels(agent.id);
	const [openId, setOpenId] = useState<string | null>(null);
	const [adding, setAdding] = useState(false);
	const accounts = channels.filter((c) => c.type === "discord-user");
	const open = accounts.find((c) => c.id === openId) ?? null;

	if (isLoading) return <Spinner />;
	if (open) return <AccountDetail agent={agent} channel={open} onBack={() => setOpenId(null)} />;
	return (
		<div className="flex flex-col gap-4">
			<div className="flex items-start gap-3">
				<span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-fg-subtle">
					<UserRound className="size-5" />
				</span>
				<p className="text-[13px] leading-5 text-fg-muted">
					A normal Discord account for {agent.name}: add it to group chats and servers, DM it, and it can join
					voice channels and use its own profile in its browser. For a bot application with slash commands,
					use Discord instead.
				</p>
			</div>
			{accounts.length > 0 && (
				<div className="flex flex-col divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
					{accounts.map((c) => (
						<button
							key={c.id}
							type="button"
							onClick={() => setOpenId(c.id)}
							className="flex items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-surface-2/40"
						>
							<ChannelIcon type="discord-user" size={34} />
							<div className="min-w-0 flex-1">
								<div className="truncate text-sm font-medium">
									{c.status.botName ?? "Personal account"}
								</div>
								<div className="flex items-center gap-1.5 text-xs text-fg-subtle">
									<span
										aria-hidden
										className={cn(
											"size-1.5 shrink-0 rounded-full",
											c.enabled && c.status.state === "connected"
												? "bg-success"
												: c.status.state === "error"
													? "bg-danger"
													: "bg-fg-subtle/40",
										)}
									/>
									<span className="truncate">
										{!c.enabled
											? "Off"
											: c.status.state === "connected"
												? "Connected"
												: (c.status.error ?? c.status.state)}
									</span>
								</div>
							</div>
							<Badge tone={c.status.state === "error" ? "danger" : "neutral"}>{c.status.state}</Badge>
						</button>
					))}
				</div>
			)}
			<Button variant="secondary" className="self-start" onClick={() => setAdding(true)}>
				<Plus /> {accounts.length ? "Add another account" : "Add the account"}
			</Button>
			<AddAccountDialog agent={agent} open={adding} onOpenChange={setAdding} />
		</div>
	);
}
