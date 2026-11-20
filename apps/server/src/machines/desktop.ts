import helperSource from "./sekai-desktop.py" with { type: "text" };
import { HELPER_PATH, installHelperScript } from "./setup.ts";

/** The exit code COMMAND uses when the helper isn't installed. */
const MISSING = 97;

import { clickEvents, dragEvents, relayCombo, ScreenRelay } from "./relay.ts";
import { type SshTarget, shq, sshExec, sshText } from "./ssh.ts";

/**
 * A bot's desktop, driven through sekai-desktop over SSH. Tools speak in screenshot pixels (what the model
 * sees, at most SHOT_WIDTH wide); this converts to real screen pixels.
 */

export const SHOT_WIDTH = 1280;

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

export interface Screenshot {
	png: Uint8Array;
	/** Real screen pixels per screenshot pixel. */
	scale: number;
	width: number;
	height: number;
}

/** Width and height from a PNG's header. */
export function pngSize(png: Uint8Array): { width: number; height: number } {
	const v = new DataView(png.buffer, png.byteOffset, png.byteLength);
	if (png.length < 24 || v.getUint32(0) !== 0x89504e47) throw new Error("Not a PNG");
	return { width: v.getUint32(16), height: v.getUint32(20) };
}

/**
 * Seeing and using a desktop. Coordinates are in screenshot pixels (at most SHOT_WIDTH wide); each machine
 * kind converts to its own screen. Implemented over SSH (bots' computers) and over the desktop app (yours).
 */
export interface DesktopControl {
	info(): Promise<DesktopInfo>;
	/** Real screen pixels per screenshot pixel. */
	scale(): Promise<number>;
	screenshot(): Promise<Screenshot>;
	tree(app?: string, all?: boolean): Promise<{ activeWindow: string | null; apps: string[]; elements: UiElement[] }>;
	act(id: string, action?: string): Promise<unknown>;
	focusElement(id: string): Promise<unknown>;
	click(x: number, y: number, button?: "left" | "middle" | "right", count?: number): Promise<unknown>;
	move(x: number, y: number): Promise<unknown>;
	drag(x1: number, y1: number, x2: number, y2: number): Promise<unknown>;
	scroll(x: number, y: number, direction: "up" | "down" | "left" | "right", amount: number): Promise<unknown>;
	type(text: string): Promise<unknown>;
	key(...combos: string[]): Promise<unknown>;
	windows(): Promise<{ activeWindow: string | null; windows: DesktopWindow[] }>;
	activate(windowId: string): Promise<unknown>;
	open(command: string): Promise<unknown>;
	readClipboard(): Promise<string>;
	writeClipboard(text: string): Promise<void>;
	/** Starts the browser with remote debugging if it isn't running; returns its port on the machine. */
	browser(port?: number, profile?: string): Promise<number>;
	waitIdle(seconds?: number): Promise<unknown>;
}

/**
 * The helper on the machine. One set up before it was renamed (feesh-desktop), or one deleted since, gets the
 * current helper installed the first time it's missing (see ensureHelper).
 */
const COMMAND = `PATH="$HOME/.local/bin:$PATH"; command -v ${HELPER_PATH.split("/").at(-1)} >/dev/null 2>&1 || exit ${MISSING}; ${HELPER_PATH.split("/").at(-1)}`;

export class Desktop implements DesktopControl {
	private screen: { width: number; height: number; at: number } | null = null;
	private installed = false;
	/** screen-relay on this screen, when "Faster screen control" is on (see relay.ts). */
	private relay: ScreenRelay | null = null;
	/**
	 * The pixels the bot's coordinates are in: "shot" (screenshots scaled to SHOT_WIDTH), or "real" once
	 * screen-relay served a screenshot (full size). It only changes when a screenshot is taken, so the
	 * coordinates a bot sends always match the last screenshot it saw.
	 */
	private space: "shot" | "real" = "shot";

	constructor(private readonly target: SshTarget) {}

	/** Turns faster screen control (screen-relay) on or off for this screen. */
	useRelay(on: boolean, label: string): void {
		if (on) this.relay ??= new ScreenRelay(this.target, label);
		else if (this.relay) {
			this.relay.close();
			this.relay = null;
		}
	}

	/** Stops using screen-relay here (the machine is going away). */
	dispose(): void {
		this.relay?.close();
		this.relay = null;
	}

	/** screen-relay, when it's in use and working; null means the helper. */
	private live(): ScreenRelay | null {
		return this.space === "real" && this.relay?.ready() ? this.relay : null;
	}

	/** Runs `fn` through screen-relay; false when it can't (then the caller uses the helper). */
	private async viaRelay(fn: (relay: ScreenRelay) => Promise<unknown>): Promise<boolean> {
		const relay = this.live();
		if (!relay) return false;
		try {
			await fn(relay);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Runs the helper, installing it first when the machine doesn't have it, or when it's an older one that doesn't
	 * know the command yet (it prints its usage and exits 2); once per connection.
	 */
	private async exec(args: string, opts: { input?: string; timeoutMs: number }) {
		let r = await sshExec(this.target, `${COMMAND} ${args}`, opts);
		const outdated = r.code === 2 && r.stderr.includes("lets a Sekai bot see and use its Linux desktop");
		if ((r.code === MISSING || outdated) && !this.installed) {
			this.installed = true;
			await sshText(this.target, installHelperScript(), { input: helperSource, timeoutMs: 60_000 });
			r = await sshExec(this.target, `${COMMAND} ${args}`, opts);
		}
		if (r.code === MISSING) throw new Error("The desktop helper isn't on this machine and couldn't be installed");
		return r;
	}

	private async run<T>(args: string, input?: string): Promise<T> {
		const r = await this.exec(args, { input, timeoutMs: 60_000 });
		const out = new TextDecoder().decode(r.stdout);
		if (r.timedOut) throw new Error(`Timed out: ${args.slice(0, 40)}`);
		if (r.code !== 0 && !out.trim()) throw new Error(r.stderr.trim().slice(-2000) || `exit ${r.code}`);
		const line = out.trim().split("\n").at(-1) ?? "{}";
		const data = JSON.parse(line) as T & { error?: string };
		if (data.error) throw new Error(data.error);
		return data;
	}

	async info(): Promise<DesktopInfo> {
		const info = await this.run<DesktopInfo>("info");
		this.screen = { width: info.width, height: info.height, at: Date.now() };
		return info;
	}

	/** Screen size, refreshed now and then (it rarely changes). */
	async size(): Promise<{ width: number; height: number }> {
		if (!this.screen || Date.now() - this.screen.at > 60_000) await this.info();
		return this.screen ?? { width: SHOT_WIDTH, height: 800 };
	}

	async scale(): Promise<number> {
		if (this.space === "real") return 1;
		const { width } = await this.size();
		return width > SHOT_WIDTH ? width / SHOT_WIDTH : 1;
	}

	async screenshot(): Promise<Screenshot> {
		// The one place the coordinate space changes: to full size once screen-relay is ready, back when it's off.
		if (this.relay?.ready()) this.space = "real";
		else if (!this.relay) this.space = "shot";
		const relay = this.live();
		if (relay) {
			try {
				const png = await relay.call((c) => c.screenshot());
				const { width, height } = pngSize(png);
				return { png, width, height, scale: 1 };
			} catch {
				// The helper takes this one, at full size like screen-relay's.
			}
		}
		const width = this.space === "real" ? (await this.size()).width : SHOT_WIDTH;
		return this.helperShot(width);
	}

	private async helperShot(maxWidth: number): Promise<Screenshot> {
		const r = await this.exec(`screenshot ${maxWidth}`, { timeoutMs: 30_000 });
		if (r.code !== 0 || r.stdout.length < 24) {
			const text = new TextDecoder().decode(r.stdout).trim() || r.stderr.trim();
			let message = text;
			try {
				message = (JSON.parse(text) as { error?: string }).error ?? text;
			} catch {}
			throw new Error(`Couldn't take a screenshot: ${message || `exit ${r.code}`}`);
		}
		const { width, height } = pngSize(r.stdout);
		const screen = await this.size();
		return { png: r.stdout, width, height, scale: screen.width / width };
	}

	async tree(
		app?: string,
		all = false,
	): Promise<{ activeWindow: string | null; apps: string[]; elements: UiElement[] }> {
		return this.run(`tree ${app ? shq(app) : ""} ${all ? "--all" : ""}`);
	}

	act(id: string, action?: string) {
		return this.run<{ did: string }>(`act ${shq(id)} ${action ? shq(action) : ""}`);
	}

	focusElement(id: string) {
		return this.run(`focus-element ${shq(id)}`);
	}

	/** The element with keyboard focus (and whether it's a password field). */
	focused() {
		return this.run<{ role: string | null; name: string | null; password: boolean; app: string | null }>("focused");
	}

	/** x, y in screenshot pixels. */
	async click(x: number, y: number, button: "left" | "middle" | "right" = "left", count = 1) {
		const s = await this.scale();
		const [rx, ry] = [x * s, y * s];
		const b = button === "right" ? 3 : button === "middle" ? 2 : 1;
		if (
			await this.viaRelay((r) =>
				r.call((c) => c.input(clickEvents(r.fraction(rx, ry).x, r.fraction(rx, ry).y, b, count))),
			)
		)
			return { ok: true };
		return this.run(`click ${Math.round(rx)} ${Math.round(ry)} ${button} ${count}`);
	}

	async move(x: number, y: number) {
		const s = await this.scale();
		const [rx, ry] = [x * s, y * s];
		if (await this.viaRelay((r) => r.call((c) => c.move(r.fraction(rx, ry).x, r.fraction(rx, ry).y))))
			return { ok: true };
		return this.run(`move ${Math.round(rx)} ${Math.round(ry)}`);
	}

	async drag(x1: number, y1: number, x2: number, y2: number) {
		const s = await this.scale();
		const viaRelay = await this.viaRelay((r) => {
			const a = r.fraction(x1 * s, y1 * s);
			const b = r.fraction(x2 * s, y2 * s);
			return r.call((c) => c.input(dragEvents(a.x, a.y, b.x, b.y)));
		});
		if (viaRelay) return { ok: true };
		return this.run(`drag ${Math.round(x1 * s)} ${Math.round(y1 * s)} ${Math.round(x2 * s)} ${Math.round(y2 * s)}`);
	}

	async scroll(x: number, y: number, direction: "up" | "down" | "left" | "right", amount: number) {
		const s = await this.scale();
		const notches = Math.max(1, Math.round(amount));
		const delta = {
			dx: direction === "left" ? -notches : direction === "right" ? notches : 0,
			dy: direction === "up" ? -notches : direction === "down" ? notches : 0,
		};
		if (
			await this.viaRelay((r) =>
				r.call((c) => c.scroll(r.fraction(x * s, y * s).x, r.fraction(x * s, y * s).y, delta)),
			)
		)
			return { ok: true };
		return this.run(`scroll ${Math.round(x * s)} ${Math.round(y * s)} ${direction} ${notches}`);
	}

	async type(text: string) {
		if (await this.viaRelay((r) => r.call((c) => c.type(text)))) return { ok: true };
		return this.run("type", text);
	}

	async key(...combos: string[]) {
		const mapped = combos.map(relayCombo);
		if (
			mapped.every((m): m is string => m !== null) &&
			(await this.viaRelay((r) => r.call((c) => c.key(...mapped))))
		)
			return { ok: true };
		return this.run(`key ${combos.map(shq).join(" ")}`);
	}

	windows() {
		return this.run<{ activeWindow: string | null; windows: DesktopWindow[] }>("windows");
	}

	activate(windowId: string) {
		return this.run(`activate ${shq(windowId)}`);
	}

	open(command: string) {
		return this.run<{ activeWindow: string | null }>(`open sh -c ${shq(command)}`);
	}

	async readClipboard(): Promise<string> {
		return (await this.run<{ text: string }>("clipboard get")).text;
	}

	async writeClipboard(text: string): Promise<void> {
		await this.run("clipboard set", text);
	}

	/**
	 * Starts Chrome with remote debugging if it isn't running; returns its port on the machine. profile: its folder
	 * in the account's home (default ~/.config/sekai-chrome). A helper from before profiles is replaced first.
	 */
	async browser(port = 9222, profile?: string): Promise<number> {
		const args = `browser ${port}${profile ? ` ${shq(profile)}` : ""}`;
		try {
			return (await this.run<{ port: number }>(args)).port;
		} catch (err) {
			if (!profile || !/bad arguments/i.test(err instanceof Error ? err.message : String(err))) throw err;
			await sshText(this.target, installHelperScript(), { input: helperSource, timeoutMs: 60_000 });
			return (await this.run<{ port: number }>(args)).port;
		}
	}

	async waitIdle(seconds = 3) {
		const relay = this.live();
		if (relay) {
			// Screenshots through screen-relay are quick: two the same in a row means the screen settled.
			try {
				const until = Date.now() + seconds * 1000;
				let last = 0n;
				while (Date.now() < until) {
					const now = BigInt(Bun.hash(await relay.call((c) => c.screenshot())));
					if (now === last) return { idle: true };
					last = now;
					await Bun.sleep(120);
				}
				return { idle: false };
			} catch {
				// The helper's way below.
			}
		}
		return this.run<{ idle: boolean }>(`wait-idle ${seconds}`);
	}
}

/** The accessibility tree as compact lines for the model, in screenshot pixels. */
export function formatTree(
	tree: { activeWindow: string | null; apps: string[]; elements: UiElement[] },
	scale: number,
	limit = 300,
): string {
	const lines: string[] = [];
	const px = (n: number) => Math.round(n / scale);
	for (const e of tree.elements.slice(0, limit)) {
		const box = e.box ? ` at (${px(e.box[0])},${px(e.box[1])} ${px(e.box[2])}x${px(e.box[3])})` : "";
		const value = e.value ? ` value=${JSON.stringify(e.value.slice(0, 120))}` : "";
		const states = e.states.length ? ` ${e.states.join(" ")}` : "";
		const actions = e.actions.length ? ` actions:${e.actions.slice(0, 3).join("/")}` : "";
		lines.push(
			`[${e.id}] ${e.role}${e.name ? ` ${JSON.stringify(e.name.slice(0, 120))}` : ""}${box}${value}${states}${actions}`,
		);
	}
	const more =
		tree.elements.length > limit
			? `\n…and ${tree.elements.length - limit} more (ask for one app to narrow it down)`
			: "";
	return `Active window: ${tree.activeWindow ?? "none"}\nApps: ${tree.apps.filter(Boolean).join(", ")}\n${lines.join("\n")}${more}`;
}
