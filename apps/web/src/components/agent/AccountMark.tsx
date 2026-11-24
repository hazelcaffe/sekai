import { BrandTile } from "@sekai/client";
import type { ReactNode } from "react";

export type AccountPlatform = "discord" | "slack" | "signal" | "x" | "instagram" | "tiktok";

/** The marks LobeHub's set lacks, as one-colour glyphs (they follow the tile's text colour). */
const GLYPHS: Record<"x" | "instagram" | "tiktok", ReactNode> = {
	x: (
		<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className="size-full">
			<path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
		</svg>
	),
	instagram: (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden className="size-full">
			<rect x="3" y="3" width="18" height="18" rx="5" />
			<circle cx="12" cy="12" r="4" />
			<circle cx="17.2" cy="6.8" r="0.6" fill="currentColor" stroke="none" />
		</svg>
	),
	tiktok: (
		<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className="size-full">
			<path d="M16.5 3c.4 2.3 1.9 3.7 4.2 3.9v3.1c-1.6 0-3-.5-4.2-1.3v6.6c0 3.5-2.6 6-6 6-3.3 0-5.8-2.4-5.8-5.6 0-3.4 3-5.9 6.6-5.5v3.2c-1.8-.4-3.4.7-3.4 2.4 0 1.5 1.2 2.5 2.6 2.5 1.6 0 2.8-1.2 2.8-3V3h3.4Z" />
		</svg>
	),
};

/** A platform's mark on the same tile every brand uses (Discord, Slack and Signal from the bundled marks). */
export function AccountMark({ platform, size = 34 }: { platform: AccountPlatform; size?: number }) {
	if (platform === "discord" || platform === "slack" || platform === "signal")
		return <BrandTile brand={platform} size={size} />;
	return (
		<BrandTile
			brand={null}
			size={size}
			fallback={
				<span
					className="inline-flex"
					style={{ width: Math.round(size * 0.52), height: Math.round(size * 0.52) }}
				>
					{GLYPHS[platform]}
				</span>
			}
		/>
	);
}
