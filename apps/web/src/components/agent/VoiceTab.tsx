import { adminUrl, api, qk, useVoiceSettings, VoiceSettingsEditor } from "@sekai/client";
import { type Agent, type AgentVoice, resolveVoice } from "@sekai/shared";
import { Spinner } from "@sekai/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { toast } from "sonner";

/** How this bot sounds and listens: its own speaking voice and speech-to-text model, or the defaults. */
export function VoiceTab({ agent }: { agent: Agent }) {
	const qc = useQueryClient();
	const { data: defaults } = useVoiceSettings();
	const own = agent.models.voice;
	const update = useMutation({
		mutationFn: (voice: AgentVoice) => api.agents.update(agent.id, { models: { ...agent.models, voice } }),
		onSuccess: () => void qc.invalidateQueries({ queryKey: qk.agentVoice(agent.id) }),
		onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
	});
	if (!defaults) return <Spinner />;
	return (
		<div className="flex flex-col gap-3">
			<p className="text-[13px] leading-5 text-fg-subtle">
				Give {agent.name} its own voice, or leave anything on Default to use{" "}
				<a
					href={adminUrl("voice")}
					className="inline-flex items-center gap-0.5 font-medium text-brand-ink hover:underline"
				>
					Admin → Voice <ExternalLink className="size-3" />
				</a>
				. Voices come from ElevenLabs or Fish Audio, added there.
			</p>
			<VoiceSettingsEditor
				value={resolveVoice(defaults, own)}
				own={own}
				defaults={defaults}
				onChange={(patch) => update.mutate({ ...own, ...patch })}
				onError={(m) => toast.error(m)}
			/>
		</div>
	);
}
