import { api, BrandTile, qk, timeAgo, useApiProviders, vendorBrand } from "@sekai/client";
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
	ErrorState,
	errorMessage,
	Field,
	Fold,
	FormGroup,
	IconButton,
	Input,
	List,
	PasswordInput,
	Row,
	Section,
	Select,
	SkeletonRows,
	Switch,
	Textarea,
	ToggleRow,
} from "@sekai/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
	AudioLines,
	CircleCheck,
	Cpu,
	ExternalLink,
	Pencil,
	Plug,
	Plus,
	RefreshCw,
	Server,
	Trash2,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { actionError, saveForm } from "../../lib/forms.ts";

type Scope = "models" | "voice";

const isVoiceKind = (k: ApiKind) => VOICE_KINDS.includes(k);
const inScope = (scope: Scope, p: ApiProviderWithStatus) =>
	scope === "voice" ? isVoiceKind(p.kind) : CHAT_KINDS.includes(p.kind);
const kindLabel = (k: string) => API_KIND_LABELS[k as ApiKind] ?? k;

function countsLabel(s: { chatModels: number; embeddingModels: number; voiceModels: number }, scope: Scope): string {
	if (scope === "voice") return `${s.voiceModels} ${s.voiceModels === 1 ? "voice model" : "voice models"}`;
	return `${s.chatModels} chat${s.embeddingModels ? ` · ${s.embeddingModels} embedding` : ""}`;
}

const URL_HINTS: Record<ApiKind, string> = {
	openai: "Usually ends in /v1.",
	anthropic: "Anthropic's API address.",
	google: "Google Gemini's API address.",
	elevenlabs: "Use a regional address like api.eu.residency.elevenlabs.io if your account lives there.",
	fishaudio: "Fish Audio's API address.",
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
					<span className="text-body font-semibold text-fg-muted">
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

const MODEL_TYPES = [
	{ value: "chat", label: "Chat" },
	{ value: "embedding", label: "Embedding" },
	{ value: "tts", label: "Text to speech" },
	{ value: "stt", label: "Speech to text" },
];

function ModelRows({
	models,
	voice,
	onChange,
}: {
	models: ApiModel[];
	/** ElevenLabs and Fish Audio: only speech models. */
	voice: boolean;
	onChange: (m: ApiModel[]) => void;
}) {
	const set = (i: number, patch: Partial<ApiModel>) =>
		onChange(models.map((m, j) => (j === i ? { ...m, ...patch } : m)));
	return (
		<div className="flex flex-col gap-2.5">
			{models.map((m, i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: rows are edited in place
				<div key={i} className="flex flex-col gap-2.5 rounded-lg border border-border bg-surface p-3">
					<div className="flex flex-wrap gap-2">
						<Input
							value={m.id}
							aria-label="Model ID"
							placeholder={voice ? "e.g. eleven_flash_v2_5" : "e.g. llama3.3:70b"}
							onChange={(e) => set(i, { id: e.target.value })}
							className="min-w-40 flex-1 font-mono"
						/>
						<Select
							label="Model type"
							value={m.type}
							onValueChange={(type) => set(i, { type: type as ApiModel["type"] })}
							options={voice ? MODEL_TYPES.slice(2) : MODEL_TYPES}
							className="w-36"
						/>
						<IconButton
							variant="ghost"
							size="icon"
							label="Remove model"
							onClick={() => onChange(models.filter((_, j) => j !== i))}
						>
							<Trash2 />
						</IconButton>
					</div>
					{m.type === "chat" ? (
						<div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-small text-fg-muted">
							<span className="flex items-center gap-2">
								Context
								<Input
									type="number"
									aria-label="Context window (tokens)"
									value={m.contextWindow}
									onChange={(e) => set(i, { contextWindow: Number(e.target.value) || 128_000 })}
									className="h-8 w-28 tabular-nums"
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
					) : m.type === "embedding" ? (
						<span className="flex items-center gap-2 text-small text-fg-muted">
							Dimensions
							<Input
								type="number"
								aria-label="Dimensions"
								value={m.dimensions ?? ""}
								placeholder="Automatic"
								onChange={(e) => set(i, { dimensions: Number(e.target.value) || null })}
								className="h-8 w-28 tabular-nums"
							/>
						</span>
					) : null}
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
							type: voice ? "tts" : "chat",
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
	initialDraft,
	onChange,
	editing,
	savedId,
	scope,
	onBack,
	onCancel,
	onSubmit,
}: {
	draft: Draft;
	initialDraft: Draft;
	onChange: (d: Draft) => void;
	editing: boolean;
	savedId?: string;
	scope: Scope;
	onBack?: () => void;
	onCancel: () => void;
	onSubmit: (d: Draft) => Promise<void>;
}) {
	const preset = API_PRESETS.find((p) => p.id === draft.preset);
	const [headers, setHeaders] = useState(headersText(draft.headers));
	const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
	const test = useMutation({
		mutationFn: () => api.apiProviders.test({ ...draft, models: [], ...(savedId ? { id: savedId } : {}) }),
		onSuccess: (res) => {
			if (res.ok) {
				const text =
					scope === "voice"
						? `${res.models.filter((m) => m.type === "tts" || m.type === "stt").length} voice models found.`
						: `${res.models.filter((m) => m.type === "chat").length} chat · ${res.models.filter((m) => m.type === "embedding").length} embedding models found.`;
				setTestResult({ ok: true, message: text });
			} else {
				setTestResult({
					ok: false,
					message: res.error || "Couldn't reach this provider. Check the address and key.",
				});
			}
		},
		onError: (err) => setTestResult({ ok: false, message: errorMessage(err) }),
	});
	const custom = draft.preset.startsWith("custom");
	const valid = Boolean(draft.name.trim() && draft.baseUrl.trim());
	const dirty = JSON.stringify(draft) !== JSON.stringify(initialDraft);
	const advancedSummary = [
		!isVoiceKind(draft.kind) && !draft.discover ? "manual list" : null,
		draft.models.length ? `${draft.models.length} manual` : null,
		Object.keys(draft.headers).length ? `${Object.keys(draft.headers).length} headers` : null,
	]
		.filter(Boolean)
		.join(" · ");

	return (
		<FormGroup
			dirty={dirty}
			submitWhenClean={!editing && valid}
			disabled={!valid}
			submitLabel={editing ? "Save" : scope === "voice" ? "Add service" : "Add provider"}
			onCancel={onCancel}
			error={testResult && !testResult.ok ? testResult.message : null}
			extra={
				<>
					<Button
						variant="secondary"
						loading={test.isPending}
						disabled={!draft.baseUrl.trim()}
						onClick={() => test.mutate()}
					>
						Test connection
					</Button>
					{!dirty && (
						<Button variant="ghost" onClick={onCancel}>
							Cancel
						</Button>
					)}
				</>
			}
			onSubmit={() => saveForm(() => onSubmit(draft))}
		>
			{onBack && preset && (
				<List label="Provider">
					<Row
						leading={<ProviderMark preset={preset.id} name={preset.name} size={32} />}
						title={preset.name}
						subtitle={preset.local ? "Runs on this computer" : API_KIND_LABELS[preset.kind]}
						trailing={
							<Button variant="ghost" size="sm" onClick={onBack}>
								Change
							</Button>
						}
					/>
				</List>
			)}
			{preset?.hint && <Callout icon={<Cpu />}>{preset.hint}</Callout>}
			<div className="grid gap-4 sm:grid-cols-2">
				<Field label="Name">
					<Input
						value={draft.name}
						onChange={(e) => onChange({ ...draft, name: e.target.value })}
						placeholder="e.g. OpenAI"
					/>
				</Field>
				<Field label="API format">
					<Select
						label="API format"
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
			<Field label="Server address" hint={URL_HINTS[draft.kind]}>
				<Input
					value={draft.baseUrl}
					onChange={(e) => {
						setTestResult(null);
						onChange({ ...draft, baseUrl: e.target.value });
					}}
					placeholder="https://api.example.com/v1"
					className="font-mono"
				/>
			</Field>
			<Field
				label="API key"
				optional={Boolean(preset?.local)}
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
							className="inline-flex items-center gap-1 text-small font-medium text-brand-ink hover:underline"
						>
							Get a key <ExternalLink aria-hidden className="size-4" />
						</a>
					)
				}
			>
				<PasswordInput
					autoComplete="off"
					value={draft.apiKey}
					onChange={(e) => {
						setTestResult(null);
						onChange({ ...draft, apiKey: e.target.value });
					}}
					className="font-mono"
				/>
			</Field>

			{testResult?.ok && (
				<p role="status" className="flex items-center gap-1.5 text-small text-success-ink">
					<CircleCheck aria-hidden className="size-4 shrink-0" />
					{testResult.message}
				</p>
			)}

			<Fold title="Advanced" summary={advancedSummary || "Optional"}>
				{!isVoiceKind(draft.kind) && (
					<List label="Model discovery">
						<ToggleRow
							title="Fetch model list automatically"
							description="Turn off to use only the models you list below."
							checked={draft.discover}
							onCheckedChange={(discover) => onChange({ ...draft, discover })}
						/>
					</List>
				)}
				<div className="flex flex-col gap-1.5">
					<span className="text-small font-medium text-fg">Manual models</span>
					<ModelRows
						models={draft.models}
						voice={isVoiceKind(draft.kind)}
						onChange={(models) => onChange({ ...draft, models })}
					/>
				</div>
				<Field label="Extra headers" optional hint="One per line, e.g. HTTP-Referer: https://sekai.local">
					<Textarea
						value={headers}
						onChange={(e) => {
							setHeaders(e.target.value);
							onChange({ ...draft, headers: parseHeaders(e.target.value) });
						}}
						className="min-h-16 font-mono"
					/>
				</Field>
			</Fold>
		</FormGroup>
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
	const [initialDraft, setInitialDraft] = useState<Draft | null>(editing ? draftOf(editing) : null);
	const refresh = () => {
		void qc.invalidateQueries({ queryKey: qk.apiProviders });
		void qc.invalidateQueries({ queryKey: qk.models });
		void qc.invalidateQueries({ queryKey: qk.embeddingModels });
		void qc.invalidateQueries({ queryKey: ["voice"] });
	};

	const submit = async (d: Draft) => {
		const body = { ...d, models: d.models.filter((m) => m.id.trim()) };
		const saved = editing ? await api.apiProviders.update(editing.id, body) : await api.apiProviders.create(body);
		refresh();
		onOpenChange(false);
		if (!saved.status.ok && saved.status.error) {
			toast.warning(`${saved.name} is saved, but Sekai couldn't reach it yet. Its row says why.`);
		}
	};

	const presets = API_PRESETS.filter((p) => (scope === "voice" ? p.scope !== "models" : p.scope !== "voice"));

	return (
		<Dialog
			open={open}
			onOpenChange={onOpenChange}
			size="lg"
			title={
				editing
					? `Edit ${editing.name}`
					: draft && !draft.preset.startsWith("custom")
						? `Add ${API_PRESETS.find((p) => p.id === draft.preset)?.name ?? draft.name}`
						: scope === "voice"
							? "Add a voice service"
							: "Add a provider"
			}
			description={
				!draft
					? scope === "voice"
						? "Choose ElevenLabs or Fish Audio."
						: "Pick a model provider or connect your own server."
					: undefined
			}
		>
			{draft && initialDraft ? (
				<ProviderForm
					draft={draft}
					initialDraft={initialDraft}
					onChange={setDraft}
					editing={Boolean(editing)}
					savedId={editing?.id}
					scope={scope}
					onBack={
						!editing
							? () => {
									setDraft(null);
									setInitialDraft(null);
								}
							: undefined
					}
					onCancel={() => onOpenChange(false)}
					onSubmit={submit}
				/>
			) : (
				<List label="Available providers">
					{presets.map((p) => (
						<Row
							key={p.id}
							leading={<ProviderMark preset={p.id} name={p.name} size={32} />}
							title={p.name}
							subtitle={p.local ? "Runs on this computer" : API_KIND_LABELS[p.kind]}
							chevron
							onClick={() => {
								const next = draftFrom(p);
								setDraft(next);
								setInitialDraft(next);
							}}
						/>
					))}
				</List>
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
		onError: actionError,
	});
	const check = useMutation({
		mutationFn: () => api.apiProviders.check(p.id),
		onSuccess: refresh,
		onError: actionError,
	});
	const remove = useMutation({
		mutationFn: () => api.apiProviders.delete(p.id),
		onSuccess: refresh,
		onError: actionError,
	});
	const s = p.status;
	const host = p.baseUrl.replace(/^https?:\/\//, "");
	const subtitle =
		!s.ok && s.error ? (
			<span className="text-danger-ink">{s.error}</span>
		) : (
			`${kindLabel(p.kind)} · ${host}${s.checkedAt && s.ok ? ` · checked ${timeAgo(s.checkedAt)}` : ""}`
		);

	return (
		<>
			<Row
				leading={<ProviderMark preset={p.preset} name={p.name} />}
				title={p.name}
				subtitle={subtitle}
				onClick={onEdit}
				badge={
					!p.enabled ? (
						<Badge>Off</Badge>
					) : s.ok ? (
						<Badge tone="success">{countsLabel(s, scope)}</Badge>
					) : s.checkedAt ? (
						<Badge tone="danger">Problem</Badge>
					) : undefined
				}
				trailing={
					<Switch checked={p.enabled} onCheckedChange={(on) => toggle.mutate(on)} label={`Use ${p.name}`} />
				}
				menuLabel={`Actions for ${p.name}`}
				menu={[
					{ label: "Edit", icon: <Pencil />, onSelect: onEdit },
					{
						label: check.isPending ? "Checking…" : "Check again",
						icon: <RefreshCw />,
						disabled: check.isPending,
						onSelect: () => check.mutate(),
					},
					"-",
					{ label: "Remove", icon: <Trash2 />, danger: true, onSelect: () => setDeleting(true) },
				]}
			/>
			<Confirm
				open={deleting}
				onOpenChange={setDeleting}
				title={`Remove ${p.name}?`}
				description={
					scope === "voice"
						? "Bots using its voices will switch back to the default voice."
						: "Bots using its models will switch back to the default model."
				}
				confirmLabel="Remove"
				danger
				onConfirm={() => remove.mutate()}
			/>
		</>
	);
}

/** Settings → Models → Other providers, and Settings → Voice → Voice services. */
export function ApiProviders({ scope = "models" }: { scope?: Scope }) {
	const { data: all, isLoading, isError, error, refetch } = useApiProviders();
	const providers = all?.filter((p) => inScope(scope, p));
	const [dialog, setDialog] = useState<{ editing: ApiProviderWithStatus | null; key: number } | null>(null);
	const voice = scope === "voice";
	const openAdd = () => setDialog({ editing: null, key: Date.now() });

	return (
		<Section
			title={voice ? "Voice services" : "Other providers"}
			description={
				voice
					? "Add ElevenLabs or Fish Audio to talk with your bots, including in character voices."
					: "Connect OpenAI, Anthropic, Google, or a local model server directly."
			}
			action={
				providers && providers.length > 0 ? (
					<Button variant="secondary" size="sm" onClick={openAdd}>
						<Plus /> Add
					</Button>
				) : undefined
			}
		>
			{isLoading ? (
				<SkeletonRows count={2} />
			) : isError ? (
				<ErrorState
					size="sm"
					title={voice ? "Voice services didn't load" : "Providers didn't load"}
					error={error}
					onRetry={() => void refetch()}
				/>
			) : !providers?.length ? (
				<EmptyState
					size="sm"
					icon={voice ? <AudioLines /> : <Server />}
					title={voice ? "No voice services yet" : "Just your main model server for now"}
					action={
						<Button variant="secondary" size="sm" onClick={openAdd}>
							<Plus /> {voice ? "Add a voice service" : "Add a provider"}
						</Button>
					}
					className="rounded-lg border border-dashed border-border"
				/>
			) : (
				<List label={voice ? "Voice services" : "Other providers"}>
					{providers.map((p) => (
						<ProviderRow
							key={p.id}
							p={p}
							scope={scope}
							onEdit={() => setDialog({ editing: p, key: Date.now() })}
						/>
					))}
				</List>
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
