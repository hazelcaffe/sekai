import { createHash } from "node:crypto";
import { existsSync, mkdirSync, renameSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { messageText, speakableText } from "@sekai/shared";
import { config } from "../config.ts";
import { badRequest, errorMessage, notFound } from "../lib/errors.ts";
import { log } from "../lib/log.ts";
import { getMessage } from "../services/messages.ts";
import { voiceFor } from "./settings.ts";
import { speak } from "./tts.ts";

const DIR = join(config.dataDir, "voice-cache");

/** The reply's audio format: raw 24 kHz mono 16-bit PCM, streamed. */
export const SPEECH_HEADERS = {
	"content-type": "application/octet-stream",
	"x-audio-format": "pcm_s16le;rate=24000;channels=1",
	"cache-control": "no-store",
};

/**
 * Text read out in a bot's voice, as a stream of 24 kHz PCM. The first time it streams as it's made (and is
 * kept); after that it comes from disk.
 */
export async function speechStream(opts: {
	text: string;
	agentId: string | null;
	signal?: AbortSignal;
}): Promise<ReadableStream<Uint8Array>> {
	const text = speakableText(opts.text);
	if (!text) throw badRequest("There's nothing to read out");
	const v = await voiceFor(opts.agentId);
	const model = v.ttsModel;
	const voice = v.ttsVoice;
	if (!model) throw badRequest("No speaking voice picked yet (Settings → Voice, or the bot's Model & voice)");
	const key = createHash("sha256").update(`${model}|${voice}|${v.language}|${text}`).digest("hex").slice(0, 32);
	const file = join(DIR, `${key}.pcm`);
	if (existsSync(file)) {
		// Played again: keep it (housekeeping drops audio nobody played for a month).
		const now = new Date();
		utimesSync(file, now, now);
		return Bun.file(file).stream();
	}

	const chunks: Uint8Array[] = [];
	const abort = new AbortController();
	opts.signal?.addEventListener("abort", () => abort.abort());
	const gen = speak({ model, voice, text, language: v.language, signal: abort.signal });
	return new ReadableStream<Uint8Array>({
		async pull(controller) {
			try {
				const { done, value } = await gen.next();
				if (done) {
					controller.close();
					if (!abort.signal.aborted && chunks.length) {
						mkdirSync(DIR, { recursive: true });
						// Own temp name: two first reads of the same text may finish together.
						const part = `${file}.${crypto.randomUUID().slice(0, 8)}.part`;
						await Bun.write(part, Buffer.concat(chunks));
						renameSync(part, file);
					}
					return;
				}
				chunks.push(value);
				controller.enqueue(value);
			} catch (err) {
				log.warn(`reading aloud failed: ${errorMessage(err)}`);
				controller.error(err);
			}
		},
		cancel() {
			abort.abort();
			void gen.return(undefined);
		},
	});
}

/** A message in its bot's voice. */
export async function messageSpeech(messageId: string, signal?: AbortSignal): Promise<ReadableStream<Uint8Array>> {
	const m = await getMessage(messageId);
	if (!m) throw notFound("Message");
	return speechStream({ text: messageText(m), agentId: m.agentId, signal });
}
