import { cn } from "@sekai/client";
import type { ChannelType } from "@sekai/shared";
import type { ReactNode } from "react";

/** Discord's mark, drawn as a simple glyph (no bundled logo asset). */
function DiscordGlyph() {
	return (
		<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
			<path d="M19.3 5.3A16.6 16.6 0 0 0 15.2 4l-.5 1a15.3 15.3 0 0 0-5.4 0l-.5-1a16.6 16.6 0 0 0-4.1 1.3C2.1 9.2 1.4 13 1.7 16.7a16.8 16.8 0 0 0 5 2.6l1.1-1.7c-.6-.2-1.2-.5-1.7-.8l.4-.3a11.9 11.9 0 0 0 10.9 0l.4.3c-.5.3-1.1.6-1.7.8l1.1 1.7a16.7 16.7 0 0 0 5-2.6c.4-4.3-.7-8.1-2.9-11.4ZM8.7 14.4c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Zm6.6 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Z" />
		</svg>
	);
}

const LOOK: Record<ChannelType, { bg: string; icon: ReactNode }> = {
	discord: { bg: "#5865F2", icon: <DiscordGlyph /> },
	"discord-user": { bg: "#4752c4", icon: <DiscordGlyph /> },
};

const UNKNOWN = { bg: "#6b7280", icon: null };

export function ChannelIcon({ type, size = 32, className }: { type: string; size?: number; className?: string }) {
	const look = LOOK[type as ChannelType] ?? UNKNOWN;
	return (
		<span
			className={cn(
				"inline-flex shrink-0 items-center justify-center rounded-xl text-white [&_svg]:size-[58%]",
				className,
			)}
			style={{ width: size, height: size, background: look.bg }}
		>
			{look.icon}
		</span>
	);
}
