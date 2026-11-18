import { describe, expect, test } from "bun:test";
import { cleanHandle } from "@sekai/shared";
import { voicePhrase } from "../src/channels/manager.ts";
import { decodeOggOpus, encodeOggOpus } from "../src/voice/ogg.ts";
import { fitPost, mayAnswer, mentionText } from "../src/x/mentions.ts";

describe("X mentions", () => {
	const account = { userId: "100", allowIds: ["42"] };

	test("only the people you allowed get answers, by account id", () => {
		expect(mayAnswer({ id: "1", user: { id: "42", username: "someone_ok" } }, account)).toBe(true);
		// Someone else, even with the same handle text in their name, is ignored.
		expect(mayAnswer({ id: "2", user: { id: "43", username: "someone_ok" } }, account)).toBe(false);
		expect(mayAnswer({ id: "3", user: { id: "100", username: "SekaiAgent" } }, account)).toBe(false);
		expect(mayAnswer({ id: "4", user: null }, account)).toBe(false);
		expect(mayAnswer({ id: "5", user: { id: "42" }, retweeting: {} }, account)).toBe(false);
		expect(mayAnswer({ id: "6", user: { id: "42" } }, { userId: "100", allowIds: [] })).toBe(false);
	});

	test("the leading @mentions are dropped from the question", () => {
		expect(mentionText("@SekaiAgent hi")).toBe("hi");
		expect(mentionText("@someone @SekaiAgent what's up?")).toBe("what's up?");
		expect(mentionText("hey @SekaiAgent")).toBe("hey @SekaiAgent");
	});

	test("replies fit one post", () => {
		expect(fitPost("hi!")).toBe("hi!");
		const long = `${"This is a sentence. ".repeat(20)}`;
		const out = fitPost(long);
		expect(out.length).toBeLessThanOrEqual(280);
		expect(out.endsWith(".")).toBe(true);
		expect(cleanHandle("https://x.com/Someone_OK/status/1")).toBe("someone_ok");
		expect(cleanHandle("@Someone_OK")).toBe("someone_ok");
	});
});

describe("Discord voice phrases", () => {
	test("join and leave, said plainly", () => {
		expect(voicePhrase("join vc")?.name).toBe("join");
		expect(voicePhrase("can you join the voice channel?")?.name).toBe("join");
		expect(voicePhrase("hop in vc General")).toEqual({ name: "join", sub: null, options: { channel: "General" } });
		expect(voicePhrase("leave vc")?.name).toBe("leave");
		expect(voicePhrase("hang up")?.name).toBe("leave");
		expect(voicePhrase("join me for lunch")).toBeNull();
		expect(voicePhrase("what's a vc?")).toBeNull();
	});
});

describe("voice messages", () => {
	test("Ogg Opus round trip keeps the length", () => {
		const n = 24_000 * 2;
		const pcm = new Uint8Array(n * 2);
		const view = new DataView(pcm.buffer);
		for (let i = 0; i < n; i++)
			view.setInt16(i * 2, Math.round(Math.sin((i / 24_000) * 2 * Math.PI * 300) * 8000), true);
		const ogg = encodeOggOpus(pcm);
		expect(new TextDecoder().decode(ogg.data.subarray(0, 4))).toBe("OggS");
		expect(ogg.durationMs).toBe(2000);
		expect(atob(ogg.waveform).length).toBe(256);
		const back = decodeOggOpus(ogg.data);
		expect(back).not.toBeNull();
		expect(Math.abs((back?.length ?? 0) - pcm.length)).toBeLessThan(24_000 * 2 * 0.1);
	});
});

describe("devices", () => {
	test("PowerShell commands go over ssh encoded (no cmd.exe quoting)", async () => {
		const { powershell } = await import("../src/machines/hosts.ts");
		const cmd = powershell("Write-Output 'it''s \"fine\"'; whoami");
		expect(cmd.startsWith("powershell -NoProfile -NonInteractive -EncodedCommand ")).toBe(true);
		const b64 = cmd.split(" ").at(-1) ?? "";
		expect(Buffer.from(b64, "base64").toString("utf16le")).toBe("Write-Output 'it''s \"fine\"'; whoami");
	});
});
