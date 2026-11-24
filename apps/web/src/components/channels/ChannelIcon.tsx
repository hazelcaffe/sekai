import { BrandTile } from "@sekai/client";
import { Mail } from "lucide-react";

/** The same bundled brand marks used by account and provider tiles. */
export function ChannelIcon({ type, size = 32, className }: { type: string; size?: number; className?: string }) {
	if (type === "email")
		return <Mail size={size} aria-label="Email" className={`bg-surface text-brand-ink ${className ?? ""}`} />;
	return (
		<BrandTile
			brand={type === "slack" || type === "signal" ? type : type.startsWith("discord") ? "discord" : null}
			size={size}
			className={className}
		/>
	);
}
