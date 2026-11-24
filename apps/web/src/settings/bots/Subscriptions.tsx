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
import {
	jobWorkspace,
	joinCommandLine,
	PROVIDER_PRESET_IDS,
	PROVIDER_PRESETS,
	type ProviderPresetId,
	type ProviderToolState,
	type ProviderWithStatus,
	type SignInTicket,
	splitCommandLine,
} from "@sekai/shared";
import {
	Badge,
	Button,
	Callout,
	Confirm,
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
	Select,
	SkeletonRows,
	Spinner,
	StatusDot,
	Switch,
	Textarea,
	useFormValues,
} from "@sekai/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Download, ExternalLink, KeyRound, Plug, Plus, RefreshCw, ShieldAlert, Terminal, Trash2 } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { useGoBack } from "../../lib/back.ts";
import { actionError, saveForm, useAfterSave } from "../../lib/forms.ts";
import { sectionPath } from "../registry.tsx";
import type { SettingsSectionProps } from "../section.ts";
import { SignInTerminal } from "./SignInTerminal.tsx";

const LIST = sectionPath("subscriptions");
const presetTitle = (id: ProviderPresetId) => (id === "custom" ? "Custom" : PROVIDER_PRESETS[id].title);
const isPreset = (id: string | undefined): id is ProviderPresetId =>
	(PROVIDER_PRESET_IDS as readonly string[]).includes(id ?? "");

const ENV_HINTS: Partial<Record<ProviderPresetId, string>> = {
	claude: "ANTHROPIC_API_KEY=sk-ant-…",
	codex: "OPENAI_API_KEY=sk-…",
	grok: "XAI_API_KEY=xai-…",
	devin: "WINDSURF_API_KEY=…",
	muse: "META_API_KEY=…",
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
			Anthropic doesn't allow other apps to offer claude.ai sign-in, so Sekai runs Claude Code's own sign-in on
			this server, or uses an <code className="font-mono">ANTHROPIC_API_KEY</code> under Advanced. If other people
			use this Sekai, use an API key.
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

/** First missing tool that Sekai can install automatically. */
function nextInstallableTool(tools: ProviderToolState[]): ProviderToolState | null {
	return tools.find((t) => !t.installed && !t.unavailable) ?? null;
}

/** Whether any tool for this subscription is missing. */
function missingTools(tools: ProviderToolState[]): ProviderToolState[] {
	return tools.filter((t) => !t.installed);
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
								: "Codex, Claude Code, OpenCode, Grok and more — install and sign in right from Sekai."
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
							const missing = missingTools(p.setup.tools);
							const installing = p.setup.tools.some((t) => t.job?.state === "running");
							const state = installing
								? { tone: "brand" as const, label: "Installing…" }
								: missing.length > 0
									? { tone: "warning" as const, label: "Needs install" }
									: STATE[s.state];
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
										) : s.state === "ready" && missing.length === 0 && !installing ? undefined : (
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
				Sekai installs each plan's tool into its own folder and runs its sign-in in your browser; Sekai never
				sees your password. Most plans can use a bot's memory, notes, routines and team. Pi is chat-only.
			</Fold>
		</Page>
	);
}

// ---------------------------------------------------------------- adding / editing settings

/** Name, command, sign-in command, environment and extra models: adding a plan, or changing one. */
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
	const [signInError, setSignInError] = useState<string | null>(null);
	const form = useFormValues({
		title: provider?.title ?? def.title,
		command: provider?.command ?? def.command,
		args: joinArgs(provider?.args ?? def.args),
		signInCommand: joinCommandLine(provider?.signInCommand ?? []),
		env: kvText(provider?.env ?? def.env),
		models: (provider?.extraModels ?? []).join(", "),
	});
	const v = form.values;

	return (
		<FormGroup
			dirty={form.dirty}
			submitWhenClean={!provider}
			disabled={acp && !v.command.trim()}
			submitLabel={provider ? "Save" : "Add subscription"}
			onCancel={() => {
				setSignInError(null);
				form.reset();
			}}
			onSubmit={() => {
				const rawSignIn = v.signInCommand.trim();
				const parsedSignIn = rawSignIn ? splitCommandLine(rawSignIn) : [];
				if (parsedSignIn === null) {
					setSignInError("Close the quote in the sign-in command.");
					return Promise.reject(new Error("Close the quote in the sign-in command."));
				}
				setSignInError(null);
				return saveForm(async () => {
					const body = {
						title: v.title.trim() || def.title,
						command: v.command.trim(),
						args: splitArgs(v.args),
						signInCommand: parsedSignIn,
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
				});
			}}
		>
			<Field label="Name">
				<Input value={v.title} onChange={(e) => form.set("title", e.target.value)} maxLength={80} />
			</Field>
			<Fold title="Advanced" defaultOpen={def.id === "custom"} summary="Command, sign-in command and environment">
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
					label="Sign-in command"
					optional
					error={signInError ?? undefined}
					hint={
						def.id === "custom"
							? "Command Sekai runs in the browser terminal when you click Sign in (no shell)."
							: "Leave empty to use this plan's default sign-in command."
					}
				>
					<Input
						value={v.signInCommand}
						onChange={(e) => {
							setSignInError(null);
							form.set("signInCommand", e.target.value);
						}}
						placeholder={
							def.id === "custom" ? "e.g. my-agent login --device-auth" : (provider?.setup.signIn ?? "")
						}
						className="font-mono"
					/>
				</Field>
				<Field
					label="Environment"
					optional
					hint="One KEY=value per line. Secret values (API keys, tokens) are encrypted and hidden after saving."
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
				{provider?.setup.folder && (
					<Field label="Sign-in folder" hint="Only Sekai's account on this server can read it.">
						<Input value={provider.setup.folder} readOnly className="font-mono text-fg-muted" />
					</Field>
				)}
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
			description={def ? def.description : "Pick a plan to install and sign in right from Sekai."}
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
					<SettingsForm
						key={preset}
						preset={preset}
						provider={null}
						onSaved={(p) =>
							afterSave(() => navigate(sectionPath("subscriptions", p.id), { replace: true }))
						}
					/>
					<Fold variant="link" title="Setup guide">
						<Markdown text={def.signIn} className="text-small text-fg-muted" />
						<a
							href={def.docsUrl}
							target="_blank"
							rel="noreferrer"
							className="mt-2 inline-flex items-center gap-1 text-small font-medium text-brand-ink hover:underline"
						>
							Read its docs <ExternalLink aria-hidden className="size-4" />
						</a>
					</Fold>
				</>
			)}
		</Page>
	);
}

// ---------------------------------------------------------------- tools row

function toolSubtitle(tool: ProviderToolState): string {
	if (tool.job?.state === "running") return tool.job.step;
	if (tool.job?.state === "failed") return tool.job.error ?? "Install failed.";
	if (tool.installed) {
		return [
			tool.version ? `v${tool.version}` : "Installed",
			tool.managed ? "managed by Sekai" : "already on this server",
			tool.updateAvailable && tool.wanted && tool.wanted !== "latest" ? `v${tool.wanted} available` : null,
		]
			.filter(Boolean)
			.join(" · ");
	}
	if (tool.unavailable) return tool.unavailable;
	if (tool.wanted && tool.wanted !== "latest") return `Not installed · v${tool.wanted}`;
	return "Not installed · latest version";
}

// ---------------------------------------------------------------- one subscription

function SubscriptionPage({ id, readOnly }: { id: string; readOnly: boolean }) {
	const goBack = useGoBack();
	const refresh = useRefresh();
	const { data: providers, isLoading, isError, error, refetch } = useProviders();
	const p = providers?.find((x) => x.id === id) ?? null;
	const users = useBotsUsing(id);

	const [removing, setRemoving] = useState(false);
	const [target, setTarget] = useState("");
	const [ticket, setTicket] = useState<SignInTicket | null>(null);
	const [terminalOpen, setTerminalOpen] = useState(false);
	const [terminalTitle, setTerminalTitle] = useState("Sign in");
	const [terminalHint, setTerminalHint] = useState<string | undefined>(undefined);

	const check = useMutation({ mutationFn: () => api.providers.check(id), onSuccess: refresh, onError: actionError });
	const toggle = useMutation({
		mutationFn: (enabled: boolean) => api.providers.update(id, { enabled }),
		onSuccess: refresh,
		onError: actionError,
	});
	const toggleOwnConfig = useMutation({
		mutationFn: (ownConfig: boolean) => api.providers.update(id, { ownConfig }),
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
	const installTool = useMutation({
		mutationFn: (toolId: string) => api.providers.installTool(toolId),
		onSuccess: refresh,
		onError: actionError,
	});
	const authenticate = useMutation({
		mutationFn: (methodId: string) => api.providers.authenticate(id, methodId),
		onSuccess: (r) => {
			refresh();
			if (r.status.state === "ready") toast.success(`Signed in to ${r.title}`);
		},
		onError: actionError,
	});
	const openSignIn = useMutation({
		mutationFn: (opts: { methodId?: string; target?: string; title?: string; hint?: string }) =>
			api.providers.signIn(id, { methodId: opts.methodId, target: opts.target }).then((t) => ({
				ticket: t,
				title: opts.title,
				hint: opts.hint,
			})),
		onSuccess: ({ ticket: t, title, hint }) => {
			setTicket(t);
			setTerminalTitle(title ?? `Sign in to ${p?.title ?? "subscription"}`);
			setTerminalHint(hint);
			setTerminalOpen(true);
			refresh();
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
	const setup = p.setup;
	const checking = s.state === "checking" || check.isPending;
	const installingTool = setup.tools.find((t) => t.job?.state === "running") ?? null;
	const toInstall = nextInstallableTool(setup.tools);
	const unavailableTool = setup.tools.find((t) => !t.installed && t.unavailable) ?? null;
	const failedTools = setup.tools.filter((t) => t.job?.state === "failed" && t.job.error);
	const targets = def.signInTargets ?? [];
	const selectedTarget = target || targets[0]?.id || "";
	const canBrowserSignIn = Boolean(setup.signIn && !setup.signInBlocked);
	const terminalMethods = s.authMethods.filter((m) => m.terminal);
	const directMethods = s.authMethods.filter((m) => !m.terminal);

	// Lead with the single next thing to do.
	let headlineTone: "success" | "warning" | "danger" | "neutral" | "brand" = STATE[s.state].tone;
	let headlineTitle = STATE[s.state].label;
	let headlineSubtitle: string | undefined;

	if (!p.enabled) {
		headlineTone = "neutral";
		headlineTitle = "Off";
		headlineSubtitle = "Turn it on below to offer its models to bots.";
	} else if (installingTool) {
		headlineTone = "brand";
		headlineTitle = `Installing ${installingTool.title}…`;
		headlineSubtitle = installingTool.job?.step;
	} else if (toInstall) {
		headlineTone = "warning";
		headlineTitle = `Install ${toInstall.title}`;
		headlineSubtitle = "Sekai installs it into its own tools folder so you don't need SSH.";
	} else if (unavailableTool) {
		headlineTone = "warning";
		headlineTitle = `${unavailableTool.title} needed`;
		headlineSubtitle = unavailableTool.unavailable ?? undefined;
	} else if (s.state === "ready") {
		headlineTone = "success";
		headlineTitle = s.models.length > 0 ? `Ready: ${pluralize(s.models.length, "model")}` : "Ready";
		headlineSubtitle = [
			s.agentName && `${s.agentName}${s.agentVersion ? ` ${s.agentVersion}` : ""}`,
			s.account,
			s.checkedAt && `checked ${timeAgo(s.checkedAt)}`,
		]
			.filter(Boolean)
			.join(" · ");
	} else if (checking) {
		headlineTone = "brand";
		headlineTitle = "Checking…";
		headlineSubtitle = "Starting the tool to see its models and sign-in state.";
	} else if (s.state === "auth_required") {
		headlineTone = "warning";
		headlineTitle = "Sign in to finish setup";
		headlineSubtitle = def.signInHint ?? "Sign in through the terminal right here in your browser.";
	} else {
		headlineTone = STATE[s.state].tone;
		headlineTitle = s.state === "error" ? "Needs attention" : "Not checked yet";
		headlineSubtitle = [
			s.agentName && `${s.agentName}${s.agentVersion ? ` ${s.agentVersion}` : ""}`,
			s.checkedAt && `checked ${timeAgo(s.checkedAt)}`,
		]
			.filter(Boolean)
			.join(" · ");
	}

	const startPresetSignIn = () => {
		openSignIn.mutate({
			target: targets.length > 0 ? selectedTarget : undefined,
			title: `Sign in to ${p.title}`,
			hint: def.signInHint,
		});
	};

	const needsSignInPrimary =
		!readOnly &&
		p.enabled &&
		!installingTool &&
		!toInstall &&
		!unavailableTool &&
		s.state !== "ready" &&
		!checking &&
		canBrowserSignIn;

	return (
		<Page back={back} title={p.title} description={def.vendor}>
			{p.preset === "claude" && <ClaudeTermsNote />}

			<List label="Next step">
				<Row
					leading={
						<StatusDot
							tone={headlineTone}
							label={headlineTitle}
							pulse={Boolean(checking || installingTool || setup.signingIn)}
						/>
					}
					title={headlineTitle}
					subtitle={headlineSubtitle}
					trailing={
						readOnly ? undefined : installingTool ? (
							<Spinner className="size-4" />
						) : toInstall && p.enabled ? (
							<Button
								variant="primary"
								size="sm"
								loading={installTool.isPending && installTool.variables === toInstall.id}
								onClick={() => installTool.mutate(toInstall.id)}
							>
								<Download /> Install
							</Button>
						) : needsSignInPrimary && targets.length === 0 ? (
							<Button
								variant="primary"
								size="sm"
								loading={openSignIn.isPending}
								disabled={setup.signingIn}
								onClick={startPresetSignIn}
							>
								<KeyRound /> {setup.signingIn ? "Signing in…" : "Sign in"}
							</Button>
						) : (
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
				<Row
					title="Coding jobs"
					subtitle={
						jobWorkspace(p) === "computer"
							? "Ask a bot to use a server folder, its computer or a devbox."
							: jobWorkspace(p) === "server"
								? "Ask a bot to use a server folder. This subscription can’t work on its computer or devbox."
								: "Chat only. For coding jobs, ask for a server folder with Claude Code, Codex or OpenCode."
					}
				/>
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

			{/* Pi target picker when signing in is the primary action or available */}
			{!readOnly && p.enabled && !toInstall && !installingTool && targets.length > 0 && canBrowserSignIn && (
				<Section
					title="Sign in to a provider"
					description="Pi signs in to one provider at a time. Pick one to connect."
				>
					<div className="flex flex-col gap-3 sm:flex-row sm:items-end">
						<Field label="Provider" className="flex-1">
							<Select
								value={selectedTarget}
								onValueChange={setTarget}
								options={targets.map((t) => ({
									value: t.id,
									label: t.account ? `${t.name} (account)` : t.name,
								}))}
							/>
						</Field>
						<Button
							variant={s.state === "ready" ? "secondary" : "primary"}
							loading={openSignIn.isPending}
							disabled={setup.signingIn || !selectedTarget}
							onClick={startPresetSignIn}
						>
							<KeyRound /> {setup.signingIn ? "Signing in…" : "Sign in"}
						</Button>
					</div>
				</Section>
			)}

			{/* Re-sign-in / ACP auth methods / sign-in help */}
			{!readOnly && p.enabled && !toInstall && !installingTool && (
				<>
					{s.state === "ready" && canBrowserSignIn && targets.length === 0 && (
						<div className="flex flex-wrap items-center gap-2">
							<Button
								variant="secondary"
								size="sm"
								loading={openSignIn.isPending}
								disabled={setup.signingIn}
								onClick={startPresetSignIn}
							>
								<Terminal /> Sign in again
							</Button>
						</div>
					)}

					{(terminalMethods.length > 0 || directMethods.length > 0) && s.state !== "ready" && (
						<Section title="Sign-in options from this agent">
							<div className="flex flex-wrap gap-2">
								{terminalMethods.map((m) => (
									<Button
										key={m.id}
										variant={needsSignInPrimary ? "secondary" : "primary"}
										loading={openSignIn.isPending}
										disabled={setup.signingIn}
										onClick={() =>
											openSignIn.mutate({
												methodId: m.id,
												title: m.name,
												hint: m.description ?? undefined,
											})
										}
									>
										<Terminal /> {m.name}
									</Button>
								))}
								{directMethods.map((m) => (
									<Button
										key={m.id}
										variant="secondary"
										loading={authenticate.isPending && authenticate.variables === m.id}
										disabled={authenticate.isPending}
										onClick={() => authenticate.mutate(m.id)}
									>
										<KeyRound /> {m.name}
									</Button>
								))}
							</div>
						</Section>
					)}

					{setup.signInBlocked && !unavailableTool && s.state !== "ready" && (
						<Callout tone="info" title="Sign-in setup">
							<p>{setup.signInBlocked}</p>
							<div className="mt-2">
								<Markdown text={def.signIn} className="text-small text-fg-muted" />
							</div>
						</Callout>
					)}
				</>
			)}

			{failedTools.map((t) => (
				<Callout key={t.id} tone="danger" title={`Couldn't install ${t.title}`}>
					<p className="whitespace-pre-wrap">{t.job?.error}</p>
				</Callout>
			))}

			{p.enabled && s.state === "error" && s.error && !toInstall && !installingTool && (
				<Callout tone="danger" title="Couldn't start it">
					<pre className="max-h-40 overflow-auto font-mono text-caption whitespace-pre-wrap scrollbar-thin">
						{s.error}
					</pre>
				</Callout>
			)}

			{setup.tools.length > 0 && !readOnly && (
				<Section
					title="Tools on this server"
					description="Installed into Sekai's own folder so bots can run them without SSH."
				>
					<List label="Required tools">
						{setup.tools.map((tool) => {
							const isRunning = tool.job?.state === "running";
							const isPending = installTool.isPending && installTool.variables === tool.id;
							return (
								<Row
									key={tool.id}
									title={tool.title}
									subtitle={toolSubtitle(tool)}
									trailing={
										isRunning ? (
											<Spinner className="size-4" />
										) : !tool.installed ? (
											tool.unavailable ? (
												<Badge tone="neutral">Manual</Badge>
											) : (
												<Button
													variant="secondary"
													size="sm"
													loading={isPending}
													onClick={() => installTool.mutate(tool.id)}
												>
													<Download /> Install
												</Button>
											)
										) : tool.updateAvailable ? (
											<Button
												variant="secondary"
												size="sm"
												loading={isPending}
												onClick={() => installTool.mutate(tool.id)}
											>
												Update
											</Button>
										) : (
											<Badge tone="success">Installed</Badge>
										)
									}
								/>
							);
						})}
					</List>
					{setup.tools.some((t) => t.unpinned) && (
						<p className="text-caption text-fg-muted">{setup.tools.find((t) => t.unpinned)?.unpinned}</p>
					)}
					{unavailableTool && (
						<a
							href={def.docsUrl}
							target="_blank"
							rel="noreferrer"
							className="inline-flex items-center gap-1 self-start text-small font-medium text-brand-ink hover:underline"
						>
							Open {def.title} setup guide <ExternalLink aria-hidden className="size-4" />
						</a>
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
					<Section title="Sign-in storage">
						<List label="Sign-in storage">
							<Row
								title="Use its own sign-in"
								subtitle={
									p.ownConfig
										? "Kept in its own private folder so you can connect more than one account."
										: "Currently uses this server's default sign-in. Turn on to keep a separate sign-in for this subscription."
								}
								trailing={
									<Switch
										checked={p.ownConfig}
										label="Use its own sign-in"
										disabled={toggleOwnConfig.isPending}
										onCheckedChange={(ownConfig) => toggleOwnConfig.mutate(ownConfig)}
									/>
								}
							/>
						</List>
					</Section>

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
								? `${users.map((u) => u.name).join(", ")} will need another model. ${p.ownConfig ? "Its saved sign-in folder will be removed too." : "Its sign-in on this server stays."}`
								: p.ownConfig
									? "Bots can't use it any more, and its saved sign-in folder will be removed."
									: "Bots can't use it any more. Its sign-in on this server stays."
						}
						confirmLabel="Remove"
						danger
						onConfirm={() => remove.mutate()}
					/>
				</>
			)}

			<SignInTerminal
				open={terminalOpen}
				onOpenChange={setTerminalOpen}
				title={terminalTitle}
				hint={terminalHint}
				ticket={ticket}
				onDone={refresh}
			/>
		</Page>
	);
}

/**
 * Use AI plans you already pay for as your bots' models: the list, a subscription's page
 * (`/settings/subscriptions/<id>`), and adding one (`…/new`, or `…/new/<plan>` with the plan picked).
 */
export function SubscriptionsSection({ back, rest, readOnly }: SettingsSectionProps) {
	const [first, second] = rest ? rest.split("/") : [];
	if (first === "new" && !readOnly) {
		return <AddSubscription initial={isPreset(second) ? second : null} />;
	}
	if (first) return <SubscriptionPage id={first} readOnly={readOnly} />;
	return <SubscriptionList back={back} readOnly={readOnly} />;
}
