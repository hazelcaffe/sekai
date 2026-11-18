import {
	AgentAvatar,
	api,
	BrandTile,
	cn,
	joinArgs,
	kvText,
	Markdown,
	parseKv,
	presetBrand,
	splitArgs,
	timeAgo,
	useAgents,
	useProviders,
} from "@sekai/client";
import { PROVIDER_PRESET_IDS, PROVIDER_PRESETS, type ProviderPresetId, type ProviderWithStatus } from "@sekai/shared";
import {
	Badge,
	Button,
	Card,
	Confirm,
	Dialog,
	EmptyState,
	Field,
	Input,
	SettingsPanel,
	Spinner,
	Switch,
	Textarea,
} from "@sekai/ui";
import { useMutation } from "@tanstack/react-query";
import {
	Check,
	ChevronRight,
	CircleAlert,
	Copy,
	ExternalLink,
	KeyRound,
	Plug,
	RefreshCw,
	ShieldAlert,
	Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

/** The agent's own mark on a tile (a plug for a custom ACP agent). */
export function ProviderMark({ preset, size = 36 }: { preset: ProviderPresetId; size?: number }) {
	return (
		<BrandTile
			brand={presetBrand(preset)}
			size={size}
			fallback={<Plug className="text-fg-muted" style={{ width: size * 0.45, height: size * 0.45 }} />}
		/>
	);
}

function StatusBadge({ p }: { p: ProviderWithStatus }) {
	if (!p.enabled) return <Badge>Off</Badge>;
	switch (p.status.state) {
		case "ready":
			return (
				<Badge tone="success">
					<Check className="size-3" /> Ready
				</Badge>
			);
		case "checking":
			return (
				<Badge tone="info">
					<Spinner className="size-3 text-info" /> Checking…
				</Badge>
			);
		case "auth_required":
			return (
				<Badge tone="warning">
					<KeyRound className="size-3" /> Needs sign-in
				</Badge>
			);
		case "error":
			return (
				<Badge tone="danger">
					<CircleAlert className="size-3" /> Problem
				</Badge>
			);
		default:
			return <Badge>Not checked</Badge>;
	}
}

function ClaudeTermsNote() {
	return (
		<div className="flex gap-3 rounded-2xl border border-warning/30 bg-warning/[0.06] p-3.5 text-xs leading-5 text-fg-muted">
			<ShieldAlert className="mt-0.5 size-4 shrink-0 text-warning" />
			<p>
				Anthropic doesn't allow third-party apps to offer claude.ai login, so Sekai never asks for your Claude
				account. It drives the Claude Code that's already signed in on the computer running Sekai (
				<code className="font-mono">claude auth login</code>), or uses an{" "}
				<code className="font-mono">ANTHROPIC_API_KEY</code> you add below. If anyone else uses this Sekai, use
				an API key.
			</p>
		</div>
	);
}

function CopyLine({ text }: { text: string }) {
	return (
		<div className="flex items-center gap-2 rounded-xl bg-bg-subtle px-3 py-2 font-mono text-xs">
			<span className="min-w-0 flex-1 truncate">{text}</span>
			<button
				type="button"
				aria-label="Copy"
				onClick={() => {
					void navigator.clipboard.writeText(text);
					toast.success("Copied", { duration: 1200 });
				}}
				className="rounded-md p-1 text-fg-subtle hover:bg-surface-2 hover:text-fg"
			>
				<Copy className="size-3.5" />
			</button>
		</div>
	);
}

function ProviderDialog({
	open,
	onOpenChange,
	preset,
	provider,
}: {
	open: boolean;
	onOpenChange: (o: boolean) => void;
	preset: ProviderPresetId;
	provider: ProviderWithStatus | null;
}) {
	const def = PROVIDER_PRESETS[provider?.preset ?? preset];
	const [title, setTitle] = useState("");
	const [command, setCommand] = useState("");
	const [args, setArgs] = useState("");
	const [env, setEnv] = useState("");
	const [models, setModels] = useState("");

	useEffect(() => {
		if (!open) return;
		setTitle(provider?.title ?? def.title);
		setCommand(provider?.command ?? def.command);
		setArgs(joinArgs(provider?.args ?? def.args));
		setEnv(kvText(provider?.env ?? def.env));
		setModels((provider?.extraModels ?? []).join(", "));
	}, [open, provider, def]);

	const save = useMutation({
		mutationFn: () => {
			const body = {
				title: title.trim() || def.title,
				command: command.trim(),
				args: splitArgs(args),
				env: parseKv(env),
				extraModels: models
					.split(/[,\n]/)
					.map((m) => m.trim())
					.filter(Boolean),
			};
			return provider
				? api.providers.update(provider.id, body)
				: api.providers.create({ preset: def.id, ...body });
		},
		onSuccess: (p) => {
			onOpenChange(false);
			toast.success(provider ? "Saved. Checking it again…" : `Added ${p.title}. Checking it…`);
		},
	});
	const acp = def.kind === "acp";
	const valid = !acp || command.trim();

	return (
		<Dialog
			open={open}
			onOpenChange={onOpenChange}
			size="lg"
			title={provider ? `Edit ${provider.title}` : `Add ${def.title}`}
			description={def.description}
			footer={
				<>
					<Button variant="secondary" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button variant="primary" disabled={!valid || save.isPending} onClick={() => save.mutate()}>
						{save.isPending && <Spinner className="text-primary-foreground" />}
						{provider ? "Save" : "Add and check"}
					</Button>
				</>
			}
		>
			<div className="flex flex-col gap-4">
				{def.id === "claude" && <ClaudeTermsNote />}
				<div className="rounded-2xl bg-surface-2/50 p-4 text-[13px] leading-6">
					<div className="mb-1 font-medium">Sign in first, on the computer running Sekai</div>
					<Markdown text={def.signIn} className="text-[13px] leading-6 text-fg-muted" />
					<a
						href={def.docsUrl}
						target="_blank"
						rel="noreferrer"
						className="mt-1 inline-flex items-center gap-1 text-info"
					>
						Official docs <ExternalLink className="size-3" />
					</a>
				</div>
				<Field label="Name">
					<Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} />
				</Field>
				{acp ? (
					<div className="grid gap-3 md:grid-cols-[1fr_2fr]">
						<Field label="Command" hint="Must be on the server's PATH, or a full path.">
							<Input
								value={command}
								onChange={(e) => setCommand(e.target.value)}
								className="font-mono text-[13px]"
							/>
						</Field>
						<Field label="Arguments" hint="Starts the agent in ACP mode.">
							<Input
								value={args}
								onChange={(e) => setArgs(e.target.value)}
								className="font-mono text-[13px]"
							/>
						</Field>
					</div>
				) : (
					<Field
						label="Claude Code executable (optional)"
						hint="Leave empty to use the one bundled with the Claude Agent SDK."
					>
						<Input
							value={command}
							onChange={(e) => setCommand(e.target.value)}
							placeholder="~/.local/bin/claude"
							className="font-mono text-[13px]"
						/>
					</Field>
				)}
				<Field
					label="Environment (optional)"
					hint="One KEY=value per line: API keys, a config folder, a custom endpoint. Values that look secret are hidden after saving."
				>
					<Textarea
						value={env}
						onChange={(e) => setEnv(e.target.value)}
						className="min-h-20 font-mono text-[13px]"
						placeholder={
							def.id === "claude"
								? "ANTHROPIC_API_KEY=sk-ant-…"
								: def.id === "gemini"
									? "GEMINI_API_KEY=…"
									: "OPENAI_API_KEY=sk-…"
						}
					/>
				</Field>
				<Field
					label="Extra models (optional)"
					hint="Comma-separated model IDs to offer, if the agent doesn't list the one you want."
				>
					<Input
						value={models}
						onChange={(e) => setModels(e.target.value)}
						className="font-mono text-[13px]"
					/>
				</Field>
			</div>
		</Dialog>
	);
}

function ProviderCard({ p, onEdit }: { p: ProviderWithStatus; onEdit: () => void }) {
	const def = PROVIDER_PRESETS[p.preset];
	const s = p.status;
	const [open, setOpen] = useState(s.state !== "ready");
	const [confirm, setConfirm] = useState(false);
	const { data: agents = [] } = useAgents();
	const users = agents.filter(
		(a) => a.models.primary.model === p.id || a.models.primary.model.startsWith(`${p.id}::`),
	);
	const check = useMutation({ mutationFn: () => api.providers.check(p.id) });
	const toggle = useMutation({ mutationFn: (enabled: boolean) => api.providers.update(p.id, { enabled }) });
	const remove = useMutation({ mutationFn: () => api.providers.delete(p.id) });
	const signIn = useMutation({
		mutationFn: (methodId: string) => api.providers.authenticate(p.id, methodId),
		onSuccess: (r) => (r.status.state === "ready" ? toast.success("Signed in") : undefined),
	});
	const checking = s.state === "checking" || check.isPending;

	return (
		<Card className="overflow-hidden">
			<div className="flex items-center gap-3 p-4">
				<ProviderMark preset={p.preset} />
				<button type="button" onClick={() => setOpen((o) => !o)} className="min-w-0 flex-1 text-left">
					<div className="flex flex-wrap items-center gap-1.5">
						<span className="text-sm font-medium">{p.title}</span>
						<StatusBadge p={p} />
					</div>
					<div className="truncate text-xs text-fg-subtle">
						{def.vendor}
						{s.agentName ? ` · ${s.agentName}${s.agentVersion ? ` ${s.agentVersion}` : ""}` : ""}
						{s.account ? ` · ${s.account}` : ""}
						{s.state === "ready" ? ` · ${s.models.length || "default"} models` : ""}
					</div>
				</button>
				<ChevronRight
					className={cn("size-4 shrink-0 text-fg-subtle transition-transform", open && "rotate-90")}
				/>
				<Switch checked={p.enabled} onCheckedChange={(v) => toggle.mutate(v)} label="Enabled" />
			</div>
			{open && (
				<div className="flex flex-col gap-4 border-t border-border p-4">
					{p.preset === "claude" && <ClaudeTermsNote />}
					{s.state === "error" && s.error && (
						<pre className="max-h-48 overflow-auto rounded-xl bg-danger/8 p-3 font-mono text-xs whitespace-pre-wrap text-danger scrollbar-thin">
							{s.error}
						</pre>
					)}
					{(s.state === "auth_required" || s.state === "error") && (
						<div className="flex flex-col gap-2 rounded-2xl bg-surface-2/50 p-4 text-[13px]">
							<div className="font-medium">
								{s.state === "auth_required" ? `${p.title} needs you to sign in` : "How to set it up"}
							</div>
							<Markdown text={def.signIn} className="text-[13px] leading-6 text-fg-muted" />
							{s.authMethods.length > 0 && (
								<div className="flex flex-col gap-2 pt-1">
									{s.authMethods.map((m) =>
										m.terminal ? (
											<div key={m.id} className="flex flex-col gap-1">
												<span className="text-xs text-fg-subtle">
													{m.name}: run this in a terminal on the server
												</span>
												<CopyLine text={m.terminal} />
											</div>
										) : (
											<Button
												key={m.id}
												variant="secondary"
												size="sm"
												className="self-start"
												disabled={signIn.isPending}
												onClick={() => signIn.mutate(m.id)}
												title={m.description ?? undefined}
											>
												{signIn.isPending ? <Spinner /> : <KeyRound />} {m.name}
											</Button>
										),
									)}
									<p className="text-xs text-fg-subtle">
										Sign-in happens on the computer running Sekai: a browser may open there.
									</p>
								</div>
							)}
						</div>
					)}
					{s.state === "ready" && (
						<div className="grid gap-3 text-xs md:grid-cols-2">
							<div>
								<div className="mb-1.5 font-medium text-fg-subtle">Models</div>
								<div className="flex flex-wrap gap-1">
									{s.models.length === 0 && <span className="text-fg-subtle">Its default model</span>}
									{s.models.slice(0, 14).map((m) => (
										<Badge key={m.id}>{m.name}</Badge>
									))}
									{s.models.length > 14 && <Badge>+{s.models.length - 14}</Badge>}
								</div>
							</div>
							<div>
								<div className="mb-1.5 font-medium text-fg-subtle">Reasoning levels</div>
								<div className="flex flex-wrap gap-1">
									{s.thinking.length === 0 ? (
										<span className="text-fg-subtle">Not adjustable</span>
									) : (
										s.thinking.map((t) => <Badge key={t}>{t}</Badge>)
									)}
								</div>
							</div>
						</div>
					)}
					<div>
						<div className="mb-1.5 text-xs font-medium text-fg-subtle">Bots using it</div>
						{users.length === 0 ? (
							<p className="text-xs text-fg-subtle">
								None yet. Open a bot's Model tab (or the model pill in the composer) and pick a{" "}
								{p.title} model.
							</p>
						) : (
							<div className="flex flex-wrap gap-1.5">
								{users.map((a) => (
									<a
										key={a.id}
										href={`/bot/${a.id}`}
										className="flex items-center gap-1.5 rounded-full border border-border py-0.5 pr-2.5 pl-0.5 text-xs hover:bg-surface-2"
									>
										<AgentAvatar avatar={a.avatar} size={20} />
										{a.name}
									</a>
								))}
							</div>
						)}
					</div>
					<div className="flex flex-wrap items-center gap-1.5">
						<Button
							variant="secondary"
							size="xs"
							onClick={() => check.mutate()}
							disabled={checking || !p.enabled}
						>
							<RefreshCw className={cn(checking && "animate-spin")} /> Check again
						</Button>
						<Button variant="secondary" size="xs" onClick={onEdit}>
							Edit
						</Button>
						<Button variant="danger-ghost" size="xs" onClick={() => setConfirm(true)}>
							<Trash2 /> Remove
						</Button>
						{s.checkedAt && (
							<span className="ml-auto text-[11px] text-fg-subtle">Checked {timeAgo(s.checkedAt)}</span>
						)}
					</div>
				</div>
			)}
			<Confirm
				open={confirm}
				onOpenChange={setConfirm}
				title={`Remove ${p.title}?`}
				description={
					users.length
						? `${users.map((u) => u.name).join(", ")} will need another model. Your sign-in for the agent itself is untouched.`
						: "Sekai stops using it. Your sign-in for the agent itself is untouched."
				}
				confirmLabel="Remove"
				danger
				onConfirm={() => remove.mutate()}
			/>
		</Card>
	);
}

/** BYOS: use the agent CLIs (and plans) you already pay for as your bots' brains. */
export function SubscriptionsPanel() {
	return (
		<SettingsPanel
			value="subscriptions"
			title="Subscriptions"
			description="Use the plans you already have. Sekai can run Codex, Claude Code, Grok, Gemini CLI, Devin, Antigravity, Muse Code or any ACP agent as a bot's brain, signed in with your own account."
			className="max-w-4xl"
		>
			<Subscriptions />
		</SettingsPanel>
	);
}

function Subscriptions() {
	const { data: providers = [], isLoading } = useProviders();
	const [dialog, setDialog] = useState<{ preset: ProviderPresetId; provider: ProviderWithStatus | null } | null>(
		null,
	);
	const added = new Set(providers.map((p) => p.preset));

	return (
		<div className="flex flex-col gap-6">
			<p className="text-[13px] leading-6 text-fg-subtle">
				The agent runs on the computer running Sekai and keeps its own sign-in; Sekai never sees your password.
				It gets the bot's memory, notes, routines and team as tools, and asks your approval like any other bot.
			</p>

			{isLoading ? (
				<Spinner />
			) : providers.length === 0 ? (
				<EmptyState
					icon={<KeyRound />}
					title="No subscriptions connected"
					description="Pick one below. You'll need its CLI installed and signed in on the computer running Sekai."
					className="py-6"
				/>
			) : (
				<div className="flex flex-col gap-3">
					{providers.map((p) => (
						<ProviderCard key={p.id} p={p} onEdit={() => setDialog({ preset: p.preset, provider: p })} />
					))}
				</div>
			)}

			<div>
				<h3 className="mb-3 text-[13px] font-semibold">Add a subscription</h3>
				<div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
					{PROVIDER_PRESET_IDS.map((id) => {
						const def = PROVIDER_PRESETS[id];
						return (
							<button
								key={id}
								type="button"
								onClick={() => setDialog({ preset: id, provider: null })}
								className="flex items-start gap-3 rounded-2xl border border-border p-3.5 text-left transition-colors hover:bg-surface-2"
							>
								<ProviderMark preset={id} size={32} />
								<span className="min-w-0">
									<span className="flex items-center gap-1.5 text-sm font-medium">
										{def.title}
										{added.has(id) && id !== "custom" && (
											<Check className="size-3.5 text-success" />
										)}
									</span>
									<span className="line-clamp-2 text-xs leading-5 text-fg-subtle">{def.vendor}</span>
								</span>
							</button>
						);
					})}
				</div>
			</div>

			<ProviderDialog
				open={dialog !== null}
				onOpenChange={(o) => !o && setDialog(null)}
				preset={dialog?.preset ?? "custom"}
				provider={dialog?.provider ?? null}
			/>
		</div>
	);
}
