import { z } from "zod";

/**
 * Teaching a bot by doing it once: while you're in control of its computer in Sekai, the app records what you do
 * (clicks, drags, scrolls, keys and typing, with the screen at each click), you check what it saw, and a model
 * writes it up as a skill you review before it's saved. Text typed into a password field is never recorded.
 */

const coord = z.number().int().min(0).max(20_000);
/** A frame of the screen as a data URL (JPEG), with the click marked on it. */
const frame = z
	.string()
	.max(1_200_000)
	.regex(/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/)
	.optional();
const base = {
	/** Milliseconds since the recording started. */
	at: z.number().int().min(0),
	/** The active window's title then, when Sekai could tell. */
	window: z.string().max(300).nullable().default(null),
};

/** Coordinates are the computer's own screen pixels. */
export const TeachStep = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("click"),
		...base,
		x: coord,
		y: coord,
		button: z.enum(["left", "middle", "right"]).default("left"),
		double: z.boolean().default(false),
		image: frame,
	}),
	z.object({ kind: z.literal("drag"), ...base, x: coord, y: coord, toX: coord, toY: coord, image: frame }),
	z.object({
		kind: z.literal("scroll"),
		...base,
		x: coord,
		y: coord,
		direction: z.enum(["up", "down", "left", "right"]),
		amount: z.number().int().min(1).max(10_000),
	}),
	z.object({
		kind: z.literal("type"),
		...base,
		text: z.string().max(20_000),
		/** The field it went into, when Sekai could tell ("Search", "Subject"…). */
		field: z.string().max(200).nullable().default(null),
		pasted: z.boolean().default(false),
	}),
	/** Typed into a password field, or hidden by you: its text never left your browser. */
	z.object({ kind: z.literal("secret"), ...base, field: z.string().max(200).nullable().default(null) }),
	/** A key or shortcut, in xdotool's names (Return, ctrl+l, alt+F4). */
	z.object({ kind: z.literal("key"), ...base, combo: z.string().min(1).max(80) }),
]);
export type TeachStep = z.infer<typeof TeachStep>;
export type TeachStepInput = z.input<typeof TeachStep>;

export const TeachDraftInput = z.object({
	/** A bot with a seat on the computer (its own screen there); without it, the computer's own bot. */
	agentId: z.string().optional(),
	/** What you showed it, in your words. */
	goal: z.string().trim().min(1).max(500),
	/** Anything it should know that the screen doesn't show. */
	notes: z.string().trim().max(4000).default(""),
	/** The computer's screen size (the steps' coordinates are in it). */
	screen: z.object({ width: z.number().int().min(100).max(20_000), height: z.number().int().min(100).max(20_000) }),
	steps: z.array(TeachStep).min(1).max(500),
	/** The screen when you stopped. */
	finalImage: frame,
});
export type TeachDraftInput = z.input<typeof TeachDraftInput>;

/** The skill a model wrote from a demonstration, for you to review. */
export interface SkillDraft {
	name: string;
	title: string;
	description: string;
	instructions: string;
	/** The model that wrote it. */
	model: string;
}

export const TeachSave = z.object({
	agentId: z.string().optional(),
	name: z.string().trim().min(1).max(63),
	title: z.string().trim().min(1).max(120),
	description: z.string().trim().min(1).max(1000),
	instructions: z.string().max(100_000),
});
export type TeachSave = z.input<typeof TeachSave>;

/** What's on the computer's screen at a step: the active window, and (when asked) the field with focus. */
export interface TeachContext {
	window: string | null;
	app: string | null;
	focused: { role: string | null; name: string | null; password: boolean } | null;
}

/** At most this many frames of the screen go to the model with a demonstration. */
export const TEACH_MAX_IMAGES = 20;
/** Recordings stop on their own after this long. */
export const TEACH_MAX_MS = 20 * 60_000;

/** The frames worth sending: the first and last click, and an even spread of the rest (indexes into steps). */
export function pickFrames(steps: TeachStepInput[], max = TEACH_MAX_IMAGES - 1): Set<number> {
	const withImage = steps.flatMap((s, i) => ((s.kind === "click" || s.kind === "drag") && s.image ? [i] : []));
	if (withImage.length <= max) return new Set(withImage);
	const picked = new Set<number>();
	for (let k = 0; k < max; k++) {
		const i = withImage[Math.round((k * (withImage.length - 1)) / (max - 1))];
		if (i !== undefined) picked.add(i);
	}
	return picked;
}

/** A key as the recorder gets it (from the keyboard, or the takeover's toolbar). */
export interface TeachKey {
	key: string;
	ctrl?: boolean;
	alt?: boolean;
	meta?: boolean;
	shift?: boolean;
}

const MODIFIERS = new Set(["Shift", "Control", "Alt", "AltGraph", "Meta", "OS", "CapsLock", "NumLock", "Fn"]);
const KEY_NAMES: Record<string, string> = {
	Enter: "Return",
	Backspace: "BackSpace",
	Escape: "Escape",
	Tab: "Tab",
	ArrowUp: "Up",
	ArrowDown: "Down",
	ArrowLeft: "Left",
	ArrowRight: "Right",
	Delete: "Delete",
	Home: "Home",
	End: "End",
	PageUp: "Page_Up",
	PageDown: "Page_Down",
	Insert: "Insert",
	ContextMenu: "Menu",
	PrintScreen: "Print",
	" ": "space",
};

/** xdotool's name for a key ("Return", "a", "F5"). */
export function keyName(key: string): string {
	if (KEY_NAMES[key]) return KEY_NAMES[key];
	if (/^F\d{1,2}$/.test(key)) return key;
	return key.length === 1 ? key.toLowerCase() : key;
}

type Step = TeachStepInput;
type TypedStep = Extract<Step, { kind: "type" } | { kind: "secret" }>;

/**
 * Turns what you do on the screen into steps: a press and release is a click (or a drag when the pointer moved),
 * two quick clicks in one place a double click, wheel turns in one direction one scroll, and keys a typed run of
 * text until a click, Enter, Tab or a shortcut ends it. Pure: the app feeds it events and gets the steps.
 */
export class TeachRecorder {
	readonly steps: Step[] = [];
	private down: { x: number; y: number; step: Extract<Step, { kind: "click" }> | null } | null = null;
	private run: TypedStep | null = null;

	/** A button went down at (x, y). Returns the new click step, so a frame and window can be added to it. */
	pointerDown(x: number, y: number, button: "left" | "middle" | "right", at: number) {
		this.endRun();
		const last = this.steps.at(-1);
		if (
			last?.kind === "click" &&
			!last.double &&
			(last.button ?? "left") === button &&
			at - last.at < 450 &&
			Math.abs(last.x - x) <= 8 &&
			Math.abs(last.y - y) <= 8
		) {
			last.double = true;
			this.down = { x, y, step: null };
			return null;
		}
		const step: Extract<Step, { kind: "click" }> = { kind: "click", at, x, y, button, window: null };
		this.steps.push(step);
		this.down = { x, y, step };
		return step;
	}

	/** The button came back up: a click stays a click, unless the pointer travelled (then it was a drag). */
	pointerUp(x: number, y: number): void {
		const d = this.down;
		this.down = null;
		if (!d?.step || Math.hypot(x - d.x, y - d.y) <= 10) return;
		const i = this.steps.indexOf(d.step);
		if (i < 0) return;
		const { at, window, image } = d.step;
		this.steps[i] = { kind: "drag", at, window, image, x: d.x, y: d.y, toX: x, toY: y };
	}

	wheel(x: number, y: number, direction: "up" | "down" | "left" | "right", at: number): void {
		this.endRun();
		const last = this.steps.at(-1);
		if (last?.kind === "scroll" && last.direction === direction && at - last.at < 1500) {
			last.amount += 1;
			last.at = at;
			return;
		}
		this.steps.push({ kind: "scroll", at, x, y, direction, amount: 1, window: null });
	}

	/** A key press. Returns the typed run when this key started one (the app then checks for a password field). */
	key(k: TeachKey, at: number): TypedStep | null {
		if (MODIFIERS.has(k.key)) return null;
		const mods = [k.ctrl && "ctrl", k.alt && "alt", k.meta && "super"].filter(Boolean) as string[];
		if (mods.length) {
			const name = keyName(k.key);
			const shift = k.shift && name.length === 1 ? ["shift"] : [];
			this.push({ kind: "key", at, combo: [...mods, ...shift, name].join("+"), window: null });
			return null;
		}
		if (k.key.length === 1 || [...k.key].length === 1) return this.append(k.key, at);
		if (k.key === "Backspace" && this.run) {
			if (this.run.kind === "type") this.run.text = [...this.run.text].slice(0, -1).join("");
			return null;
		}
		this.push({ kind: "key", at, combo: keyName(k.key), window: null });
		return null;
	}

	/** A shortcut pressed some other way (the takeover's Keys menu), already in xdotool's names. */
	press(combo: string, at: number): void {
		this.push({ kind: "key", at, combo, window: null });
	}

	/** Text typed in one go (a phone keyboard), or pasted: a paste is its own step. */
	text(text: string, at: number, pasted = false): TypedStep | null {
		if (!text) return null;
		if (!pasted) return this.append(text, at);
		this.endRun();
		const step: TypedStep = { kind: "type", at, text, pasted: true, window: null, field: null };
		this.steps.push(step);
		return step;
	}

	/** The field a typed run went into turned out to be a password field (or you hid it): its text is dropped. */
	hide(step: TypedStep, field: string | null = null): void {
		const i = this.steps.indexOf(step);
		if (i < 0) return;
		const secret: TypedStep = { kind: "secret", at: step.at, window: step.window, field: field ?? step.field };
		this.steps[i] = secret;
		if (this.run === step) this.run = secret;
	}

	/** The steps so far, without empty typed runs. */
	finish(): Step[] {
		this.endRun();
		return this.steps.filter((s) => s.kind !== "type" || s.text.length > 0);
	}

	private append(text: string, at: number): TypedStep | null {
		if (this.run) {
			if (this.run.kind === "type") this.run.text += text;
			return null;
		}
		const run: TypedStep = { kind: "type", at, text, window: null, field: null };
		this.steps.push(run);
		this.run = run;
		return run;
	}

	private push(step: Step): void {
		this.endRun();
		this.steps.push(step);
	}

	private endRun(): void {
		this.run = null;
	}
}
