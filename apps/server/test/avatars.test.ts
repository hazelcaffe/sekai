import { describe, expect, test } from "bun:test";
import { Avatar, GALLERY, GALLERY_UNITS, galleryIcon, galleryShortName, randomAvatar } from "@sekai/shared";
import { avatarFor } from "../src/agent/tools/agents.ts";

describe("character gallery", () => {
	test("ids are unique, units exist, files look like the media kit's", () => {
		expect(new Set(GALLERY.map((g) => g.id)).size).toBe(GALLERY.length);
		const units = new Set(GALLERY_UNITS.map((u) => u.id));
		for (const g of GALLERY) {
			expect(units.has(g.unit)).toBe(true);
			expect(g.file).toMatch(/^([0-9a-f]{40}|icon_\d\d_unit0[2-6]_[a-z]+)\.png$/);
			expect(g.color).toMatch(/^#[0-9A-F]{6}$/);
		}
		expect(GALLERY.length).toBe(36);
	});

	test("short names", () => {
		const miku = galleryIcon("vs-miku");
		const ichika = galleryIcon("ln-ichika");
		const unitMiku = galleryIcon("n25-miku");
		expect(miku && galleryShortName(miku)).toBe("Miku");
		expect(ichika && galleryShortName(ichika)).toBe("Ichika");
		expect(unitMiku && galleryShortName(unitMiku)).toBe("Miku");
	});

	test("new bots get a stable character icon", () => {
		const a = randomAvatar("Juniper");
		expect(a).toEqual(randomAvatar("Juniper"));
		expect(a.kind).toBe("gallery");
		expect(Avatar.safeParse(a).success).toBe(true);
	});

	test("bots creating bots can pick a character, a drawn look, or nothing", () => {
		expect(avatarFor({ name: "x", character: "wxs-emu" })).toEqual({
			kind: "gallery",
			id: "wxs-emu",
			color: "#ff66bb",
		});
		const drawn = avatarFor({ name: "x", shape: "star", color: "teal" });
		expect(drawn).toMatchObject({ kind: "character", shape: "star", color: "#2ec4b6" });
		expect(avatarFor({ name: "x" }).kind).toBe("gallery");
	});
});
