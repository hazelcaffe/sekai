import { BrandTile } from "@sekai/client";

/** The same bundled brand marks used by account and provider tiles. */
export function ChannelIcon({ type, size = 32, className }: { type: string; size?: number; className?: string }) {
	return (
		<BrandTile
			brand={type === "slack" ? "slack" : type.startsWith("discord") ? "discord" : null}
			size={size}
			className={className}
		/>
	);
}
