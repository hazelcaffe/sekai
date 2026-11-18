import { execFile, spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app, clipboard, screen, systemPreferences } from "electron";
import { macCombo } from "./combos.ts";
import helperSource from "./mac-helper.jxa" with { type: "text" };
import { captureMainScreen } from "./screen.ts";
import type { Button, DesktopInfo, DesktopWindow, Direction, Platform, UiTree } from "./types.ts";

/**
 * macOS: a JavaScript for Automation helper (CoreGraphics events for the mouse and keyboard, System Events
 * for the accessibility tree) and Electron's screen capture. Needs Accessibility and Screen Recording
 * permission for Sekai, which macOS asks for the first time.
 */

export class MacPlatform implements Platform {
	private helper: string | null = null;

	private path(): string {
		if (this.helper) return this.helper;
		const dir = join(app.getPath("userData"), "helpers");
		mkdirSync(dir, { recursive: true });
		const file = join(dir, "sekai-desktop.jxa");
		writeFileSync(file, helperSource);
		this.helper = file;
		return file;
	}

	private call<T>(cmd: string, args: Record<string, unknown> = {}, timeoutMs = 60_000): Promise<T> {
		return new Promise((resolve, reject) => {
			execFile(
				"osascript",
				["-l", "JavaScript", this.path(), cmd, JSON.stringify(args)],
				{ timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 },
				(err, stdout, stderr) => {
					const line = String(stdout).trim().split("\n").at(-1) ?? "";
					try {
						const msg = JSON.parse(line) as { ok: boolean; data?: T; error?: string };
						if (msg.ok) resolve(msg.data as T);
						else reject(new Error(permissionHint(msg.error ?? "The macOS helper failed")));
					} catch {
						reject(
							new Error(
								permissionHint(
									String(stderr || err?.message || line)
										.trim()
										.slice(-500),
								),
							),
						);
					}
				},
			);
		});
	}

	async problem(): Promise<string | null> {
		if (!systemPreferences.isTrustedAccessibilityClient(false)) {
			// Shows macOS's prompt that opens the right settings page.
			systemPreferences.isTrustedAccessibilityClient(true);
			return "Allow Sekai under System Settings → Privacy & Security → Accessibility, so bots can use the mouse and keyboard.";
		}
		if (systemPreferences.getMediaAccessStatus("screen") !== "granted") {
			return "Allow Sekai under System Settings → Privacy & Security → Screen Recording, then restart Sekai, so bots can see the screen.";
		}
		return null;
	}

	async info(): Promise<DesktopInfo> {
		const display = screen.getPrimaryDisplay();
		const pointer = screen.getCursorScreenPoint();
		const w = await this.windows();
		return {
			width: display.size.width,
			height: display.size.height,
			pointer: [pointer.x, pointer.y],
			activeWindow: w.activeWindow,
			windows: w.windows,
		};
	}

	screenshot(maxWidth: number): Promise<Buffer> {
		return captureMainScreen(maxWidth);
	}

	tree(appName?: string, all?: boolean): Promise<UiTree> {
		return this.call<UiTree>("tree", { app: appName ?? null, all: all ?? false }, 120_000);
	}

	act(id: string, action?: string): Promise<{ did: string }> {
		return this.call<{ did: string }>("act", { id, action: action ?? null });
	}

	async focus(id: string): Promise<void> {
		await this.call("focus", { id });
	}

	async click(x: number, y: number, button: Button, count: number): Promise<void> {
		await this.call("click", { x, y, button, count });
	}

	async move(x: number, y: number): Promise<void> {
		await this.call("move", { x, y });
	}

	async drag(x1: number, y1: number, x2: number, y2: number): Promise<void> {
		await this.call("drag", { x1, y1, x2, y2 });
	}

	async scroll(x: number, y: number, direction: Direction, amount: number): Promise<void> {
		const dy = direction === "up" ? amount : direction === "down" ? -amount : 0;
		const dx = direction === "left" ? amount : direction === "right" ? -amount : 0;
		await this.call("scroll", { x, y, dx, dy });
	}

	/** Short plain lines are typed key by key; anything else is pasted (and the clipboard put back). */
	async type(text: string): Promise<void> {
		const lines = text.replace(/\r\n/g, "\n").split("\n");
		for (const [i, line] of lines.entries()) {
			if (line) {
				if (line.length <= 200 && /^[\x20-\x7e]*$/.test(line)) await this.call("keystroke", { text: line });
				else await this.paste(line);
			}
			if (i < lines.length - 1) await this.key(["Return"]);
		}
	}

	private async paste(text: string): Promise<void> {
		const before = await clipboard.readText().catch(() => "");
		await clipboard.writeText(text);
		await this.key(["cmd+v"]);
		await new Promise((r) => setTimeout(r, 250));
		await clipboard.writeText(before);
	}

	async key(combos: string[]): Promise<void> {
		await this.call("keys", { combos: combos.map(macCombo) });
	}

	windows(): Promise<{ activeWindow: string | null; windows: DesktopWindow[] }> {
		return this.call("windows");
	}

	async activate(id: string): Promise<void> {
		await this.call("activate", { id });
	}

	async open(command: string): Promise<void> {
		const c = command.trim();
		// An app name ("TextEdit", "Google Chrome"), a URL or file, or else a shell command.
		const args =
			/^[a-z][a-z0-9+.-]*:\/\//i.test(c) || c.startsWith("/") ? [c] : /^[\w .&'-]+$/.test(c) ? ["-a", c] : null;
		if (args) {
			await new Promise<void>((resolve, reject) =>
				execFile("open", args, (err, _out, stderr) =>
					err ? reject(new Error(String(stderr).trim() || err.message)) : resolve(),
				),
			);
		} else {
			spawn(process.env.SHELL || "/bin/zsh", ["-lc", c], { detached: true, stdio: "ignore" }).unref();
		}
		await new Promise((r) => setTimeout(r, 1500));
	}

	dispose(): void {}
}

function permissionHint(message: string): string {
	if (/not allowed assistive access|-1719|-25211|accessibility/i.test(message)) {
		return `${message}. Allow Sekai under System Settings → Privacy & Security → Accessibility.`;
	}
	if (/not authorized to send Apple events|-1743/i.test(message)) {
		return `${message}. Allow Sekai to control System Events under System Settings → Privacy & Security → Automation.`;
	}
	return message;
}
