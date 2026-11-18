import { type CustomVoice, parseApiModel, type VoiceCandidate } from "@sekai/shared";
import { Button, Checkbox, Dialog, Field, Input, Segmented, Select, Spinner, Textarea } from "@sekai/ui";
import { useQueryClient } from "@tanstack/react-query";
import { Mic, Pause, Play, RotateCcw, Square, Upload, Wand2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.ts";
import { useVoiceModels } from "../data.ts";
import { qk } from "../query.ts";
import { cn } from "../utils.ts";
import { useVoiceRecorder } from "../voice/hooks.ts";

const IDEAS = [
	"A warm, cheerful young woman with a light British accent, speaking quickly with a smile",
	"A calm late-night radio host: low, smooth and unhurried",
	"An old wizard with a deep, gravelly voice who speaks slowly",
	"An excited teenage gamer, fast and a little breathless",
];

const SCRIPT =
	"Hi! I'm recording this so my assistant can speak in my voice. I like quiet mornings, a good cup of tea, and long walks when the weather's nice. When something exciting happens, I talk a little faster, and when I'm thinking, I slow down.";

/** One sound at a time, from a URL (data: or blob:). */
function usePlayer() {
	const audio = useRef<HTMLAudioElement | null>(null);
	const [playing, setPlaying] = useState<string | null>(null);
	useEffect(() => () => audio.current?.pause(), []);
	const toggle = (key: string, url: string) => {
		audio.current?.pause();
		if (playing === key) {
			setPlaying(null);
			return;
		}
		const a = new Audio(url);
		a.onended = () => setPlaying((p) => (p === key ? null : p));
		audio.current = a;
		setPlaying(key);
		void a.play().catch(() => setPlaying(null));
	};
	const stop = () => {
		audio.current?.pause();
		setPlaying(null);
	};
	return { playing, toggle, stop };
}

function PlayButton({ playing, onClick, label }: { playing: boolean; onClick: () => void; label: string }) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-label={playing ? `Stop ${label}` : `Hear ${label}`}
			className="flex size-9 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-transform active:scale-90 [&_svg]:size-4"
		>
			{playing ? <Pause className="fill-current" /> : <Play className="translate-x-px fill-current" />}
		</button>
	);
}

function Clock({ startedAt }: { startedAt: number }) {
	const [now, setNow] = useState(Date.now());
	useEffect(() => {
		const t = setInterval(() => setNow(Date.now()), 250);
		return () => clearInterval(t);
	}, []);
	const s = Math.floor((now - startedAt) / 1000);
	return (
		<span className="tabular-nums">
			{Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")}
		</span>
	);
}

/**
 * Make a voice: describe it and keep one of the voices that come out, or record someone (with their OK). Fish
 * Audio works on any plan; ElevenLabs needs a paid one.
 */
export function MakeVoiceDialog({
	open,
	onOpenChange,
	onMade,
	providerId: preferred,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onMade: (voice: CustomVoice) => void;
	/** Start with this service (the one the voice picker is on). */
	providerId?: string;
}) {
	const qc = useQueryClient();
	const { data: models = [] } = useVoiceModels();
	const services = useMemo(() => {
		const seen = new Map<string, { id: string; name: string; kind: string }>();
		for (const m of models) {
			if (m.cap !== "tts" || (m.kind !== "fishaudio" && m.kind !== "elevenlabs")) continue;
			const id = parseApiModel(m.id)?.providerId;
			if (id && !seen.has(id)) seen.set(id, { id, name: m.source, kind: m.kind });
		}
		return [...seen.values()].sort((a, b) => Number(b.kind === "fishaudio") - Number(a.kind === "fishaudio"));
	}, [models]);
	const [providerId, setProviderId] = useState("");
	const service =
		services.find((s) => s.id === providerId) ?? services.find((s) => s.id === preferred) ?? services[0];
	const [mode, setMode] = useState<"describe" | "record">("describe");
	const [description, setDescription] = useState("");
	const [sample, setSample] = useState("");
	const [candidates, setCandidates] = useState<VoiceCandidate[]>([]);
	const [picked, setPicked] = useState<string | null>(null);
	const [name, setName] = useState("");
	const [busy, setBusy] = useState<"design" | "save" | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [recording, setRecording] = useState<{ blob: Blob; url: string; secs: number } | null>(null);
	const [consent, setConsent] = useState(false);
	const recorder = useVoiceRecorder();
	const player = usePlayer();
	const file = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (open) return;
		player.stop();
		recorder.cancel();
		setCandidates([]);
		setPicked(null);
		setError(null);
		setBusy(null);
	}, [open, player.stop, recorder.cancel]);
	useEffect(() => () => (recording ? URL.revokeObjectURL(recording.url) : undefined), [recording]);
	useEffect(() => {
		if (recorder.error) setError(recorder.error);
	}, [recorder.error]);

	const fail = (err: unknown) => setError(err instanceof Error ? err.message : String(err));
	const done = (v: CustomVoice) => {
		void qc.invalidateQueries({ queryKey: ["voice", "voices"] });
		void qc.invalidateQueries({ queryKey: qk.customVoices });
		onMade(v);
		onOpenChange(false);
	};

	const design = async () => {
		if (!service) return;
		setBusy("design");
		setError(null);
		setCandidates([]);
		setPicked(null);
		player.stop();
		try {
			const r = await api.voice.custom.design({
				providerId: service.id,
				description,
				text: sample.trim() || undefined,
			});
			setCandidates(r.candidates);
			setPicked(r.candidates[0]?.id ?? null);
			if (r.candidates[0]) player.toggle(r.candidates[0].id, r.candidates[0].audio);
		} catch (err) {
			fail(err);
		} finally {
			setBusy(null);
		}
	};

	const keep = async () => {
		if (!picked) return;
		setBusy("save");
		setError(null);
		try {
			done(await api.voice.custom.keep(picked, name.trim() || "My voice"));
		} catch (err) {
			fail(err);
		} finally {
			setBusy(null);
		}
	};

	const stopRecording = () => {
		const secs = recorder.startedAt ? (Date.now() - recorder.startedAt) / 1000 : 0;
		const blob = recorder.stop();
		if (!blob) return;
		setRecording({ blob, url: URL.createObjectURL(blob), secs });
	};

	const clone = async () => {
		if (!service || !recording) return;
		setBusy("save");
		setError(null);
		try {
			done(
				await api.voice.custom.clone({
					providerId: service.id,
					name: name.trim() || "My voice",
					audio: recording.blob,
					consent,
				}),
			);
		} catch (err) {
			fail(err);
		} finally {
			setBusy(null);
		}
	};

	const footer =
		mode === "describe" ? (
			<>
				<Button variant="ghost" onClick={() => onOpenChange(false)}>
					Cancel
				</Button>
				<Button
					variant="primary"
					disabled={!picked || busy !== null || !name.trim()}
					onClick={() => void keep()}
				>
					{busy === "save" && <Spinner className="text-primary-foreground" />} Keep this voice
				</Button>
			</>
		) : (
			<>
				<Button variant="ghost" onClick={() => onOpenChange(false)}>
					Cancel
				</Button>
				<Button
					variant="primary"
					disabled={!recording || !consent || busy !== null || !name.trim()}
					onClick={() => void clone()}
				>
					{busy === "save" && <Spinner className="text-primary-foreground" />} Make the voice
				</Button>
			</>
		);

	return (
		<Dialog
			open={open}
			onOpenChange={onOpenChange}
			icon={<Wand2 />}
			title="Make a voice"
			description="Describe one and keep the take you like, or record someone speaking."
			footer={services.length ? footer : undefined}
		>
			{services.length === 0 ? (
				<p className="text-[13px] leading-5 text-fg-subtle">
					Add Fish Audio (or ElevenLabs) in Admin → Voice first. Fish Audio makes voices on any plan.
				</p>
			) : (
				<div className="flex flex-col gap-4">
					<div className="flex flex-wrap items-center gap-2">
						<Segmented<"describe" | "record">
							value={mode}
							onValueChange={(m) => {
								setMode(m);
								setError(null);
							}}
							options={[
								{ value: "describe", label: "Describe it" },
								{ value: "record", label: "From a recording" },
							]}
						/>
						{services.length > 1 && (
							<div className="ml-auto w-44">
								<Select
									size="sm"
									value={service?.id ?? ""}
									onValueChange={setProviderId}
									options={services.map((s) => ({
										value: s.id,
										label: s.name,
										description: s.kind === "elevenlabs" ? "Needs a paid plan" : "Any plan",
									}))}
								/>
							</div>
						)}
					</div>

					{mode === "describe" ? (
						<>
							<Field label="The voice">
								<Textarea
									value={description}
									onChange={(e) => setDescription(e.target.value)}
									placeholder="Who's speaking: age, accent, mood, pace…"
									rows={3}
								/>
							</Field>
							{!description && (
								<div className="-mt-2 flex flex-wrap gap-1.5">
									{IDEAS.map((idea) => (
										<button
											key={idea}
											type="button"
											onClick={() => setDescription(idea)}
											className="rounded-full border border-border px-2.5 py-1 text-left text-xs text-fg-muted transition-colors hover:bg-muted hover:text-fg"
										>
											{idea.split(":")[0]?.split(",")[0]}
										</button>
									))}
								</div>
							)}
							<Field label="What the samples say (optional)">
								<Input value={sample} onChange={(e) => setSample(e.target.value)} maxLength={150} />
							</Field>
							<Button
								variant="secondary"
								className="self-start"
								disabled={description.trim().length < 8 || busy !== null}
								onClick={() => void design()}
							>
								{busy === "design" ? <Spinner /> : <Wand2 />}
								{busy === "design"
									? "Making voices…"
									: candidates.length
										? "Make new ones"
										: "Make voices"}
							</Button>
							{candidates.length > 0 && (
								<div className="flex flex-col gap-2" role="radiogroup" aria-label="Takes">
									{candidates.map((c, i) => (
										<div
											key={c.id}
											className={cn(
												"flex items-center gap-3 rounded-2xl border p-2 pr-3 transition-colors",
												picked === c.id
													? "border-brand/50 bg-brand/6 ring-[3px] ring-ring/10"
													: "border-border",
											)}
										>
											<PlayButton
												playing={player.playing === c.id}
												onClick={() => player.toggle(c.id, c.audio)}
												label={`take ${i + 1}`}
											/>
											{/* biome-ignore lint/a11y/useSemanticElements: a take with its own play button */}
											<button
												type="button"
												role="radio"
												aria-checked={picked === c.id}
												onClick={() => setPicked(c.id)}
												className="min-w-0 flex-1 text-left"
											>
												<span className="block text-sm font-medium">Take {i + 1}</span>
												<span className="block truncate text-xs text-fg-subtle">
													{c.traits ?? `${(c.durationMs / 1000).toFixed(1)} s`}
												</span>
											</button>
										</div>
									))}
									<Field label="Name it">
										<Input
											value={name}
											onChange={(e) => setName(e.target.value)}
											placeholder="Wizard"
											maxLength={60}
										/>
									</Field>
								</div>
							)}
						</>
					) : (
						<>
							<p className="text-[13px] leading-5 text-fg-subtle">
								Record 10–30 seconds of one person talking clearly, with no music or background noise.
								You can read this:
							</p>
							<blockquote className="rounded-2xl bg-muted/60 px-4 py-3 text-[13px] leading-6 text-fg-muted">
								{SCRIPT}
							</blockquote>
							{recorder.state !== "idle" ? (
								<div className="flex items-center gap-3 rounded-2xl border border-destructive/30 bg-destructive/6 p-2 pr-3">
									<button
										type="button"
										onClick={stopRecording}
										aria-label="Stop recording"
										className="flex size-9 shrink-0 items-center justify-center rounded-full bg-destructive text-white [&_svg]:size-4"
									>
										<Square className="fill-current" />
									</button>
									<span className="flex-1 text-sm font-medium text-destructive">
										Recording… {recorder.startedAt && <Clock startedAt={recorder.startedAt} />}
									</span>
								</div>
							) : recording ? (
								<div className="flex items-center gap-3 rounded-2xl border border-border p-2 pr-2">
									<PlayButton
										playing={player.playing === "rec"}
										onClick={() => player.toggle("rec", recording.url)}
										label="your recording"
									/>
									<span className="min-w-0 flex-1 text-sm">
										Your recording
										<span className="block text-xs text-fg-subtle">
											{recording.secs ? `${Math.round(recording.secs)} s` : "From a file"}
											{recording.secs && recording.secs < 8
												? " · a bit short; 10–30 s works best"
												: ""}
										</span>
									</span>
									<Button
										variant="ghost"
										size="sm"
										onClick={() => {
											setRecording(null);
											void recorder.start();
										}}
									>
										<RotateCcw /> Again
									</Button>
								</div>
							) : (
								<div className="flex flex-wrap gap-2">
									<Button variant="secondary" onClick={() => void recorder.start()}>
										<Mic /> Record
									</Button>
									<Button variant="ghost" onClick={() => file.current?.click()}>
										<Upload /> Use a file
									</Button>
									<input
										ref={file}
										type="file"
										accept="audio/wav,audio/x-wav,audio/ogg,.wav,.ogg,.opus"
										className="hidden"
										onChange={(e) => {
											const f = e.target.files?.[0];
											if (f) setRecording({ blob: f, url: URL.createObjectURL(f), secs: 0 });
											e.target.value = "";
										}}
									/>
								</div>
							)}
							<Field label="Name it">
								<Input
									value={name}
									onChange={(e) => setName(e.target.value)}
									placeholder="My voice"
									maxLength={60}
								/>
							</Field>
							<Checkbox
								checked={consent}
								onCheckedChange={setConsent}
								label="This is my voice, or the speaker agreed to it being used"
							/>
						</>
					)}
					{error && <p className="text-[13px] leading-5 text-destructive">{error}</p>}
				</div>
			)}
		</Dialog>
	);
}
