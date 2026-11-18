import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { app } from "electron";
import { windowsCombo } from "./combos.ts";
import type { Button, DesktopInfo, DesktopWindow, Direction, Platform, UiTree } from "./types.ts";
import hostSource from "./windows-host.ps1" with { type: "text" };

/**
 * Windows: a long-running Windows PowerShell helper (UI Automation for controls, SendInput for the mouse and
 * keyboard, GDI for screenshots), so each call is a round trip rather than a new process.
 */

interface Pending {
	resolve: (v: unknown) => void;
	reject: (e: Error) => void;
	timer: ReturnType<typeof setTimeout>;
}

export class WindowsPlatform implements Platform {
	private host: ChildProcessWithoutNullStreams | null = null;
	private ready: Promise<void> | null = null;
	private seq = 0;
	private pending = new Map<number, Pending>();

	private start(): Promise<void> {
		if (this.ready) return this.ready;
		const dir = join(app.getPath("userData"), "helpers");
		mkdirSync(dir, { recursive: true });
		const file = join(dir, "sekai-desktop.ps1");
		// A BOM tells Windows PowerShell the script is UTF-8.
		writeFileSync(file, `\ufeff${hostSource}`, "utf8");
		const host = spawn(
			"powershell.exe",
			["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", file],
			{ windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
		);
		this.host = host;
		let stderr = "";
		host.stderr.on("data", (b: Buffer) => {
			stderr = (stderr + b.toString("utf8")).slice(-4000);
		});
		this.ready = new Promise<void>((resolve, reject) => {
			const timer = setTimeout(
				() => reject(new Error(`The Windows helper didn't start: ${stderr.trim()}`)),
				30_000,
			);
			const lines = createInterface({ input: host.stdout });
			lines.on("line", (line) => {
				let msg: { ready?: boolean; id?: number; ok?: boolean; data?: unknown; error?: string };
				try {
					msg = JSON.parse(line);
				} catch {
					return;
				}
				if (msg.ready) {
					clearTimeout(timer);
					resolve();
					return;
				}
				const p = msg.id ? this.pending.get(msg.id) : undefined;
				if (!p || !msg.id) return;
				this.pending.delete(msg.id);
				clearTimeout(p.timer);
				if (msg.ok) p.resolve(msg.data);
				else p.reject(new Error(msg.error ?? "The Windows helper failed"));
			});
			host.on("exit", (code) => {
				clearTimeout(timer);
				const err = new Error(`The Windows helper stopped (${code}): ${stderr.trim().slice(-500)}`);
				reject(err);
				for (const p of this.pending.values()) {
					clearTimeout(p.timer);
					p.reject(err);
				}
				this.pending.clear();
				this.host = null;
				this.ready = null;
			});
		});
		return this.ready;
	}

	private async call<T>(cmd: string, args: Record<string, unknown> = {}, timeoutMs = 60_000): Promise<T> {
		await this.start();
		const host = this.host;
		if (!host) throw new Error("The Windows helper isn't running");
		const id = ++this.seq;
		return new Promise<T>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`The Windows helper took too long (${cmd})`));
				// A stuck helper (a hung UI Automation provider) is restarted on the next call.
				host.kill();
			}, timeoutMs);
			this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
			host.stdin.write(`${JSON.stringify({ id, cmd, args })}\n`);
		});
	}

	async problem(): Promise<string | null> {
		try {
			await this.start();
			return null;
		} catch (err) {
			return err instanceof Error ? err.message : String(err);
		}
	}

	info(): Promise<DesktopInfo> {
		return this.call<DesktopInfo>("info");
	}

	async screenshot(maxWidth: number): Promise<Buffer> {
		const r = await this.call<{ b64: string }>("screenshot", { maxWidth }, 30_000);
		return Buffer.from(r.b64, "base64");
	}

	tree(appName?: string, all?: boolean): Promise<UiTree> {
		return this.call<UiTree>("tree", { app: appName ?? null, all: all ?? false }, 90_000);
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
		const horizontal = direction === "left" || direction === "right";
		const notches = direction === "up" || direction === "right" ? amount : -amount;
		await this.call("scroll", { x, y, notches, horizontal });
	}

	async type(text: string): Promise<void> {
		await this.call("type", { text }, 30_000 + text.length * 20);
	}

	async key(combos: string[]): Promise<void> {
		await this.call("key", { combos: combos.map(windowsCombo) });
	}

	windows(): Promise<{ activeWindow: string | null; windows: DesktopWindow[] }> {
		return this.call("windows");
	}

	async activate(id: string): Promise<void> {
		await this.call("activate", { id });
	}

	async open(command: string): Promise<void> {
		await this.call("open", { command });
	}

	dispose(): void {
		this.host?.kill();
		this.host = null;
		this.ready = null;
	}
}
