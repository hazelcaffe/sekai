import {
	type AgentVoice,
	parseApiModel,
	type VoiceCap,
	type VoiceInfo,
	type VoiceModelInfo,
	type VoiceSettings,
} from "@sekai/shared";
import {
	Button,
	Callout,
	Dialog,
	ErrorState,
	Field,
	IconButton,
	Input,
	Section,
	Select,
	type SelectOption,
	SkeletonRows,
	Spinner,
	Tooltip,
} from "@sekai/ui";
import { useQuery } from "@tanstack/react-query";
import { AudioLines, Play, Search, Square, Volume2, Wand2 } from "lucide-react";
import { type ReactNode, useEffect, useState, useSyncExternalStore } from "react";
import { api } from "../api.ts";
import { useAccess, useVoiceModels } from "../data.ts";
import { qk } from "../query.ts";
import { cn } from "../utils.ts";
import { MakeVoiceDialog } from "./MakeVoice.tsx";

// ---------------------------------------------------------------- previews (one at a time, app-wide)

let current: { key: string; audio: HTMLAudioElement; loading: boolean } | null = null;
const listeners = new Set<() => void>();
const notify = () => {
	for (const l of listeners) l();
};

function stopPreview(): void {
	current?.audio.pause();
	current = null;
	notify();
}

async function playPreview(key: string, url: string, onError: (message: string) => void): Promise<void> {
	if (current?.key === key) return stopPreview();
	current?.audio.pause();
	const audio = new Audio(url);
	current = { key, audio, loading: true };
	notify();
	audio.onended = () => {
		if (current?.audio === audio) stopPreview();
	};
	audio.onerror = () => {
		if (current?.audio !== audio) return;
		stopPreview();
		// The server says why (a missing key, a busy Space…).
		void fetch(url)
			.then(async (r) =>
				onError(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "Couldn't play that voice"),
			)
			.catch(() => onError("Couldn't play that voice"));
	};
	try {
		await audio.play();
		if (current?.audio === audio) {
			current = { ...current, loading: false };
			notify();
		}
	} catch {
		// onerror explains.
	}
}

function usePreview(key: string): "idle" | "loading" | "playing" {
	return useSyncExternalStore(
		(l) => {
			listeners.add(l);
			return () => listeners.delete(l);
		},
		() => (current?.key === key ? (current.loading ? "loading" : "playing") : "idle"),
	);
}

// ---------------------------------------------------------------- voices

const TINTS = Array.from({ length: 8 }, (_, i) => `var(--series-${((i + 4) % 8) + 1})`);
const tint = (s: string) => TINTS[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % TINTS.length];

function VoiceCard({
	voice,
	model,
	cap,
	selected,
	disabled,
	onSelect,
	onError,
}: {
	voice: VoiceInfo;
	model: string;
	cap: VoiceCap;
	selected: boolean;
	disabled?: boolean;
	onSelect: () => void;
	onError: (message: string) => void;
}) {
	const key = `${model}|${voice.id}`;
	const state = usePreview(key);
	const [broken, setBroken] = useState(false);
	return (
		<div
			className={cn(
				"flex min-w-0 items-center gap-2.5 rounded-lg border p-1.5 pl-2 transition-[background-color,border-color,box-shadow] duration-150",
				selected
					? "border-brand/50 bg-brand/6 ring-[3px] ring-brand-ink/10"
					: "border-border bg-surface hover:bg-surface-2/60",
			)}
		>
			<Tooltip content={[voice.name, voice.description].filter(Boolean).join(" · ")}>
				{/* biome-ignore lint/a11y/useSemanticElements: a voice card with its own play button */}
				<button
					type="button"
					role="radio"
					aria-checked={selected}
					disabled={disabled}
					onClick={onSelect}
					className="flex min-w-0 flex-1 items-center gap-2.5 py-0.5 text-left disabled:opacity-60"
				>
					{voice.image && !broken ? (
						<img
							src={voice.image}
							alt=""
							loading="lazy"
							onError={() => setBroken(true)}
							className="size-9 shrink-0 rounded-md object-cover"
						/>
					) : (
						<span
							aria-hidden
							className="flex size-9 shrink-0 items-center justify-center rounded-md text-body font-semibold text-paper"
							style={{ background: tint(voice.id) }}
						>
							{voice.name.trim()[0]?.toUpperCase() ?? "?"}
						</span>
					)}
					<span className="min-w-0">
						<span className="block truncate text-body font-medium">{voice.name}</span>
						{(voice.description || voice.language) && (
							<span className="block truncate text-small text-fg-subtle">
								{[voice.language?.toUpperCase(), voice.description].filter(Boolean).join(" · ")}
							</span>
						)}
					</span>
				</button>
			</Tooltip>
			<IconButton
				variant="ghost"
				size="icon-sm"
				label={state === "playing" ? `Stop ${voice.name}` : `Hear ${voice.name}`}
				disabled={disabled}
				onClick={() =>
					void playPreview(
						key,
						api.voice.previewUrl({ model, voice: voice.id, cap, name: voice.name }),
						onError,
					)
				}
				className={cn("shrink-0", state === "playing" && "text-brand-ink")}
			>
				{state === "loading" ? (
					<Spinner />
				) : state === "playing" ? (
					<Square className="fill-current" />
				) : (
					<Play className="fill-current" />
				)}
			</IconButton>
		</div>
	);
}

/** The voices of a model, each with ▶ to hear it. Big libraries (Fish Audio) are searched. */
export function VoiceGrid({
	model,
	info,
	cap,
	value,
	valueName,
	onChange,
	disabled,
	onError,
	listClassName,
}: {
	model: string;
	info: VoiceModelInfo | undefined;
	cap: VoiceCap;
	value: string;
	valueName?: string;
	onChange: (voice: VoiceInfo) => void;
	disabled?: boolean;
	onError: (message: string) => void;
	listClassName?: string;
}) {
	const [q, setQ] = useState("");
	const [query, setQuery] = useState("");
	useEffect(() => {
		const t = setTimeout(() => setQuery(q.trim()), 350);
		return () => clearTimeout(t);
	}, [q]);
	useEffect(() => () => stopPreview(), []);
	const enabled = Boolean(model);
	const { data, isLoading, error } = useQuery({
		queryKey: qk.voices(model, cap, query),
		queryFn: () => api.voice.voices(model, cap, query),
		enabled,
		staleTime: 5 * 60_000,
	});
	const voices = data ?? [];
	const searchable = info?.searchable || voices.length > 12 || query !== "";
	const shown =
		value && !voices.some((v) => v.id === value)
			? [{ id: value, name: valueName || value, description: "Your pick" }, ...voices]
			: voices;
	if (!enabled) return <p className="text-small text-fg-subtle">Pick a model to see its voices.</p>;
	return (
		<div className="@container flex flex-col gap-2">
			{searchable && (
				<div className="relative">
					<Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle" />
					<Input
						value={q}
						onChange={(e) => setQ(e.target.value)}
						placeholder={
							info?.kind === "fishaudio"
								? "Search Fish Audio voices, or paste a fish.audio link"
								: "Search voices"
						}
						className="pl-9"
					/>
				</div>
			)}
			{isLoading ? (
				<div className="flex items-center gap-2 py-3 text-small text-fg-subtle">
					<Spinner /> Loading voices…
				</div>
			) : error ? (
				<p className="text-body text-danger-ink">{error instanceof Error ? error.message : String(error)}</p>
			) : shown.length === 0 ? (
				<p className="py-2 text-small text-fg-subtle">
					{query ? "No voices match." : "This model has no voices to pick."}
				</p>
			) : (
				<div
					role="radiogroup"
					aria-label="Voice"
					className={cn(
						"grid max-h-[340px] grid-cols-1 gap-2 overflow-y-auto p-0.5 scrollbar-thin @[19rem]:grid-cols-2 @[36rem]:grid-cols-3",
						listClassName,
					)}
				>
					{shown.map((v) => (
						<VoiceCard
							key={v.id}
							voice={v}
							model={model}
							cap={cap}
							selected={v.id === value}
							disabled={disabled}
							onSelect={() => onChange(v)}
							onError={onError}
						/>
					))}
				</div>
			)}
		</div>
	);
}

// ---------------------------------------------------------------- models

const DEFAULT = "__default";

function modelOptions(models: VoiceModelInfo[], cap: VoiceCap): SelectOption[] {
	return models
		.filter((m) => m.cap === cap)
		.map((m) => ({
			value: m.id,
			label: m.name,
			description: [m.source, cap === "stt" && m.live ? "words as you talk" : null].filter(Boolean).join(" · "),
		}));
}

const nameOf = (models: VoiceModelInfo[], id: string, cap: VoiceCap) =>
	models.find((m) => m.id === id && m.cap === cap)?.name ?? (id ? id.split("::").pop() : "");

/** A voice's picture, or its first letter on a color of its own. */
function VoiceFace({
	voice,
	size = 40,
}: {
	voice: { id: string; name: string; image?: string | null };
	size?: number;
}) {
	const [broken, setBroken] = useState(false);
	if (voice.image && !broken) {
		return (
			<img
				src={voice.image}
				alt=""
				loading="lazy"
				onError={() => setBroken(true)}
				className="shrink-0 rounded-lg object-cover"
				style={{ width: size, height: size }}
			/>
		);
	}
	return (
		<span
			aria-hidden
			className="flex shrink-0 items-center justify-center rounded-lg text-body font-semibold text-paper"
			style={{ width: size, height: size, background: tint(voice.id || voice.name) }}
		>
			{voice.name.trim()[0]?.toUpperCase() ?? "?"}
		</span>
	);
}

/** The voice in use, from its model's list (for its picture and description). */
function useVoice(model: string, cap: VoiceCap, id: string, name?: string): VoiceInfo | null {
	const { data } = useQuery({
		queryKey: qk.voices(model, cap, ""),
		queryFn: () => api.voice.voices(model, cap, ""),
		enabled: Boolean(model && id),
		staleTime: 5 * 60_000,
	});
	if (!id) return null;
	return data?.find((v) => v.id === id) ?? { id, name: name || id };
}

/** One voice the bot uses: who it is, ▶ to hear it, and Change to pick another (in a dialog with every voice). */
function VoiceRow({
	label,
	model,
	modelName,
	cap,
	voiceId,
	voiceName,
	isDefault,
	onOpen,
	onError,
}: {
	label: string;
	model: string;
	modelName: string;
	cap: VoiceCap;
	voiceId: string;
	voiceName?: string;
	isDefault: boolean;
	onOpen: () => void;
	onError: (message: string) => void;
}) {
	const voice = useVoice(model, cap, voiceId, voiceName);
	const key = `${model}|${voiceId}`;
	const state = usePreview(key);
	const shown = voice ?? { id: model, name: modelName || "?" };
	return (
		<div className="flex items-center gap-3 px-3.5 py-3">
			<button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left">
				<VoiceFace voice={shown} />
				<span className="min-w-0">
					<span className="block text-small text-fg-subtle">{label}</span>
					<span className="flex items-baseline gap-1.5">
						<span className="truncate text-body font-medium">{voice?.name ?? "Pick a voice"}</span>
						{isDefault && (
							<span className="shrink-0 rounded-full bg-surface-2 px-1.5 text-caption text-fg-subtle">
								default
							</span>
						)}
					</span>
					<span className="block truncate text-small text-fg-subtle">
						{[modelName, voice?.description].filter(Boolean).join(" · ")}
					</span>
				</span>
			</button>
			{voice && model && (
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label={state === "playing" ? `Stop ${voice.name}` : `Hear ${voice.name}`}
					onClick={() =>
						void playPreview(
							key,
							api.voice.previewUrl({ model, voice: voice.id, cap, name: voice.name }),
							onError,
						)
					}
					className={cn("shrink-0", state === "playing" && "text-brand-ink")}
				>
					{state === "loading" ? (
						<Spinner />
					) : state === "playing" ? (
						<Square className="fill-current" />
					) : (
						<Play className="fill-current" />
					)}
				</Button>
			)}
			<Button variant="secondary" size="xs" onClick={onOpen} className="shrink-0">
				Change
			</Button>
		</div>
	);
}

/**
 * How bots sound and listen: the speaking voice (calls, reading aloud, voice messages) and the speech-to-text
 * model (calls, dictation, your voice messages). For the defaults (Settings → Voice), or one bot's own choices on
 * top of them.
 */
export function VoiceSettingsEditor({
	value,
	own,
	defaults,
	onChange,
	onError,
	setup,
}: {
	/** What's in effect. */
	value: VoiceSettings;
	/** A bot's own choices (null fields use the defaults). Leave out for the defaults themselves. */
	own?: AgentVoice;
	defaults?: VoiceSettings;
	onChange: (patch: Partial<AgentVoice>) => void;
	onError: (message: string) => void;
	/** Where to connect a voice service, said while there's none (Settings → Voice has them above). */
	setup?: ReactNode;
}) {
	const { data: models = [], isLoading, isError, error, refetch } = useVoiceModels();
	const { admin } = useAccess();
	const [picking, setPicking] = useState(false);
	const [making, setMaking] = useState(false);
	const agent = Boolean(own);
	const withDefault = (opts: SelectOption[], cap: VoiceCap, id: string | undefined) =>
		agent && defaults
			? [{ value: DEFAULT, label: `Default (${nameOf(models, id ?? "", cap) || "none picked"})` }, ...opts]
			: opts;
	const info = (id: string, cap: VoiceCap) => models.find((m) => m.id === id && m.cap === cap);
	if (isLoading) return <SkeletonRows count={3} leading={false} />;
	if (isError) return <ErrorState size="sm" error={error} onRetry={() => void refetch()} />;
	// Nothing to pick from: say what to do instead of showing empty pickers.
	if (models.length === 0) {
		return (
			<Callout icon={<AudioLines />} title="No voice service yet">
				{setup ??
					(admin
						? "Connect ElevenLabs or Fish Audio in Settings → Voice, then pick voices here."
						: "Calls, reading aloud and dictation need a voice service. Ask an admin to connect one.")}
			</Callout>
		);
	}
	const sttOptions = modelOptions(models, "stt");

	const ttsModel = agent ? (own?.ttsModel ?? DEFAULT) : value.ttsModel;
	const sttModel = agent ? (own?.sttModel ?? DEFAULT) : value.sttModel;
	const ttsIsDefault = agent && own?.ttsModel == null && own?.ttsVoice == null;
	const reset = (label: string, show: boolean, patch: Partial<AgentVoice>) =>
		agent && show ? (
			<button
				type="button"
				onClick={() => onChange(patch)}
				className="self-start text-small font-medium text-brand-ink hover:underline"
			>
				{label}
			</button>
		) : null;

	return (
		<div className="flex flex-col gap-6">
			<Section title="Speaking" description="Talks on calls, reads messages aloud and sends voice messages.">
				<div className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface">
					<VoiceRow
						label="Speaking voice"
						model={value.ttsModel}
						modelName={nameOf(models, value.ttsModel, "tts") ?? ""}
						cap="tts"
						voiceId={value.ttsVoice}
						voiceName={value.ttsVoiceName}
						isDefault={ttsIsDefault}
						onOpen={() => setPicking(true)}
						onError={onError}
					/>
				</div>
			</Section>

			<Section title="Listening" description="Hears you on calls, writes down dictation and your voice messages.">
				<div className="@container">
					<div className="grid gap-3 @[24rem]:grid-cols-[minmax(0,1fr)_7rem]">
						<Field
							label="Speech to text"
							hint={
								sttOptions.length === 0
									? "None of your voice services has one yet. ElevenLabs and Fish Audio do."
									: undefined
							}
						>
							{sttOptions.length === 0 ? (
								<Select
									value=""
									onValueChange={() => {}}
									options={[]}
									placeholder="None yet"
									disabled
								/>
							) : (
								<Select
									value={sttModel}
									onValueChange={(id) => onChange({ sttModel: id === DEFAULT ? null : id })}
									options={withDefault(sttOptions, "stt", defaults?.sttModel)}
									placeholder="Pick a model"
								/>
							)}
						</Field>
						<Field label="Language" hint="A code like en or ja.">
							<Input
								key={value.language}
								defaultValue={agent ? (own?.language ?? "") : value.language}
								placeholder={agent ? defaults?.language || "Detect" : "Detect"}
								maxLength={20}
								onBlur={(e) => {
									const v = e.target.value.trim();
									if (agent) {
										if (v !== (own?.language ?? "")) onChange({ language: v || null });
									} else if (v !== value.language) onChange({ language: v });
								}}
							/>
						</Field>
					</div>
				</div>
			</Section>

			<Dialog
				open={picking}
				onOpenChange={setPicking}
				icon={<Volume2 />}
				title="Speaking voice"
				description="Talks on calls, reads messages aloud and sends voice messages. Any ElevenLabs voice, or any Fish Audio voice (search, or paste a fish.audio link)."
				footer={
					<>
						<Button variant="secondary" onClick={() => setMaking(true)}>
							<Wand2 /> Make a voice
						</Button>
						{reset("Use the default", !ttsIsDefault, {
							ttsModel: null,
							ttsVoice: null,
							ttsVoiceName: null,
						})}
						<Button variant="primary" className="ml-auto" onClick={() => setPicking(false)}>
							Done
						</Button>
					</>
				}
			>
				<div className="flex flex-col gap-4">
					<Field label="Model">
						<Select
							value={ttsModel}
							onValueChange={(id) =>
								// A new model starts without a voice (the server clears the defaults' own).
								onChange(
									agent
										? { ttsModel: id === DEFAULT ? null : id, ttsVoice: null, ttsVoiceName: null }
										: { ttsModel: id },
								)
							}
							options={withDefault(modelOptions(models, "tts"), "tts", defaults?.ttsModel)}
							placeholder="Pick a model"
						/>
					</Field>
					<VoiceGrid
						model={value.ttsModel}
						info={info(value.ttsModel, "tts")}
						cap="tts"
						value={value.ttsVoice}
						valueName={value.ttsVoiceName}
						onChange={(v) => {
							onChange({ ttsVoice: v.id, ttsVoiceName: v.name });
							setPicking(false);
						}}
						onError={onError}
						listClassName="max-h-[min(48vh,440px)]"
					/>
				</div>
			</Dialog>

			<MakeVoiceDialog
				open={making}
				onOpenChange={setMaking}
				providerId={parseApiModel(value.ttsModel)?.providerId}
				onMade={(v) => {
					// Its own service's model, unless the bot already speaks with one of that service's models.
					const same = parseApiModel(value.ttsModel)?.providerId === v.providerId;
					onChange({ ttsModel: same ? value.ttsModel : v.model, ttsVoice: v.voiceId, ttsVoiceName: v.name });
					setPicking(false);
				}}
			/>
		</div>
	);
}
