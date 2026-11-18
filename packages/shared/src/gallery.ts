/**
 * Character icons from the HATSUNE MIKU: COLORFUL STAGE! media kit (https://colorfulstage.com/media/mediakits/).
 * They ship with Sekai, unmodified (apps/server/assets/gallery), and the apps show them whole: no cropping,
 * recoloring or overlays on the picture itself. Sekai's logo is the Virtual Singer Miku icon (vs-miku).
 */
export const GALLERY_SOURCE = "https://colorfulstage.com/upload_images/media/mediakits/";
export const GALLERY_PAGE = "https://colorfulstage.com/media/mediakits/";
export const GALLERY_CREDIT = "© SEGA / © Colorful Palette / © Crypton Future Media, INC. www.piapro.net";

export interface GalleryUnit {
	id: string;
	name: string;
}

export interface GalleryIcon {
	/** Stable id stored in avatars, e.g. "vs-miku" or "ln-ichika". */
	id: string;
	name: string;
	unit: string;
	/** File name on colorfulstage.com. */
	file: string;
	/** The character's color: tints the bot's chat and its avatar's ring. */
	color: string;
}

export const GALLERY_UNITS: GalleryUnit[] = [
	{ id: "vs", name: "Virtual Singers" },
	{ id: "ln", name: "Leo/need" },
	{ id: "mmj", name: "MORE MORE JUMP!" },
	{ id: "vbs", name: "Vivid BAD SQUAD" },
	{ id: "wxs", name: "Wonderlands×Showtime" },
	{ id: "n25", name: "Nightcord at 25:00" },
];

const vs = (id: string, name: string, hash: string, color: string): GalleryIcon => ({
	id: `vs-${id}`,
	name,
	unit: "vs",
	file: `${hash}.png`,
	color,
});

const unitIcon = (
	unit: string,
	unitNo: string,
	n: number,
	id: string,
	name: string,
	color: string,
	file = id,
): GalleryIcon => ({
	id: `${unit}-${id}`,
	name,
	unit,
	file: `icon_${String(n).padStart(2, "0")}_unit${unitNo}_${file}.png`,
	color,
});

export const GALLERY: GalleryIcon[] = [
	vs("miku", "Hatsune Miku", "84c65d715f3d121b6c1a8e3c5bc4f8e005b5c8f2", "#33CCBB"),
	vs("rin", "Kagamine Rin", "3a406e52fa09a7a36b94480b4ba09d39cc9ba75c", "#FFCC11"),
	vs("len", "Kagamine Len", "66966e1a93ec65e4ce54a64d2f5cdb90b0f3aa40", "#FFEE11"),
	vs("luka", "Megurine Luka", "b630b108cdea9cf7351c9aedd88ee336b2f07d74", "#FFBBCC"),
	vs("meiko", "MEIKO", "01dc3163b4241a18827b9a4673d348c9e72948fb", "#DD4444"),
	vs("kaito", "KAITO", "668bd7a0c4d6736a6807ba4fe869c316ac07d873", "#3366CC"),

	unitIcon("ln", "02", 1, "ichika", "Ichika Hoshino", "#33AAEE", "ichica"),
	unitIcon("ln", "02", 2, "saki", "Saki Tenma", "#FFDD44"),
	unitIcon("ln", "02", 3, "honami", "Honami Mochizuki", "#EE6666"),
	unitIcon("ln", "02", 4, "shiho", "Shiho Hinomori", "#BBDD22"),
	unitIcon("ln", "02", 5, "miku", "Hatsune Miku (Leo/need)", "#33CCBB"),
	unitIcon("ln", "02", 6, "luka", "Megurine Luka (Leo/need)", "#FFBBCC"),

	unitIcon("mmj", "03", 1, "minori", "Minori Hanasato", "#FFCCAA"),
	unitIcon("mmj", "03", 2, "haruka", "Haruka Kiritani", "#99CCFF"),
	unitIcon("mmj", "03", 3, "airi", "Airi Momoi", "#FFAACC"),
	unitIcon("mmj", "03", 4, "shizuku", "Shizuku Hinomori", "#99EEDD"),
	unitIcon("mmj", "03", 5, "miku", "Hatsune Miku (MORE MORE JUMP!)", "#33CCBB"),
	unitIcon("mmj", "03", 6, "rin", "Kagamine Rin (MORE MORE JUMP!)", "#FFCC11"),

	unitIcon("vbs", "04", 1, "kohane", "Kohane Azusawa", "#FF6699"),
	unitIcon("vbs", "04", 2, "an", "An Shiraishi", "#00BBDD"),
	unitIcon("vbs", "04", 3, "akito", "Akito Shinonome", "#FF7722"),
	unitIcon("vbs", "04", 4, "toya", "Toya Aoyagi", "#0077DD"),
	unitIcon("vbs", "04", 5, "miku", "Hatsune Miku (Vivid BAD SQUAD)", "#33CCBB"),
	unitIcon("vbs", "04", 6, "len", "Kagamine Len (Vivid BAD SQUAD)", "#FFEE11"),
	unitIcon("vbs", "04", 7, "meiko", "MEIKO (Vivid BAD SQUAD)", "#DD4444"),

	unitIcon("wxs", "05", 1, "tsukasa", "Tsukasa Tenma", "#FFBB00"),
	unitIcon("wxs", "05", 2, "emu", "Emu Otori", "#FF66BB"),
	unitIcon("wxs", "05", 3, "nene", "Nene Kusanagi", "#33DD99"),
	unitIcon("wxs", "05", 4, "rui", "Rui Kamishiro", "#BB88EE"),
	unitIcon("wxs", "05", 5, "miku", "Hatsune Miku (Wonderlands×Showtime)", "#33CCBB"),
	unitIcon("wxs", "05", 6, "kaito", "KAITO (Wonderlands×Showtime)", "#3366CC"),

	unitIcon("n25", "06", 1, "kanade", "Kanade Yoisaki", "#BB6688"),
	unitIcon("n25", "06", 2, "mafuyu", "Mafuyu Asahina", "#8888CC"),
	unitIcon("n25", "06", 3, "ena", "Ena Shinonome", "#CCAA88"),
	unitIcon("n25", "06", 4, "mizuki", "Mizuki Akiyama", "#DDAACC"),
	unitIcon("n25", "06", 5, "miku", "Hatsune Miku (Nightcord at 25:00)", "#33CCBB"),
];

const BY_ID = new Map(GALLERY.map((g) => [g.id, g]));

export function galleryIcon(id: string): GalleryIcon | undefined {
	return BY_ID.get(id);
}

/** The first name, without the unit, e.g. "Ichika" or "Miku". */
export function galleryShortName(icon: GalleryIcon): string {
	const base = icon.name.replace(/\s*\(.*\)$/, "");
	const parts = base.split(" ");
	// Virtual singers go by their given name, which comes last (Hatsune Miku → Miku); the others' comes first.
	const singer = VIRTUAL_SINGERS.has(icon.id.split("-")[1] ?? "");
	return (singer ? parts.at(-1) : parts[0]) ?? base;
}

const VIRTUAL_SINGERS = new Set(["miku", "rin", "len", "luka", "meiko", "kaito"]);
