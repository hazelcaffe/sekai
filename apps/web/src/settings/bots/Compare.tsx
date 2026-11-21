import {
	api,
	BrandGlyph,
	cn,
	formatTokens,
	Markdown,
	ModelList,
	pluralize,
	useAccess,
	useModels,
	vendorBrand,
} from "@sekai/client";
import type { CompareEvent, ModelInfo } from "@sekai/shared";
import {
	Button,
	Callout,
	EmptyState,
	ErrorState,
	errorMessage,
	Field,
	Fold,
	IconButton,
	Link,
	List,
	Page,
	Popover,
	Row,
	Section,
	Skeleton,
	Spinner,
	Textarea,
} from "@sekai/ui";
import { CircleAlert, Plus, Sparkles, Square, Timer, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { sectionPath } from "../registry.tsx";
import type { SettingsSectionProps } from "../section.ts";

const MAX = 4;
const HISTORY = "sekai.compare.history";

interface Answer {
	text: string;
	thinking: boolean;
	done?: Extract<CompareEvent, { type: "done" }>;
	error?: string;
}

interface Past {
	prompt: string;
	system: string;
	models: string[];
}

function loadHistory(): Past[] {
	try {
		return (JSON.parse(localStorage.getItem(HISTORY) ?? "[]") as Past[]).slice(0, 8);
	} catch {
		return [];
	}
}

const money = (n: number) => (n > 0 && n < 0.001 ? "<$0.001" : `$${n.toFixed(n < 0.1 ? 3 : 2)}`);

function ModelChip({ info, id, onRemove }: { info?: ModelInfo; id: string; onRemove: () => void }) {
	const brand = info ? vendorBrand(info.provider) : null;
	const name = info?.name ?? id;
	return (
		<span className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-surface pr-1 pl-2.5 text-small coarse:h-11 coarse:pr-0.5 coarse:pl-3">
			{brand && <BrandGlyph brand={brand} size={14} />}
			<span className="max-w-48 truncate text-fg">{name}</span>
			<IconButton
				variant="ghost"
				size="icon-sm"
				label={`Remove ${name}`}
				onClick={onRemove}
				className="size-6 rounded-full coarse:size-11"
			>
				<X />
			</IconButton>
		</span>
	);
}

function AnswerCard({
	info,
	id,
	answer,
	running,
	canPrice,
}: {
	info?: ModelInfo;
	id: string;
	answer?: Answer;
	running: boolean;
	canPrice: boolean;
}) {
	const brand = info ? vendorBrand(info.provider) : null;
	const d = answer?.done;
	return (
		<div className="flex min-w-0 flex-col rounded-lg border border-border bg-surface">
			<div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
				{brand && <BrandGlyph brand={brand} size={16} />}
				<span className="min-w-0 flex-1 truncate text-body font-medium text-fg">{info?.name ?? id}</span>
				{running && !d && !answer?.error && <Spinner />}
			</div>
			<div className="min-h-28 flex-1 px-4 py-3 text-message">
				{answer?.error ? (
					<p className="flex gap-2 text-body text-danger-ink">
						<CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
						{errorMessage(answer.error)}
					</p>
				) : answer?.text ? (
					<Markdown text={answer.text} />
				) : running ? (
					<div className="flex flex-col gap-2 py-1">
						<span className="text-small text-fg-muted">
							{answer?.thinking ? "Thinking…" : "Waiting for the first word…"}
						</span>
						<Skeleton className="h-3.5 w-4/5" />
						<Skeleton className="h-3.5 w-3/5 opacity-70" />
					</div>
				) : null}
			</div>
			{d && (
				<div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-border px-4 py-2 text-caption text-fg-muted tabular-nums">
					<span className="inline-flex items-center gap-1">
						<Timer aria-hidden className="size-4" />
						{(d.ms / 1000).toFixed(1)}s
						{d.firstMs !== null ? ` (first word ${(d.firstMs / 1000).toFixed(1)}s)` : ""}
					</span>
					<span>
						{formatTokens(d.inputTokens)} in · {formatTokens(d.outputTokens)} out
					</span>
					<span className="ml-auto">
						{d.cost !== null ? (
							money(d.cost)
						) : canPrice ? (
							<Link href={sectionPath("usage")} className="text-brand-ink hover:underline">
								Set a price
							</Link>
						) : null}
					</span>
				</div>
			)}
		</div>
	);
}

function CompareBody() {
	const { data: models = [], isLoading: modelsLoading, isError, error: modelsError, refetch } = useModels();
	const { admin } = useAccess();
	const [prompt, setPrompt] = useState("");
	const [system, setSystem] = useState("");
	const [picked, setPicked] = useState<string[]>([]);
	const [answers, setAnswers] = useState<Record<string, Answer>>({});
	const [shown, setShown] = useState<string[]>([]);
	const [running, setRunning] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [history, setHistory] = useState<Past[]>(loadHistory);
	const [adding, setAdding] = useState(false);
	const stop = useRef<AbortController | null>(null);
	const seeded = useRef(false);
	const info = (id: string) => models.find((m) => m.id === id);

	// Start with two gateway models once so you can compare right away (without re-adding after the user clears them).
	useEffect(() => {
		if (seeded.current || !models.length) return;
		seeded.current = true;
		setPicked(
			models
				.filter((m) => !m.byos)
				.slice(0, 2)
				.map((m) => m.id),
		);
	}, [models]);

	const run = async () => {
		if (!prompt.trim() || !picked.length || running) return;
		const ctrl = new AbortController();
		stop.current = ctrl;
		setRunning(true);
		setError(null);
		setShown(picked);
		setAnswers(Object.fromEntries(picked.map((m) => [m, { text: "", thinking: false }])));
		const entry = { prompt: prompt.trim(), system, models: picked };
		const next = [entry, ...history.filter((h) => h.prompt !== entry.prompt)].slice(0, 8);
		setHistory(next);
		localStorage.setItem(HISTORY, JSON.stringify(next));
		try {
			await api.compare(
				{ prompt: prompt.trim(), system, models: picked },
				(ev) => {
					if (ev.type === "end") return;
					setAnswers((all) => {
						const a = all[ev.model] ?? { text: "", thinking: false };
						if (ev.type === "text") return { ...all, [ev.model]: { ...a, text: a.text + ev.delta } };
						if (ev.type === "reasoning") return { ...all, [ev.model]: { ...a, thinking: true } };
						if (ev.type === "done") return { ...all, [ev.model]: { ...a, done: ev } };
						return { ...all, [ev.model]: { ...a, error: ev.error } };
					});
				},
				ctrl.signal,
			);
		} catch (e) {
			if (!ctrl.signal.aborted) setError(errorMessage(e));
		} finally {
			setRunning(false);
			stop.current = null;
		}
	};

	if (isError) {
		return <ErrorState title="Models didn't load" error={modelsError} onRetry={() => void refetch()} />;
	}
	if (!modelsLoading && models.length === 0) {
		return (
			<EmptyState
				icon={<Sparkles />}
				title="No models available yet"
				description={
					admin
						? "Connect a model server or provider in Models first."
						: "Ask an admin to connect a model server."
				}
				action={
					admin ? (
						<Button asChild size="sm" variant="secondary">
							<Link href={sectionPath("models")}>Open Models</Link>
						</Button>
					) : undefined
				}
				className="rounded-lg border border-dashed border-border"
			/>
		);
	}

	const gridCols = shown.length === 3 ? "xl:grid-cols-3" : "";

	return (
		<>
			<Section>
				<div className="flex flex-col gap-3">
					<Field label="Prompt">
						<Textarea
							value={prompt}
							onChange={(e) => setPrompt(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
									e.preventDefault();
									void run();
								}
							}}
							placeholder="Ask what you'd ask a bot: a hard question, a writing task, some code…"
							className="min-h-28"
						/>
					</Field>

					<Fold title="Instructions" summary={system.trim() ? "Added" : "Optional"}>
						<Field label="Shared instructions" optional hint="Sent before your prompt to every model.">
							<Textarea
								value={system}
								onChange={(e) => setSystem(e.target.value)}
								placeholder="e.g. Answer in three concise bullet points."
								className="min-h-20"
							/>
						</Field>
					</Fold>

					<div className="flex flex-wrap items-center gap-2 pt-1">
						{modelsLoading && picked.length === 0 ? (
							<>
								<Skeleton className="h-8 w-36 rounded-full" />
								<Skeleton className="h-8 w-36 rounded-full" />
							</>
						) : (
							picked.map((id) => (
								<ModelChip
									key={id}
									id={id}
									info={info(id)}
									onRemove={() => setPicked(picked.filter((m) => m !== id))}
								/>
							))
						)}
						{picked.length < MAX && !modelsLoading && (
							<Popover
								open={adding}
								onOpenChange={setAdding}
								className="w-[min(380px,calc(100vw-24px))] p-0 pt-2"
								trigger={
									<Button variant="ghost" size="sm">
										<Plus /> Add a model
									</Button>
								}
							>
								<ModelList
									value=""
									onSelect={(id) => {
										if (!picked.includes(id)) setPicked([...picked, id]);
										setAdding(false);
									}}
								/>
							</Popover>
						)}
						<span className="ml-auto flex gap-2">
							{running ? (
								<Button variant="secondary" onClick={() => stop.current?.abort()}>
									<Square /> Stop
								</Button>
							) : (
								<Button
									variant="primary"
									onClick={() => void run()}
									disabled={!prompt.trim() || !picked.length}
								>
									Compare
								</Button>
							)}
						</span>
					</div>

					{error && (
						<Callout tone="danger" icon={<CircleAlert />}>
							{error}
						</Callout>
					)}
				</div>
			</Section>

			{shown.length > 0 && (
				<div className={cn("grid gap-4 md:grid-cols-2", gridCols)}>
					{shown.map((id) => (
						<AnswerCard
							key={id}
							id={id}
							info={info(id)}
							answer={answers[id]}
							running={running}
							canPrice={admin}
						/>
					))}
				</div>
			)}

			{history.length > 0 && (
				<Section
					title="Recent prompts"
					description="Kept only in this browser."
					action={
						<Button
							variant="ghost"
							size="sm"
							onClick={() => {
								setHistory([]);
								localStorage.removeItem(HISTORY);
							}}
						>
							Clear
						</Button>
					}
				>
					<List label="Recent prompts">
						{history.map((h) => (
							<Row
								key={h.prompt}
								title={<span className="block truncate">{h.prompt}</span>}
								value={pluralize(h.models.length, "model")}
								onClick={() => {
									setPrompt(h.prompt);
									setSystem(h.system);
									setPicked(h.models.slice(0, MAX));
								}}
								trailing={
									<IconButton
										label="Remove prompt from history"
										size="icon-sm"
										onClick={() => {
											const next = history.filter((x) => x.prompt !== h.prompt);
											setHistory(next);
											localStorage.setItem(HISTORY, JSON.stringify(next));
										}}
									>
										<X />
									</IconButton>
								}
							/>
						))}
					</List>
				</Section>
			)}
		</>
	);
}

export function CompareSection({ back }: SettingsSectionProps) {
	return (
		<Page
			back={back}
			width="wide"
			title="Compare models"
			description="Send one prompt to up to four models side by side."
		>
			<CompareBody />
		</Page>
	);
}
