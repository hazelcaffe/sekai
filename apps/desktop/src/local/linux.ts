import { spawn, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import helperSource from "../../../server/src/machines/sekai-desktop.py" with { type: "text" };
import { xdotoolCombo } from "./combos.ts";
import { captureMainScreen } from "./screen.ts";
import type { Button, DesktopInfo, DesktopWindow, Direction, Platform, UiTree } from "./types.ts";

/**
 * Linux (X11): the same helper bots use on their own computers (xdotool for input, ImageMagick for
 * screenshots, AT-SPI for the accessibility tree, wmctrl for windows).
 */

function has(bin: string): boolean {
	return spawnSync("sh", ["-c", `command -v ${bin}`]).status === 0;
}

export class LinuxPlatform implements Platform {
	private helper: string | null = null;

	private path(): string {
		if (this.helper) return this.helper;
		const dir = join(app.getPath("userData"), "helpers");
		mkdirSync(dir, { recursive: true });
		const file = join(dir, "sekai-desktop.py");
		writeFileSync(file, helperSource);
		chmodSync(file, 0o755);
		this.helper = file;
		return file;
	}

	private run(args: string[], input?: string): Promise<{ stdout: Buffer; stderr: string; code: number }> {
		return new Promise((resolve, reject) => {
			// Apps the bot opens go to X11 (XWayland in a Wayland session), where it can see and use them.
			const env = { ...process.env, GDK_BACKEND: "x11", QT_QPA_PLATFORM: "xcb", SDL_VIDEODRIVER: "x11" };
			const child = spawn("python3", [this.path(), ...args], { stdio: ["pipe", "pipe", "pipe"], env });
			const out: Buffer[] = [];
			const err: Buffer[] = [];
			child.stdout.on("data", (b: Buffer) => out.push(b));
			child.stderr.on("data", (b: Buffer) => err.push(b));
			child.on("error", reject);
			const timer = setTimeout(() => child.kill("SIGKILL"), 60_000);
			child.on("close", (code) => {
				clearTimeout(timer);
				resolve({ stdout: Buffer.concat(out), stderr: Buffer.concat(err).toString("utf8"), code: code ?? 1 });
			});
			child.stdin.end(input ?? "");
		});
	}

	private async json<T>(args: string[], input?: string): Promise<T> {
		const r = await this.run(args, input);
		const line = r.stdout.toString("utf8").trim().split("\n").at(-1) ?? "";
		let data: T & { error?: string };
		try {
			data = JSON.parse(line) as T & { error?: string };
		} catch {
			throw new Error((r.stderr || line || `sekai-desktop ${args[0]} failed`).trim().slice(-500));
		}
		if (data.error) throw new Error(data.error);
		return data;
	}

	async problem(): Promise<string | null> {
		if (!process.env.DISPLAY) {
			return process.env.WAYLAND_DISPLAY
				? "Bots can't use a Wayland-only session yet. Log in with an X11 (Xorg) session."
				: "There's no graphical session (DISPLAY isn't set).";
		}
		const missing = ["python3", "xdotool", "import"].filter((b) => !has(b));
		if (missing.length) {
			return `Install ${missing.map((m) => (m === "import" ? "imagemagick" : m)).join(", ")} so bots can see and use this computer (e.g. sudo apt install xdotool imagemagick wmctrl python3-gi gir1.2-atspi-2.0).`;
		}
		if (process.env.XDG_SESSION_TYPE === "wayland" || process.env.WAYLAND_DISPLAY) {
			return "This is a Wayland session: bots can only see and use X11 apps here (the ones they open run that way). Log in with an X11 (Xorg) session for full support.";
		}
		return null;
	}

	info(): Promise<DesktopInfo> {
		return this.json<DesktopInfo>(["info"]);
	}

	async screenshot(maxWidth: number): Promise<Buffer> {
		const r = await this.run(["screenshot", String(maxWidth)]);
		if (r.code === 0 && r.stdout.length > 24 && r.stdout[0] === 0x89) return r.stdout;
		// ImageMagick can't grab some sessions (e.g. XWayland); Electron's capture may.
		return captureMainScreen(maxWidth);
	}

	tree(appName?: string, all?: boolean): Promise<UiTree> {
		return this.json<UiTree>(["tree", ...(appName ? [appName] : []), ...(all ? ["--all"] : [])]);
	}

	act(id: string, action?: string): Promise<{ did: string }> {
		return this.json<{ did: string }>(["act", id, ...(action ? [action] : [])]);
	}

	async focus(id: string): Promise<void> {
		await this.json(["focus-element", id]);
	}

	async click(x: number, y: number, button: Button, count: number): Promise<void> {
		await this.json(["click", String(x), String(y), button, String(count)]);
	}

	async move(x: number, y: number): Promise<void> {
		await this.json(["move", String(x), String(y)]);
	}

	async drag(x1: number, y1: number, x2: number, y2: number): Promise<void> {
		await this.json(["drag", String(x1), String(y1), String(x2), String(y2)]);
	}

	async scroll(x: number, y: number, direction: Direction, amount: number): Promise<void> {
		await this.json(["scroll", String(x), String(y), direction, String(amount)]);
	}

	async type(text: string): Promise<void> {
		await this.json(["type"], text);
	}

	async key(combos: string[]): Promise<void> {
		await this.json(["key", ...combos.map(xdotoolCombo)]);
	}

	windows(): Promise<{ activeWindow: string | null; windows: DesktopWindow[] }> {
		return this.json(["windows"]);
	}

	async activate(id: string): Promise<void> {
		await this.json(["activate", id]);
	}

	async open(command: string): Promise<void> {
		const target = /^https?:\/\//i.test(command) ? `xdg-open ${JSON.stringify(command)}` : command;
		await this.json(["open", "sh", "-c", target]);
	}

	dispose(): void {}
}
