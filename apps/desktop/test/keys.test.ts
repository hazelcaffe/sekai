import { describe, expect, test } from "bun:test";
import { macCombo, windowsCombo, xdotoolCombo } from "../src/local/combos.ts";
import { parseCombo } from "../src/local/keys.ts";

describe("key combos", () => {
	test("parsing", () => {
		expect(parseCombo("ctrl+l")).toEqual({ modifiers: ["ctrl"], key: "l" });
		expect(parseCombo("Return")).toEqual({ modifiers: [], key: "enter" });
		expect(parseCombo("super")).toEqual({ modifiers: ["meta"], key: null });
		expect(parseCombo("cmd+shift+t")).toEqual({ modifiers: ["meta", "shift"], key: "t" });
		expect(parseCombo("ctrl++")).toEqual({ modifiers: ["ctrl"], key: "+" });
		expect(parseCombo("Control_L+c")).toEqual({ modifiers: ["ctrl"], key: "c" });
		expect(() => parseCombo("ctrl+banana")).toThrow(/Unknown key/);
		expect(() => parseCombo("l+ctrl+x")).toThrow(/isn't a modifier/);
	});

	test("Linux (xdotool names)", () => {
		expect(xdotoolCombo("ctrl+l")).toBe("ctrl+l");
		expect(xdotoolCombo("Page_Down")).toBe("Next");
		expect(xdotoolCombo("alt+f4")).toBe("alt+F4");
		expect(xdotoolCombo("cmd+space")).toBe("super+space");
		expect(xdotoolCombo("ctrl++")).toBe("ctrl+plus");
	});

	test("Windows (virtual keys)", () => {
		expect(windowsCombo("ctrl+c")).toEqual({ vks: [0x11, 0x43] });
		expect(windowsCombo("alt+F4")).toEqual({ vks: [0x12, 0x73] });
		expect(windowsCombo("Return")).toEqual({ vks: [0x0d] });
		expect(windowsCombo("win")).toEqual({ vks: [0x5b] });
		expect(windowsCombo("ctrl+/")).toEqual({ vks: [0x11], char: "/" });
	});

	test("macOS (key codes)", () => {
		expect(macCombo("cmd+c")).toEqual({ mods: ["meta"], code: 8 });
		expect(macCombo("Return")).toEqual({ mods: [], code: 36 });
		expect(macCombo("cmd+shift+t")).toEqual({ mods: ["meta", "shift"], code: 17 });
		expect(macCombo("A")).toEqual({ mods: ["shift"], code: 0 });
		expect(macCombo("cmd")).toEqual({ mods: [], code: 55 });
		expect(macCombo("alt+é")).toEqual({ mods: ["alt"], code: null, char: "é" });
	});
});
