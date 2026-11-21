import { api, MakeVoiceDialog, qk, timeAgo, useAccess, useVoiceSettings, VoiceSettingsEditor } from "@sekai/client";
import type { CustomVoice, VoiceSettingsUpdate } from "@sekai/shared";
import {
	Button,
	Confirm,
	Dialog,
	EmptyState,
	ErrorState,
	Field,
	Fold,
	IconButton,
	Input,
	List,
	Page,
	Row,
	SaveState,
	Section,
	SkeletonRows,
} from "@sekai/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Play, Square, Trash2, Wand2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { SettingsSectionProps } from "../section.ts";
import { ApiProviders } from "./ApiProviders.tsx";
import { usePatchAutosave } from "./common.tsx";

/** Voices you made: hear, rename or delete them, or make another. */
function YourVoices() {
	const qc = useQueryClient();
	const {
		data: voices = [],
		isLoading,
		isError,
		error,
		refetch,
	} = useQuery({ queryKey: qk.customVoices, queryFn: api.voice.custom.list });
	const [making, setMaking] = useState(false);
	const [renaming, setRenaming] = useState<CustomVoice | null>(null);
	const [renameValue, setRenameValue] = useState("");
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
	});
	const rename = useMutation({
		mutationFn: ({ id, name }: { id: string; name: string }) => api.voice.custom.rename(id, name),
		onSuccess: () => {
			refresh();
			setRenaming(null);
		},
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
			toast.error("Couldn't play that voice.");
		};
		audio.current = a;
		setPlaying(v.voiceId);
		void a.play().catch(() => setPlaying(null));
	};

	return (
		<Section
			title="Your voices"
			description="Custom voices from a description or recording. Pick them in any bot's Model & voice."
			action={
				voices.length > 0 ? (
					<Button variant="secondary" size="sm" onClick={() => setMaking(true)}>
						<Wand2 /> Make a voice
					</Button>
				) : undefined
			}
		>
			{isLoading ? (
				<SkeletonRows count={2} />
			) : isError ? (
				<ErrorState size="sm" title="Your voices didn't load" error={error} onRetry={() => void refetch()} />
			) : voices.length === 0 ? (
				<EmptyState
					size="sm"
					icon={<Wand2 />}
					title="No custom voices yet"
					description="Describe a voice (“an old wizard, deep and gravelly”) or record someone with their permission."
					action={
						<Button variant="secondary" size="sm" onClick={() => setMaking(true)}>
							<Wand2 /> Make a voice
						</Button>
					}
					className="rounded-lg border border-dashed border-border"
				/>
			) : (
				<List label="Your voices">
					{voices.map((v) => (
						<Row
							key={v.voiceId}
							leading={
								<IconButton
									variant="ghost"
									size="icon-sm"
									label={playing === v.voiceId ? `Stop ${v.name}` : `Hear ${v.name}`}
									onClick={() => play(v)}
								>
									{playing === v.voiceId ? (
										<Square className="fill-current" />
									) : (
										<Play className="fill-current" />
									)}
								</IconButton>
							}
							title={v.name}
							subtitle={`${v.kind === "fishaudio" ? "Fish Audio" : "ElevenLabs"} · ${
								v.source === "recording" ? "from a recording" : v.description || "from a description"
							} · ${timeAgo(v.createdAt)}`}
							menuLabel={`Actions for ${v.name}`}
							menu={[
								{
									label: "Rename",
									icon: <Pencil />,
									onSelect: () => {
										setRenaming(v);
										setRenameValue(v.name);
									},
								},
								"-",
								{
									label: "Delete",
									icon: <Trash2 />,
									danger: true,
									onSelect: () => setRemoving(v),
								},
							]}
						/>
					))}
				</List>
			)}

			<MakeVoiceDialog
				open={making}
				onOpenChange={setMaking}
				onMade={(v) => toast.success(`Created ${v.name}. Pick it in any bot's Model & voice settings.`)}
			/>

			<Dialog
				open={renaming !== null}
				onOpenChange={(o) => !o && setRenaming(null)}
				size="sm"
				title="Rename voice"
				footer={
					<>
						<Button variant="ghost" onClick={() => setRenaming(null)}>
							Cancel
						</Button>
						<Button
							variant="primary"
							loading={rename.isPending}
							disabled={!renameValue.trim() || renameValue.trim() === renaming?.name}
							onClick={() =>
								renaming && rename.mutate({ id: renaming.voiceId, name: renameValue.trim() })
							}
						>
							Save
						</Button>
					</>
				}
			>
				<Field label="Voice name">
					<Input
						value={renameValue}
						onChange={(e) => setRenameValue(e.target.value)}
						maxLength={60}
						onKeyDown={(e) => {
							if (e.key === "Enter" && renaming && renameValue.trim()) {
								rename.mutate({ id: renaming.voiceId, name: renameValue.trim() });
							}
						}}
					/>
				</Field>
			</Dialog>

			<Confirm
				open={removing !== null}
				onOpenChange={(o) => !o && setRemoving(null)}
				title={`Delete ${removing?.name}?`}
				description={
					removing?.kind === "elevenlabs"
						? "It's deleted from your ElevenLabs account too. Bots using it switch back to their default voice."
						: "Bots using it switch back to their default voice."
				}
				confirmLabel="Delete"
				danger
				onConfirm={() => removing && remove.mutate(removing.voiceId)}
			/>
		</Section>
	);
}

/** Default voice settings for every bot. */
function VoiceDefaults() {
	const qc = useQueryClient();
	const { data: v, isLoading, isError, error, refetch } = useVoiceSettings();
	const autosave = usePatchAutosave(async (patch: VoiceSettingsUpdate) => {
		const next = await api.voice.updateSettings(patch);
		qc.setQueryData(qk.voiceSettings, next);
		void qc.invalidateQueries({ queryKey: ["voice", "agent"] });
		return next;
	});

	if (isLoading) return <SkeletonRows count={3} />;
	if (isError || !v) {
		return (
			<Section title="Defaults for every bot">
				<ErrorState size="sm" title="Voice defaults didn't load" error={error} onRetry={() => void refetch()} />
			</Section>
		);
	}

	return (
		<Section
			title="Defaults for every bot"
			description="How your bots sound and listen. Each bot can override this in Model & voice."
			saveState={<SaveState state={autosave} />}
		>
			<VoiceSettingsEditor
				value={v}
				onChange={(patch) => autosave.save(patch as VoiceSettingsUpdate)}
				onError={(m) => toast.error(m)}
				setup="Add ElevenLabs or Fish Audio above, then pick the voices here."
			/>
		</Section>
	);
}

export function VoiceSection({ back, readOnly }: SettingsSectionProps) {
	const { admin } = useAccess();
	const isAdmin = admin && !readOnly;

	return (
		<Page back={back} title="Voice" description="Calls, reading messages aloud and dictation.">
			{isAdmin && (
				<>
					<ApiProviders scope="voice" />
					<VoiceDefaults />
				</>
			)}
			<YourVoices />
			<Fold variant="link" title="About recording and consent">
				Calls and dictation send your microphone audio to the voice services you choose (ElevenLabs or Fish
				Audio). Let people know before they join a call or voice channel with a bot, and follow the recording
				rules where you live.
			</Fold>
		</Page>
	);
}
