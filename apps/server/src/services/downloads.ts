import {
	type AppDownloads,
	DOWNLOAD_PLATFORMS,
	type DownloadArch,
	type DownloadBrowser,
	type DownloadFile,
	type DownloadPlatform,
	emptyDownloadFiles,
	SEKAI_RELEASES_URL,
	SEKAI_REPO,
} from "@sekai/shared";
import { z } from "zod";
import { errorMessage } from "../lib/errors.ts";
import { log } from "../lib/log.ts";

const HOUR_MS = 60 * 60_000;
const FAILED_MS = 60_000;
const TIMEOUT_MS = 8_000;

/** What a release's file is: where it goes, what to call it, and where it ranks among its platform's files. */
export interface AssetKind {
	platform: DownloadPlatform | "checksums";
	label: string;
	arch: DownloadArch | null;
	browser: DownloadBrowser | null;
	/** Lower comes first. */
	order: number;
}

// 1.2.3, or 1.2.3-beta.1 (the release workflow names every file after the version it builds). The pre-release part
// is lazy, so "-debug" and "-unsigned" in a file's name aren't taken for one.
const V = String.raw`\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)??`;

const kind = (
	platform: AssetKind["platform"],
	label: string,
	order: number,
	extra: Partial<Pick<AssetKind, "arch" | "browser">> = {},
): AssetKind => ({ platform, label, order, arch: extra.arch ?? null, browser: extra.browser ?? null });

const RULES: { re: RegExp; kind: (m: RegExpMatchArray) => AssetKind | null }[] = [
	// Sekai-0.2.0-arm64.dmg, Sekai-0.2.0-x64.dmg
	{
		re: new RegExp(`^Sekai-${V}-(x64|arm64)\\.dmg$`),
		kind: (m) =>
			m[1] === "arm64"
				? kind("macos", "Apple silicon", 0, { arch: "arm64" })
				: kind("macos", "Intel", 1, { arch: "x64" }),
	},
	// Sekai-0.2.0-setup-x64.exe, Sekai-0.2.0-portable-x64.exe
	{
		re: new RegExp(`^Sekai-${V}-(setup|portable)-(x64|arm64)\\.exe$`),
		kind: (m) => {
			const arch: DownloadArch = m[2] === "arm64" ? "arm64" : "x64";
			const name = m[1] === "setup" ? "Installer" : "Portable";
			return kind(
				"windows",
				arch === "x64" ? name : `${name} (arm64)`,
				(m[1] === "setup" ? 0 : 2) + (arch === "x64" ? 0 : 1),
				{
					arch,
				},
			);
		},
	},
	// Sekai-0.2.0-x86_64.AppImage, Sekai-0.2.0-arm64.AppImage
	{
		re: new RegExp(`^Sekai-${V}-(x86_64|x64|arm64|aarch64)\\.AppImage$`),
		kind: (m) =>
			m[1] === "arm64" || m[1] === "aarch64"
				? kind("linux", "AppImage (arm64)", 1, { arch: "arm64" })
				: kind("linux", "AppImage (x86_64)", 0, { arch: "x64" }),
	},
	// sekai_0.2.0_amd64.deb, sekai_0.2.0_arm64.deb
	{
		re: new RegExp(`^sekai_${V}_(amd64|arm64)\\.deb$`),
		kind: (m) =>
			m[1] === "arm64"
				? kind("linux", ".deb (arm64)", 3, { arch: "arm64" })
				: kind("linux", ".deb (x86_64)", 2, { arch: "x64" }),
	},
	// Sekai-0.2.0.apk (signed), Sekai-0.2.0-debug.apk (a build without Sekai's signing key)
	{
		re: new RegExp(`^Sekai-${V}(-debug)?\\.apk$`),
		kind: (m) => (m[1] ? kind("android", "APK (debug build)", 1) : kind("android", "APK", 0)),
	},
	// Sekai-0.2.0-unsigned.ipa
	{
		re: new RegExp(`^Sekai-${V}(-unsigned)?\\.ipa$`),
		kind: (m) => (m[1] ? kind("ios", "IPA (unsigned)", 1) : kind("ios", "IPA", 0)),
	},
	// sekai-chromium-0.2.0.zip, sekai-firefox-0.2.0.zip, and the two Safari ones
	{
		re: new RegExp(`^sekai-(chromium|firefox)-${V}\\.zip$`),
		kind: (m) =>
			m[1] === "firefox"
				? kind("extension", "Firefox", 1, { browser: "firefox" })
				: kind("extension", "Chrome, Edge and Brave", 0, { browser: "chromium" }),
	},
	{
		re: new RegExp(`^sekai-safari-macos-unsigned-${V}\\.zip$`),
		kind: () => kind("extension", "Safari (unsigned app)", 2, { browser: "safari" }),
	},
	{
		re: new RegExp(`^sekai-safari-webextension-source-${V}\\.zip$`),
		kind: () => kind("extension", "Safari (Xcode project)", 3, { browser: "safari" }),
	},
	{ re: /^SHA256SUMS\.txt$/, kind: () => kind("checksums", "Checksums", 0) },
];

/** Which platform and variant a release file belongs to; null for files Sekai doesn't offer (updater files, logs…). */
export function classifyAsset(name: string): AssetKind | null {
	for (const rule of RULES) {
		const m = name.match(rule.re);
		if (m) return rule.kind(m);
	}
	return null;
}

const GithubRelease = z.object({
	tag_name: z.string().min(1).max(100),
	published_at: z.string().nullish(),
	assets: z
		.array(
			z.object({
				name: z.string(),
				size: z.number().nonnegative(),
				state: z.string().optional(),
			}),
		)
		.default([]),
});
type GithubRelease = z.infer<typeof GithubRelease>;

const releaseUrl = (tag: string) => `${SEKAI_RELEASES_URL}/tag/${encodeURIComponent(tag)}`;
// Built here rather than taken from GitHub's answer, so every link goes to this repository's release files.
const assetUrl = (tag: string, name: string) =>
	`${SEKAI_RELEASES_URL}/download/${encodeURIComponent(tag)}/${encodeURIComponent(name)}`;

/** The downloads page's data for one GitHub release. */
export function describeRelease(release: GithubRelease, matchesServer: boolean): AppDownloads {
	const tag = release.tag_name;
	const files = emptyDownloadFiles();
	const ranked: Record<DownloadPlatform, { file: DownloadFile; order: number }[]> = {
		macos: [],
		windows: [],
		linux: [],
		android: [],
		ios: [],
		extension: [],
	};
	let checksumsUrl: string | null = null;
	for (const asset of release.assets) {
		if (asset.state && asset.state !== "uploaded") continue;
		const found = classifyAsset(asset.name);
		if (!found) continue;
		if (found.platform === "checksums") {
			checksumsUrl = assetUrl(tag, asset.name);
			continue;
		}
		ranked[found.platform].push({
			order: found.order,
			file: {
				label: found.label,
				arch: found.arch,
				browser: found.browser,
				name: asset.name,
				size: asset.size,
				url: assetUrl(tag, asset.name),
			},
		});
	}
	for (const platform of DOWNLOAD_PLATFORMS) {
		files[platform] = ranked[platform].sort((a, b) => a.order - b.order).map((r) => r.file);
	}
	const published = release.published_at ? Date.parse(release.published_at) : Number.NaN;
	return {
		releasesUrl: SEKAI_RELEASES_URL,
		release: {
			tag,
			version: tag.replace(/^v/, ""),
			url: releaseUrl(tag),
			publishedAt: Number.isNaN(published) ? null : published,
			matchesServer,
			checksumsUrl,
		},
		files,
		error: null,
	};
}

const nothing = (error: string | null): AppDownloads => ({
	releasesUrl: SEKAI_RELEASES_URL,
	release: null,
	files: emptyDownloadFiles(),
	error,
});

export interface DownloadsSourceOptions {
	/** This server's version: its own release is offered, if there is one. */
	version: string;
	fetch?: typeof fetch;
	now?: () => number;
	/** How long an answer is kept. */
	ttlMs?: number;
	/** How long a failure is remembered before GitHub is asked again. */
	failedMs?: number;
	timeoutMs?: number;
}

/**
 * The downloads for this server's version from GitHub's public releases API, kept in memory for an hour. If there
 * is no release for that version, the latest one. A failure is kept for a minute (and the last good answer is
 * served meanwhile, if there is one), so a slow or down GitHub doesn't slow every visit.
 */
export function createDownloadsSource(options: DownloadsSourceOptions) {
	const doFetch = options.fetch ?? fetch;
	const now = options.now ?? Date.now;
	const ttl = options.ttlMs ?? HOUR_MS;
	const failedFor = options.failedMs ?? FAILED_MS;
	const timeout = options.timeoutMs ?? TIMEOUT_MS;
	const tag = `v${options.version}`;
	let kept: { value: AppDownloads; until: number } | null = null;
	let lastGood: AppDownloads | null = null;
	let pending: Promise<AppDownloads> | null = null;

	/** A release from GitHub, or null when there's none at that address. */
	async function fetchRelease(path: string): Promise<GithubRelease | null> {
		const res = await doFetch(`https://api.github.com/repos/${SEKAI_REPO}/releases/${path}`, {
			headers: {
				accept: "application/vnd.github+json",
				"user-agent": "sekai-server",
				"x-github-api-version": "2022-11-28",
			},
			signal: AbortSignal.timeout(timeout),
		});
		if (res.status === 404) return null;
		if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
		return GithubRelease.parse(await res.json());
	}

	async function load(): Promise<AppDownloads> {
		const own = await fetchRelease(`tags/${encodeURIComponent(tag)}`);
		if (own) return describeRelease(own, true);
		const latest = await fetchRelease("latest");
		return latest ? describeRelease(latest, latest.tag_name === tag) : nothing(null);
	}

	async function refresh(): Promise<AppDownloads> {
		try {
			const value = await load();
			lastGood = value;
			kept = { value, until: now() + ttl };
			return value;
		} catch (err) {
			log.warn(`Couldn't load the app downloads from GitHub: ${errorMessage(err)}`);
			const value = lastGood ?? nothing("Couldn't reach GitHub.");
			kept = { value, until: now() + failedFor };
			return value;
		}
	}

	return {
		/** The downloads, from memory when they were fetched recently. */
		get(): Promise<AppDownloads> {
			if (kept && now() < kept.until) return Promise.resolve(kept.value);
			pending ??= refresh().finally(() => {
				pending = null;
			});
			return pending;
		},
		/** Forgets what was kept, so the next call asks GitHub. */
		clear() {
			kept = null;
			lastGood = null;
		},
	};
}
