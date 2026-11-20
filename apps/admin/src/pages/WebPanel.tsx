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
	Field,
	Input,
	PasswordInput,
	Section,
	Segmented,
	SettingsPanel,
	Spinner,
	ToggleRow,
} from "@sekai/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	Ban,
	CircleCheck,
	CircleX,
	Cloud,
	Download,
	FileSearch,
	Globe,
	RotateCw,
	Signpost,
	Square,
	TriangleAlert,
	WandSparkles,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

const KEY = ["web"] as const;
const SETUP_KEY = ["web", "setup"] as const;

const STATE_BADGE: Record<
	WebEngineStatus["state"],
	{ tone: "success" | "warning" | "danger" | "neutral"; label: string }
> = {
	ready: { tone: "success", label: "Reading pages" },
	starting: { tone: "warning", label: "Starting…" },
	installing: { tone: "warning", label: "Installing…" },
	missing: { tone: "warning", label: "Not installed" },
	error: { tone: "danger", label: "Not working" },
	off: { tone: "neutral", label: "Off" },
};

function useSave() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (patch: Partial<WebEngineSettings>) => api.web.save(patch),
		onSuccess: (next) => {
			qc.setQueryData(KEY, next);
			toast.success("Saved", { duration: 1200 });
		},
		onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
	});
}

/** Where the engine runs, and the state of whatever is running. */
function Engine({ status }: { status: WebEngineStatus }) {
	const qc = useQueryClient();
	const save = useSave();
	const s = status.settings;
	const [url, setUrl] = useState(s.url);
	const [token, setToken] = useState("");
	const badge = STATE_BADGE[status.state];
	const install = useMutation({
		mutationFn: api.web.install,
		onSuccess: (next) => qc.setQueryData(KEY, next),
		onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
	});
	const restart = useMutation({
		mutationFn: api.web.restart,
		onSuccess: (next) => qc.setQueryData(KEY, next),
		onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
	});
	const setup = useSetup();
	// Installing carries on in the background: the state says so until it's done.
	const installing = install.isPending || status.state === "installing";
	const settingUp = setup.data?.state === "running";
	const busy = installing || settingUp || restart.isPending || save.isPending;
	// Missing here (not installed, or installing it failed): the agent can do it.
	const canSetUp = s.mode === "here" && !status.binary && !installing;
	return (
		<Section
			title="Firecrawl Local"
			icon={<Globe />}
			description="One small program that fetches a page on this server and turns it into clean Markdown: no adverts or navigation, PDFs and Word files read too, and pages that need JavaScript rendered in Chrome. Bots get it through web_fetch."
			action={<Badge tone={badge.tone}>{badge.label}</Badge>}
		>
			<Segmented<WebEngineMode>
				value={s.mode}
				onValueChange={(mode) => save.mutate({ mode })}
				options={[
					{ value: "off", label: "Off" },
					{ value: "here", label: "On this server" },
					{ value: "elsewhere", label: "Somewhere else" },
				]}
			/>
			{s.mode === "off" && (
				<p className="text-xs leading-5 text-fg-subtle">
					Bots keep web_fetch while this is off: it fetches a page and strips the HTML to text.
				</p>
			)}
			{status.state === "installing" && (
				<Callout tone="info" icon={<Download />} title="Building Firecrawl Local">
					Rust is compiling it, which takes a few minutes. This page says when it's running; you can leave it.
				</Callout>
			)}
			{status.error && (
				<Callout
					tone={status.state === "missing" ? "warning" : "danger"}
					icon={<TriangleAlert />}
					title={status.state === "missing" ? "Firecrawl Local isn't installed yet" : "It isn't working"}
					action={
						status.state === "missing" && status.canInstall && !settingUp ? (
							<Button variant="primary" onClick={() => install.mutate()} disabled={busy}>
								{installing ? <Spinner className="text-primary-foreground" /> : <Download />}
								Install it
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
					<div className="grid gap-4 xs:grid-cols-2">
						<Field
							label="Port"
							hint="Left empty, Sekai picks a free one. On 127.0.0.1 only, with a fresh token each start."
						>
							<Input
								type="number"
								min={0}
								max={65535}
								placeholder="Automatic"
								defaultValue={s.port || ""}
								onBlur={(e) => {
									const port = Number(e.target.value) || 0;
									if (port !== s.port) save.mutate({ port });
								}}
							/>
						</Field>
						<Field
							label="Chrome for JavaScript pages"
							hint="Always is slower but reads app-like pages; never keeps it to plain fetches."
						>
							<Segmented
								value={s.browser}
								onValueChange={(browser) => save.mutate({ browser })}
								options={[
									{ value: "auto", label: "When needed" },
									{ value: "never", label: "Never" },
									{ value: "always", label: "Always" },
								]}
							/>
						</Field>
					</div>
					<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-subtle">
						{status.version && <span>Version {status.version}</span>}
						{status.url && <span className="font-mono">{status.url}</span>}
						{status.binary && <span className="max-w-full truncate font-mono">{status.binary}</span>}
						{status.startedAt && <span>Started {timeAgo(status.startedAt)}</span>}
					</div>
					<div className="flex flex-wrap gap-2">
						<Button variant="secondary" onClick={() => restart.mutate()} disabled={busy}>
							{restart.isPending ? <Spinner /> : <RotateCw />} Restart
						</Button>
						{status.canInstall && !settingUp && (
							<Button variant="ghost" onClick={() => install.mutate()} disabled={busy}>
								{installing ? <Spinner /> : <Download />}
								{status.binary ? "Update it" : "Install it"}
							</Button>
						)}
					</div>
					{!status.canInstall && !status.binary && !settingUp && (
						<p className="text-xs leading-5 text-fg-subtle">
							Sekai installs it with Rust's cargo, which this server doesn't have. Let Sekai set it up for
							you (above), install Rust from{" "}
							<a
								href="https://rustup.rs"
								target="_blank"
								rel="noreferrer"
								className="font-medium text-brand-ink hover:underline"
							>
								rustup.rs
							</a>{" "}
							and run <code className="font-mono">cargo install firecrawl-local</code> yourself, or run it
							on another machine and give its address here.
						</p>
					)}
				</>
			)}
			{s.mode === "elsewhere" && (
				<div className="grid gap-4 xs:grid-cols-2">
					<Field label="Address" hint="Where `firecrawl-local serve` answers.">
						<Input
							value={url}
							placeholder="http://192.168.1.9:3002"
							onChange={(e) => setUrl(e.target.value)}
							onBlur={() => url.trim() !== s.url && save.mutate({ url: url.trim() })}
						/>
					</Field>
					<Field label="Token" hint="Only if it was started with --token. Left empty: none.">
						<PasswordInput
							value={token}
							placeholder={s.token || "No token"}
							onChange={(e) => setToken(e.target.value)}
							onBlur={() => token && save.mutate({ token })}
						/>
					</Field>
				</div>
			)}
		</Section>
	);
}

/** The current or last "Set it up for me" run, checked every second or two while it's at work. */
function useSetup() {
	const qc = useQueryClient();
	const query = useQuery({
		queryKey: SETUP_KEY,
		queryFn: api.web.setup.status,
		refetchInterval: (q) => (q.state.data?.state === "running" ? 1500 : false),
	});
	// When it finishes, the engine's state changed too.
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
	running: { tone: "warning", label: "Setting it up…" },
	done: { tone: "success", label: "Done" },
	failed: { tone: "danger", label: "Couldn't finish" },
	stopped: { tone: "neutral", label: "Stopped" },
};

function SetupStepRow({ step }: { step: WebSetupStep }) {
	if (step.kind === "note") {
		return <p className="whitespace-pre-wrap text-[13px] leading-5 text-fg-muted">{step.text}</p>;
	}
	const icon = step.running ? (
		<Spinner className="size-3.5" />
	) : step.refused ? (
		<Ban className="size-3.5 text-warning" />
	) : step.exitCode === 0 ? (
		<CircleCheck className="size-3.5 text-success" />
	) : (
		<CircleX className="size-3.5 text-danger" />
	);
	return (
		<details className="group rounded-xl border border-border bg-card" open={step.running || undefined}>
			<summary className="flex cursor-pointer list-none items-start gap-2 px-3 py-2 coarse:py-3">
				<span className="mt-0.5 shrink-0">{icon}</span>
				<span className="min-w-0 flex-1">
					<span className="block text-[13px] leading-5">{step.text}</span>
					<code className="block truncate font-mono text-[11.5px] text-fg-subtle">{step.command}</code>
				</span>
				{step.finishedAt && !step.refused && (
					<span className="shrink-0 text-[11px] tabular-nums text-fg-subtle">
						{Math.max(1, Math.round((step.finishedAt - step.startedAt) / 1000))} s
					</span>
				)}
			</summary>
			<div className="border-t border-border px-3 py-2">
				{step.refused ? (
					<p className="text-xs leading-5 text-warning">Sekai didn't run it: {step.refused}</p>
				) : (
					<pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-[11.5px] leading-4 text-fg-muted">
						{step.output.trim() || (step.running ? "Working…" : "(no output)")}
					</pre>
				)}
			</div>
		</details>
	);
}

/**
 * "Set it up for me": a model installs Firecrawl Local on this server, command by command, while you watch.
 * Sekai checks every command before it runs (nothing outside the setup) and turns it on at the end.
 */
function SetupAgent({ setup, canStart }: { setup: WebSetup | undefined; canStart: boolean }) {
	const qc = useQueryClient();
	const [confirm, setConfirm] = useState(false);
	const onDone = (next: WebSetup) => qc.setQueryData(SETUP_KEY, next);
	const onError = (e: unknown) => toast.error(e instanceof Error ? e.message : String(e));
	const start = useMutation({ mutationFn: api.web.setup.start, onSuccess: onDone, onError });
	const stop = useMutation({ mutationFn: api.web.setup.stop, onSuccess: onDone, onError });
	const state = setup?.state ?? "idle";
	const steps = setup?.steps ?? [];
	const badge = SETUP_BADGE[state];
	return (
		<div className="flex flex-col gap-3 rounded-2xl border border-border bg-surface-2/50 p-4">
			<div className="flex flex-wrap items-start gap-3">
				<span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand/12 text-brand-ink [&_svg]:size-[18px]">
					<WandSparkles />
				</span>
				<span className="min-w-0 flex-1 basis-60">
					<span className="flex flex-wrap items-center gap-2">
						<span className="text-sm font-medium">Let Sekai set it up</span>
						{state !== "idle" && <Badge tone={badge.tone}>{badge.label}</Badge>}
					</span>
					<span className="mt-0.5 block text-xs leading-5 text-fg-subtle">
						Your default model installs Rust, the build tools and Firecrawl Local on this server, then turns
						it on. You see every command. Sekai refuses anything else (its own files, services, other
						machines), and building takes 10 to 20 minutes.
					</span>
				</span>
				{state === "running" ? (
					<Button variant="secondary" onClick={() => stop.mutate()} disabled={stop.isPending}>
						<Square /> Stop
					</Button>
				) : (
					canStart && (
						<Button variant="primary" onClick={() => setConfirm(true)} disabled={start.isPending}>
							{start.isPending ? <Spinner className="text-primary-foreground" /> : <WandSparkles />}
							{state === "idle" ? "Set it up for me" : "Try again"}
						</Button>
					)
				)}
			</div>
			{setup?.summary && state !== "running" && (
				<Callout
					tone={state === "done" ? "success" : state === "failed" ? "danger" : "info"}
					title={state === "done" ? "Firecrawl Local is set up" : "It couldn't finish"}
				>
					{setup.summary}
				</Callout>
			)}
			{steps.length > 0 && (
				<div className="flex max-h-[28rem] flex-col gap-2 overflow-y-auto">
					{steps.map((step) => (
						<SetupStepRow key={step.id} step={step} />
					))}
				</div>
			)}
			{state === "running" && steps.length === 0 && (
				<div className="flex items-center gap-2 text-xs text-fg-subtle">
					<Spinner className="size-3.5" /> Looking at this server…
				</div>
			)}
			{setup?.model && <p className="text-[11px] text-fg-subtle">With {setup.model}</p>}
			<Confirm
				open={confirm}
				onOpenChange={setConfirm}
				icon={<WandSparkles />}
				title="Let Sekai set up Firecrawl Local?"
				description="A model runs commands on this server as Sekai's own account (and sudo for the package manager), until Firecrawl Local is installed and running. It can't touch Sekai's files, stop services or reach other machines, and you can stop it any time."
				confirmLabel="Set it up"
				onConfirm={() => start.mutate()}
			/>
		</div>
	);
}

/** What may leave the machine. */
function CloudSection({ status }: { status: WebEngineStatus }) {
	const save = useSave();
	const s = status.settings;
	const [key, setKey] = useState("");
	return (
		<Section
			title="Firecrawl's cloud"
			icon={<Cloud />}
			description="Reading, crawling and listing pages happen here and send nothing to Firecrawl. Searching has to go to them (there's no search index on this server), and a page that refuses this server can be fetched by them instead."
		>
			<Segmented<WebCloudMode>
				value={s.cloud}
				onValueChange={(cloud) => save.mutate({ cloud })}
				options={[
					{ value: "off", label: "Nothing leaves" },
					{ value: "search", label: "Searches only" },
					{ value: "auto", label: "Searches and refused pages" },
				]}
			/>
			{s.cloud !== "off" && (
				<Field
					label="Firecrawl API key"
					hint={
						<>
							Optional: search works without one, with low limits. Get one at{" "}
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
						value={key}
						placeholder={s.apiKey || "fc-…"}
						onChange={(e) => setKey(e.target.value)}
						onBlur={() => key && save.mutate({ apiKey: key })}
					/>
				</Field>
			)}
			{s.cloud === "off" && status.state === "ready" && (
				<p className="text-xs leading-5 text-fg-subtle">
					Bots have no web_search while nothing may leave; they can still read any page you give them.
				</p>
			)}
		</Section>
	);
}

/** Crawling, and a page to try. */
function BotsSection({ status }: { status: WebEngineStatus }) {
	const save = useSave();
	const [url, setUrl] = useState("https://example.com");
	const check = useMutation({
		mutationFn: () => api.web.check(url),
		onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
	});
	return (
		<Section
			title="What bots can do"
			icon={<Signpost />}
			description="web_fetch reads one page. With crawling on, bots also get web_map (a site's pages) and web_crawl (reads a set of them in one go)."
		>
			<ToggleRow
				title="Let bots crawl sites"
				description="Up to 25 pages at a time, robots.txt respected."
				checked={status.settings.crawl}
				onCheckedChange={(crawl) => save.mutate({ crawl })}
			/>
			<Field label="Try a page" hint="Reads it the way a bot would.">
				<div className="flex flex-wrap items-center gap-2">
					<Input
						value={url}
						onChange={(e) => setUrl(e.target.value)}
						placeholder="https://example.com"
						className="min-w-0 flex-1"
					/>
					<Button
						variant="secondary"
						onClick={() => check.mutate()}
						disabled={check.isPending || status.state !== "ready"}
					>
						{check.isPending ? <Spinner /> : <FileSearch />} Read it
					</Button>
				</div>
			</Field>
			{check.data && (
				<div className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-4">
					<div className="flex flex-wrap items-center gap-2">
						<span className="font-medium">{check.data.title || check.data.url}</span>
						<Badge tone={check.data.source === "local" ? "success" : "info"}>
							{check.data.source === "local" ? "Read here" : "Read by Firecrawl's cloud"}
						</Badge>
						<span className="text-xs text-fg-subtle">{check.data.ms} ms</span>
					</div>
					<pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words text-xs text-fg-muted">
						{check.data.preview}
					</pre>
				</div>
			)}
		</Section>
	);
}

function WebBody() {
	const { data, isLoading } = useWebEngine();
	if (isLoading || !data) return <Spinner />;
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

export function WebPanel() {
	return (
		<SettingsPanel
			value="web"
			title="Web reading"
			description="How bots read the web: Firecrawl Local turns pages into clean Markdown on this server, and can follow links through a site. Without it, bots still read pages the simple way."
		>
			<WebBody />
		</SettingsPanel>
	);
}
