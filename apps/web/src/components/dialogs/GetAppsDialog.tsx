import { cn, desktop, formatBytes, mobile, useAppDownloads, useInfo } from "@sekai/client";
import {
	type AppDownloads,
	type DeviceInfo,
	DOWNLOAD_PLATFORMS,
	type DownloadFile,
	type DownloadPlatform,
	detectDevice,
	primaryDownload,
	SEKAI_RELEASES_URL,
} from "@sekai/shared";
import { Badge, Button, Callout, Dialog, EmptyState, IconTile, Skeleton } from "@sekai/ui";
import { Download, Laptop, Monitor, Puzzle, Smartphone, TabletSmartphone, Terminal, TriangleAlert } from "lucide-react";
import { type ComponentProps, type MouseEvent, type ReactNode, useEffect, useState } from "react";
import { useUi } from "../../stores/ui.ts";

const PLATFORMS: Record<DownloadPlatform, { name: string; icon: ReactNode; note?: string }> = {
	macos: {
		name: "Mac",
		icon: <Laptop />,
		note: "The first time, macOS asks you to allow it in Privacy & Security.",
	},
	windows: { name: "Windows", icon: <Monitor /> },
	linux: { name: "Linux", icon: <Terminal /> },
	android: { name: "Android", icon: <Smartphone />, note: "You may need to allow installs from your browser." },
	ios: {
		name: "iPhone and iPad",
		icon: <TabletSmartphone />,
		note: "It's unsigned, so you install it with a sideloading tool.",
	},
	extension: { name: "Browser extension", icon: <Puzzle /> },
};

type UserAgentData = {
	getHighEntropyValues?: (hints: string[]) => Promise<{ architecture?: string; platform?: string }>;
};

/** The visitor's platform, processor and browser: a quick guess first, then what Chromium reveals when asked. */
function useDevice(): DeviceInfo {
	const [device, setDevice] = useState(() => detectDevice(navigator));
	useEffect(() => {
		let current = true;
		const data = (navigator as Navigator & { userAgentData?: UserAgentData }).userAgentData;
		data?.getHighEntropyValues?.(["architecture", "platform"])
			.then((hints) => current && setDevice(detectDevice(navigator, hints)))
			.catch(() => {});
		return () => {
			current = false;
		};
	}, []);
	return device;
}

const DESKTOP_PLATFORMS: Record<string, DownloadPlatform> = { darwin: "macos", win32: "windows", linux: "linux" };

/** The app you're in: it's already installed, so it isn't offered. */
function installedPlatform(): DownloadPlatform | null {
	if (mobile) return mobile.platform;
	return desktop ? (DESKTOP_PLATFORMS[desktop.platform] ?? null) : null;
}

/** A link out; the phone apps open it in the system browser. */
function Out({ href, onClick, ...props }: ComponentProps<"a"> & { href: string }) {
	const open = (e: MouseEvent<HTMLAnchorElement>) => {
		onClick?.(e);
		if (!mobile || e.defaultPrevented) return;
		e.preventDefault();
		mobile.openExternal(href);
	};
	return <a href={href} target="_blank" rel="noreferrer" onClick={open} {...props} />;
}

const linkClass = "font-medium text-brand-ink hover:underline";

function PlatformRow({
	platform,
	files,
	device,
	own,
}: {
	platform: DownloadPlatform;
	files: DownloadFile[];
	device: DeviceInfo;
	own: boolean;
}) {
	const { name, icon, note } = PLATFORMS[platform];
	const primary = primaryDownload(platform, files, { arch: own ? device.arch : null, browser: device.browser });
	const others = files.filter((f) => f !== primary);
	return (
		<li className={cn("rounded-lg border bg-surface px-3 py-3", own ? "border-brand/40" : "border-border")}>
			<div className="flex items-start gap-3">
				<IconTile tone={own ? "brand" : "neutral"}>{icon}</IconTile>
				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-center gap-x-2 gap-y-1">
						<span className="text-body font-medium">{name}</span>
						{own && <Badge tone="accent">This device</Badge>}
					</div>
					{primary ? (
						<>
							<div className="text-small text-fg-subtle">
								{primary.label} · <span className="whitespace-nowrap">{formatBytes(primary.size)}</span>
							</div>
							{note && <div className="mt-1 text-small text-fg-subtle">{note}</div>}
						</>
					) : (
						<div className="text-small text-fg-subtle">Not in this release yet.</div>
					)}
				</div>
				{primary && (
					<Button asChild size="sm" variant={own ? "primary" : "secondary"}>
						<Out href={primary.url} aria-label={`Download ${primary.label} for ${name}`}>
							<Download />
							Download
						</Out>
					</Button>
				)}
			</div>
			{others.length > 0 && (
				<div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 pl-12 text-small">
					{others.map((f) => (
						<Out key={f.url} href={f.url} className={cn(linkClass, "whitespace-nowrap coarse:py-1")}>
							{f.label}
							<span className="ml-1 font-normal text-fg-subtle">{formatBytes(f.size)}</span>
						</Out>
					))}
				</div>
			)}
		</li>
	);
}

function Loading() {
	return (
		<ul className="space-y-2" aria-busy aria-label="Loading the downloads">
			{DOWNLOAD_PLATFORMS.slice(0, 4).map((p) => (
				<li key={p}>
					<Skeleton className="h-[72px] rounded-lg" />
				</li>
			))}
		</ul>
	);
}

function GithubLink({ url, children }: { url: string; children: ReactNode }) {
	return (
		<Out href={url} className={linkClass}>
			{children}
		</Out>
	);
}

/** The apps of this server's release: one row per platform, the visitor's own first. */
export function AppDownloadList() {
	const { data, isPending, isError } = useAppDownloads();
	const { data: info } = useInfo();
	const device = useDevice();
	const installed = installedPlatform();

	if (isPending) return <Loading />;
	const releasesUrl = data?.releasesUrl ?? SEKAI_RELEASES_URL;
	if (isError || data?.error) {
		return (
			<Callout tone="warning" icon={<TriangleAlert />}>
				Couldn't reach GitHub. See <GithubLink url={releasesUrl}>all downloads on GitHub</GithubLink>.
			</Callout>
		);
	}
	const { release, files } = data as AppDownloads;
	const offered = DOWNLOAD_PLATFORMS.filter(
		(p) =>
			p !== installed &&
			!(p === "extension" && (mobile || device.platform === "android" || device.platform === "ios")),
	);
	if (!release || offered.every((p) => files[p].length === 0)) {
		return (
			<EmptyState
				icon={<Download />}
				title="No apps to download yet"
				description={
					<>
						{release ? "This release has no apps attached." : "Nothing has been published yet."} See{" "}
						<GithubLink url={release?.url ?? releasesUrl}>GitHub</GithubLink>.
					</>
				}
			/>
		);
	}
	const own = device.platform && offered.includes(device.platform) ? device.platform : null;
	const rows = own ? [own, ...offered.filter((p) => p !== own)] : offered;
	const published = release.publishedAt
		? new Date(release.publishedAt).toLocaleDateString(undefined, {
				year: "numeric",
				month: "short",
				day: "numeric",
			})
		: null;
	return (
		<div className="space-y-4">
			<div className="space-y-0.5 text-body text-fg-muted">
				<p>
					Version {release.version}
					{published ? ` · ${published}` : ""} · <GithubLink url={release.url}>What's new</GithubLink>
				</p>
				{!release.matchesServer && info?.version && (
					<p className="text-small text-fg-subtle">
						These are from the latest release. Your server runs {info.version}.
					</p>
				)}
			</div>
			<ul className="space-y-2">
				{rows.map((p) => (
					<PlatformRow key={p} platform={p} files={files[p]} device={device} own={p === own} />
				))}
			</ul>
			<p className="flex flex-wrap gap-x-4 gap-y-1 text-small">
				{release.checksumsUrl && <GithubLink url={release.checksumsUrl}>SHA-256 checksums</GithubLink>}
				<GithubLink url={releasesUrl}>All releases on GitHub</GithubLink>
			</p>
		</div>
	);
}

/** Get the apps: the desktop and phone apps and the browser extension, as a dialog (a bottom sheet on phones). */
export function GetAppsDialog() {
	const open = useUi((s) => s.getAppsOpen);
	const setOpen = useUi((s) => s.setGetAppsOpen);
	return (
		<Dialog
			open={open}
			onOpenChange={setOpen}
			title="Get the apps"
			description="Sekai on your computer, your phone and your browser."
			icon={<Download />}
		>
			{open && <AppDownloadList />}
		</Dialog>
	);
}
