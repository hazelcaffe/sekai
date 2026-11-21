import {
	type ApiKind,
	apiModelId,
	parseApiModel,
	type VoiceCap,
	type VoiceInfo,
	type VoiceModelInfo,
} from "@sekai/shared";
import { badRequest } from "../lib/errors.ts";
import { apiVoiceModels, voiceProvider } from "../llm/api-providers.ts";
import { customVoiceInfos } from "./custom.ts";
import type { VoiceEndpoint } from "./providers/common.ts";
import { isLiveScribe, listElevenLabsVoices } from "./providers/elevenlabs.ts";
import { searchFishVoices } from "./providers/fish.ts";

/** Where a voice model runs: a voice service you added (ElevenLabs or Fish Audio). */
export interface VoiceBackend {
	kind: ApiKind;
	model: string;
	providerId: string;
	endpoint: VoiceEndpoint;
}

/** "api_abc::eleven_flash_v2_5" → how to reach it. */
export async function backendOf(id: string): Promise<VoiceBackend> {
	const api = parseApiModel(id);
	if (!api) throw badRequest(id ? `Unknown voice model: ${id}` : "No voice model picked yet (Settings → Voice)");
	const { kind, endpoint } = await voiceProvider(api.providerId);
	return { kind, model: api.model, providerId: api.providerId, endpoint };
}

/** Every voice model you can use: ElevenLabs' and Fish Audio's. */
export async function listVoiceModels(): Promise<VoiceModelInfo[]> {
	return (await apiVoiceModels()).map((v) => ({
		id: apiModelId(v.providerId, v.model.id),
		name: v.model.name || v.model.id,
		cap: v.model.type as VoiceCap,
		source: v.providerName,
		kind: v.kind,
		searchable: true,
		live: v.kind === "elevenlabs" && isLiveScribe(v.model.id),
	}));
}

/** The voices a model can speak with: ElevenLabs' and Fish Audio's are searched. */
export async function listVoices(id: string, query = ""): Promise<VoiceInfo[]> {
	const b = await backendOf(id);
	switch (b.kind) {
		case "elevenlabs":
			return listElevenLabsVoices(b.endpoint, query.trim());
		case "fishaudio": {
			// Voices you made in Sekai first.
			const [mine, found] = await Promise.all([
				customVoiceInfos(b.providerId, query),
				searchFishVoices(b.endpoint, query),
			]);
			return [...mine, ...found];
		}
		default:
			return [];
	}
}
