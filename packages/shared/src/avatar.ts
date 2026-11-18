import { z } from "zod";
import { GALLERY } from "./gallery.ts";

export const AVATAR_SHAPES = [
	"blob",
	"circle",
	"squircle",
	"flower",
	"star",
	"cloud",
	"ghost",
	"drop",
	"bean",
	"gem",
] as const;
export type AvatarShape = (typeof AVATAR_SHAPES)[number];

export const AVATAR_FACES = ["happy", "calm", "wink", "curious", "sleepy", "focused", "none"] as const;
export type AvatarFace = (typeof AVATAR_FACES)[number];

/** Palette for character avatars, chosen to read well on both dark and light backgrounds. */
export const AVATAR_COLORS = {
	coral: "#ff7a6b",
	tangerine: "#ff9f43",
	sunflower: "#ffcd3c",
	lime: "#a3e048",
	mint: "#3ddc97",
	teal: "#2ec4b6",
	sky: "#4cc9f0",
	azure: "#4f8cff",
	iris: "#7c6cff",
	lilac: "#b388ff",
	pink: "#ff7eb6",
	slate: "#94a3b8",
} as const;
export type AvatarColorName = keyof typeof AVATAR_COLORS;
export const AVATAR_COLOR_NAMES = Object.keys(AVATAR_COLORS) as AvatarColorName[];

const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const Avatar = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("character"),
		shape: z.enum(AVATAR_SHAPES),
		color: HexColor,
		face: z.enum(AVATAR_FACES).default("happy"),
	}),
	z.object({ kind: z.literal("emoji"), emoji: z.string().min(1).max(16), color: HexColor }),
	z.object({ kind: z.literal("image"), url: z.string().min(1) }),
	/** A character icon from the Colorful Stage media kit (see gallery.ts); color is the character's. */
	z.object({ kind: z.literal("gallery"), id: z.string().min(1).max(40), color: HexColor }),
]);
export type Avatar = z.infer<typeof Avatar>;

/** A random character icon from the gallery (stable for a seed, such as the bot's name). */
export function randomAvatar(seed?: string): Avatar {
	const n = seed ? hash(seed) : Math.floor(Math.random() * 1_000_000);
	const icon = GALLERY[n % GALLERY.length];
	return icon ? { kind: "gallery", id: icon.id, color: icon.color.toLowerCase() } : randomCharacter(seed);
}

/** A random drawn character (shape, color and face). */
export function randomCharacter(seed?: string): Extract<Avatar, { kind: "character" }> {
	const n = seed ? hash(seed) : Math.floor(Math.random() * 1_000_000);
	const shape = AVATAR_SHAPES[n % AVATAR_SHAPES.length] ?? "blob";
	const colorName = AVATAR_COLOR_NAMES[Math.floor(n / 7) % AVATAR_COLOR_NAMES.length] ?? "iris";
	const faces = AVATAR_FACES.filter((f) => f !== "none");
	const face = faces[Math.floor(n / 13) % faces.length] ?? "happy";
	return { kind: "character", shape, color: AVATAR_COLORS[colorName], face };
}

/** The color that tints a bot's chat, when its avatar has one. */
export function avatarColor(avatar: Avatar): string | undefined {
	return avatar.kind === "image" ? undefined : avatar.color;
}

function hash(s: string): number {
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return Math.abs(h);
}
