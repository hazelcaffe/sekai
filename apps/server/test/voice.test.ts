import { describe, expect, test } from "bun:test";
import { AgentModels, resolveVoice, speakableText, speechChunks, VoiceSettings } from "@sekai/shared";
import { parseWav, pcmToWav, RATE, SpeechDetector, wavToPcm } from "../src/voice/pcm.ts";
import { pcmFrom } from "../src/voice/providers/common.ts";

function tone(seconds: number, rate = RATE, amp = 0.3): Uint8Array<ArrayBuffer> {
	const n = Math.floor(seconds * rate);
	const b = Buffer.alloc(n * 2);
	for (let i = 0; i < n; i++)
		b.writeInt16LE(Math.round(Math.sin((i / rate) * 2 * Math.PI * 220) * amp * 0x7fff), i * 2);
	return new Uint8Array(b);
}
const silence = (seconds: number) => new Uint8Array(Math.floor(seconds * RATE) * 2);

describe("speakable text", () => {
	test("drops Markdown, code and links but keeps the words", () => {
		const md =
			"# Plan\n**Bold** and _soft_ words, `npm i`, a [link](https://x.y) and https://bare.example/z\n```ts\nconst a = 1;\n```\n- one\n- two\n| a | b |\n|---|---|\n| 1 | 2 |";
		const out = speakableText(md);
		expect(out).toContain("Plan");
		expect(out).toContain("Bold and soft words, npm i, a link and (link)");
		expect(out).toContain("(code)");
		expect(out).not.toContain("const a");
		expect(out).not.toMatch(/[*#`]|\]\(/);
		expect(out).toContain("one\ntwo");
	});

	test("chunks at sentence ends within the limit", () => {
		const text = "First one. Second one is here! Third? Fourth sentence goes on a bit longer.";
		const chunks = speechChunks(text, 30);
		expect(chunks.every((c) => c.length <= 30)).toBe(true);
		expect(chunks.join(" ")).toBe(text);
		expect(speechChunks("こんにちは。瑞希だよ。", 100)).toEqual(["こんにちは。 瑞希だよ。"]);
		expect(speechChunks("x".repeat(25), 10)).toEqual(["x".repeat(10), "x".repeat(10), "x".repeat(5)]);
	});
});

describe("bot voices", () => {
	const defaults = VoiceSettings.parse({
		ttsModel: "api_a::eleven_flash_v2_5",
		ttsVoice: "sarah",
		ttsVoiceName: "Sarah",
	});

	test("old bots get empty voice settings: everything is the default", () => {
		const models = AgentModels.parse({ primary: { model: "m" } });
		expect(models.voice.ttsModel).toBeNull();
		expect(resolveVoice(defaults, models.voice)).toEqual(defaults);
	});

	test("settings saved by older versions still load: other services' models and old fields read as unset", () => {
		const saved = VoiceSettings.parse({
			callMode: "realtime",
			realtimeModel: "legacy::gpt-realtime-2",
			realtimeVoice: "marin",
			ttsModel: "",
			sttModel: "legacy::gpt-4o-transcribe",
			language: "en",
		});
		expect(saved).toEqual({ ttsModel: "", ttsVoice: "", ttsVoiceName: "", sttModel: "", language: "en" });
		const bot = AgentModels.parse({
			primary: { model: "m" },
			voice: { callMode: "voice", realtimeVoice: "coral", ttsModel: "legacy::x", sttModel: "api_a::scribe_v2" },
		});
		expect(bot.voice).toEqual({
			ttsModel: null,
			ttsVoice: null,
			ttsVoiceName: null,
			sttModel: "api_a::scribe_v2",
			language: null,
		});
		expect(resolveVoice(defaults, bot.voice).sttModel).toBe("api_a::scribe_v2");
	});

	test("a bot's own model brings its own voice; the default voice doesn't leak across models", () => {
		const own = resolveVoice(defaults, { ttsModel: "api_f::s1", ttsVoice: null });
		expect(own.ttsModel).toBe("api_f::s1");
		expect(own.ttsVoice).toBe("");
		const mizuki = resolveVoice(defaults, { ttsModel: "api_f::s1", ttsVoice: "abc", ttsVoiceName: "Mizuki" });
		expect([mizuki.ttsVoice, mizuki.ttsVoiceName]).toEqual(["abc", "Mizuki"]);
	});

	test("a bot can change just the voice of the default model, or just the language", () => {
		const v = resolveVoice(defaults, { ttsVoice: "jessica", ttsVoiceName: "Jessica" });
		expect(v.ttsModel).toBe(defaults.ttsModel);
		expect([v.ttsVoice, v.ttsVoiceName]).toEqual(["jessica", "Jessica"]);
		const ja = resolveVoice(defaults, { language: "ja" });
		expect(ja.language).toBe("ja");
		expect(ja.ttsVoice).toBe("sarah");
	});

	test("no speaking model, no voice", () => {
		const none = VoiceSettings.parse({ ttsVoice: "sarah", ttsVoiceName: "Sarah" });
		expect(resolveVoice(none, null)).toMatchObject({ ttsModel: "", ttsVoice: "", ttsVoiceName: "" });
	});
});

describe("audio", () => {
	test("WAV round trip, and other formats come out as 24 kHz mono 16-bit", () => {
		const pcm = tone(0.5);
		expect(wavToPcm(pcmToWav(pcm))).toEqual(pcm);
		const at48 = pcmToWav(tone(0.5, 48_000), 48_000);
		expect(parseWav(at48)?.sampleRate).toBe(48_000);
		const out = wavToPcm(at48);
		expect(Math.abs(out.length - pcm.length)).toBeLessThanOrEqual(4);
	});

	test("the speech detector cuts a clip after a pause, with a little lead-in", () => {
		const clips: Uint8Array[] = [];
		let starts = 0;
		const d = new SpeechDetector({ start: () => starts++, end: (c) => clips.push(c) });
		d.push(silence(1));
		d.push(tone(1.2));
		d.push(silence(1));
		d.push(tone(0.6));
		d.push(silence(0.2));
		expect(starts).toBe(2);
		expect(clips.length).toBe(1);
		const seconds = (clips[0]?.length ?? 0) / (RATE * 2);
		expect(seconds).toBeGreaterThan(1.2);
		expect(seconds).toBeLessThan(2.4);
		expect(d.inSpeech).toBe(true);
		expect(d.flush()).toBe(true);
		expect(clips.length).toBe(2);
	});

	test("short clicks aren't speech", () => {
		let starts = 0;
		const d = new SpeechDetector({ start: () => starts++, end: () => {} });
		d.push(silence(0.5));
		d.push(tone(0.06));
		d.push(silence(1));
		expect(starts).toBe(0);
	});

	test("streamed WAV and raw PCM replies decode, even split at odd bytes", async () => {
		const pcm = tone(0.3);
		const body = (bytes: Uint8Array<ArrayBuffer>, type: string) => {
			const parts = [bytes.subarray(0, 7), bytes.subarray(7, 51), bytes.subarray(51, 1001), bytes.subarray(1001)];
			return new Response(
				new ReadableStream({
					start(c) {
						for (const p of parts) c.enqueue(p);
						c.close();
					},
				}),
				{ headers: { "content-type": type } },
			);
		};
		const collect = async (res: Response) => {
			const out: Uint8Array[] = [];
			for await (const c of pcmFrom(res)) out.push(c);
			return new Uint8Array(Buffer.concat(out));
		};
		expect(await collect(body(new Uint8Array(pcmToWav(pcm)), "audio/wav"))).toEqual(pcm);
		expect(await collect(body(pcm, "audio/pcm"))).toEqual(pcm);
	});
});
