import {
	type Agent,
	resolveVoice,
	VoiceSettings,
	type VoiceSettings as VoiceSettingsT,
	VoiceSettingsUpdate,
} from "@sekai/shared";
import { bus } from "../events/bus.ts";
import { parse } from "../lib/errors.ts";
import { getAgent } from "../services/agents.ts";
import { readKey, writeKey } from "../services/kv.ts";

const KEY = "voice";
let cache: VoiceSettingsT | null = null;

/** Voice defaults for every bot (Settings → Voice). */
export async function voiceSettings(): Promise<VoiceSettingsT> {
	if (cache) return cache;
	// Settings saved by older versions may carry fields and models that are gone: parsing drops them.
	const parsed = VoiceSettings.parse((await readKey(KEY)) ?? {});
	cache = parsed.ttsModel ? parsed : { ...parsed, ttsVoice: "", ttsVoiceName: "" };
	return cache;
}

export async function updateVoiceSettings(input: unknown): Promise<VoiceSettingsT> {
	const patch = parse(VoiceSettingsUpdate, input);
	const current = await voiceSettings();
	const next = VoiceSettings.parse({ ...current, ...patch });
	// A new model starts with its own voice, unless one came with it.
	if ((patch.ttsModel !== undefined && patch.ttsModel !== current.ttsModel && !patch.ttsVoice) || !next.ttsModel) {
		next.ttsVoice = "";
		next.ttsVoiceName = "";
	}
	await writeKey(KEY, next);
	cache = next;
	bus.emit({ type: "settings.changed" });
	return next;
}

/** A bot's voice with the defaults filled in. */
export async function voiceFor(agent: Agent | string | null | undefined): Promise<VoiceSettingsT> {
	const defaults = await voiceSettings();
	const a = typeof agent === "string" ? await getAgent(agent) : agent;
	return resolveVoice(defaults, a?.models.voice);
}

/** For tests. */
export function resetVoiceSettings(): void {
	cache = null;
}
