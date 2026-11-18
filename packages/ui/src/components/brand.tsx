/// <reference path="../assets.d.ts" />
import logo from "../assets/sekai-logo.png";
import { cn } from "../lib/utils.ts";

/** Sekai's logo: the Virtual Singer Miku icon from the Colorful Stage media kit, shown whole and unmodified. */
export function SekaiMark({ className, size = 32 }: { className?: string; size?: number }) {
	return (
		<img
			src={logo}
			width={size}
			height={size}
			alt=""
			aria-hidden
			draggable={false}
			className={cn("shrink-0 rounded-full select-none", className)}
		/>
	);
}
