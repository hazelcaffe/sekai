import { describe, expect, test } from "bun:test";
import { pickFrames, TeachDraftInput, TeachRecorder, type TeachStepInput } from "@sekai/shared";
import { describeStep, parseDraft, slug, teachMessages } from "../src/agent/teach.ts";

const IMG = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";

describe("Recording a demonstration", () => {
	test("a press and release is a click; moving between them a drag; two quick ones a double click", () => {
		const r = new TeachRecorder();
		expect(r.pointerDown(100, 200, "left", 0)).not.toBeNull();
		r.pointerUp(101, 201);
		// Again in the same place, quickly: the same click, now a double one (no new step to give a frame).
		expect(r.pointerDown(102, 199, "left", 300)).toBeNull();
		r.pointerUp(102, 199);
		r.pointerDown(10, 10, "left", 2000);
		r.pointerUp(300, 40);
		r.pointerDown(500, 500, "right", 5000);
		r.pointerUp(500, 500);
		expect(r.finish()).toEqual([
			{ kind: "click", at: 0, x: 100, y: 200, button: "left", window: null, double: true },
			{ kind: "drag", at: 2000, x: 10, y: 10, toX: 300, toY: 40, window: null, image: undefined },
			{ kind: "click", at: 5000, x: 500, y: 500, button: "right", window: null },
		]);
	});

	test("keys become typed runs, ended by a click, Enter, Tab or a shortcut", () => {
		const r = new TeachRecorder();
		const run = r.key({ key: "h" }, 0);
		expect(run?.kind).toBe("type");
		expect(r.key({ key: "i" }, 50)).toBeNull();
		r.key({ key: "x" }, 60);
		r.key({ key: "Backspace" }, 70);
		r.key({ key: "Shift" }, 75);
		r.key({ key: "!", shift: true }, 80);
		r.key({ key: "Enter" }, 100);
		r.key({ key: "l", ctrl: true }, 200);
		r.key({ key: "T", ctrl: true, shift: true }, 250);
		r.key({ key: "F5" }, 300);
		r.key({ key: "Backspace" }, 350);
		r.press("alt+Tab", 400);
		expect(
			r.finish().map((s) => (s.kind === "type" ? `type:${s.text}` : s.kind === "key" ? s.combo : s.kind)),
		).toEqual(["type:hi!", "Return", "ctrl+l", "ctrl+shift+t", "F5", "BackSpace", "alt+Tab"]);
	});

	test("hidden text is gone for good, a paste is its own step, and empty runs are dropped", () => {
		const r = new TeachRecorder();
		const run = r.key({ key: "s" }, 0);
		if (!run) throw new Error("no run");
		r.key({ key: "3" }, 10);
		r.hide(run, "Password");
		r.key({ key: "c" }, 20);
		r.key({ key: "Enter" }, 30);
		r.text("pasted words", 40, true);
		r.key({ key: "a" }, 50);
		r.key({ key: "Backspace" }, 60);
		const steps = r.finish();
		expect(steps).toEqual([
			{ kind: "secret", at: 0, window: null, field: "Password" },
			{ kind: "key", at: 30, combo: "Return", window: null },
			{ kind: "type", at: 40, text: "pasted words", pasted: true, window: null, field: null },
		]);
		expect(JSON.stringify(steps)).not.toContain("s3c");
	});

	test("wheel turns in one direction are one scroll", () => {
		const r = new TeachRecorder();
		r.wheel(50, 60, "down", 0);
		r.wheel(50, 60, "down", 500);
		r.wheel(50, 60, "down", 1200);
		r.wheel(50, 60, "up", 1300);
		r.wheel(50, 60, "up", 5000);
		expect(r.finish().map((s) => (s.kind === "scroll" ? `${s.direction}${s.amount}` : s.kind))).toEqual([
			"down3",
			"up1",
			"up1",
		]);
	});
});

describe("Writing it up", () => {
	const steps: TeachStepInput[] = [
		{ kind: "click", at: 1500, x: 720, y: 450, image: IMG, window: "Billing - Google Chrome" },
		{ kind: "type", at: 4000, text: "march", field: "Search" },
		{ kind: "secret", at: 6000, field: "Password" },
		{ kind: "key", at: 7000, combo: "Return" },
		{ kind: "scroll", at: 9000, x: 720, y: 450, direction: "down", amount: 3 },
		{ kind: "drag", at: 65_000, x: 0, y: 0, toX: 1440, toY: 900, image: IMG },
	];

	test("steps are described in the bot's screenshot pixels", () => {
		const scale = 1440 / 1280;
		const [click, typed, secret, key, scroll, drag] = TeachDraftInput.parse({
			goal: "x",
			screen: { width: 1440, height: 900 },
			steps,
		}).steps.map((s) => describeStep(s, scale));
		expect(click).toBe('Clicked at (640, 400) in "Billing - Google Chrome"');
		expect(typed).toBe('Typed "march" into "Search"');
		expect(secret).toContain("hidden");
		expect(key).toBe("Pressed Return");
		expect(scroll).toBe("Scrolled down 3 notches at (640, 400)");
		expect(drag).toBe("Dragged from (0, 0) to (1280, 800)");
	});

	test("the model gets the goal, notes, every step, the picked frames and the end screen", () => {
		const input = TeachDraftInput.parse({
			goal: "Download the March invoice",
			notes: "Always the latest month",
			screen: { width: 1440, height: 900 },
			steps,
			finalImage: IMG,
		});
		const [system, user] = teachMessages(input, "Miku");
		expect(system?.content).toContain("skill for Miku");
		expect(system?.content).toContain("1280x800");
		const parts = Array.isArray(user?.content) ? user.content : [];
		const texts = parts.flatMap((p) => (p.type === "text" ? [p.text] : []));
		expect(texts[0]).toContain("Download the March invoice");
		expect(texts[0]).toContain("Always the latest month");
		expect(texts).toContain("6. [1:05] Dragged from (0, 0) to (1280, 800)");
		expect(parts.filter((p) => p.type === "image_url")).toHaveLength(3);
		expect(JSON.stringify(parts)).not.toContain('Password" (');
	});

	test("frames: all of them when few, else the first, the last and an even spread", () => {
		const many: TeachStepInput[] = Array.from({ length: 40 }, (_, i) => ({
			kind: "click",
			at: i * 1000,
			x: 1,
			y: 1,
			image: IMG,
		}));
		const picked = pickFrames(many);
		expect(picked.size).toBe(19);
		expect(picked.has(0) && picked.has(39)).toBe(true);
		expect(pickFrames(steps)).toEqual(new Set([0, 5]));
	});

	test("the model's reply becomes a draft, with a usable name whatever it wrote", () => {
		const fenced =
			'Here it is:\n```json\n{"name": "march-invoice", "title": "Download an invoice", "description": "Use when asked for an invoice.", "instructions": "## Steps\\n1. Open billing"}\n```';
		expect(parseDraft(fenced, "goal")).toEqual({
			name: "march-invoice",
			title: "Download an invoice",
			description: "Use when asked for an invoice.",
			instructions: "## Steps\n1. Open billing",
		});
		const odd = parseDraft('{"name": "Not A Slug!", "title": "Export the Report", "instructions": "1. Go"}', "x");
		expect(odd.name).toBe("export-the-report");
		expect(odd.description).toBe("Use when asked to x.");
		expect(parseDraft("1. Open the app\n2. Click Export", "Export the report").instructions).toContain(
			"Click Export",
		);
		expect(() => parseDraft('{"title": "Only a title"}', "x")).toThrow();
		expect(slug("Ça va: Überweisung 2026!")).toBe("ca-va-uberweisung-2026");
		expect(slug("!!!")).toBe("taught-skill");
	});

	test("frames must be images, so nothing else rides along to the model", () => {
		const bad = TeachDraftInput.safeParse({
			goal: "x",
			screen: { width: 1440, height: 900 },
			steps: [{ kind: "click", at: 0, x: 1, y: 1, image: "https://example.com/tracker.png" }],
		});
		expect(bad.success).toBe(false);
	});
});
