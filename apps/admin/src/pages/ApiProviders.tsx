import { api, BrandTile, cn, qk, timeAgo, useApiProviders, vendorBrand } from "@sekai/client";
import {
	API_KIND_LABELS,
	API_PRESETS,
	type ApiKind,
	type ApiModel,
	type ApiPreset,
	type ApiProviderCreate,
	type ApiProviderWithStatus,
	CHAT_KINDS,
	VOICE_KINDS,
} from "@sekai/shared";
import {
	Badge,
	Button,
	Callout,
	Confirm,
	Dialog,
	EmptyState,
	Field,
	Input,
	Section,
	Select,
	Spinner,
	Switch,
	Textarea,
	ToggleRow,
} from "@sekai/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
	AudioLines,
	ChevronLeft,
	CircleAlert,
	CircleCheck,
	Cloud,
	Cpu,
	ExternalLink,
	Plug,
	Plus,
	RefreshCw,
	Server,
	Trash2,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

/** A colored monogram per provider (no vendor logos). */
type Scope = "models" | "voice";

const isVoiceKind = (k: ApiKind) => VOICE_KINDS.includes(k);
const inScope = (scope: Scope, p: ApiProviderWithStatus) =>
	scope === "voice" ? isVoiceKind(p.kind) : CHAT_KINDS.includes(p.kind);
const kindLabel = (k: string) => API_KIND_LABELS[k as ApiKind] ?? k;

function countsLabel(s: { chatModels: number; embeddingModels: number; voiceModels: number }, scope: Scope): string {
	if (scope === "voice") return `${s.voiceModels} voice model${s.voiceModels === 1 ? "" : "s"}`;
	return `${s.chatModels} chat${s.embeddingModels ? ` · ${s.embeddingModels} embedding` : ""}`;
}

const URL_HINTS: Record<ApiKind, string> = {
	openai: "Usually ends in /v1. Sekai calls /chat/completions, /models and /embeddings on it.",
	anthropic: "Sekai calls /messages and /models on it.",
	google: "Sekai calls generateContent, models and batchEmbedContents on it.",
	elevenlabs:
		"ElevenLabs' API (use a regional address like https://api.eu.residency.elevenlabs.io if your account lives there).",
	fishaudio: "Fish Audio's API.",
};

function ProviderMark({ preset, name, size = 36 }: { preset: string; name: string; size?: number }) {
	const local = API_PRESETS.find((p) => p.id === preset)?.local;
	return (
		<BrandTile
			brand={vendorBrand(preset)}
			size={size}
			fallback={
				local ? (
					<Cpu className="size-4 text-fg-muted" />
				) : preset.startsWith("custom") ? (
					<Plug className="size-4 text-fg-muted" />
				) : (
					<span className="text-[13px] font-semibold text-fg-muted">
						{name.replace(/[^A-Za-z0-9]/g, "").slice(0, 2) || "AI"}
					</span>
				)
			}
		/>
	);
}

type Draft = Required<Omit<ApiProviderCreate, "models">> & { models: ApiModel[] };

function draftFrom(preset: ApiPreset): Draft {
	return {
		name: preset.id.startsWith("custom") ? "" : preset.name,
		preset: preset.id,
		kind: preset.kind,
		baseUrl: preset.baseUrl,
		apiKey: "",
		headers: {},
		discover: true,
		models: [],
		enabled: true,
	};
}

function draftOf(p: ApiProviderWithStatus): Draft {
	return {
		name: p.name,
		preset: p.preset,
		kind: p.kind,
		baseUrl: p.baseUrl,
		apiKey: p.apiKey,
		headers: p.headers,
		discover: p.discover,
		models: p.models,
		enabled: p.enabled,
	};
}

const headersText = (h: Record<string, string>) =>
	Object.entries(h)
		.map(([k, v]) => `${k}: ${v}`)
		.join("\n");

function parseHeaders(text: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const line of text.split("\n")) {
		const i = line.indexOf(":");
		if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
	}
	return out;
}

function ModelRows({ models, onChange }: { models: ApiModel[]; onChange: (m: ApiModel[]) => void }) {
	const set = (i: number, patch: Partial<ApiModel>) =>
		onChange(models.map((m, j) => (j === i ? { ...m, ...patch } : m)));
	return (
		<div className="flex flex-col gap-2">
			{models.map((m, i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: rows are edited in place
				<div key={i} className="flex flex-col gap-2 rounded-xl border border-border p-2.5">
					<div className="flex gap-2">
						<Input
							value={m.id}
							placeholder="Model ID, e.g. llama3.3:70b"
							onChange={(e) => set(i, { id: e.target.value })}
							className="font-mono text-[13px]"
						/>
						<Select
							value={m.type}
							onValueChange={(type) => set(i, { type: type as ApiModel["type"] })}
							options={[
								{ value: "chat", label: "Chat" },
								{ value: "embedding", label: "Embedding" },
								{ value: "tts", label: "Text to speech" },
								{ value: "stt", label: "Speech to text" },
							]}
							className="w-36"
						/>
						<Button
							variant="ghost"
							size="icon"
							aria-label="Remove model"
							onClick={() => onChange(models.filter((_, j) => j !== i))}
						>
							<Trash2 />
						</Button>
					</div>
					{m.type === "chat" ? (
						<div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px]">
							<span className="flex items-center gap-2">
								Context
								<Input
									type="number"
									aria-label="Context window (tokens)"
									value={m.contextWindow}
									onChange={(e) => set(i, { contextWindow: Number(e.target.value) || 128_000 })}
									className="h-8 w-28"
								/>
							</span>
							<span className="flex items-center gap-2">
								<Switch
									label="Images"
									checked={m.vision}
									onCheckedChange={(vision) => set(i, { vision })}
									size="sm"
								/>
								Images
							</span>
							<span className="flex items-center gap-2">
								<Switch
									label="Reasoning"
									checked={m.reasoning}
									onCheckedChange={(reasoning) => set(i, { reasoning })}
									size="sm"
								/>
								Reasoning
							</span>
						</div>
					) : (
						<span className="flex items-center gap-2 text-[13px]">
							Dimensions
							<Input
								type="number"
								aria-label="Dimensions"
								value={m.dimensions ?? ""}
								placeholder="auto"
								onChange={(e) => set(i, { dimensions: Number(e.target.value) || null })}
								className="h-8 w-28"
							/>
						</span>
					)}
				</div>
			))}
			<Button
				variant="secondary"
				size="sm"
				className="self-start"
				onClick={() =>
					onChange([
						...models,
						{
							id: "",
							name: "",
							type: "chat",
							contextWindow: 128_000,
							maxOutputTokens: 16_000,
							vision: false,
							reasoning: false,
							dimensions: null,
						},
					])
				}
			>
				<Plus /> Add a model
			</Button>
		</div>
	);
}

function ProviderForm({
	draft,
	onChange,
	editing,
	savedId,
	scope,
}: {
	draft: Draft;
	onChange: (d: Draft) => void;
	editing: boolean;
	/** The saved provider being edited, if any. */
	savedId?: string;
	scope: Scope;
}) {
	const preset = API_PRESETS.find((p) => p.id === draft.preset);
	const [headers, setHeaders] = useState(headersText(draft.headers));
	const test = useMutation({
		mutationFn: () => api.apiProviders.test({ ...draft, models: [], ...(savedId ? { id: savedId } : {}) }),
	});
	const custom = draft.preset.startsWith("custom");
	return (
		<div className="flex flex-col gap-4">
			{preset?.hint && <Callout icon={<Cpu />}>{preset.hint}</Callout>}
			<div className="grid gap-4 sm:grid-cols-2">
				<Field label="Name">
					<Input
						value={draft.name}
						onChange={(e) => onChange({ ...draft, name: e.target.value })}
						placeholder="My models"
					/>
				</Field>
				<Field label="API">
					<Select
						value={draft.kind}
						onValueChange={(kind) => onChange({ ...draft, kind: kind as Draft["kind"] })}
						disabled={!custom && !editing}
						options={Object.entries(API_KIND_LABELS)
							.filter(([k]) =>
								scope === "voice" ? isVoiceKind(k as ApiKind) : CHAT_KINDS.includes(k as ApiKind),
							)
							.map(([value, label]) => ({ value, label }))}
					/>
				</Field>
			</div>
			<Field label="Base URL" hint={URL_HINTS[draft.kind]}>
				<Input
					value={draft.baseUrl}
					onChange={(e) => onChange({ ...draft, baseUrl: e.target.value })}
					placeholder="https://api.example.com/v1"
					className="font-mono text-[13px]"
				/>
			</Field>
			<Field
				label="API key"
				hint={
					editing
						? "Shown masked. Paste a new key to replace it."
						: preset?.local
							? "Usually not needed for local servers."
							: undefined
				}
				action={
					preset?.keyUrl && (
						<a
							href={preset.keyUrl}
							target="_blank"
							rel="noreferrer"
							className="flex items-center gap-1 text-xs font-medium text-brand-ink hover:underline"
						>
							Get a key <ExternalLink className="size-3" />
						</a>
					)
				}
			>
				<Input
					type="password"
					autoComplete="off"
					value={draft.apiKey}
					onChange={(e) => onChange({ ...draft, apiKey: e.target.value })}
					className="font-mono text-[13px]"
				/>
			</Field>
			{!isVoiceKind(draft.kind) && (
				<ToggleRow
					title="Get the model list from the provider"
					description="Off: only the models you add below show up."
					checked={draft.discover}
					onCheckedChange={(discover) => onChange({ ...draft, discover })}
				/>
			)}
			<div className="flex flex-wrap items-center gap-2">
				<Button
					variant="secondary"
					size="sm"
					onClick={() => test.mutate()}
					disabled={test.isPending || !draft.baseUrl}
				>
					{test.isPending ? <Spinner /> : <Plug />} Test connection
				</Button>
				{test.data && (
					<span
						className={cn(
							"flex items-center gap-1.5 text-[13px]",
							test.data.ok ? "text-success" : "text-destructive",
						)}
					>
						{test.data.ok ? <CircleCheck className="size-4" /> : <CircleAlert className="size-4" />}
						{test.data.ok
							? scope === "voice"
								? `${test.data.models.filter((m) => m.type === "tts" || m.type === "stt").length} voice models`
								: `${test.data.models.filter((m) => m.type === "chat").length} chat · ${test.data.models.filter((m) => m.type === "embedding").length} embedding models`
							: test.data.error}
					</span>
				)}
			</div>
			<details className="group rounded-2xl border border-border">
				<summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium select-none">
					Models by hand and extra headers
					<span className="ml-2 text-xs font-normal text-fg-subtle">
						{draft.models.length ? `${draft.models.length} added` : "optional"}
					</span>
				</summary>
				<div className="flex flex-col gap-4 border-t border-border p-4">
					<ModelRows models={draft.models} onChange={(models) => onChange({ ...draft, models })} />
					<Field label="Extra headers" hint="One per line, like HTTP-Referer: https://sekai.local">
						<Textarea
							value={headers}
							onChange={(e) => {
								setHeaders(e.target.value);
								onChange({ ...draft, headers: parseHeaders(e.target.value) });
							}}
							className="min-h-16 font-mono text-[13px]"
						/>
					</Field>
				</div>
			</details>
		</div>
	);
}

function ProviderDialog({
	open,
	onOpenChange,
	editing,
	scope,
}: {
	open: boolean;
	onOpenChange: (o: boolean) => void;
	editing: ApiProviderWithStatus | null;
	scope: Scope;
}) {
	const qc = useQueryClient();
	const [draft, setDraft] = useState<Draft | null>(editing ? draftOf(editing) : null);
	const refresh = () => {
		void qc.invalidateQueries({ queryKey: qk.apiProviders });
		void qc.invalidateQueries({ queryKey: qk.models });
		void qc.invalidateQueries({ queryKey: qk.embeddingModels });
		void qc.invalidateQueries({ queryKey: ["voice"] });
	};
	const save = useMutation({
		mutationFn: (d: Draft) => {
			const body = { ...d, models: d.models.filter((m) => m.id.trim()) };
			return editing ? api.apiProviders.update(editing.id, body) : api.apiProviders.create(body);
		},
		onSuccess: (p) => {
			refresh();
			onOpenChange(false);
			if (p.status.ok)
				toast.success(`${p.name}: ${countsLabel(p.status, isVoiceKind(p.kind) ? "voice" : scope)} ready`);
			else toast.warning(`${p.name} saved, but: ${p.status.error}`);
		},
	});

	return (
		<Dialog
			open={open}
			onOpenChange={onOpenChange}
			size="lg"
			icon={<Plug />}
			title={
				editing
					? `Edit ${editing.name}`
					: draft
						? scope === "voice"
							? "Add a voice service"
							: "Add an API provider"
						: "Pick a provider"
			}
			description={
				!draft
					? scope === "voice"
						? "Voices for calls, reading aloud and dictation."
						: "Any service with an OpenAI-, Anthropic- or Gemini-compatible API. Its models show up next to the gateway's."
					: undefined
			}
			footer={
				draft && (
					<>
						{!editing && (
							<Button variant="ghost" className="mr-auto" onClick={() => setDraft(null)}>
								<ChevronLeft /> Back
							</Button>
						)}
						<Button variant="ghost" onClick={() => onOpenChange(false)}>
							Cancel
						</Button>
						<Button
							variant="primary"
							disabled={!draft.name.trim() || !draft.baseUrl.trim() || save.isPending}
							onClick={() => save.mutate(draft)}
						>
							{save.isPending && <Spinner className="text-primary-foreground" />}
							{editing ? "Save" : "Add provider"}
						</Button>
					</>
				)
			}
		>
			{draft ? (
				<ProviderForm
					draft={draft}
					onChange={setDraft}
					editing={Boolean(editing)}
					savedId={editing?.id}
					scope={scope}
				/>
			) : (
				<div className="grid gap-2 sm:grid-cols-2">
					{API_PRESETS.filter((p) => (scope === "voice" ? p.scope !== "models" : p.scope !== "voice")).map(
						(p) => (
							<button
								key={p.id}
								type="button"
								onClick={() => setDraft(draftFrom(p))}
								className="flex items-center gap-3 rounded-2xl border border-border p-3 text-left transition-colors hover:bg-muted/60"
							>
								<ProviderMark preset={p.id} name={p.name} size={32} />
								<span className="min-w-0">
									<span className="block truncate text-sm font-medium">{p.name}</span>
									<span className="block truncate text-xs text-fg-subtle">
										{p.local ? "On this computer" : API_KIND_LABELS[p.kind]}
									</span>
								</span>
							</button>
						),
					)}
				</div>
			)}
		</Dialog>
	);
}

function ProviderRow({ p, onEdit, scope }: { p: ApiProviderWithStatus; onEdit: () => void; scope: Scope }) {
	const qc = useQueryClient();
	const [deleting, setDeleting] = useState(false);
	const refresh = () => {
		void qc.invalidateQueries({ queryKey: qk.apiProviders });
		void qc.invalidateQueries({ queryKey: qk.models });
		void qc.invalidateQueries({ queryKey: qk.embeddingModels });
		void qc.invalidateQueries({ queryKey: ["voice"] });
	};
	const toggle = useMutation({
		mutationFn: (enabled: boolean) => api.apiProviders.update(p.id, { enabled }),
		onSuccess: refresh,
	});
	const check = useMutation({ mutationFn: () => api.apiProviders.check(p.id), onSuccess: refresh });
	const remove = useMutation({ mutationFn: () => api.apiProviders.delete(p.id), onSuccess: refresh });
	const s = p.status;
	return (
		<div className="flex items-center gap-3 px-4 py-3">
			<ProviderMark preset={p.preset} name={p.name} />
			<button type="button" onClick={onEdit} className="min-w-0 flex-1 text-left">
				<div className="flex flex-wrap items-center gap-1.5">
					<span className="truncate text-sm font-medium">{p.name}</span>
					{!p.enabled ? (
						<Badge>Off</Badge>
					) : s.ok ? (
						<Badge tone="success">{countsLabel(s, scope)}</Badge>
					) : s.checkedAt ? (
						<Badge tone="danger">Problem</Badge>
					) : null}
				</div>
				<div className="truncate text-xs text-fg-subtle">
					{!s.ok && s.error ? s.error : `${kindLabel(p.kind)} · ${p.baseUrl.replace(/^https?:\/\//, "")}`}
					{s.checkedAt && s.ok ? ` · checked ${timeAgo(s.checkedAt)}` : ""}
				</div>
			</button>
			<Button
				variant="ghost"
				size="icon-sm"
				aria-label="Check again"
				onClick={() => check.mutate()}
				disabled={check.isPending}
			>
				<RefreshCw className={check.isPending ? "animate-spin" : undefined} />
			</Button>
			<Switch checked={p.enabled} onCheckedChange={(on) => toggle.mutate(on)} label={`Use ${p.name}`} />
			<Button variant="ghost" size="icon-sm" aria-label={`Remove ${p.name}`} onClick={() => setDeleting(true)}>
				<Trash2 />
			</Button>
			<Confirm
				open={deleting}
				onOpenChange={setDeleting}
				title={`Remove ${p.name}?`}
				description={
					scope === "voice"
						? "Bots using its voices fall back to the defaults."
						: "Bots using its models fall back to the default model."
				}
				confirmLabel="Remove"
				danger
				onConfirm={() => remove.mutate()}
			/>
		</div>
	);
}

/** Admin → Models → API providers, and Admin → Voice → voice services. */
export function ApiProviders({ scope = "models" }: { scope?: Scope }) {
	const { data: all, isLoading } = useApiProviders();
	const providers = all?.filter((p) => inScope(scope, p));
	const [dialog, setDialog] = useState<{ editing: ApiProviderWithStatus | null; key: number } | null>(null);
	const voice = scope === "voice";
	return (
		<Section
			title={voice ? "Voice services" : "API providers"}
			icon={voice ? <AudioLines /> : <Cloud />}
			description={
				voice
					? "ElevenLabs and Fish Audio (including character voices). Their voices show up in the pickers below and in each bot's Voice tab."
					: "Use models from OpenAI, Anthropic, Google, OpenRouter, a local Ollama… alongside the gateway's."
			}
			action={
				<Button variant="secondary" size="sm" onClick={() => setDialog({ editing: null, key: Date.now() })}>
					<Plus /> Add
				</Button>
			}
		>
			{isLoading ? (
				<Spinner />
			) : !providers?.length ? (
				<EmptyState
					icon={voice ? <AudioLines /> : <Server />}
					tone="neutral"
					title={voice ? "No voices yet" : "Just the gateway for now"}
					description={
						voice
							? "Add ElevenLabs or Fish Audio with an API key to talk with your bots, including in anime and game character voices."
							: "Add a provider with an OpenAI-, Anthropic- or Gemini-compatible API, including models running on your own machine."
					}
					action={
						<Button
							variant="secondary"
							size="sm"
							onClick={() => setDialog({ editing: null, key: Date.now() })}
						>
							<Plus /> {voice ? "Add a voice service" : "Add a provider"}
						</Button>
					}
					className="rounded-2xl border border-dashed border-border py-8"
				/>
			) : (
				<div className="divide-y divide-border rounded-2xl border border-border bg-card">
					{providers.map((p) => (
						<ProviderRow
							key={p.id}
							p={p}
							scope={scope}
							onEdit={() => setDialog({ editing: p, key: Date.now() })}
						/>
					))}
				</div>
			)}
			{dialog && (
				<ProviderDialog
					key={dialog.key}
					open
					scope={scope}
					onOpenChange={(o) => !o && setDialog(null)}
					editing={dialog.editing}
				/>
			)}
		</Section>
	);
}
