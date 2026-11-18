import { api, MakeVoiceDialog, qk, timeAgo, useVoiceSettings, VoiceSettingsEditor } from "@sekai/client";
import type { CustomVoice, VoiceSettingsUpdate } from "@sekai/shared";
import { Button, Callout, Confirm, Section, SettingsPanel, Spinner } from "@sekai/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AudioLines, KeyRound, Play, Square, Trash2, Wand2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ApiProviders } from "./ApiProviders.tsx";

/** Voices you made: hear, rename or delete them, or make another. */
function YourVoices() {
	const qc = useQueryClient();
	const { data: voices = [], isLoading } = useQuery({ queryKey: qk.customVoices, queryFn: api.voice.custom.list });
	const [making, setMaking] = useState(false);
	const [removing, setRemoving] = useState<CustomVoice | null>(null);
	const [playing, setPlaying] = useState<string | null>(null);
	const audio = useRef<HTMLAudioElement | null>(null);
	useEffect(() => () => audio.current?.pause(), []);
	const refresh = () => {
		void qc.invalidateQueries({ queryKey: qk.customVoices });
		void qc.invalidateQueries({ queryKey: ["voice", "voices"] });
	};
	const remove = useMutation({
		mutationFn: (id: string) => api.voice.custom.delete(id),
		onSuccess: refresh,
		onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
	});
	const rename = useMutation({
		mutationFn: ({ id, name }: { id: string; name: string }) => api.voice.custom.rename(id, name),
		onSuccess: refresh,
	});
	const play = (v: CustomVoice) => {
		audio.current?.pause();
		if (playing === v.voiceId) {
			setPlaying(null);
			return;
		}
		const a = new Audio(api.voice.previewUrl({ model: v.model, voice: v.voiceId, cap: "tts", name: v.name }));
		a.onended = () => setPlaying(null);
		a.onerror = () => {
			setPlaying(null);
			toast.error("Couldn't play that voice");
		};
		audio.current = a;
		setPlaying(v.voiceId);
		void a.play().catch(() => setPlaying(null));
	};
	return (
		<Section
			title="Your voices"
			icon={<Wand2 />}
			description="Voices you made from a description or a recording. Pick them for any bot (Profile → Voice → Change)."
			action={
				<Button variant="secondary" size="sm" onClick={() => setMaking(true)}>
					<Wand2 /> Make a voice
				</Button>
			}
		>
			{isLoading ? (
				<Spinner />
			) : voices.length === 0 ? (
				<p className="text-[13px] text-fg-subtle">
					None yet. Describe one (“an old wizard, deep and gravelly”) or record someone who agrees to it.
				</p>
			) : (
				<div className="flex flex-col divide-y divide-border rounded-2xl border border-border bg-card">
					{voices.map((v) => (
						<div key={v.voiceId} className="flex items-center gap-3 px-3.5 py-2.5">
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label={playing === v.voiceId ? `Stop ${v.name}` : `Hear ${v.name}`}
								onClick={() => play(v)}
							>
								{playing === v.voiceId ? (
									<Square className="fill-current" />
								) : (
									<Play className="fill-current" />
								)}
							</Button>
							<div className="min-w-0 flex-1">
								<input
									defaultValue={v.name}
									aria-label="Voice name"
									maxLength={60}
									onBlur={(e) => {
										const name = e.target.value.trim();
										if (name && name !== v.name) rename.mutate({ id: v.voiceId, name });
									}}
									className="w-full truncate rounded-md bg-transparent text-sm font-medium outline-none focus:bg-muted focus:px-1.5"
								/>
								<div className="truncate text-xs text-fg-subtle">
									{v.kind === "fishaudio" ? "Fish Audio" : "ElevenLabs"} ·{" "}
									{v.source === "recording"
										? "from a recording"
										: v.description || "from a description"}{" "}
									· {timeAgo(v.createdAt)}
								</div>
							</div>
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label={`Delete ${v.name}`}
								onClick={() => setRemoving(v)}
							>
								<Trash2 />
							</Button>
						</div>
					))}
				</div>
			)}
			<MakeVoiceDialog
				open={making}
				onOpenChange={setMaking}
				onMade={(v) => toast.success(`Made ${v.name}. Pick it for a bot in its panel.`)}
			/>
			<Confirm
				open={removing !== null}
				onOpenChange={(o) => !o && setRemoving(null)}
				title={`Delete ${removing?.name}?`}
				description={
					removing?.kind === "elevenlabs"
						? "It's deleted from your ElevenLabs account too. Bots using it go back to their default voice."
						: "Bots using it go back to their default voice."
				}
				confirmLabel="Delete"
				danger
				onConfirm={() => removing && remove.mutate(removing.voiceId)}
			/>
		</Section>
	);
}

/** The speaking voice and speech-to-text model every bot starts with, each voice with a ▶ to hear it. */
function VoiceDefaults() {
	const qc = useQueryClient();
	const { data: v } = useVoiceSettings();
	const save = useMutation({
		mutationFn: (patch: VoiceSettingsUpdate) => api.voice.updateSettings(patch),
		onSuccess: (next) => {
			qc.setQueryData(qk.voiceSettings, next);
			void qc.invalidateQueries({ queryKey: ["voice", "agent"] });
			toast.success("Saved", { duration: 1200 });
		},
		onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
	});
	if (!v) return <Spinner />;
	return (
		<Section
			title="Defaults for every bot"
			icon={<AudioLines />}
			description="How your bots sound and listen. Each bot can pick its own in its panel (Profile → Voice)."
		>
			<VoiceSettingsEditor
				value={v}
				onChange={(patch) => save.mutate(patch as VoiceSettingsUpdate)}
				onError={(m) => toast.error(m)}
			/>
		</Section>
	);
}

export function VoicePanel() {
	return (
		<SettingsPanel
			value="voice"
			title="Voice"
			description="Talk with your bots: calls, reading messages aloud, and dictation, with ElevenLabs and Fish Audio."
		>
			<ApiProviders scope="voice" />
			<VoiceDefaults />
			<YourVoices />
			<Callout icon={<KeyRound />} title="Recording and consent">
				Calls and dictation send your microphone audio to the voice services you pick. Let people know before
				they're on a call or in a voice channel with a bot, and check the rules where you are.
			</Callout>
		</SettingsPanel>
	);
}
