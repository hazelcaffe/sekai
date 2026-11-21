import {
	AgentAvatar,
	api,
	BrandTile,
	joinArgs,
	kvText,
	Markdown,
	parseKv,
	pluralize,
	presetBrand,
	qk,
	splitArgs,
	timeAgo,
	useAgents,
	useProviders,
} from "@sekai/client";
import { PROVIDER_PRESET_IDS, PROVIDER_PRESETS, type ProviderPresetId, type ProviderWithStatus } from "@sekai/shared";
import {
	Badge,
	Button,
	Callout,
	Confirm,
	CopyField,
	EmptyState,
	ErrorState,
	Field,
	Fold,
	FormGroup,
	Input,
	List,
	Page,
	type PageBack,
	Row,
	Section,
	SkeletonRows,
	StatusDot,
	Switch,
	Textarea,
	useFormValues,
} from "@sekai/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, KeyRound, Plug, Plus, RefreshCw, ShieldAlert, Trash2 } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { useGoBack } from "../../lib/back.ts";
import { actionError, saveForm, useAfterSave } from "../../lib/forms.ts";
import { sectionPath } from "../registry.tsx";
import type { SettingsSectionProps } from "../section.ts";

const LIST = sectionPath("subscriptions");
const presetTitle = (id: ProviderPresetId) => (id === "custom" ? "Custom" : PROVIDER_PRESETS[id].title);
const isPreset = (id: string | undefined): id is ProviderPresetId =>
	(PROVIDER_PRESET_IDS as readonly string[]).includes(id ?? "");

const ENV_HINTS: Partial<Record<ProviderPresetId, string>> = {
	claude: "ANTHROPIC_API_KEY=sk-ant-…",
	opencode: "XDG_CONFIG_HOME=/path/to/config",
	pi: "PI_CODING_AGENT_DIR=/path/to/pi-config",
};

/** How a subscription is doing, in a word (none while it's ready). */
const STATE: Record<
	ProviderWithStatus["status"]["state"],
	{ tone: "success" | "warning" | "danger" | "neutral" | "brand"; label: string }
> = {
	ready: { tone: "success", label: "Ready" },
	checking: { tone: "brand", label: "Checking…" },
	auth_required: { tone: "warning", label: "Needs sign-in" },
	error: { tone: "danger", label: "Problem" },
	unchecked: { tone: "neutral", label: "Not checked" },
};

/** The subscription's own mark on a tile (a plug for a custom one). */
function ProviderMark({ preset, size = 36 }: { preset: ProviderPresetId; size?: number }) {
	return <BrandTile brand={presetBrand(preset)} size={size} fallback={<Plug className="size-4 text-fg-muted" />} />;
}

function ClaudeTermsNote() {
	return (
		<Callout tone="warning" icon={<ShieldAlert />}>
			Anthropic doesn't allow other apps to offer claude.ai sign-in, so Sekai uses the Claude Code signed in on
			this server, or an <code className="font-mono">ANTHROPIC_API_KEY</code> under Advanced. If other people use
			this Sekai, use an API key.
		</Callout>
	);
}

function useRefresh() {
	const qc = useQueryClient();
	return () => {
		void qc.invalidateQueries({ queryKey: qk.providers });
		void qc.invalidateQueries({ queryKey: qk.models });
	};
}

/** Bots whose model is this subscription (yours, and ones shared with you). */
function useBotsUsing(id: string) {
	const { data: agents = [] } = useAgents();
	return agents.filter((a) => a.models.primary.model === id || a.models.primary.model.startsWith(`${id}::`));
}

// ---------------------------------------------------------------- the list

function SubscriptionList({ back, readOnly }: { back: PageBack; readOnly: boolean }) {
	const navigate = useNavigate();
	const refresh = useRefresh();
	const { data: providers = [], isLoading, isError, error, refetch } = useProviders();
	const toggle = useMutation({
		mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => api.providers.update(id, { enabled }),
		onSuccess: refresh,
		onError: actionError,
	});
	const add = () => navigate(sectionPath("subscriptions", "new"));

	return (
		<Page back={back} title="Subscriptions" description="Use AI plans you already pay for as your bots' models.">
			{readOnly && (
				<Callout icon={<KeyRound />}>
					Only admins can add or change these. Pick one in a bot's Model & voice.
				</Callout>
			)}
			<Section
				action={
					!readOnly && providers.length > 0 ? (
						<Button variant="secondary" size="sm" onClick={add}>
							<Plus /> Add
						</Button>
					) : undefined
				}
				title="Connected"
			>
				{isLoading ? (
					<SkeletonRows count={2} />
				) : isError ? (
					<ErrorState
						size="sm"
						title="Subscriptions didn't load"
						error={error}
						onRetry={() => void refetch()}
					/>
				) : providers.length === 0 ? (
					<EmptyState
						size="sm"
						icon={<KeyRound />}
						title="No subscriptions yet"
						description={
							readOnly
								? "Ask an admin to connect one."
								: "Codex, Claude Code, Grok and more, installed and signed in on this server."
						}
						action={
							readOnly ? undefined : (
								<Button variant="secondary" onClick={add}>
									Add a subscription
								</Button>
							)
						}
					/>
				) : (
					<List label="Connected subscriptions">
						{providers.map((p) => {
							const s = p.status;
							const state = STATE[s.state];
							return (
								<Row
									key={p.id}
									leading={<ProviderMark preset={p.preset} />}
									title={p.title}
									subtitle={[
										PROVIDER_PRESETS[p.preset].vendor,
										s.account,
										s.state === "ready" && s.models.length
											? pluralize(s.models.length, "model")
											: null,
									]
										.filter(Boolean)
										.join(" · ")}
									badge={
										!p.enabled ? (
											readOnly && <Badge>Off</Badge>
										) : s.state === "ready" ? undefined : (
											<Badge tone={state.tone}>{state.label}</Badge>
										)
									}
									href={sectionPath("subscriptions", p.id)}
									trailing={
										readOnly ? undefined : (
											<Switch
												checked={p.enabled}
												label={`Use ${p.title}`}
												disabled={toggle.isPending}
												onCheckedChange={(enabled) => toggle.mutate({ id: p.id, enabled })}
											/>
										)
									}
								/>
							);
						})}
					</List>
				)}
			</Section>
			<Fold variant="link" title="Learn more">
				Each plan runs its own signed-in tool on this server; Sekai never sees your password. Most can use a
				bot's memory, notes, routines and team. Pi is chat-only.
			</Fold>
		</Page>
	);
}

// ---------------------------------------------------------------- adding one

/** Name, command, environment and extra models: adding a plan, or changing one. */
function SettingsForm({
	preset,
	provider,
	onSaved,
}: {
	preset: ProviderPresetId;
	provider: ProviderWithStatus | null;
	onSaved: (p: ProviderWithStatus) => void;
}) {
	const refresh = useRefresh();
	const def = PROVIDER_PRESETS[provider?.preset ?? preset];
	const acp = def.kind === "acp";
	const form = useFormValues({
		title: provider?.title ?? def.title,
		command: provider?.command ?? def.command,
		args: joinArgs(provider?.args ?? def.args),
		env: kvText(provider?.env ?? def.env),
		models: (provider?.extraModels ?? []).join(", "),
	});
	const v = form.values;

	return (
		<FormGroup
			dirty={form.dirty}
			submitWhenClean={!provider}
			disabled={acp && !v.command.trim()}
			submitLabel={provider ? "Save" : "Add and check"}
			onCancel={() => form.reset()}
			onSubmit={() =>
				saveForm(async () => {
					const body = {
						title: v.title.trim() || def.title,
						command: v.command.trim(),
						args: splitArgs(v.args),
						env: parseKv(v.env),
						extraModels: v.models
							.split(/[,\n]/)
							.map((m) => m.trim())
							.filter(Boolean),
					};
					const saved = provider
						? await api.providers.update(provider.id, body)
						: await api.providers.create({ preset: def.id, ...body });
					refresh();
					form.reset(form.values);
					onSaved(saved);
				})
			}
		>
			<Field label="Name">
				<Input value={v.title} onChange={(e) => form.set("title", e.target.value)} maxLength={80} />
			</Field>
			<Fold title="Advanced" defaultOpen={def.id === "custom"} summary="Command and environment">
				{acp ? (
					<div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
						<Field label="Command" hint="On the server's PATH, or a full path.">
							<Input
								value={v.command}
								onChange={(e) => form.set("command", e.target.value)}
								className="font-mono"
							/>
						</Field>
						<Field label="Arguments" hint="Flags that start it in ACP mode.">
							<Input
								value={v.args}
								onChange={(e) => form.set("args", e.target.value)}
								className="font-mono"
							/>
						</Field>
					</div>
				) : (
					<Field label="Claude Code executable" optional hint="Leave empty to use the bundled one.">
						<Input
							value={v.command}
							onChange={(e) => form.set("command", e.target.value)}
							placeholder="e.g. ~/.local/bin/claude"
							className="font-mono"
						/>
					</Field>
				)}
				<Field
					label="Environment"
					optional
					hint="One KEY=value per line. Secret values are hidden after saving."
				>
					<Textarea
						value={v.env}
						onChange={(e) => form.set("env", e.target.value)}
						className="min-h-20 font-mono"
						placeholder={`e.g. ${ENV_HINTS[def.id] ?? "OPENAI_API_KEY=sk-…"}`}
					/>
				</Field>
				<Field label="Extra models" optional hint="Model names to offer if it doesn't list them, with commas.">
					<Input
						value={v.models}
						onChange={(e) => form.set("models", e.target.value)}
						className="font-mono"
					/>
				</Field>
			</Fold>
		</FormGroup>
	);
}

/** Pick a plan, then its settings, on one page (so back from the new subscription goes to the list). */
function AddSubscription({ initial }: { initial: ProviderPresetId | null }) {
	const goBack = useGoBack();
	const navigate = useNavigate();
	const afterSave = useAfterSave();
	const { data: providers = [] } = useProviders();
	const [preset, setPreset] = useState(initial);
	const added = new Set(providers.map((p) => p.preset));
	const def = preset ? PROVIDER_PRESETS[preset] : null;
	return (
		<Page
			back={{ label: "Subscriptions", onClick: () => goBack(LIST) }}
			title={preset ? `Add ${presetTitle(preset)}` : "Add a subscription"}
			description={def ? def.description : "Pick a plan that's installed on this server."}
		>
			{!preset || !def ? (
				<List label="Plans">
					{PROVIDER_PRESET_IDS.map((id) => (
						<Row
							key={id}
							leading={<ProviderMark preset={id} size={32} />}
							title={presetTitle(id)}
							subtitle={PROVIDER_PRESETS[id].vendor}
							value={added.has(id) && id !== "custom" ? "Added" : undefined}
							chevron
							onClick={() => setPreset(id)}
						/>
					))}
				</List>
			) : (
				<>
					<List label="Plan">
						<Row
							leading={<ProviderMark preset={preset} size={32} />}
							title={presetTitle(preset)}
							subtitle={def.vendor}
							trailing={
								<Button variant="ghost" size="sm" onClick={() => setPreset(null)}>
									Change
								</Button>
							}
						/>
					</List>
					{preset === "claude" && <ClaudeTermsNote />}
					<Section title="First, sign in on this server">
						<Markdown text={def.signIn} className="text-small text-fg-muted" />
						<a
							href={def.docsUrl}
							target="_blank"
							rel="noreferrer"
							className="inline-flex items-center gap-1 self-start text-small font-medium text-brand-ink hover:underline"
						>
							Its setup guide <ExternalLink aria-hidden className="size-4" />
						</a>
					</Section>
					<SettingsForm
						key={preset}
						preset={preset}
						provider={null}
						onSaved={(p) =>
							afterSave(() => navigate(sectionPath("subscriptions", p.id), { replace: true }))
						}
					/>
				</>
			)}
		</Page>
	);
}

// ---------------------------------------------------------------- one subscription

function SubscriptionPage({ id, readOnly }: { id: string; readOnly: boolean }) {
	const goBack = useGoBack();
	const refresh = useRefresh();
	const { data: providers, isLoading, isError, error, refetch } = useProviders();
	const p = providers?.find((x) => x.id === id) ?? null;
	const users = useBotsUsing(id);
	const [removing, setRemoving] = useState(false);
	const check = useMutation({ mutationFn: () => api.providers.check(id), onSuccess: refresh, onError: actionError });
	const toggle = useMutation({
		mutationFn: (enabled: boolean) => api.providers.update(id, { enabled }),
		onSuccess: refresh,
		onError: actionError,
	});
	const remove = useMutation({
		mutationFn: () => api.providers.delete(id),
		onSuccess: () => {
			refresh();
			goBack(LIST);
		},
		onError: actionError,
	});
	const signIn = useMutation({
		mutationFn: (methodId: string) => api.providers.authenticate(id, methodId),
		onSuccess: (r) => {
			refresh();
			if (r.status.state === "ready") toast.success(`Signed in to ${r.title}`);
		},
		onError: actionError,
	});
	const back = { label: "Subscriptions", onClick: () => goBack(LIST) };

	if (isLoading || isError || !p) {
		return (
			<Page back={back} title="Subscription">
				{isLoading ? (
					<SkeletonRows count={3} />
				) : isError ? (
					<ErrorState error={error} onRetry={() => void refetch()} />
				) : (
					<EmptyState icon={<KeyRound />} title="This subscription isn't here." />
				)}
			</Page>
		);
	}

	const def = PROVIDER_PRESETS[p.preset];
	const s = p.status;
	const state = !p.enabled ? { tone: "neutral" as const, label: "Off" } : STATE[s.state];
	const checking = s.state === "checking" || check.isPending;
	const needsSetup = p.enabled && (s.state === "auth_required" || s.state === "error");

	return (
		<Page back={back} title={p.title} description={def.vendor}>
			{p.preset === "claude" && <ClaudeTermsNote />}

			<List label="Status">
				{(p.enabled || readOnly) && (
					<Row
						leading={<StatusDot tone={state.tone} label={state.label} pulse={checking} />}
						title={state.label}
						subtitle={[
							s.agentName && `${s.agentName}${s.agentVersion ? ` ${s.agentVersion}` : ""}`,
							s.account,
							s.checkedAt && `checked ${timeAgo(s.checkedAt)}`,
						]
							.filter(Boolean)
							.join(" · ")}
						trailing={
							readOnly ? undefined : (
								<Button
									variant="secondary"
									size="sm"
									loading={checking}
									disabled={!p.enabled}
									onClick={() => check.mutate()}
								>
									{!checking && <RefreshCw />} Check again
								</Button>
							)
						}
					/>
				)}
				{!readOnly && (
					<Row
						title="Use it"
						subtitle="Turn it off to keep its setup without offering its models."
						trailing={
							<Switch
								checked={p.enabled}
								label={`Use ${p.title}`}
								disabled={toggle.isPending}
								onCheckedChange={(enabled) => toggle.mutate(enabled)}
							/>
						}
					/>
				)}
			</List>

			{p.enabled && s.state === "error" && s.error && (
				<Callout tone="danger" title="Couldn't start it">
					<pre className="max-h-40 overflow-auto font-mono text-caption whitespace-pre-wrap scrollbar-thin">
						{s.error}
					</pre>
				</Callout>
			)}

			{needsSetup && !readOnly && (
				<Section title={s.state === "auth_required" ? "Sign in" : "How to set it up"}>
					<Markdown text={def.signIn} className="text-small text-fg-muted" />
					{s.authMethods.map((m) =>
						m.terminal ? (
							<Field key={m.id} label={m.name} hint="Run it in a terminal on this server.">
								<CopyField label={`the command for ${m.name}`} value={m.terminal} />
							</Field>
						) : (
							<div key={m.id} className="flex flex-col items-start gap-1">
								<Button
									variant="secondary"
									loading={signIn.isPending && signIn.variables === m.id}
									disabled={signIn.isPending}
									onClick={() => signIn.mutate(m.id)}
								>
									<KeyRound /> {m.name}
								</Button>
								{m.description && <p className="text-small text-fg-muted">{m.description}</p>}
							</div>
						),
					)}
					{s.authMethods.some((m) => !m.terminal) && (
						<p className="text-small text-fg-muted">
							It signs in on this server; a browser may open there.
						</p>
					)}
				</Section>
			)}

			{s.state === "ready" && (
				<Section title="What it offers">
					<div className="flex flex-col gap-1.5">
						<span className="text-small font-medium text-fg">Models</span>
						<div className="flex flex-wrap gap-1.5">
							{s.models.length === 0 ? (
								<span className="text-small text-fg-muted">Its default model</span>
							) : (
								s.models.map((m) => <Badge key={m.id}>{m.name}</Badge>)
							)}
						</div>
					</div>
					<div className="flex flex-col gap-1.5">
						<span className="text-small font-medium text-fg">Thinking levels</span>
						<div className="flex flex-wrap gap-1.5">
							{s.thinking.length === 0 ? (
								<span className="text-small text-fg-muted">Not adjustable</span>
							) : (
								s.thinking.map((t) => <Badge key={t}>{t}</Badge>)
							)}
						</div>
					</div>
				</Section>
			)}

			<Section title="Bots using it">
				{users.length === 0 ? (
					<p className="text-small text-fg-muted">None yet. Pick it in a bot's Model & voice.</p>
				) : (
					<List label="Bots using it">
						{users.map((a) => (
							<Row
								key={a.id}
								leading={<AgentAvatar avatar={a.avatar} size={32} />}
								title={a.name}
								subtitle={a.sharedBy ? `Shared by ${a.sharedBy}` : undefined}
								href={a.sharedBy ? `/bots/${a.id}/profile` : `/bots/${a.id}/model`}
							/>
						))}
					</List>
				)}
			</Section>

			{!readOnly && (
				<>
					<Section title="Settings">
						<SettingsForm preset={p.preset} provider={p} onSaved={() => {}} />
					</Section>
					<div>
						<Button variant="danger-ghost" onClick={() => setRemoving(true)}>
							<Trash2 /> Remove subscription
						</Button>
					</div>
					<Confirm
						open={removing}
						onOpenChange={setRemoving}
						title={`Remove ${p.title}?`}
						description={
							users.length
								? `${users.map((u) => u.name).join(", ")} will need another model. Its sign-in on this server stays.`
								: "Bots can't use it any more. Its sign-in on this server stays."
						}
						confirmLabel="Remove"
						danger
						onConfirm={() => remove.mutate()}
					/>
				</>
			)}
		</Page>
	);
}

/**
 * Use AI plans you already pay for as your bots' models: the list, a subscription's page
 * (`/settings/subscriptions/<id>`), and adding one (`…/new`, or `…/new/<plan>` with the plan picked).
 */
export function SubscriptionsSection({ back, rest, readOnly }: SettingsSectionProps) {
	const [first, second] = rest.split("/");
	if (first === "new" && !readOnly) return <AddSubscription initial={isPreset(second) ? second : null} />;
	if (first && first !== "new") return <SubscriptionPage key={first} id={first} readOnly={readOnly} />;
	return <SubscriptionList back={back} readOnly={readOnly} />;
}
