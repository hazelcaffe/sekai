/** The public GitHub repository Sekai's releases (desktop installers, phone apps, browser extensions) live in. */
export const SEKAI_REPO = "hazelcaffe/sekai";
/** Every release, for when the list itself can't be shown. */
export const SEKAI_RELEASES_URL = `https://github.com/${SEKAI_REPO}/releases`;

export const DOWNLOAD_PLATFORMS = ["macos", "windows", "linux", "android", "ios", "extension"] as const;
export type DownloadPlatform = (typeof DOWNLOAD_PLATFORMS)[number];
export type DownloadArch = "x64" | "arm64";
export type DownloadBrowser = "chromium" | "firefox" | "safari";

/** One file of a release. */
export interface DownloadFile {
	/** What it is, short: "Apple silicon", "Intel", "Installer", "Portable", "AppImage (x86_64)", ".deb (arm64)", "APK"… */
	label: string;
	/** The processor it's for, when that matters (desktop apps). */
	arch: DownloadArch | null;
	/** The browser it's for (extensions). */
	browser: DownloadBrowser | null;
	/** The file's name as it's published. */
	name: string;
	/** Bytes. */
	size: number;
	url: string;
}

export interface DownloadRelease {
	/** "v0.2.0". */
	tag: string;
	/** "0.2.0". */
	version: string;
	/** The release's page on GitHub (notes, every file). */
	url: string;
	/** Epoch milliseconds. */
	publishedAt: number | null;
	/** This is the release for the version this server runs; otherwise it's the latest one. */
	matchesServer: boolean;
	/** SHA-256 checksums of every file in it. */
	checksumsUrl: string | null;
}

/** What `GET /api/apps/downloads` returns: the apps of this server's release, from GitHub. */
export interface AppDownloads {
	/** Every release; always set, so there's something to link to even when nothing else loaded. */
	releasesUrl: string;
	/** Null when GitHub couldn't be reached (`error` says so) or has no release yet. */
	release: DownloadRelease | null;
	/** Files by platform, the ones to offer first at the front. A platform with none isn't in this release yet. */
	files: Record<DownloadPlatform, DownloadFile[]>;
	/** A sentence for when GitHub couldn't be reached. */
	error: string | null;
}

export const emptyDownloadFiles = (): Record<DownloadPlatform, DownloadFile[]> => ({
	macos: [],
	windows: [],
	linux: [],
	android: [],
	ios: [],
	extension: [],
});

/** What the browser says about itself (a subset of `navigator`, so this works without a DOM). */
export interface NavigatorLike {
	userAgent?: string;
	platform?: string;
	maxTouchPoints?: number;
	userAgentData?: { platform?: string; mobile?: boolean };
}

/** Extra facts Chromium gives when asked (`userAgentData.getHighEntropyValues`). */
export interface HighEntropyHints {
	architecture?: string;
	platform?: string;
}

export interface DeviceInfo {
	/** Null when it's none of the platforms with an app (a console, a smart TV…). */
	platform: DownloadPlatform | null;
	/** The processor; a guess when the browser doesn't say (Macs are taken to be Apple silicon). */
	arch: DownloadArch;
	/** The visitor's browser, to pick an extension. */
	browser: DownloadBrowser;
}

/** Which platform, processor and browser a visitor is on, from what the browser reveals. */
export function detectDevice(nav: NavigatorLike, hints: HighEntropyHints = {}): DeviceInfo {
	const ua = nav.userAgent ?? "";
	const reported = hints.platform ?? nav.userAgentData?.platform ?? "";
	const legacy = nav.platform ?? "";
	let platform: DownloadPlatform | null = null;
	if (/android/i.test(reported) || /android/i.test(ua)) platform = "android";
	else if (/iphone|ipad|ipod/i.test(ua) || (legacy === "MacIntel" && (nav.maxTouchPoints ?? 0) > 1)) platform = "ios";
	else if (/^win/i.test(reported || legacy) || /windows/i.test(ua)) platform = "windows";
	else if (/^mac/i.test(reported || legacy) || /macintosh|mac os x/i.test(ua)) platform = "macos";
	else if (/cros|chrome os/i.test(`${reported} ${ua}`)) platform = null;
	else if (/^linux/i.test(reported || legacy) || /linux|x11/i.test(ua)) platform = "linux";

	let arch: DownloadArch;
	if (hints.architecture) arch = /arm/i.test(hints.architecture) ? "arm64" : "x64";
	else if (/aarch64|arm64|\barm\b/i.test(`${legacy} ${ua}`)) arch = "arm64";
	// Safari and Firefox say "Intel" on every Mac, and nearly every Mac still in use is Apple silicon.
	else arch = platform === "macos" ? "arm64" : "x64";

	const browser: DownloadBrowser = /firefox\//i.test(ua)
		? "firefox"
		: /safari\//i.test(ua) && !/chrome\/|chromium\/|crios\/|edg\/|opr\//i.test(ua)
			? "safari"
			: "chromium";
	return { platform, arch, browser };
}

/**
 * The file to offer first: the one for the device's processor (or browser, for extensions), else the first in the
 * list, which is the one the server ranks highest. With no processor (another platform's row, not the device's own)
 * it's always the first.
 */
export function primaryDownload(
	platform: DownloadPlatform,
	files: DownloadFile[],
	device: { arch: DownloadArch | null; browser: DownloadBrowser },
): DownloadFile | null {
	if (platform === "extension") return files.find((f) => f.browser === device.browser) ?? files[0] ?? null;
	if (!device.arch) return files[0] ?? null;
	return files.find((f) => f.arch === device.arch) ?? files.find((f) => !f.arch) ?? files[0] ?? null;
}
