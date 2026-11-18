/**
 * What the desktop app can do on this computer for bots. Coordinates are the computer's own input
 * coordinates: X pixels on Linux, physical pixels on Windows (the helper is DPI-aware), points on macOS.
 * The server scales screenshots and converts the bot's clicks into these.
 */

export interface DesktopWindow {
	id: string;
	app: string;
	title: string;
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface DesktopInfo {
	width: number;
	height: number;
	pointer: [number, number];
	activeWindow: string | null;
	windows: DesktopWindow[];
}

export interface UiElement {
	id: string;
	role: string;
	name: string;
	box: [number, number, number, number] | null;
	states: string[];
	value: string | null;
	actions: string[];
}

export interface UiTree {
	activeWindow: string | null;
	apps: string[];
	elements: UiElement[];
	truncated?: boolean;
}

export type Button = "left" | "middle" | "right";
export type Direction = "up" | "down" | "left" | "right";

export interface Platform {
	/** Can this computer be used at all (tools installed, permissions granted)? Null when it can. */
	problem(): Promise<string | null>;
	info(): Promise<DesktopInfo>;
	/** A PNG of the main screen, at most maxWidth wide. */
	screenshot(maxWidth: number): Promise<Buffer>;
	tree(app?: string, all?: boolean): Promise<UiTree>;
	act(id: string, action?: string): Promise<{ did: string }>;
	focus(id: string): Promise<void>;
	click(x: number, y: number, button: Button, count: number): Promise<void>;
	move(x: number, y: number): Promise<void>;
	drag(x1: number, y1: number, x2: number, y2: number): Promise<void>;
	scroll(x: number, y: number, direction: Direction, amount: number): Promise<void>;
	type(text: string): Promise<void>;
	key(combos: string[]): Promise<void>;
	windows(): Promise<{ activeWindow: string | null; windows: DesktopWindow[] }>;
	activate(id: string): Promise<void>;
	open(command: string): Promise<void>;
	/** Stops helper processes. */
	dispose(): void;
}
