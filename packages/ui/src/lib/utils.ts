import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/** Sekai's own utilities, so cn() knows text-body is a size (not a colour) and z-dialog a layer. */
const twMerge = extendTailwindMerge({
	extend: {
		classGroups: {
			"font-size": [{ text: ["caption", "small", "body", "message", "heading", "title", "display"] }],
			z: [{ z: ["sticky", "panel", "overlay", "takeover", "dialog", "menu", "tooltip", "toast"] }],
			rounded: [{ rounded: ["sheet"] }],
			"rounded-t": [{ "rounded-t": ["sheet"] }],
			"max-w": [{ "max-w": ["form", "wide"] }],
			duration: [{ duration: ["fast", "panel"] }],
			shadow: [{ shadow: ["soft", "pop"] }],
		},
	},
});

export function cn(...inputs: ClassValue[]): string {
	return twMerge(clsx(inputs));
}
