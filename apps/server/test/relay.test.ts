import { describe, expect, test } from "bun:test";
import { clickEvents, dragEvents, RELAY_VERSION, relayCombo, relaySetupScript } from "../src/machines/relay.ts";

describe("Faster screen control (screen-relay)", () => {
	test("xdotool key names become screen-relay's", () => {
		expect(relayCombo("Return")).toBe("return");
		expect(relayCombo("ctrl+l")).toBe("ctrl+l");
		expect(relayCombo("ctrl+shift+T")).toBe("ctrl+shift+T");
		expect(relayCombo("alt+F4")).toBe("alt+f4");
		expect(relayCombo("BackSpace")).toBe("backspace");
		expect(relayCombo("Page_Down")).toBe("pagedown");
		expect(relayCombo("super")).toBe("super");
		expect(relayCombo("Escape")).toBe("esc");
		expect(relayCombo("ctrl+alt+Delete")).toBe("ctrl+alt+delete");
		expect(relayCombo("Up")).toBe("up");
		expect(relayCombo("ctrl+minus")).toBe("ctrl+-");
		expect(relayCombo("a")).toBe("a");
		expect(relayCombo("A")).toBe("A");
		// No such key in screen-relay: the helper presses it.
		expect(relayCombo("XF86AudioMute")).toBeNull();
		expect(relayCombo("ctrl+KP_Add")).toBeNull();
	});

	test("clicks and drags as input events, in fractions of the screen", () => {
		expect(clickEvents(0.5, 0.25, 1, 2)).toEqual([
			{ type: "pointerMove", x: 0.5, y: 0.25 },
			{ type: "buttonDown", button: 1, x: 0.5, y: 0.25 },
			{ type: "buttonUp", button: 1, x: 0.5, y: 0.25 },
			{ type: "buttonDown", button: 1, x: 0.5, y: 0.25 },
			{ type: "buttonUp", button: 1, x: 0.5, y: 0.25 },
		]);
		const drag = dragEvents(0.1, 0.1, 0.9, 0.5);
		expect(drag[1]).toEqual({ type: "buttonDown", button: 1, x: 0.1, y: 0.1 });
		expect(drag.at(-1)).toEqual({ type: "buttonUp", button: 1, x: 0.9, y: 0.5 });
		expect(drag.filter((e) => e.type === "pointerMove")).toHaveLength(9);
	});

	test("the setup script is valid bash, pinned, and keeps the token out of its log", async () => {
		const script = relaySetupScript();
		const check = Bun.spawn(["bash", "-n"], { stdin: new TextEncoder().encode(script), stderr: "pipe" });
		expect(await check.exited).toBe(0);
		expect(script).toContain(`screen-relay@${RELAY_VERSION}`);
		expect(script).toContain("--public https://screen-relay.invalid");
		// up prints a link with the token in it: never into the log, which only its account can read.
		expect(script).toMatch(/screen-relay up [^\n]*2>&1 >\/dev\/null \| sed -E 's\/\[0-9a-f\]\{64\}\/\(token\)\/g'/);
		expect(script).toContain("umask 077");
		expect(script).not.toMatch(/--show-token|status [^\n]*--json[^\n]*token/);
		// One port per screen, so seats on a shared computer each get their own.
		expect(script).toContain("PORT=$((7700 + N))");
	});
});
