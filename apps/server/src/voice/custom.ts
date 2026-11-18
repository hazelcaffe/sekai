import { randomBytes } from "node:crypto";
import { rmSync } from "node:fs";
import { apiModelId, type CustomVoice, type VoiceCandidate, type VoiceInfo } from "@sekai/shared";
import { eq } from "drizzle-orm";
import { currentActor, runAs } from "../auth/actor.ts";
import { db, schema } from "../db/index.ts";
import { badRequest, HttpError, notFound } from "../lib/errors.ts";
import { log } from "../lib/log.ts";
import { apiVoiceModels, voiceProvider } from "../llm/api-providers.ts";
import { readKey, writeKey } from "../services/kv.ts";
import { getUploadRow, saveUpload } from "../services/uploads.ts";
import { pcmToWav, RATE } from "./pcm.ts";
import { type VoiceEndpoint, voiceError } from "./providers/common.ts";
import { fishTranscribe } from "./providers/fish.ts";

/**
 * Voices you make: from a description (the service designs a few, you keep one) or from a recording of a voice
 * you may use.
 * - Fish Audio: Sekai keeps the voice itself (a short reference clip and its words) and sends it with each line
 *   to speak, so it works on any Fish plan and nothing is stored in your Fish account.
 * - ElevenLabs: the voice is saved in your ElevenLabs account (their plans decide whether you can).
 */

/** Voice ids of voices Sekai keeps (Fish Audio). */
export const CUSTOM_PREFIX = "sekai:";
const KEY = "voice.custom";
const CANDIDATE_TTL = 30 * 60_000;
/** Fish uses 10–30 s best; longer only slows every line down. */
const MAX_REFERENCE_SECS = 30;
const MIN_REFERENCE_SECS = 5;

interface Stored extends CustomVoice {
	/** Fish: the reference clip (an upload) and what's said in it. */
	uploadId?: string;
	text?: string;
	/** Who made it (they and admins may rename or delete it; everyone's bots may speak with it). */
	userId?: string | null;
}

interface Candidate {
	providerId: string;
	kind: "fishaudio" | "elevenlabs";
	description: string;
	audio: Uint8Array;
	mime: string;
	text: string;
	/** ElevenLabs keeps the designed voice until it's saved. */
	generatedVoiceId?: string;
	expires: number;
}

const candidates = new Map<string, Candidate>();
const references = new Map<string, { audio: Uint8Array; text: string }>();

async function all(): Promise<Stored[]> {
	return ((await readKey(KEY)) as Stored[] | undefined) ?? [];
}

async function save(list: Stored[]): Promise<void> {
	await writeKey(KEY, list);
}

const toPublic = ({ uploadId: _u, text: _t, ...v }: Stored): CustomVoice => v;

export async function listCustomVoices(providerId?: string): Promise<CustomVoice[]> {
	return (await all()).filter((v) => !providerId || v.providerId === providerId).map(toPublic);
}

/** Sekai's own voices for a Fish provider, as picker entries (searched by name). */
export async function customVoiceInfos(providerId: string, query = ""): Promise<VoiceInfo[]> {
	const q = query.trim().toLowerCase();
	return (await listCustomVoices(providerId))
		.filter((v) => v.voiceId.startsWith(CUSTOM_PREFIX))
		.filter((v) => !q || `${v.name} ${v.description}`.toLowerCase().includes(q))
		.map((v) => ({
			id: v.voiceId,
			name: v.name,
			description: `Yours · ${v.source === "recording" ? "from a recording" : v.description || "designed"}`,
		}));
}

/** The clip and words a Sekai voice speaks from (for Fish Audio's text to speech). */
export async function customReference(voiceId: string): Promise<{ audio: Uint8Array; text: string }> {
	const hit = references.get(voiceId);
	if (hit) return hit;
	const v = (await all()).find((x) => x.voiceId === voiceId);
	if (!v?.uploadId) throw badRequest("That voice was deleted. Pick another one.");
	const uploadId = v.uploadId;
	// Any bot may speak with it, whoever made the clip.
	const row = await runAs(null, () => getUploadRow(uploadId));
	const ref = { audio: new Uint8Array(await Bun.file(row.path).arrayBuffer()), text: v.text ?? "" };
	references.set(voiceId, ref);
	return ref;
}

async function service(providerId: string): Promise<{ kind: "fishaudio" | "elevenlabs"; endpoint: VoiceEndpoint }> {
	const { kind, endpoint } = await voiceProvider(providerId);
	if (kind !== "fishaudio" && kind !== "elevenlabs")
		throw badRequest("Voices can be made with Fish Audio or ElevenLabs");
	return { kind, endpoint };
}

/** A speech model of the provider to use the new voice with. */
async function speechModel(providerId: string): Promise<string> {
	const models = (await apiVoiceModels()).filter((m) => m.providerId === providerId && m.model.type === "tts");
	const pick =
		models.find((m) => /free/.test(m.model.id)) ??
		models.find((m) => /multilingual_v2|flash_v2_5/.test(m.model.id)) ??
		models[0];
	if (!pick) throw badRequest("That service has no speech models");
	return apiModelId(providerId, pick.model.id);
}

const elHeaders = (e: VoiceEndpoint, json = true) => ({
	"xi-api-key": e.apiKey,
	...(json ? { "content-type": "application/json" } : {}),
	...e.headers,
});
const fishHeaders = (e: VoiceEndpoint) => ({ authorization: `Bearer ${e.apiKey}`, ...e.headers });

/** ElevenLabs refuses on free plans: say so plainly. */
async function elevenLabsError(res: Response, label: string): Promise<Error> {
	const err = await voiceError(res, label);
	if (/paid plan|paid_plan|upgrade your plan|feature_not_available|can_not_use/i.test(err.message)) {
		return new Error(
			`${label}: making voices needs a paid ElevenLabs plan. Fish Audio can make them on any plan (add it in Admin → Voice).`,
		);
	}
	return err;
}

function remember(c: Omit<Candidate, "expires">): string {
	const now = Date.now();
	for (const [id, x] of candidates) if (x.expires < now) candidates.delete(id);
	const id = `cand_${randomBytes(8).toString("hex")}`;
	candidates.set(id, { ...c, expires: now + CANDIDATE_TTL });
	return id;
}

/** Voices made from a description: a few to choose from (nothing is saved yet). */
export async function designVoice(input: {
	providerId: string;
	description: string;
	text?: string;
	language?: string;
}): Promise<{ candidates: VoiceCandidate[] }> {
	const description = input.description.trim();
	if (description.length < 8) throw badRequest("Describe the voice in a few words (who, age, accent, mood…)");
	const { kind, endpoint } = await service(input.providerId);
	if (kind === "fishaudio") {
		const res = await fetch(`${endpoint.url}/v1/voice-design`, {
			method: "POST",
			headers: { ...fishHeaders(endpoint), "content-type": "application/json", model: "voice-design-1" },
			body: JSON.stringify({
				instruction: description.slice(0, 2000),
				reference_text:
					input.text?.trim().slice(0, 150) ||
					"Hi! This is how I sound. I can read your messages and talk with you on calls.",
				...(input.language ? { language: input.language } : {}),
				n: 3,
			}),
			signal: AbortSignal.timeout(120_000),
		});
		if (!res.ok) throw await voiceError(res, endpoint.label);
		const body = (await res.json()) as {
			candidates: {
				audio_base64: string;
				duration_ms: number;
				text?: string;
				features?: Record<string, string>;
			}[];
		};
		return {
			candidates: body.candidates.map((c) => {
				const audio = new Uint8Array(Buffer.from(c.audio_base64, "base64"));
				const text = c.text ?? input.text ?? "";
				const f = c.features ?? {};
				return {
					id: remember({ providerId: input.providerId, kind, description, audio, mime: "audio/wav", text }),
					audio: `data:audio/wav;base64,${c.audio_base64}`,
					durationMs: c.duration_ms,
					text,
					traits: [f.gender, f.age, f.accent, f.tone].filter(Boolean).join(" · ") || undefined,
				};
			}),
		};
	}
	const text = input.text?.trim();
	const res = await fetch(`${endpoint.url}/v1/text-to-voice/design`, {
		method: "POST",
		headers: elHeaders(endpoint),
		body: JSON.stringify({
			voice_description: description.slice(0, 1000),
			...(text && text.length >= 100 ? { text } : { auto_generate_text: true }),
		}),
		signal: AbortSignal.timeout(120_000),
	});
	if (!res.ok) throw await elevenLabsError(res, endpoint.label);
	const body = (await res.json()) as {
		text: string;
		previews: { audio_base_64: string; generated_voice_id: string; media_type: string; duration_secs: number }[];
	};
	return {
		candidates: body.previews.map((p) => ({
			id: remember({
				providerId: input.providerId,
				kind,
				description,
				audio: new Uint8Array(Buffer.from(p.audio_base_64, "base64")),
				mime: p.media_type,
				text: body.text,
				generatedVoiceId: p.generated_voice_id,
			}),
			audio: `data:${p.media_type || "audio/mpeg"};base64,${p.audio_base_64}`,
			durationMs: Math.round(p.duration_secs * 1000),
			text: body.text,
		})),
	};
}

async function keep(v: Stored): Promise<CustomVoice> {
	const list = await all();
	list.push({ ...v, userId: currentActor()?.userId ?? null });
	await save(list);
	log.info(`made a voice: ${v.name} (${v.kind}, from a ${v.source})`);
	return toPublic(v);
}

/** Keeps one of the designed voices under a name. */
export async function saveDesignedVoice(input: { candidateId: string; name: string }): Promise<CustomVoice> {
	const c = candidates.get(input.candidateId);
	if (!c || c.expires < Date.now()) throw badRequest("That sample expired. Make the voices again.");
	const name = input.name.trim().slice(0, 60) || "My voice";
	const model = await speechModel(c.providerId);
	if (c.kind === "fishaudio") {
		const upload = await saveUpload(c.audio, `${name}.wav`, c.mime);
		const id = `${CUSTOM_PREFIX}${randomBytes(6).toString("hex")}`;
		candidates.delete(input.candidateId);
		return keep({
			voiceId: id,
			providerId: c.providerId,
			kind: c.kind,
			name,
			description: c.description.slice(0, 200),
			source: "description",
			model,
			createdAt: Date.now(),
			uploadId: upload.id,
			text: c.text,
		});
	}
	const { endpoint } = await service(c.providerId);
	const res = await fetch(`${endpoint.url}/v1/text-to-voice`, {
		method: "POST",
		headers: elHeaders(endpoint),
		body: JSON.stringify({
			voice_name: name,
			voice_description: c.description.slice(0, 1000),
			generated_voice_id: c.generatedVoiceId,
		}),
	});
	if (!res.ok) throw await elevenLabsError(res, endpoint.label);
	const saved = (await res.json()) as { voice_id: string };
	candidates.delete(input.candidateId);
	return keep({
		voiceId: saved.voice_id,
		providerId: c.providerId,
		kind: c.kind,
		name,
		description: c.description.slice(0, 200),
		source: "description",
		model,
		createdAt: Date.now(),
	});
}

/** A voice from a recording (24 kHz mono PCM) of someone who agreed to it. */
export async function cloneVoice(input: {
	providerId: string;
	name: string;
	pcm: Uint8Array;
	consent: boolean;
	transcribe?: (pcm: Uint8Array) => Promise<string>;
}): Promise<CustomVoice> {
	if (!input.consent) throw badRequest("Only use a voice that's yours, or that you have permission to use");
	const secs = input.pcm.length / 2 / RATE;
	if (secs < MIN_REFERENCE_SECS)
		throw badRequest(`Record at least ${MIN_REFERENCE_SECS} seconds of speech (10–30 is best)`);
	const pcm = input.pcm.subarray(0, MAX_REFERENCE_SECS * RATE * 2);
	const wav = pcmToWav(pcm);
	const name = input.name.trim().slice(0, 60) || "My voice";
	const { kind, endpoint } = await service(input.providerId);
	const model = await speechModel(input.providerId);
	if (kind === "fishaudio") {
		// Fish speaks best when it knows what the clip says.
		let text = "";
		try {
			text = await fishTranscribe(endpoint, { pcm });
		} catch (err) {
			if (input.transcribe) text = await input.transcribe(pcm).catch(() => "");
			else log.warn(`couldn't write down the recording: ${String(err)}`);
		}
		const upload = await saveUpload(wav, `${name}.wav`, "audio/wav");
		return keep({
			voiceId: `${CUSTOM_PREFIX}${randomBytes(6).toString("hex")}`,
			providerId: input.providerId,
			kind,
			name,
			description: "",
			source: "recording",
			model,
			createdAt: Date.now(),
			uploadId: upload.id,
			text,
		});
	}
	const form = new FormData();
	form.set("name", name);
	form.append("files", new Blob([wav], { type: "audio/wav" }), "recording.wav");
	const res = await fetch(`${endpoint.url}/v1/voices/add`, {
		method: "POST",
		headers: elHeaders(endpoint, false),
		body: form,
	});
	if (!res.ok) throw await elevenLabsError(res, endpoint.label);
	const saved = (await res.json()) as { voice_id: string; requires_verification?: boolean };
	if (saved.requires_verification) {
		log.warn(`ElevenLabs wants ${name} verified before it can be used (elevenlabs.io → Voices)`);
	}
	return keep({
		voiceId: saved.voice_id,
		providerId: input.providerId,
		kind,
		name,
		description: "",
		source: "recording",
		model,
		createdAt: Date.now(),
	});
}

/** Deletes a voice you made (from ElevenLabs too, for theirs). */
/** Only the person who made a voice, or an admin, changes it. */
function requireMaker(v: Stored): void {
	const actor = currentActor();
	if (actor && !actor.admin && v.userId && v.userId !== actor.userId) {
		throw new HttpError(403, "Only the person who made this voice (or an admin) can change it.");
	}
}

export async function deleteCustomVoice(voiceId: string): Promise<void> {
	const list = await all();
	const v = list.find((x) => x.voiceId === voiceId);
	if (!v) throw notFound("Voice");
	requireMaker(v);
	if (v.kind === "elevenlabs") {
		const { endpoint } = await service(v.providerId).catch(() => ({ endpoint: null }));
		if (endpoint) {
			const res = await fetch(`${endpoint.url}/v1/voices/${encodeURIComponent(v.voiceId)}`, {
				method: "DELETE",
				headers: elHeaders(endpoint, false),
			});
			if (!res.ok && res.status !== 404) throw await voiceError(res, endpoint.label);
		}
	}
	if (v.uploadId) {
		const uploadId = v.uploadId;
		const row = await runAs(null, () => getUploadRow(uploadId)).catch(() => null);
		if (row) {
			rmSync(row.path, { force: true });
			await db.delete(schema.uploads).where(eq(schema.uploads.id, v.uploadId));
		}
	}
	references.delete(voiceId);
	await save(list.filter((x) => x.voiceId !== voiceId));
}

export async function renameCustomVoice(voiceId: string, name: string): Promise<CustomVoice> {
	const list = await all();
	const v = list.find((x) => x.voiceId === voiceId);
	if (!v) throw notFound("Voice");
	requireMaker(v);
	v.name = name.trim().slice(0, 60) || v.name;
	await save(list);
	return toPublic(v);
}
