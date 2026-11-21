import { api, timeAgo, useWebEngine } from "@sekai/client";
import type {
	WebCloudMode,
	WebEngineMode,
	WebEngineSettings,
	WebEngineStatus,
	WebSetup,
	WebSetupStep,
} from "@sekai/shared";
import {
	Badge,
	Button,
	Callout,
	Confirm,
	ErrorState,
	errorMessage,
	Field,
	Fold,
	FormGroup,
	IconTile,
	Input,
	List,
	Page,
	PasswordInput,
	Row,
	SaveState,
	Section,
	Segmented,
	SkeletonRows,
	Spinner,
	ToggleRow,
	useFormValues,
} from "@sekai/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	Ban,
	CircleAlert,
	CircleCheck,
	CircleX,
	Download,
	FileSearch,
	RotateCw,
	Square,
	TriangleAlert,
	WandSparkles,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { actionError, saveForm } from "../../lib/forms.ts";
import type { SettingsSectionProps } from "../section.ts";
import { usePatchAutosave } from "./common.tsx";

const KEY = ["web"] as const;
const SETUP_KEY = ["web", "setup"] as const;

const STATE_BADGE: Record<
	WebEngineStatus["state"],
	{ tone: "success" | "warning" | "danger" | "neutral"; label: string }
> = {
	ready: { tone: "success", label: "Ready" },
	starting: { tone: "warning", label: "Starting…" },
	installing: { tone: "warning", label: "Installing…" },
	missing: { tone: "warning", label: "Not installed" },
	error: { tone: "danger", label: "Problem" },
	off: { tone: "neutral", label: "Off" },
};

function useWebAutosave() {
	const qc = useQueryClient();
	return usePatchAutosave(async (patch: Partial<WebEngineSettings>) => {
		const next = await api.web.save(patch);
		qc.setQueryData(KEY, next);
		return next;
	});
}

/** The current or last "Set it up for me" run, checked every 1.5s while running. */
function useSetup() {
	const qc = useQueryClient();
	const query = useQuery({
		queryKey: SETUP_KEY,
		queryFn: api.web.setup.status,
		refetchInterval: (q) => (q.state.data?.state === "running" ? 1500 : false),
	});
	const state = query.data?.state;
	const was = useRef(state);
	useEffect(() => {
		if (was.current === "running" && state !== "running") void qc.invalidateQueries({ queryKey: KEY });
		was.current = state;
	}, [state, qc]);
	return query;
}

const SETUP_BADGE: Record<WebSetup["state"], { tone: "success" | "warning" | "danger" | "neutral"; label: string }> = {
	idle: { tone: "neutral", label: "" },
	running: { tone: "warning", label: "Setting up…" },
	done: { tone: "success", label: "Done" },
	failed: { tone: "danger", label: "Couldn't finish" },
	stopped: { tone: "neutral", label: "Stopped" },
};

function SetupStepRow({ step }: { step: WebSetupStep }) {
	if (step.kind === "note") {
		return <p className="whitespace-pre-wrap text-small text-fg-muted">{step.text}</p>;
	}
	const icon = step.running ? (
		<Spinner />
	) : step.refused ? (
		<Ban className="size-4 text-warning-ink" />
	) : step.exitCode === 0 ? (
		<CircleCheck className="size-4 text-success-ink" />
	) : (
		<CircleX className="size-4 text-danger-ink" />
	);
	return (
		<details className="group rounded-lg border border-border bg-surface" open={step.running || undefined}>
			<summary className="flex cursor-pointer list-none items-start gap-2.5 px-3 py-2.5 coarse:py-3">
				<span className="mt-0.5 shrink-0">{icon}</span>
				<span className="min-w-0 flex-1">
					<span className="block text-body text-fg">{step.text}</span>
					<code className="block truncate font-mono text-caption text-fg-muted">{step.command}</code>
				</span>
				{step.finishedAt && !step.refused && (
					<span className="shrink-0 text-caption tabular-nums text-fg-muted">
						{Math.max(1, Math.round((step.finishedAt - step.startedAt) / 1000))}s
					</span>
				)}
			</summary>
			<div className="border-t border-border px-3 py-2">
				{step.refused ? (
					<p className="text-small text-warning-ink">Blocked by safety check: {step.refused}</p>
				) : (
					<pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-caption text-fg-muted scrollbar-thin">
						{step.output.trim() || (step.running ? "Working…" : "(no output)")}
					</pre>
				)}
			</div>
		</details>
	);
}

/** Guided automated setup: a model installs Firecrawl Local on this server step by step while you watch. */
function SetupAgent({ setup, canStart }: { setup: WebSetup | undefined; canStart: boolean }) {
	const qc = useQueryClient();
	const [confirm, setConfirm] = useState(false);
	const onDone = (next: WebSetup) => qc.setQueryData(SETUP_KEY, next);
	const start = useMutation({ mutationFn: api.web.setup.start, onSuccess: onDone, onError: actionError });
	const stop = useMutation({ mutationFn: api.web.setup.stop, onSuccess: onDone, onError: actionError });
	const state = setup?.state ?? "idle";
	const steps = setup?.steps ?? [];
	const badge = SETUP_BADGE[state];

	return (
		<div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
			<div className="flex flex-wrap items-start gap-3">
				<IconTile tone="brand" size="md">
					<WandSparkles />
				</IconTile>
				<div className="min-w-0 flex-1 basis-56">
					<div className="flex flex-wrap items-center gap-2">
						<span className="text-body font-medium text-fg">Let Sekai set it up</span>
						{state !== "idle" && <Badge tone={badge.tone}>{badge.label}</Badge>}
					</div>
					<p className="mt-0.5 text-small text-fg-muted">
						Your default model installs the reader on this server and turns it on. You see every step.
					</p>
				</div>
				{state === "running" ? (
					<Button variant="secondary" loading={stop.isPending} onClick={() => stop.mutate()}>
						<Square /> Stop
					</Button>
				) : (
					canStart && (
						<Button variant="primary" loading={start.isPending} onClick={() => setConfirm(true)}>
							<WandSparkles />
							{state === "idle" ? "Set it up for me" : "Try again"}
						</Button>
					)
				)}
			</div>

			<Fold variant="link" title="How automatic setup stays safe">
				Sekai checks every command before running it and blocks access to its own files, services or other
				computers. Building Firecrawl Local takes 10 to 20 minutes, and you can stop it any time.
			</Fold>

			{setup?.summary && state !== "running" && (
				<Callout
					tone={state === "done" ? "success" : state === "failed" ? "danger" : "info"}
					title={state === "done" ? "Enhanced reading is ready" : "Setup couldn't finish"}
				>
					{setup.summary}
				</Callout>
			)}

			{steps.length > 0 && (
				<div className="flex max-h-[28rem] flex-col gap-2 overflow-y-auto scrollbar-thin">
					{steps.map((step) => (
						<SetupStepRow key={step.id} step={step} />
					))}
				</div>
			)}

			{state === "running" && steps.length === 0 && (
				<div className="flex items-center gap-2 text-small text-fg-muted">
					<Spinner /> Checking this server…
				</div>
			)}

			{setup?.model && <p className="text-caption text-fg-muted">Running with {setup.model}</p>}

			<Confirm
				open={confirm}
				onOpenChange={setConfirm}
				icon={<WandSparkles />}
				title="Let Sekai set up enhanced reading?"
				description="Your default model will run commands on this server to install Firecrawl Local (and sudo for system packages). It can't touch Sekai's files, stop services or reach other computers, and you can stop it any time."
				confirmLabel="Set it up"
				onConfirm={() => start.mutate()}
			/>
		</div>
	);
}

/** Remote reader server credentials (saved with FormGroup). */
function RemoteEngineForm({ status }: { status: WebEngineStatus }) {
	const qc = useQueryClient();
	const s = status.settings;
	const form = useFormValues({ url: s.url, token: "" });

	return (
		<FormGroup
			dirty={form.dirty}
			disabled={!form.values.url.trim()}
			submitLabel="Save"
			onCancel={() => form.reset()}
			onSubmit={() =>
				saveForm(async () => {
					const patch: Partial<WebEngineSettings> = { url: form.values.url.trim() };
					if (form.values.token) patch.token = form.values.token;
					const next = await api.web.save(patch);
					qc.setQueryData(KEY, next);
					form.reset({ url: next.settings.url, token: "" });
				})
			}
		>
			<div className="grid gap-4 sm:grid-cols-2">
				<Field label="Server address" hint="Where Firecrawl Local answers.">
					<Input
						value={form.values.url}
						placeholder="http://192.168.1.9:3002"
						onChange={(e) => form.set("url", e.target.value)}
						className="font-mono"
					/>
				</Field>
				<Field label="Access token" optional hint="Only needed if started with a token.">
					<PasswordInput
						value={form.values.token}
						placeholder={s.token ? "Saved (paste to replace)" : "None"}
						onChange={(e) => form.set("token", e.target.value)}
						className="font-mono"
						autoComplete="off"
					/>
				</Field>
			</div>
		</FormGroup>
	);
}

/** Where the enhanced reader runs, and its current state. */
function Engine({ status }: { status: WebEngineStatus }) {
	const qc = useQueryClient();
	const autosave = useWebAutosave();
	const s = status.settings;
	const [portDraft, setPortDraft] = useState(s.port ? String(s.port) : "");
	useEffect(() => {
		setPortDraft(s.port ? String(s.port) : "");
	}, [s.port]);

	const badge = STATE_BADGE[status.state];
	const install = useMutation({
		mutationFn: api.web.install,
		onSuccess: (next) => qc.setQueryData(KEY, next),
		onError: actionError,
	});
	const restart = useMutation({
		mutationFn: api.web.restart,
		onSuccess: (next) => qc.setQueryData(KEY, next),
		onError: actionError,
	});
	const setup = useSetup();
	const installing = install.isPending || status.state === "installing";
	const settingUp = setup.data?.state === "running";
	const busy = installing || settingUp || restart.isPending;
	const canSetUp = s.mode === "here" && !status.binary && !installing;

	const commitPort = () => {
		const trimmed = portDraft.trim();
		const port = trimmed ? Math.min(65535, Math.max(0, Math.round(Number(trimmed) || 0))) : 0;
		setPortDraft(port ? String(port) : "");
		if (port !== s.port) autosave.save({ port });
	};

	const advancedSummary = [s.port ? `Port ${s.port}` : "Automatic port", status.version ? `v${status.version}` : null]
		.filter(Boolean)
		.join(" · ");

	return (
		<Section
			title="Enhanced reading"
			description="Turns web pages, PDFs and Word files into clean text without ads or menus."
			saveState={<SaveState state={autosave} />}
			action={s.mode !== "off" && !status.error ? <Badge tone={badge.tone}>{badge.label}</Badge> : undefined}
		>
			<Segmented<WebEngineMode>
				label="Where enhanced reading runs"
				value={s.mode}
				onValueChange={(mode) => autosave.save({ mode })}
				options={[
					{ value: "off", label: "Off" },
					{ value: "here", label: "On this server" },
					{ value: "elsewhere", label: "Another server" },
				]}
			/>

			{s.mode === "off" && (
				<p className="text-small text-fg-muted">
					Bots still read simple web pages directly while enhanced reading is off.
				</p>
			)}

			<Fold variant="link" title="Learn more">
				Runs Firecrawl Local so bots can read JavaScript-heavy sites, PDFs and Word documents cleanly. Without
				it, bots still read plain pages directly.
			</Fold>

			{status.state === "installing" && (
				<Callout tone="info" icon={<Download />} title="Installing enhanced reader">
					Building Firecrawl Local on this server. This takes a few minutes — you can leave this page.
				</Callout>
			)}

			{status.error && (
				<Callout
					tone={status.state === "missing" ? "warning" : "danger"}
					icon={<TriangleAlert />}
					title={status.state === "missing" ? "Not installed yet" : "Reader isn't running"}
					action={
						status.state === "missing" && status.canInstall && !settingUp ? (
							<Button
								variant="primary"
								loading={installing}
								onClick={() => install.mutate()}
								disabled={busy}
							>
								<Download /> Install
							</Button>
						) : undefined
					}
				>
					{status.error}
				</Callout>
			)}

			{(canSetUp || (setup.data && setup.data.state !== "idle")) && (
				<SetupAgent setup={setup.data} canStart={canSetUp && !busy} />
			)}

			{s.mode === "here" && (
				<>
					<Field
						label="JavaScript pages"
						hint="Use Chrome for interactive sites. Always is slower; Never sticks to plain pages."
					>
						<Segmented
							label="JavaScript pages"
							value={s.browser}
							onValueChange={(browser) => autosave.save({ browser })}
							options={[
								{ value: "auto", label: "When needed" },
								{ value: "never", label: "Never" },
								{ value: "always", label: "Always" },
							]}
						/>
					</Field>

					{status.binary && (
						<List label="Reader status">
							<Row
								title={status.version ? `Firecrawl Local ${status.version}` : "Firecrawl Local"}
								subtitle={
									status.startedAt
										? `Started ${timeAgo(status.startedAt)}${status.url ? ` · ${status.url}` : ""}`
										: status.url || undefined
								}
								trailing={
									<Button
										variant="secondary"
										size="sm"
										loading={restart.isPending}
										disabled={busy}
										onClick={() => restart.mutate()}
									>
										<RotateCw /> Restart
									</Button>
								}
							/>
						</List>
					)}

					<Fold title="Advanced" summary={advancedSummary}>
						<Field label="Local port" hint="Leave empty to pick a free port automatically.">
							<Input
								type="number"
								min={0}
								max={65535}
								placeholder="Automatic"
								value={portDraft}
								onChange={(e) => setPortDraft(e.target.value)}
								onBlur={commitPort}
								onKeyDown={(e) => {
									if (e.key === "Enter") e.currentTarget.blur();
								}}
								className="w-36 tabular-nums"
							/>
						</Field>

						{status.binary && (
							<p className="truncate font-mono text-caption text-fg-muted">{status.binary}</p>
						)}

						{status.canInstall && !settingUp && (
							<div className="flex flex-wrap gap-2">
								<Button
									variant="secondary"
									size="sm"
									loading={installing}
									disabled={busy}
									onClick={() => install.mutate()}
								>
									<Download /> {status.binary ? "Update Firecrawl Local" : "Install Firecrawl Local"}
								</Button>
							</div>
						)}

						{!status.canInstall && !status.binary && !settingUp && (
							<p className="text-small text-fg-muted">
								Manual install requires Rust's cargo. Use “Set it up for me” above, or install Rust from{" "}
								<a
									href="https://rustup.rs"
									target="_blank"
									rel="noreferrer"
									className="font-medium text-brand-ink hover:underline"
								>
									rustup.rs
								</a>{" "}
								and run <code className="font-mono">cargo install firecrawl-local</code>.
							</p>
						)}
					</Fold>
				</>
			)}

			{s.mode === "elsewhere" && <RemoteEngineForm status={status} />}
		</Section>
	);
}

const CLOUD_HINTS: Record<WebCloudMode, string> = {
	off: "Nothing leaves this server. Web search is off; bots can still read pages you give them.",
	search: "Web searches go to Firecrawl's cloud. Pages are still read locally.",
	auto: "Web searches and pages that block your server use Firecrawl's cloud.",
};

/** Optional cloud search & blocked-page fallback. */
function CloudSection({ status }: { status: WebEngineStatus }) {
	const qc = useQueryClient();
	const autosave = useWebAutosave();
	const s = status.settings;
	const keyForm = useFormValues({ apiKey: "" });

	return (
		<Section
			title="Search & fallback"
			description="Choose whether web searches or blocked pages may use Firecrawl's cloud."
			saveState={<SaveState state={autosave} />}
		>
			<Segmented<WebCloudMode>
				label="Cloud usage"
				value={s.cloud}
				onValueChange={(cloud) => autosave.save({ cloud })}
				options={[
					{ value: "off", label: "Off" },
					{ value: "search", label: "Search only" },
					{ value: "auto", label: "Search & fallback" },
				]}
			/>
			<p className="text-small text-fg-muted">{CLOUD_HINTS[s.cloud]}</p>

			{s.cloud !== "off" && (
				<FormGroup
					dirty={keyForm.dirty}
					submitLabel="Save key"
					onCancel={() => keyForm.reset()}
					onSubmit={() =>
						saveForm(async () => {
							const next = await api.web.save({ apiKey: keyForm.values.apiKey.trim() });
							qc.setQueryData(KEY, next);
							keyForm.reset({ apiKey: "" });
						})
					}
				>
					<Field
						label="Firecrawl API key"
						optional
						hint={
							<>
								Search works without a key with low limits. Get one at{" "}
								<a
									href="https://www.firecrawl.dev/app/api-keys"
									target="_blank"
									rel="noreferrer"
									className="font-medium text-brand-ink hover:underline"
								>
									firecrawl.dev
								</a>
								.
							</>
						}
					>
						<PasswordInput
							value={keyForm.values.apiKey}
							placeholder={s.apiKey ? "Saved (paste to replace)" : "fc-…"}
							onChange={(e) => keyForm.set("apiKey", e.target.value)}
							className="font-mono"
							autoComplete="off"
						/>
					</Field>
				</FormGroup>
			)}
		</Section>
	);
}

/** Multi-page crawling and a live page tester. */
function BotsSection({ status }: { status: WebEngineStatus }) {
	const autosave = useWebAutosave();
	const [url, setUrl] = useState("https://example.com");
	const check = useMutation({
		mutationFn: () => api.web.check(url.trim()),
		// The error shows under the field, not as a toast too.
		onError: () => {},
	});

	return (
		<Section
			title="Multi-page reading"
			description="Let bots follow links across a site, or test reading a page."
			saveState={<SaveState state={autosave} />}
		>
			<List label="Site crawling">
				<ToggleRow
					title="Let bots crawl sites"
					description="Read up to 25 pages at a time, respecting robots.txt."
					checked={status.settings.crawl}
					onCheckedChange={(crawl) => autosave.save({ crawl })}
				/>
			</List>

			<Field
				label="Test a page"
				hint={
					status.state === "ready"
						? "Reads a URL the same way a bot would."
						: "Turn on and start the reader above to test a page."
				}
			>
				<div className="flex flex-wrap items-center gap-2">
					<Input
						value={url}
						onChange={(e) => setUrl(e.target.value)}
						placeholder="https://example.com"
						className="min-w-0 flex-1 font-mono"
					/>
					<Button
						variant="secondary"
						loading={check.isPending}
						disabled={status.state !== "ready" || !url.trim()}
						onClick={() => check.mutate()}
					>
						<FileSearch /> Read page
					</Button>
				</div>
			</Field>

			{check.isError && (
				<Callout tone="danger" icon={<CircleAlert />}>
					{errorMessage(check.error)}
				</Callout>
			)}

			{check.data && (
				<div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4">
					<div className="flex flex-wrap items-center gap-2">
						<span className="text-body font-medium text-fg">{check.data.title || check.data.url}</span>
						<Badge tone={check.data.source === "local" ? "success" : "info"}>
							{check.data.source === "local" ? "Read here" : "Read via cloud"}
						</Badge>
						<span className="text-caption tabular-nums text-fg-muted">{check.data.ms} ms</span>
					</div>
					<pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words text-small text-fg-muted scrollbar-thin">
						{check.data.preview}
					</pre>
				</div>
			)}
		</Section>
	);
}

function WebBody() {
	const { data, isLoading, isError, error, refetch } = useWebEngine();
	if (isLoading) return <SkeletonRows count={3} leading={false} />;
	if (isError || !data) {
		return <ErrorState title="Web reading didn't load" error={error} onRetry={() => void refetch()} />;
	}
	return (
		<>
			<Engine status={data} />
			{data.settings.mode !== "off" && (
				<>
					<CloudSection status={data} />
					<BotsSection status={data} />
				</>
			)}
		</>
	);
}

export function WebReadingSection({ back }: SettingsSectionProps) {
	return (
		<Page back={back} title="Web reading" description="How bots read web pages, PDFs and sites.">
			<WebBody />
		</Page>
	);
}
