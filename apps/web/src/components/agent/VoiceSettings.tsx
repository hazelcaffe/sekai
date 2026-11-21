import { settingsUrl, useAccess, useVoiceSettings, VoiceSettingsEditor } from "@sekai/client";
import { type Agent, type AgentVoice, resolveVoice } from "@sekai/shared";
import { ErrorState, Link, SaveState, Section, SkeletonRows, useAutosave } from "@sekai/ui";
import { toast } from "sonner";
import { useAgentUpdate } from "../../bots/useAgentUpdate.ts";

/** How this bot sounds and listens: its own speaking voice and speech-to-text model, or the defaults. */
export function BotVoice({ agent }: { agent: Agent }) {
	const voice = useVoiceSettings();
	const { admin, can } = useAccess();
	const update = useAgentUpdate(agent);
	const own = agent.models.voice;
	const state = useAutosave((next: AgentVoice) => update({ models: { ...agent.models, voice: next } }));
	const defaults = voice.data;
	// Calls, voice messages and their voices are a feature of the role (the server checks the same).
	if (!can("voice")) {
		return (
			<Section title="Voice">
				<p className="text-small text-fg-muted">
					Calls and voice messages aren't part of your role. Ask an admin if you'd like them.
				</p>
			</Section>
		);
	}
	return (
		<Section
			title="Voice"
			description={
				admin ? (
					<>
						How it listens and sounds on calls. Defaults and voice services (ElevenLabs, Fish Audio) are in{" "}
						<Link href={settingsUrl("voice")} className="font-medium text-brand-ink hover:underline">
							Voice settings
						</Link>
						.
					</>
				) : (
					"How it listens and sounds on calls. Anything on Default follows your server's voice."
				)
			}
			saveState={state.status !== "idle" ? <SaveState state={state} /> : undefined}
		>
			{defaults ? (
				<VoiceSettingsEditor
					value={resolveVoice(defaults, own)}
					own={own}
					defaults={defaults}
					onChange={(patch) => state.save({ ...own, ...patch })}
					onError={(message) => toast.error(message)}
				/>
			) : voice.isError ? (
				<ErrorState size="sm" error={voice.error} onRetry={() => void voice.refetch()} />
			) : (
				<SkeletonRows count={3} leading={false} />
			)}
		</Section>
	);
}
