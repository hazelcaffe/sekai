import { Page } from "@sekai/ui";
import { ModelSettings } from "../../components/agent/ModelSettings.tsx";
import { BotVoice } from "../../components/agent/VoiceSettings.tsx";
import type { BotSectionProps } from "../section.ts";

/** How the bot thinks (its model, limits, how models combine) and how it listens and sounds on calls. */
export function ModelVoiceSection({ agent, back }: BotSectionProps) {
	return (
		<Page
			back={back}
			title="Model & voice"
			description={`What ${agent.name} thinks with, and how it sounds on calls.`}
		>
			<ModelSettings agent={agent} />
			<BotVoice agent={agent} />
		</Page>
	);
}
