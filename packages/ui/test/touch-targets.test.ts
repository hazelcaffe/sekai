import { describe, expect, test } from "bun:test";

/**
 * DESIGN.md's touch targets: 44pt on iOS, 48dp on Android and other touch screens. Controls drawn smaller get an
 * invisible hit area (hit-area, or hit-area-y for side-by-side segments) sized by --hit for the platform.
 */
const src = (file: string) => Bun.file(new URL(`../src/${file}`, import.meta.url)).text();
const css = await src("styles/index.css");

/** Where --hit is set, in order: the block's selector (or at-rule) and the value. */
const hits = [
	...css.matchAll(
		/(@media \(pointer: coarse\)|:root(?:\[data-platform="\w+"\])?)\s*\{\s*(?::root\s*\{\s*)?--hit:\s*([^;]+);/g,
	),
].map((m) => [m[1], m[2]]);

describe("touch targets", () => {
	test("--hit is 44pt on iOS and 48dp on Android and other touch screens, nothing with a mouse", () => {
		// iOS's rule is the more specific one, so it wins on an iPhone (whose pointer is coarse too).
		expect(hits).toEqual([
			[":root", "0px"],
			["@media (pointer: coarse)", "48px"],
			[':root[data-platform="android"]', "48px"],
			[':root[data-platform="ios"]', "44px"],
		]);
	});

	const controls: [string, string, string][] = [
		["shadcn/button.tsx", "hit-area", "buttons (xs, sm and the icon sizes)"],
		["shadcn/select.tsx", "hit-area", "selects (sm is 40px on touch)"],
		["shadcn/toggle-group.tsx", "hit-area-y", "segmented controls' segments"],
		["shadcn/switch.tsx", "hit-area", "switches"],
		["shadcn/checkbox.tsx", "hit-area", "checkboxes"],
		["shadcn/radio-group.tsx", "hit-area", "radio buttons"],
		["components/form.tsx", "hit-area", "the password field's show/hide button"],
	];
	for (const [file, cls, what] of controls) {
		test(what, async () => {
			expect((await src(file)).split(/[\s"'`]+/)).toContain(cls);
		});
	}
});
