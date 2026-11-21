import { speechChunks } from "@sekai/shared";
import { backendOf, type VoiceBackend } from "./catalog.ts";
import { elevenLabsSpeech } from "./providers/elevenlabs.ts";
import { fishSpeech } from "./providers/fish.ts";

export interface SpeakOptions {
	/** A text-to-speech model id. */
	model: string;
	voice: string;
	text: string;
	language?: string;
	signal?: AbortSignal;
}

/** The longest text each service takes in one go (shorter pieces also start playing sooner). */
function maxChars(b: VoiceBackend): number {
	return b.kind === "fishaudio" ? 1500 : 2500;
}

async function* once(b: VoiceBackend, o: SpeakOptions, text: string, previous: string): AsyncGenerator<Uint8Array> {
	switch (b.kind) {
		case "elevenlabs":
			yield* elevenLabsSpeech(b.endpoint, {
				model: b.model,
				voice: o.voice,
				text,
				language: o.language,
				previousText: previous,
				signal: o.signal,
			});
			return;
		case "fishaudio":
			yield* fishSpeech(b.endpoint, { model: b.model, voice: o.voice, text, signal: o.signal });
			return;
		default:
			throw new Error(`${b.endpoint.label} can't speak`);
	}
}

/** Text to speech, streamed as 24 kHz mono 16-bit PCM. Long text is read piece by piece. */
export async function* speak(o: SpeakOptions): AsyncGenerator<Uint8Array> {
	const text = o.text.trim();
	if (!text) return;
	if (!o.model) throw new Error("No speaking voice picked yet (Settings → Voice, or the bot's Model & voice)");
	const b = await backendOf(o.model);
	let previous = "";
	for (const piece of speechChunks(text, maxChars(b))) {
		if (o.signal?.aborted) return;
		yield* once(b, o, piece, previous);
		previous = piece;
	}
}

/** All of it at once. */
export async function speakAll(o: SpeakOptions): Promise<Uint8Array> {
	const chunks: Uint8Array[] = [];
	for await (const c of speak(o)) chunks.push(c);
	return new Uint8Array(Buffer.concat(chunks));
}
