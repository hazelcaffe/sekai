import { describe, expect, test } from "bun:test";
import { type DownloadFile, detectDevice, primaryDownload, SEKAI_RELEASES_URL } from "@sekai/shared";
import { classifyAsset, createDownloadsSource, describeRelease } from "../src/services/downloads.ts";

// What v0.2.0 of hazelcaffe/sekai really has.
const V020: [string, number][] = [
	["Sekai-0.2.0-arm64.AppImage", 128370208],
	["Sekai-0.2.0-arm64.dmg", 122028171],
	["Sekai-0.2.0-portable-x64.exe", 111449639],
	["Sekai-0.2.0-setup-x64.exe", 122581955],
	["Sekai-0.2.0-x64.dmg", 129241820],
	["Sekai-0.2.0-x86_64.AppImage", 127085809],
	["sekai-chromium-0.2.0.zip", 715748],
	["sekai-firefox-0.2.0.zip", 715770],
	["sekai-safari-macos-unsigned-0.2.0.zip", 1956210],
	["sekai-safari-webextension-source-0.2.0.zip", 715678],
	["sekai_0.2.0_amd64.deb", 103033144],
	["sekai_0.2.0_arm64.deb", 97892900],
	["SHA256SUMS.txt", 1118],
];

const release = (tag: string, assets: [string, number][], extra: Record<string, unknown> = {}) => ({
	tag_name: tag,
	published_at: "2026-11-19T02:03:13Z",
	assets: assets.map(([name, size]) => ({ name, size, state: "uploaded" })),
	...extra,
});

describe("what a release's files are", () => {
	test("v0.2.0's desktop files go to their platform with a label", () => {
		const of = (name: string) => {
			const k = classifyAsset(name);
			return k && `${k.platform}|${k.label}|${k.arch ?? "-"}`;
		};
		expect(of("Sekai-0.2.0-arm64.dmg")).toBe("macos|Apple silicon|arm64");
		expect(of("Sekai-0.2.0-x64.dmg")).toBe("macos|Intel|x64");
		expect(of("Sekai-0.2.0-setup-x64.exe")).toBe("windows|Installer|x64");
		expect(of("Sekai-0.2.0-portable-x64.exe")).toBe("windows|Portable|x64");
		expect(of("Sekai-0.2.0-x86_64.AppImage")).toBe("linux|AppImage (x86_64)|x64");
		expect(of("Sekai-0.2.0-arm64.AppImage")).toBe("linux|AppImage (arm64)|arm64");
		expect(of("sekai_0.2.0_amd64.deb")).toBe("linux|.deb (x86_64)|x64");
		expect(of("sekai_0.2.0_arm64.deb")).toBe("linux|.deb (arm64)|arm64");
		expect(of("SHA256SUMS.txt")).toBe("checksums|Checksums|-");
	});

	test("the browser extensions go to their browser", () => {
		const browser = (name: string) => classifyAsset(name)?.browser;
		expect(classifyAsset("sekai-chromium-0.2.0.zip")?.platform).toBe("extension");
		expect(browser("sekai-chromium-0.2.0.zip")).toBe("chromium");
		expect(browser("sekai-firefox-0.2.0.zip")).toBe("firefox");
		expect(browser("sekai-safari-macos-unsigned-0.2.0.zip")).toBe("safari");
		expect(browser("sekai-safari-webextension-source-0.2.0.zip")).toBe("safari");
	});

	test("the phone apps' names from the release workflow", () => {
		expect(classifyAsset("Sekai-0.2.0.apk")).toMatchObject({ platform: "android", label: "APK" });
		expect(classifyAsset("Sekai-0.2.0-debug.apk")).toMatchObject({
			platform: "android",
			label: "APK (debug build)",
		});
		expect(classifyAsset("Sekai-0.2.0-unsigned.ipa")).toMatchObject({ platform: "ios", label: "IPA (unsigned)" });
		expect(classifyAsset("Sekai-0.2.0.ipa")).toMatchObject({ platform: "ios", label: "IPA" });
	});

	test("pre-release versions work, and unknown files are ignored", () => {
		expect(classifyAsset("Sekai-0.3.0-beta.1-arm64.dmg")?.platform).toBe("macos");
		expect(classifyAsset("sekai_0.3.0-beta.1_amd64.deb")?.platform).toBe("linux");
		expect(classifyAsset("Sekai-0.3.0-beta.1-unsigned.ipa")?.platform).toBe("ios");
		expect(classifyAsset("Sekai-0.3.0-beta.1-debug.apk")).toMatchObject({
			platform: "android",
			label: "APK (debug build)",
		});
		expect(classifyAsset("Sekai-0.3.0-beta.1.apk")).toMatchObject({ platform: "android", label: "APK" });
		expect(classifyAsset("latest.yml")).toBeNull();
		expect(classifyAsset("latest-mac.yml")).toBeNull();
		expect(classifyAsset("Sekai-0.2.0-x64.dmg.blockmap")).toBeNull();
		expect(classifyAsset("Sekai-0.2.0-source.tar.gz")).toBeNull();
		expect(classifyAsset("Sekai-0.2.0-evil.exe")).toBeNull();
		expect(classifyAsset("../Sekai-0.2.0-x64.dmg")).toBeNull();
	});
});

describe("a release as downloads", () => {
	const downloads = describeRelease(release("v0.2.0", [...V020, ["notes.txt", 5], ["latest.yml", 5]]), true);

	test("groups files by platform, best first, with sizes and links", () => {
		const names = (p: keyof typeof downloads.files) => downloads.files[p].map((f) => f.name);
		expect(names("macos")).toEqual(["Sekai-0.2.0-arm64.dmg", "Sekai-0.2.0-x64.dmg"]);
		expect(names("windows")).toEqual(["Sekai-0.2.0-setup-x64.exe", "Sekai-0.2.0-portable-x64.exe"]);
		expect(names("linux")).toEqual([
			"Sekai-0.2.0-x86_64.AppImage",
			"Sekai-0.2.0-arm64.AppImage",
			"sekai_0.2.0_amd64.deb",
			"sekai_0.2.0_arm64.deb",
		]);
		expect(names("extension")).toEqual([
			"sekai-chromium-0.2.0.zip",
			"sekai-firefox-0.2.0.zip",
			"sekai-safari-macos-unsigned-0.2.0.zip",
			"sekai-safari-webextension-source-0.2.0.zip",
		]);
		expect(downloads.files.android).toEqual([]);
		expect(downloads.files.ios).toEqual([]);
		expect(downloads.files.macos[0]).toEqual({
			label: "Apple silicon",
			arch: "arm64",
			browser: null,
			name: "Sekai-0.2.0-arm64.dmg",
			size: 122028171,
			url: "https://github.com/hazelcaffe/sekai/releases/download/v0.2.0/Sekai-0.2.0-arm64.dmg",
		});
	});

	test("says which release it is, links its page and checksums, and ignores unknown files", () => {
		expect(downloads.release).toEqual({
			tag: "v0.2.0",
			version: "0.2.0",
			url: "https://github.com/hazelcaffe/sekai/releases/tag/v0.2.0",
			publishedAt: Date.parse("2026-11-19T02:03:13Z"),
			matchesServer: true,
			checksumsUrl: "https://github.com/hazelcaffe/sekai/releases/download/v0.2.0/SHA256SUMS.txt",
		});
		expect(downloads.releasesUrl).toBe(SEKAI_RELEASES_URL);
		expect(downloads.error).toBeNull();
		const all = Object.values(downloads.files).flat();
		expect(all).toHaveLength(12);
		expect(all.some((f) => f.name === "notes.txt" || f.name === "latest.yml")).toBe(false);
	});

	test("a release with the phone apps puts a signed APK before a debug one, and skips files still uploading", () => {
		const d = describeRelease(
			{
				tag_name: "v0.3.0",
				assets: [
					{ name: "Sekai-0.3.0-debug.apk", size: 30, state: "uploaded" },
					{ name: "Sekai-0.3.0.apk", size: 31, state: "uploaded" },
					{ name: "Sekai-0.3.0-unsigned.ipa", size: 40, state: "uploaded" },
					{ name: "Sekai-0.3.0-arm64.dmg", size: 1, state: "starter" },
				],
			},
			false,
		);
		expect(d.files.android.map((f) => f.label)).toEqual(["APK", "APK (debug build)"]);
		expect(d.files.ios.map((f) => f.size)).toEqual([40]);
		expect(d.files.macos).toEqual([]);
		expect(d.release?.matchesServer).toBe(false);
		expect(d.release?.checksumsUrl).toBeNull();
	});

	test("links are built from the tag and name, whatever GitHub says", () => {
		const d = describeRelease(
			{
				tag_name: "v0.2.0",
				published_at: null,
				assets: [
					{
						name: "Sekai-0.2.0-x64.dmg",
						size: 1,
						state: "uploaded",
						browser_download_url: "https://evil.example/x",
					} as never,
				],
			},
			true,
		);
		expect(d.files.macos[0]?.url).toBe(
			"https://github.com/hazelcaffe/sekai/releases/download/v0.2.0/Sekai-0.2.0-x64.dmg",
		);
		expect(d.release?.publishedAt).toBeNull();
	});
});

/** A fake GitHub: a release per tag, "latest", and a request log. */
function fakeGithub(releases: Record<string, unknown>, options: { latest?: string; failWith?: number } = {}) {
	const calls: string[] = [];
	const state = { failWith: options.failWith, hang: false };
	const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
		const url = String(input);
		calls.push(url);
		if (state.hang) {
			return new Promise<Response>((_, reject) => {
				init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
			});
		}
		if (state.failWith) return new Response("nope", { status: state.failWith });
		const tag = url.match(/releases\/tags\/(.+)$/)?.[1];
		const key = tag ? decodeURIComponent(tag) : options.latest;
		const found = key ? releases[key] : undefined;
		return found
			? new Response(JSON.stringify(found), { headers: { "content-type": "application/json" } })
			: new Response("{}", { status: 404 });
	}) as typeof fetch;
	return { fetchImpl, calls, state };
}

describe("the downloads of this server's version", () => {
	test("asks GitHub for the version's own release", async () => {
		const gh = fakeGithub({ "v0.2.0": release("v0.2.0", V020) });
		const source = createDownloadsSource({ version: "0.2.0", fetch: gh.fetchImpl });
		const d = await source.get();
		expect(gh.calls).toEqual(["https://api.github.com/repos/hazelcaffe/sekai/releases/tags/v0.2.0"]);
		expect(d.release?.tag).toBe("v0.2.0");
		expect(d.release?.matchesServer).toBe(true);
		expect(d.files.macos).toHaveLength(2);
	});

	test("falls back to the latest release when there's none for its version", async () => {
		const gh = fakeGithub({ "v0.2.0": release("v0.2.0", V020) }, { latest: "v0.2.0" });
		const source = createDownloadsSource({ version: "0.2.5-dev", fetch: gh.fetchImpl });
		const d = await source.get();
		expect(gh.calls).toEqual([
			"https://api.github.com/repos/hazelcaffe/sekai/releases/tags/v0.2.5-dev",
			"https://api.github.com/repos/hazelcaffe/sekai/releases/latest",
		]);
		expect(d.release?.tag).toBe("v0.2.0");
		expect(d.release?.matchesServer).toBe(false);
		expect(d.files.windows).toHaveLength(2);
		expect(d.error).toBeNull();
	});

	test("has no release, and no error, when there are no releases at all", async () => {
		const gh = fakeGithub({});
		const d = await createDownloadsSource({ version: "0.2.0", fetch: gh.fetchImpl }).get();
		expect(d.release).toBeNull();
		expect(d.error).toBeNull();
		expect(d.releasesUrl).toBe(SEKAI_RELEASES_URL);
	});

	test("says GitHub couldn't be reached, and still links the releases page", async () => {
		for (const failure of [
			fakeGithub({}, { failWith: 403 }).fetchImpl,
			fakeGithub({}, { failWith: 500 }).fetchImpl,
			(async () => {
				throw new TypeError("fetch failed");
			}) as unknown as typeof fetch,
			(async () => new Response("<html>nope</html>")) as unknown as typeof fetch,
		]) {
			const d = await createDownloadsSource({ version: "0.2.0", fetch: failure }).get();
			expect(d.release).toBeNull();
			expect(d.error).toBe("Couldn't reach GitHub.");
			expect(d.releasesUrl).toBe(SEKAI_RELEASES_URL);
			expect(Object.values(d.files).flat()).toEqual([]);
		}
	});

	test("gives up on a slow GitHub", async () => {
		const gh = fakeGithub({});
		gh.state.hang = true;
		const started = Date.now();
		const d = await createDownloadsSource({ version: "0.2.0", fetch: gh.fetchImpl, timeoutMs: 30 }).get();
		expect(Date.now() - started).toBeLessThan(2000);
		expect(d.error).toBe("Couldn't reach GitHub.");
	});
});

describe("keeping the downloads in memory", () => {
	const setup = (options: { ttlMs?: number; failedMs?: number } = {}) => {
		const gh = fakeGithub({ "v0.2.0": release("v0.2.0", V020) });
		const clock = { now: 1_000_000 };
		const source = createDownloadsSource({
			version: "0.2.0",
			fetch: gh.fetchImpl,
			now: () => clock.now,
			...options,
		});
		return { gh, clock, source };
	};

	test("asks GitHub once an hour", async () => {
		const { gh, clock, source } = setup();
		const first = await source.get();
		clock.now += 59 * 60_000;
		expect(await source.get()).toBe(first);
		expect(gh.calls).toHaveLength(1);
		clock.now += 2 * 60_000;
		await source.get();
		expect(gh.calls).toHaveLength(2);
	});

	test("shares one request between visits at the same time", async () => {
		const { gh, source } = setup();
		const [a, b, c] = await Promise.all([source.get(), source.get(), source.get()]);
		expect(gh.calls).toHaveLength(1);
		expect(a).toBe(b);
		expect(b).toBe(c);
	});

	test("remembers a failure briefly, then tries again", async () => {
		const { gh, clock, source } = setup();
		gh.state.failWith = 502;
		expect((await source.get()).error).toBe("Couldn't reach GitHub.");
		clock.now += 30_000;
		await source.get();
		expect(gh.calls).toHaveLength(1);
		gh.state.failWith = undefined;
		clock.now += 31_000;
		const d = await source.get();
		expect(gh.calls).toHaveLength(2);
		expect(d.error).toBeNull();
		expect(d.release?.tag).toBe("v0.2.0");
	});

	test("keeps showing the last good answer while GitHub is down", async () => {
		const { gh, clock, source } = setup();
		const good = await source.get();
		gh.state.failWith = 500;
		clock.now += 61 * 60_000;
		expect(await source.get()).toBe(good);
		expect(gh.calls).toHaveLength(2);
		clock.now += 30_000;
		expect(await source.get()).toBe(good);
		expect(gh.calls).toHaveLength(2);
		clock.now += 31_000;
		await source.get();
		expect(gh.calls).toHaveLength(3);
	});

	test("clear() asks again", async () => {
		const { gh, source } = setup();
		await source.get();
		source.clear();
		await source.get();
		expect(gh.calls).toHaveLength(2);
	});
});

describe("which download is for this device", () => {
	const chrome =
		"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
	const device = (ua: string, extra: Record<string, unknown> = {}, hints = {}) =>
		detectDevice({ userAgent: ua, ...extra }, hints);

	test("knows the platform", () => {
		expect(device(chrome, { platform: "Linux x86_64" })).toMatchObject({
			platform: "linux",
			arch: "x64",
			browser: "chromium",
		});
		expect(
			device(
				"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36 Edg/130.0",
				{
					platform: "Win32",
				},
			),
		).toMatchObject({ platform: "windows", arch: "x64", browser: "chromium" });
		expect(
			device(
				"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.1 Safari/605.1.15",
				{
					platform: "MacIntel",
					maxTouchPoints: 0,
				},
			),
		).toMatchObject({ platform: "macos", browser: "safari" });
		expect(
			device(
				"Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36",
				{
					platform: "Linux armv81",
					userAgentData: { platform: "Android", mobile: true },
				},
			),
		).toMatchObject({ platform: "android", browser: "chromium" });
		expect(
			device(
				"Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 Version/18.1 Mobile Safari/604.1",
				{
					platform: "iPhone",
					maxTouchPoints: 5,
				},
			),
		).toMatchObject({ platform: "ios" });
		expect(device("Mozilla/5.0 (Firefox)", {}).platform).toBeNull();
		expect(
			device("Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) Chrome/130.0.0.0", { platform: "Linux x86_64" }).platform,
		).toBeNull();
	});

	test("an iPad that looks like a Mac is an iPad", () => {
		expect(
			device(
				"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.1 Safari/605.1.15",
				{
					platform: "MacIntel",
					maxTouchPoints: 5,
				},
			).platform,
		).toBe("ios");
	});

	test("takes Chromium's word on the processor, and assumes Apple silicon on a Mac that won't say", () => {
		const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36";
		expect(device(mac, { platform: "MacIntel" }).arch).toBe("arm64");
		expect(device(mac, { platform: "MacIntel" }, { architecture: "x86" }).arch).toBe("x64");
		expect(device(mac, { platform: "MacIntel" }, { architecture: "arm" }).arch).toBe("arm64");
		expect(
			device("Mozilla/5.0 (X11; Linux aarch64) Chrome/130.0.0.0 Safari/537.36", { platform: "Linux aarch64" })
				.arch,
		).toBe("arm64");
		expect(
			device(
				"Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0.0.0",
				{ platform: "Win32" },
				{ architecture: "arm" },
			).arch,
		).toBe("arm64");
	});

	test("tells the browsers apart", () => {
		expect(device("Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0").browser).toBe(
			"firefox",
		);
		expect(
			device(
				"Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 CriOS/130.0 Mobile/15E148 Safari/604.1",
			).browser,
		).toBe("chromium");
		expect(
			device("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.1 Safari/605.1.15")
				.browser,
		).toBe("safari");
	});

	test("offers the file for the processor first, else the best one", () => {
		const d = describeRelease(release("v0.2.0", V020), true);
		const label = (f: DownloadFile | null) => f?.label;
		expect(label(primaryDownload("macos", d.files.macos, { arch: "arm64", browser: "chromium" }))).toBe(
			"Apple silicon",
		);
		expect(label(primaryDownload("macos", d.files.macos, { arch: "x64", browser: "chromium" }))).toBe("Intel");
		expect(label(primaryDownload("linux", d.files.linux, { arch: "arm64", browser: "chromium" }))).toBe(
			"AppImage (arm64)",
		);
		expect(label(primaryDownload("linux", d.files.linux, { arch: "x64", browser: "chromium" }))).toBe(
			"AppImage (x86_64)",
		);
		// Windows on ARM runs the x64 installer.
		expect(label(primaryDownload("windows", d.files.windows, { arch: "arm64", browser: "chromium" }))).toBe(
			"Installer",
		);
		expect(label(primaryDownload("extension", d.files.extension, { arch: "x64", browser: "firefox" }))).toBe(
			"Firefox",
		);
		expect(label(primaryDownload("extension", d.files.extension, { arch: "x64", browser: "safari" }))).toBe(
			"Safari (unsigned app)",
		);
		// Another platform's row: the best file, whatever this device's processor is.
		expect(label(primaryDownload("macos", d.files.macos, { arch: null, browser: "chromium" }))).toBe(
			"Apple silicon",
		);
		expect(label(primaryDownload("linux", d.files.linux, { arch: null, browser: "chromium" }))).toBe(
			"AppImage (x86_64)",
		);
		expect(primaryDownload("android", d.files.android, { arch: "x64", browser: "chromium" })).toBeNull();
		const phone = describeRelease(release("v0.3.0", [["Sekai-0.3.0.apk", 3]]), true);
		expect(label(primaryDownload("android", phone.files.android, { arch: "arm64", browser: "chromium" }))).toBe(
			"APK",
		);
	});
});
