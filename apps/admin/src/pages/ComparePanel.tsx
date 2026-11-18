import {
	adminUrl,
	api,
	BrandGlyph,
	cn,
	formatTokens,
	Markdown,
	ModelList,
	useModels,
	vendorBrand,
} from "@sekai/client";
import type { CompareEvent, ModelInfo } from "@sekai/shared";
import { Button, Fold, IconButton, Popover, Section, SettingsPanel, Spinner, Textarea } from "@sekai/ui";
import { CircleAlert, Plus, Square, Timer, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

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
	return (
		<span className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-card pr-1 pl-2.5 text-[13px]">
			{brand && <BrandGlyph brand={brand} size={14} />}
			<span className="max-w-48 truncate">{info?.name ?? id}</span>
			<button
				type="button"
				onClick={onRemove}
				aria-label={`Remove ${info?.name ?? id}`}
				className="flex size-6 items-center justify-center rounded-full text-fg-subtle hover:bg-muted hover:text-fg"
			>
				<X className="size-3.5" />
			</button>
		</span>
	);
}

function AnswerCard({
	info,
	id,
	answer,
	running,
}: {
	info?: ModelInfo;
	id: string;
	answer?: Answer;
	running: boolean;
}) {
	const brand = info ? vendorBrand(info.provider) : null;
	const d = answer?.done;
	return (
		<div className="flex min-w-0 flex-col rounded-2xl border border-border bg-card">
			<div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
				{brand && <BrandGlyph brand={brand} size={16} />}
				<span className="min-w-0 flex-1 truncate text-sm font-medium">{info?.name ?? id}</span>
				{running && !d && !answer?.error && <Spinner />}
			</div>
			<div className="min-h-24 flex-1 px-4 py-3 text-[14px]">
				{answer?.error ? (
					<p className="flex gap-2 text-[13px] text-danger">
						<CircleAlert className="mt-0.5 size-4 shrink-0" />
						{answer.error}
					</p>
				) : answer?.text ? (
					<Markdown text={answer.text} />
				) : running ? (
					<p className="text-[13px] text-fg-subtle">
						{answer?.thinking ? "Thinking…" : "Waiting for the first word…"}
					</p>
				) : null}
			</div>
			{d && (
				<div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-border px-4 py-2 text-xs text-fg-muted tabular-nums">
					<span className="inline-flex items-center gap-1">
						<Timer className="size-3.5" />
						{(d.ms / 1000).toFixed(1)}s
						{d.firstMs !== null ? ` (first word ${(d.firstMs / 1000).toFixed(1)}s)` : ""}
					</span>
					<span>
						{formatTokens(d.inputTokens)} in · {formatTokens(d.outputTokens)} out
					</span>
					<span className="ml-auto">
						{d.cost !== null ? (
							money(d.cost)
						) : (
							<a href={adminUrl("usage")} className="text-fg-subtle hover:underline">
								Set a price
							</a>
						)}
					</span>
				</div>
			)}
		</div>
	);
}

function CompareBody() {
	const { data: models = [] } = useModels();
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
	const info = (id: string) => models.find((m) => m.id === id);

	// Start with the two most capable-looking gateway models, so there's something to compare right away.
	useEffect(() => {
		if (picked.length || !models.length) return;
		setPicked(
			models
				.filter((m) => !m.byos)
				.slice(0, 2)
				.map((m) => m.id),
		);
	}, [models, picked.length]);

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
			if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : String(e));
		} finally {
			setRunning(false);
			stop.current = null;
		}
	};

	const cols = shown.length >= 3 ? "lg:grid-cols-3" : "";
	return (
		<>
			<Section title="Prompt">
				<div className="flex flex-col gap-3">
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
						aria-label="Prompt"
					/>
					<Fold title="System prompt" summary="Optional">
						<Textarea
							value={system}
							onChange={(e) => setSystem(e.target.value)}
							placeholder="You are a concise assistant…"
							className="min-h-20"
							aria-label="System prompt"
						/>
					</Fold>
					<div className="flex flex-wrap items-center gap-2">
						{picked.map((id) => (
							<ModelChip
								key={id}
								id={id}
								info={info(id)}
								onRemove={() => setPicked(picked.filter((m) => m !== id))}
							/>
						))}
						{picked.length < MAX && (
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
					{error && <p className="text-[13px] text-danger">{error}</p>}
				</div>
			</Section>

			{shown.length > 0 && (
				<div className={cn("grid gap-3 md:grid-cols-2", cols)}>
					{shown.map((id) => (
						<AnswerCard key={id} id={id} info={info(id)} answer={answers[id]} running={running} />
					))}
				</div>
			)}

			{history.length > 0 && (
				<Section title="Recent prompts" description="Kept in this browser.">
					<div className="flex flex-col divide-y divide-border rounded-2xl border border-border bg-card">
						{history.map((h) => (
							<div key={h.prompt} className="flex items-center gap-2 px-3 py-2">
								<button
									type="button"
									className="min-w-0 flex-1 truncate text-left text-[13px] hover:text-brand-ink"
									onClick={() => {
										setPrompt(h.prompt);
										setSystem(h.system);
										setPicked(h.models.slice(0, MAX));
									}}
								>
									{h.prompt}
								</button>
								<span className="shrink-0 text-xs text-fg-subtle">{h.models.length} models</span>
								<IconButton
									label="Forget this prompt"
									size="icon-sm"
									onClick={() => {
										const next = history.filter((x) => x.prompt !== h.prompt);
										setHistory(next);
										localStorage.setItem(HISTORY, JSON.stringify(next));
									}}
								>
									<X />
								</IconButton>
							</div>
						))}
					</div>
				</Section>
			)}
		</>
	);
}

export function ComparePanel() {
	return (
		<SettingsPanel
			value="compare"
			title="Compare models"
			description="Send one prompt to up to four models at once and see their answers side by side, with how long each took and what it cost."
		>
			<CompareBody />
		</SettingsPanel>
	);
}
