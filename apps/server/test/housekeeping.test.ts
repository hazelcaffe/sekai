import { describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pruneVoiceCache } from "../src/services/housekeeping.ts";

describe("housekeeping", () => {
	test("read-aloud audio: unplayed for a month goes, recent stays, half-written files older than a day go", async () => {
		const dir = mkdtempSync(join(tmpdir(), "sekai-voice-"));
		const now = Date.now();
		const put = (name: string, ageDays: number) => {
			const p = join(dir, name);
			writeFileSync(p, "x".repeat(1000));
			const t = new Date(now - ageDays * 86_400_000);
			utimesSync(p, t, t);
		};
		put("recent.pcm", 2);
		put("old.pcm", 40);
		put("stuck.pcm.ab12.part", 2);
		put("writing.pcm.cd34.part", 0);
		const freed = await pruneVoiceCache(dir, now);
		expect(freed).toBe(2000);
		expect(readdirSync(dir).sort()).toEqual(["recent.pcm", "writing.pcm.cd34.part"]);
	});
});
