import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { VoiceCap } from "@sekai/shared";
import { config } from "../config.ts";
import { backendOf } from "./catalog.ts";
import { pcmToWav } from "./pcm.ts";
import { elevenLabsPreviewUrl } from "./providers/elevenlabs.ts";
import { fishSampleUrl } from "./providers/fish.ts";
import { speakAll } from "./tts.ts";

const DIR = join(config.dataDir, "voice-previews");
const pending = new Map<string, Promise<{ file: string; type: string }>>();

const line = (name: string) =>
	`Hi, I'm ${name || "your bot"}. This is how I'll sound when you call me or play one of my messages.`;

/**
 * A short sample of a voice: the provider's own sample when it has one, otherwise a line made once with the
 * model and kept on the server.
 */
export async function voicePreview(opts: {
	model: string;
	voice: string;
	cap: VoiceCap;
	name?: string;
}): Promise<{ file: string; type: string }> {
	const key = createHash("sha256").update(`${opts.model}|${opts.voice}|${opts.cap}`).digest("hex").slice(0, 24);
	for (const [ext, type] of [
		["wav", "audio/wav"],
		["mp3", "audio/mpeg"],
	] as const) {
		const file = join(DIR, `${key}.${ext}`);
		if (existsSync(file)) return { file, type };
	}
	let p = pending.get(key);
	if (!p) {
		p = (async () => {
			mkdirSync(DIR, { recursive: true });
			const b = await backendOf(opts.model);
			const sample =
				b.kind === "elevenlabs"
					? await elevenLabsPreviewUrl(b.endpoint, opts.voice)
					: b.kind === "fishaudio"
						? fishSampleUrl(opts.voice)
						: null;
			if (sample) {
				const res = await fetch(sample);
				if (res.ok) {
					const file = join(DIR, `${key}.mp3`);
					await Bun.write(file, await res.arrayBuffer());
					return { file, type: "audio/mpeg" };
				}
			}
			const name = (opts.name || opts.voice || "").split(/\s+[-–(]/)[0]?.trim() ?? "";
			const pcm = await speakAll({ model: opts.model, voice: opts.voice, text: line(name) });
			if (pcm.length < 12_000) throw new Error("The voice model didn't say anything");
			const file = join(DIR, `${key}.wav`);
			await Bun.write(file, pcmToWav(pcm));
			return { file, type: "audio/wav" };
		})().finally(() => pending.delete(key));
		pending.set(key, p);
	}
	return p;
}
