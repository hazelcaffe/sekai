import { Switch as SwitchPrimitive } from "radix-ui";
import type * as React from "react";
import { usePlatform } from "../lib/platform.ts";
import { cn } from "../lib/utils.ts";

/*
 * Each platform's own switch. The web's is 40×24 (32×20 small). iOS's is HIG's 51×31, its thumb stretching while
 * pressed. Android's is Material 3's 52×32: off, an outlined track with a small thumb in the outline's colour; on, a
 * filled track with a bigger white thumb; pressed, a bigger thumb still. Off tracks and outlines are border-strong
 * (3:1).
 */
/** Every switch's track: brand when on, border-strong when off (3:1). */
export const switchTrack =
	"peer group/switch relative inline-flex shrink-0 items-center rounded-full transition-colors duration-panel hit-area hit-pad-2 disabled:cursor-not-allowed disabled:opacity-50 data-checked:bg-brand data-unchecked:bg-border-strong";
/** Each look's size; Android's off track is a fill with a border-strong outline. */
export const SWITCH_TRACK = {
	default: "h-6 w-10 p-0.5",
	sm: "h-5 w-8 p-0.5",
	ios: "h-7.75 w-12.75 p-0.5",
	android: "h-8 w-13 border-2 border-transparent data-unchecked:border-border-strong data-unchecked:bg-surface-2",
};
const SWITCH_THUMB = {
	default:
		"size-5 bg-paper shadow-soft data-checked:translate-x-4 group-active/switch:w-6 group-active/switch:data-checked:translate-x-3",
	sm: "size-4 bg-paper shadow-soft data-checked:translate-x-3 group-active/switch:w-5 group-active/switch:data-checked:translate-x-2",
	ios: "size-6.75 bg-paper shadow-soft data-checked:translate-x-5 group-active/switch:w-8.25 group-active/switch:data-checked:translate-x-3.5",
	android:
		"size-4 translate-x-1.5 bg-border-strong data-checked:size-6 data-checked:translate-x-5.5 data-checked:bg-paper group-active/switch:size-7 group-active/switch:data-checked:translate-x-5 group-active/switch:data-unchecked:translate-x-0",
};

function Switch({
	className,
	size = "default",
	...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & { size?: "sm" | "default" }) {
	const platform = usePlatform();
	const look = platform === "web" ? size : platform;
	return (
		<SwitchPrimitive.Root
			data-slot="switch"
			data-size={size}
			className={cn(switchTrack, SWITCH_TRACK[look], className)}
			{...props}
		>
			<SwitchPrimitive.Thumb
				data-slot="switch-thumb"
				className={cn(
					"pointer-events-none block rounded-full transition-[translate,width,height,background-color] duration-panel ease-spring",
					SWITCH_THUMB[look],
				)}
			/>
		</SwitchPrimitive.Root>
	);
}

export { Switch };
